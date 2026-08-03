from __future__ import annotations

import json
import uuid
from typing import Any

from app.core.config import Settings


class FIRAssetTableResolver:
    """Resolve document identifiers without guessing and persist their roles."""

    def __init__(self, session: Any, settings: Settings) -> None:
        self._session = session
        self._settings = settings
        self._references_table = settings.qualify_metadata_object_name(
            "TBL_FIR_ASSET_TABLE_REFERENCES"
        )
        self._projects_table = settings.qualify_metadata_object_name("TBL_PROJECTS")

    def resolve_and_store(
        self,
        *,
        asset_id: str,
        project_id: str,
        references: list[tuple[str, str]],
    ) -> list[dict[str, Any]]:
        defaults = self._project_defaults(project_id)
        catalog = self._catalog([identifier for identifier, _role in references])
        self._session.sql(
            f"DELETE FROM {self._references_table} WHERE SQL_ASSET_ID = ? AND PROJECT_ID = ?",
            [asset_id, project_id],
        ).collect()
        resolved = [
            self._resolve(raw_identifier=identifier, role=role, catalog=catalog, defaults=defaults)
            for identifier, role in references
            if str(identifier).strip()
        ]
        self._persist_many(
            asset_id=asset_id,
            project_id=project_id,
            items=resolved,
        )
        return resolved

    def _project_defaults(self, project_id: str) -> tuple[str, str]:
        try:
            rows = self._session.sql(
                f"SELECT PROJECT_METADATA FROM {self._projects_table} WHERE PROJECT_ID = ?",
                [project_id],
            ).collect()
            metadata = rows[0]["PROJECT_METADATA"] if rows else {}
            if isinstance(metadata, str):
                metadata = json.loads(metadata)
            return (
                str((metadata or {}).get("database") or (metadata or {}).get("database_name") or "").upper(),
                str((metadata or {}).get("schema") or (metadata or {}).get("schema_name") or "").upper(),
            )
        except Exception:
            return "", ""

    def _catalog(self, identifiers: list[str]) -> list[dict[str, Any]]:
        semantic: list[dict[str, Any]] = []
        try:
            semantic_rows = self._session.sql(
                f"SELECT * FROM {self._settings.resolved_semantic_views_table}"
            ).collect()
            for row in semantic_rows:
                raw = row.as_dict() if hasattr(row, "as_dict") else dict(row)
                normalized = self._normalize_catalog_row(raw, semantic_available=True)
                status = str(normalized.get("STATUS") or "").strip().upper()
                if status and status not in {"ACTIVE", "CURRENT", "READY", "PUBLISHED"}:
                    continue
                if normalized.get("FQN"):
                    semantic.append(normalized)
        except Exception:
            # A physical table can still be resolved when the configured
            # semantic registry is absent or has not been granted yet.
            semantic = []

        semantic_by_fqn = {
            str(row["FQN"]).upper(): row
            for row in semantic
        }
        table_names = sorted(
            {
                str(identifier).strip().strip('"').split(".")[-1].strip('"').upper()
                for identifier in identifiers
                if str(identifier).strip()
            }
        )
        if not table_names:
            return semantic
        placeholders = ", ".join("?" for _value in table_names)
        try:
            physical_rows = self._session.sql(f"""
                SELECT TABLE_CATALOG AS DATABASE_NAME, TABLE_SCHEMA AS SCHEMA_NAME,
                       TABLE_NAME, CONCAT_WS('.', TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME) AS FQN
                FROM SNOWFLAKE.ACCOUNT_USAGE.TABLES
                WHERE DELETED IS NULL
                  AND TABLE_SCHEMA <> 'INFORMATION_SCHEMA'
                  AND UPPER(TABLE_NAME) IN ({placeholders})
            """, table_names).collect()
        except Exception:
            # Environments without ACCOUNT_USAGE imported privileges can still
            # resolve every table represented in the semantic registry.
            return semantic
        catalog_by_fqn: dict[str, dict[str, Any]] = dict(semantic_by_fqn)
        for physical_row in physical_rows:
            raw = (
                physical_row.as_dict()
                if hasattr(physical_row, "as_dict")
                else dict(physical_row)
            )
            physical = self._normalize_catalog_row(raw, semantic_available=False)
            physical_fqn = str(physical.get("FQN") or "").upper()
            if not physical_fqn:
                continue
            semantic_row = semantic_by_fqn.get(physical_fqn)
            catalog_by_fqn[physical_fqn] = {
                **physical,
                "VIEW_ID": semantic_row.get("VIEW_ID") if semantic_row else None,
                "STATUS": semantic_row.get("STATUS") if semantic_row else None,
                "SEMANTIC_AVAILABLE": bool(semantic_row),
            }
        return list(catalog_by_fqn.values())

    @staticmethod
    def _normalize_catalog_row(
        row: dict[str, Any],
        *,
        semantic_available: bool,
    ) -> dict[str, Any]:
        values = {str(key).upper(): value for key, value in row.items()}

        def pick(*names: str) -> Any:
            for name in names:
                value = values.get(name)
                if value is not None and str(value).strip():
                    return value
            return None

        database = str(
            pick("DATABASE_NAME", "DB_NAME", "TABLE_CATALOG", "DATABASE") or ""
        ).strip()
        schema = str(
            pick("SCHEMA_NAME", "TABLE_SCHEMA", "SCHEMA") or ""
        ).strip()
        table = str(
            pick("TABLE_NAME", "OBJECT_NAME", "NAME") or ""
        ).strip()
        fqn = str(
            pick("FQN", "SOURCE_FQN", "TABLE_FQN", "QUALIFIED_NAME") or ""
        ).strip()
        if not fqn and database and schema and table:
            fqn = f"{database}.{schema}.{table}"
        if fqn and (not database or not schema or not table):
            parts = [part.strip().strip('"') for part in fqn.split(".")]
            if len(parts) == 3:
                database = database or parts[0]
                schema = schema or parts[1]
                table = table or parts[2]

        return {
            **values,
            "DATABASE_NAME": database.upper(),
            "SCHEMA_NAME": schema.upper(),
            "TABLE_NAME": table.upper(),
            "FQN": fqn.upper(),
            "VIEW_ID": pick("VIEW_ID", "TABLE_VIEW_ID", "SEMANTIC_VIEW_ID"),
            "STATUS": pick("STATUS", "VIEW_STATUS", "STATE"),
            "SEMANTIC_AVAILABLE": semantic_available,
        }

    @staticmethod
    def _resolve(
        *,
        raw_identifier: str,
        role: str,
        catalog: list[dict[str, Any]],
        defaults: tuple[str, str],
    ) -> dict[str, Any]:
        raw = raw_identifier.strip().strip('"').upper()
        parts = [part.strip('"') for part in raw.split(".") if part]
        default_database, default_schema = defaults

        def fqn(row: dict[str, Any]) -> str:
            return str(row.get("FQN") or f"{row.get('DATABASE_NAME')}.{row.get('SCHEMA_NAME')}.{row.get('TABLE_NAME')}").upper()

        method = "unresolved"
        candidates: list[dict[str, Any]] = []
        if len(parts) == 3:
            candidates = [row for row in catalog if fqn(row) == ".".join(parts)]
            method = "exact_fqn"
        elif len(parts) == 2:
            candidates = [
                row for row in catalog
                if str(row.get("SCHEMA_NAME") or "").upper() == parts[0]
                and str(row.get("TABLE_NAME") or "").upper() == parts[1]
            ]
            method = "unique_schema_table"
        elif len(parts) == 1 and default_database and default_schema:
            candidates = [
                row for row in catalog
                if str(row.get("DATABASE_NAME") or "").upper() == default_database
                and str(row.get("SCHEMA_NAME") or "").upper() == default_schema
                and str(row.get("TABLE_NAME") or "").upper() == parts[0]
            ]
            method = "project_database_schema"
        if not candidates and len(parts) == 1:
            candidates = [
                row for row in catalog
                if str(row.get("TABLE_NAME") or "").upper() == parts[0]
            ]
            method = "unique_table_name"

        status = "resolved" if len(candidates) == 1 else "ambiguous" if len(candidates) > 1 else "unresolved"
        selected = candidates[0] if len(candidates) == 1 else None
        semantic_available = bool(selected and (selected.get("SEMANTIC_AVAILABLE", selected.get("VIEW_ID") is not None)))
        return {
            "reference_id": f"asset_ref_{uuid.uuid4().hex[:20]}",
            "raw_identifier": raw_identifier,
            "reference_role": role,
            "resolution_status": status,
            "resolved_fqn": fqn(selected) if selected else None,
            "candidate_fqns": [fqn(row) for row in candidates],
            "semantic_table_view_id": selected.get("VIEW_ID") if selected else None,
            "semantic_status": "active" if semantic_available else "missing",
            "resolution_method": method,
            "resolution_confidence": 1.0 if selected and method == "exact_fqn" else 0.9 if selected else 0.0,
        }

    def _persist_many(
        self,
        *,
        asset_id: str,
        project_id: str,
        items: list[dict[str, Any]],
    ) -> None:
        if not items:
            return
        payload = [
            {
                **item,
                "asset_id": asset_id,
                "project_id": project_id,
            }
            for item in items
        ]
        self._session.sql(f"""
            MERGE INTO {self._references_table} target
            USING (
                SELECT
                    value:reference_id::STRING AS REFERENCE_ID,
                    value:asset_id::STRING AS SQL_ASSET_ID,
                    value:project_id::STRING AS PROJECT_ID,
                    value:raw_identifier::STRING AS RAW_IDENTIFIER,
                    value:reference_role::STRING AS REFERENCE_ROLE,
                    value:resolution_status::STRING AS RESOLUTION_STATUS,
                    value:resolved_fqn::STRING AS RESOLVED_FQN,
                    value:candidate_fqns AS CANDIDATE_FQNS,
                    value:semantic_table_view_id::STRING AS SEMANTIC_TABLE_VIEW_ID,
                    value:semantic_status::STRING AS SEMANTIC_STATUS,
                    value:resolution_method::STRING AS RESOLUTION_METHOD,
                    value:resolution_confidence::FLOAT AS RESOLUTION_CONFIDENCE
                FROM TABLE(FLATTEN(INPUT => PARSE_JSON(?)))
            ) source
            ON target.REFERENCE_ID = source.REFERENCE_ID
            WHEN NOT MATCHED THEN INSERT (
                REFERENCE_ID, SQL_ASSET_ID, PROJECT_ID, RAW_IDENTIFIER,
                REFERENCE_ROLE, RESOLUTION_STATUS, RESOLVED_FQN, CANDIDATE_FQNS,
                SEMANTIC_TABLE_VIEW_ID, SEMANTIC_STATUS, RESOLUTION_METHOD,
                RESOLUTION_CONFIDENCE, ATTRIBUTES
            ) VALUES (
                source.REFERENCE_ID, source.SQL_ASSET_ID, source.PROJECT_ID,
                source.RAW_IDENTIFIER, source.REFERENCE_ROLE,
                source.RESOLUTION_STATUS, source.RESOLVED_FQN,
                source.CANDIDATE_FQNS, source.SEMANTIC_TABLE_VIEW_ID,
                source.SEMANTIC_STATUS, source.RESOLUTION_METHOD,
                source.RESOLUTION_CONFIDENCE, PARSE_JSON('{{}}')
            )
        """, [json.dumps(payload, default=str)]).collect()
