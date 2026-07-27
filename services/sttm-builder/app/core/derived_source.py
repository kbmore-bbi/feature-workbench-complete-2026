import base64
import json
import hashlib
import uuid
from typing import Any

import sqlglot
from sqlglot import exp
from snowflake.snowpark import Session
from snowflake.snowpark.types import StructField

from app.core.config import Settings
from app.core.exceptions import AppValidationError, SnowflakeQueryError
from app.core.table_selection import TableSelectionService
from app.schema.common import TableRef
from app.schema.derived_source import (
    DerivedSourceDefinition,
    DerivedSourcePreviewColumn,
    DerivedSourcePreviewRow,
    DerivedSourceRecord,
    DerivedSourceValidateResponse,
)


class DerivedSourceService:
    def __init__(self, session: Session, settings: Settings) -> None:
        self._session = session
        self._settings = settings
        self._table_selection = TableSelectionService(type("Client", (), {"session": session})(), settings)

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    @staticmethod
    def _quote_literal(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    @staticmethod
    def _json_literal(value: Any) -> str:
        # Snowflake interprets backslash escapes inside ordinary SQL string
        # literals. Embedding json.dumps() output directly can therefore turn
        # JSON escapes such as ``\n`` into raw control characters before
        # PARSE_JSON sees them. Base64 keeps the SQL literal ASCII-only and
        # round-trips arbitrary agent-generated metadata safely.
        payload = json.dumps(value, default=str, ensure_ascii=False).encode("utf-8")
        encoded = base64.b64encode(payload).decode("ascii")
        return f"BASE64_DECODE_STRING('{encoded}')"

    @staticmethod
    def _build_preview_column_names(fields: list[StructField]) -> list[str]:
        seen: dict[str, int] = {}
        normalized: list[str] = []

        for index, field in enumerate(fields, start=1):
            base_name = str(field.name or f"COLUMN_{index}")
            count = seen.get(base_name, 0) + 1
            seen[base_name] = count
            normalized.append(base_name if count == 1 else f"{base_name}_{count}")

        return normalized

    @property
    def _table_name(self) -> str:
        parts = self._settings.qualify_metadata_object_name(self._settings.snowflake_derived_sources_table).split(".")
        if len(parts) != 3:
            raise AppValidationError(
                "SNOWFLAKE_DERIVED_SOURCES_TABLE must be a fully-qualified DATABASE.SCHEMA.TABLE name."
            )
        database, schema, table = parts
        return (
            f"{self._quote_identifier(database)}."
            f"{self._quote_identifier(schema)}."
            f"{self._quote_identifier(table)}"
        )

    def ensure_table_exists(self) -> None:
        ddl = f"""
        CREATE TABLE IF NOT EXISTS {self._table_name} (
            DERIVED_SOURCE_ID STRING,
            DERIVED_SOURCE_NAME STRING,
            SQL_TEXT STRING,
            DRIVING_TABLE STRING,
            SOURCE_TABLES VARIANT,
            PARENT_DERIVED_SOURCE_IDS VARIANT,
            BASE_SOURCE_TABLES VARIANT,
            RELATIONSHIPS VARIANT,
            FILTERS VARIANT,
            SELECTED_COLUMNS_BY_TABLE VARIANT,
            PREVIEW_COLUMNS VARIANT,
            PURPOSE STRING,
            BUSINESS_DESCRIPTION STRING,
            OUTPUT_COLUMNS VARIANT,
            COLUMN_SEMANTICS VARIANT,
            SEMANTIC_PROJECTION VARIANT,
            LINEAGE_DEPTH NUMBER,
            SEMANTIC_BUNDLE_ID STRING,
            SEMANTIC_VIEW_NAME STRING,
            SEMANTIC_LEVEL STRING,
            UPSTREAM_HASH STRING,
            SOURCE_DEPENDENCY_HASH STRING,
            GENERATED_BY_REQUEST_ID STRING,
            PHYSICAL_VIEW_NAME STRING,
            CREATED_BY STRING,
            CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
            UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
            IS_ACTIVE BOOLEAN DEFAULT TRUE
        )
        """
        try:
            self._session.sql(ddl).collect()
        except Exception as exc:
            raise SnowflakeQueryError(
                f"Failed to ensure derived sources table exists: {exc}"
            ) from exc

    @staticmethod
    def _storage_unavailable(exc: Exception) -> bool:
        message = str(exc).lower()
        return (
            "insufficient privileges" in message
            or "does not exist" in message
            or "object does not exist" in message
            or "not authorized" in message
        )

    def validate_sql(self, body: DerivedSourceDefinition) -> DerivedSourceValidateResponse:
        normalized_sql = self._qualify_selected_source_tables(
            body.sql_text.strip().rstrip(";"),
            body.source_tables,
        )
        if not normalized_sql:
            raise AppValidationError("Derived SQL cannot be empty.")
        self._validate_select_only(normalized_sql)

        preview_query = f"SELECT * FROM ({normalized_sql}) AS DERIVED_SOURCE_PREVIEW LIMIT 5"
        try:
            dataframe = self._session.sql(preview_query)
            rows = dataframe.collect()
            fields = list(dataframe.schema.fields)
        except Exception as exc:
            raise SnowflakeQueryError(f"Failed to validate derived SQL: {exc}") from exc

        preview_column_names = self._build_preview_column_names(fields)
        primary_key_names = self._resolve_primary_key_names(body)
        preview_columns = [
            DerivedSourcePreviewColumn(
                name=preview_name,
                data_type=str(field.datatype),
                is_primary_key=field.name.upper() in primary_key_names,
            )
            for field, preview_name in zip(fields, preview_column_names)
        ]
        preview_rows = [
            DerivedSourcePreviewRow(
                values=json.loads(
                    json.dumps(
                        {
                            column_name: value
                            for column_name, value in zip(preview_column_names, tuple(row))
                        },
                        default=str,
                    )
                )
            )
            for row in rows
        ]

        return DerivedSourceValidateResponse(
            message="SQL validated successfully.",
            sql_text=normalized_sql,
            preview_columns=preview_columns,
            preview_rows=preview_rows,
        )

    @staticmethod
    def _qualify_selected_source_tables(sql_text: str, source_tables: list[TableRef]) -> str:
        """Resolve Analyst logical table names against the selected physical graph.

        Cortex Analyst can emit the semantic table's short name (for example
        ``CONTACT_FAMILIES``), while the service session normally uses the STTM
        metadata schema.  Executing that SQL unchanged therefore looks in the
        wrong schema.  Only unqualified names that uniquely identify a selected
        source are rewritten; CTE references and already-qualified objects are
        preserved.
        """
        if not sql_text or not source_tables:
            return sql_text
        try:
            statement = sqlglot.parse_one(sql_text, read="snowflake")
        except Exception:
            # The normal select-only validator returns the parse error with the
            # established API contract.
            return sql_text

        cte_names = {
            str(cte.alias_or_name or "").upper()
            for cte in statement.find_all(exp.CTE)
            if cte.alias_or_name
        }
        lookup: dict[str, list[TableRef]] = {}
        for source in source_tables:
            names = {
                source.table.upper(),
                f"{source.schema}_{source.table}".upper(),
                f"{source.database}_{source.schema}_{source.table}".upper(),
            }
            for name in names:
                lookup.setdefault(name, []).append(source)

        changed = False
        for table in statement.find_all(exp.Table):
            if table.catalog or table.db:
                continue
            short_name = str(table.name or "").upper()
            if not short_name or short_name in cte_names:
                continue
            matches = lookup.get(short_name, [])
            unique = {item.qualified_name.upper(): item for item in matches}
            if len(unique) > 1:
                candidates = ", ".join(sorted(unique))
                raise AppValidationError(
                    f"Unqualified table '{table.name}' is ambiguous in the selected source graph. "
                    f"Use one of: {candidates}."
                )
            if not unique:
                continue
            source = next(iter(unique.values()))
            alias = table.args.get("alias")
            table.set("catalog", exp.to_identifier(source.database))
            table.set("db", exp.to_identifier(source.schema))
            table.set("this", exp.to_identifier(source.table))
            if alias is not None:
                table.set("alias", alias)
            changed = True

        return statement.sql(dialect="snowflake", pretty=True) if changed else sql_text

    @staticmethod
    def _validate_select_only(sql_text: str) -> None:
        try:
            statements = sqlglot.parse(sql_text, read="snowflake")
        except Exception as exc:
            raise AppValidationError(f"Derived SQL could not be parsed: {exc}") from exc
        if len(statements) != 1 or not isinstance(statements[0], exp.Query):
            raise AppValidationError("Derived sources must contain one SELECT or CTE query.")
        forbidden = (
            exp.Insert,
            exp.Update,
            exp.Delete,
            exp.Merge,
            exp.Create,
            exp.Alter,
            exp.Drop,
            exp.Command,
        )
        if any(isinstance(node, forbidden) for node in statements[0].walk()):
            raise AppValidationError("Derived SQL must be read-only SELECT/CTE SQL.")

    def list_sources(self) -> list[DerivedSourceRecord]:
        try:
            rows = self._session.sql(
                f"SELECT * FROM {self._table_name} WHERE IS_ACTIVE = TRUE ORDER BY UPDATED_AT DESC"
            ).collect()
        except Exception as exc:
            if self._storage_unavailable(exc):
                return []
            raise SnowflakeQueryError(f"Failed to list derived sources: {exc}") from exc

        return [self._row_to_record(row.as_dict()) for row in rows]

    def get_sources_by_ids(self, source_ids: list[str]) -> list[DerivedSourceRecord]:
        if not source_ids:
            return []
        ids_sql = ", ".join(self._quote_literal(source_id) for source_id in source_ids)
        try:
            rows = self._session.sql(
                f"""
                SELECT * FROM {self._table_name}
                WHERE IS_ACTIVE = TRUE
                  AND DERIVED_SOURCE_ID IN ({ids_sql})
                """
            ).collect()
        except Exception as exc:
            if self._storage_unavailable(exc):
                return []
            raise
        records = {record.derived_source_id: record for record in (self._row_to_record(row.as_dict()) for row in rows)}
        return [records[source_id] for source_id in source_ids if source_id in records]

    def save_source(self, body: DerivedSourceDefinition) -> DerivedSourceRecord:
        self.ensure_table_exists()
        validation = self.validate_sql(body)
        persisted_sql = validation.sql_text or body.sql_text
        if persisted_sql != body.sql_text:
            body = body.model_copy(update={"sql_text": persisted_sql})

        source_id = body.derived_source_id or f"derived_{uuid.uuid4().hex[:12]}"
        current_user = self._current_user()
        parent_records = self.get_sources_by_ids(body.parent_derived_source_ids)
        base_source_tables = self._resolve_base_source_tables(body, parent_records)
        lineage_depth = self._lineage_depth(parent_records)
        upstream_hash = self._upstream_hash(body, parent_records)
        output_columns = self._reconcile_output_columns(
            body.output_columns,
            validation.preview_columns,
        )
        column_semantics = self._derive_column_semantics(
            sql_text=body.sql_text,
            output_columns=output_columns,
            supplied=body.column_semantics,
        )
        semantic_quality, semantic_coverage_issues = self._semantic_quality(
            body=body,
            output_columns=output_columns,
            column_semantics=column_semantics,
        )
        semantic_projection = self._build_virtual_semantic_projection(
            source_id=source_id,
            body=body,
            output_columns=output_columns,
            preview_columns=validation.preview_columns,
            base_source_tables=base_source_tables,
            lineage_depth=lineage_depth,
            upstream_hash=upstream_hash,
            column_semantics=column_semantics,
            semantic_quality=semantic_quality,
            semantic_coverage_issues=semantic_coverage_issues,
        )

        merge_sql = f"""
        MERGE INTO {self._table_name} AS target
        USING (
            SELECT
                {self._quote_literal(source_id)} AS DERIVED_SOURCE_ID,
                {self._quote_literal(body.derived_source_name)} AS DERIVED_SOURCE_NAME,
                {self._quote_literal(body.sql_text)} AS SQL_TEXT,
                {self._quote_literal(body.driving_table.qualified_name if body.driving_table else "")} AS DRIVING_TABLE,
                PARSE_JSON({self._json_literal([table.model_dump() for table in body.source_tables])}) AS SOURCE_TABLES,
                PARSE_JSON({self._json_literal(body.parent_derived_source_ids)}) AS PARENT_DERIVED_SOURCE_IDS,
                PARSE_JSON({self._json_literal([table.model_dump(mode="json") for table in base_source_tables])}) AS BASE_SOURCE_TABLES,
                PARSE_JSON({self._json_literal([item.model_dump() for item in body.relationships])}) AS RELATIONSHIPS,
                PARSE_JSON({self._json_literal(body.filters)}) AS FILTERS,
                PARSE_JSON({self._json_literal(body.selected_columns_by_table)}) AS SELECTED_COLUMNS_BY_TABLE,
                PARSE_JSON({self._json_literal([column.model_dump() for column in validation.preview_columns])}) AS PREVIEW_COLUMNS,
                {self._quote_literal(body.purpose or "")} AS PURPOSE,
                {self._quote_literal(body.business_description or "")} AS BUSINESS_DESCRIPTION,
                PARSE_JSON({self._json_literal(output_columns)}) AS OUTPUT_COLUMNS,
                PARSE_JSON({self._json_literal(column_semantics)}) AS COLUMN_SEMANTICS,
                PARSE_JSON({self._json_literal(semantic_projection)}) AS SEMANTIC_PROJECTION,
                {lineage_depth} AS LINEAGE_DEPTH,
                NULL AS SEMANTIC_BUNDLE_ID,
                NULL AS SEMANTIC_VIEW_NAME,
                NULL AS SEMANTIC_LEVEL,
                {self._quote_literal(upstream_hash)} AS UPSTREAM_HASH,
                {self._quote_literal(upstream_hash)} AS SOURCE_DEPENDENCY_HASH,
                {self._quote_literal(body.generated_by_request_id or "")} AS GENERATED_BY_REQUEST_ID,
                {self._quote_literal(current_user)} AS CREATED_BY
        ) AS source
        ON target.DERIVED_SOURCE_ID = source.DERIVED_SOURCE_ID
        WHEN MATCHED THEN UPDATE SET
            DERIVED_SOURCE_NAME = source.DERIVED_SOURCE_NAME,
            SQL_TEXT = source.SQL_TEXT,
            DRIVING_TABLE = source.DRIVING_TABLE,
            SOURCE_TABLES = source.SOURCE_TABLES,
            PARENT_DERIVED_SOURCE_IDS = source.PARENT_DERIVED_SOURCE_IDS,
            BASE_SOURCE_TABLES = source.BASE_SOURCE_TABLES,
            RELATIONSHIPS = source.RELATIONSHIPS,
            FILTERS = source.FILTERS,
            SELECTED_COLUMNS_BY_TABLE = source.SELECTED_COLUMNS_BY_TABLE,
            PREVIEW_COLUMNS = source.PREVIEW_COLUMNS,
            PURPOSE = source.PURPOSE,
            BUSINESS_DESCRIPTION = source.BUSINESS_DESCRIPTION,
            OUTPUT_COLUMNS = source.OUTPUT_COLUMNS,
            COLUMN_SEMANTICS = source.COLUMN_SEMANTICS,
            SEMANTIC_PROJECTION = source.SEMANTIC_PROJECTION,
            LINEAGE_DEPTH = source.LINEAGE_DEPTH,
            SEMANTIC_BUNDLE_ID = COALESCE(target.SEMANTIC_BUNDLE_ID, source.SEMANTIC_BUNDLE_ID),
            SEMANTIC_VIEW_NAME = COALESCE(target.SEMANTIC_VIEW_NAME, source.SEMANTIC_VIEW_NAME),
            SEMANTIC_LEVEL = COALESCE(target.SEMANTIC_LEVEL, source.SEMANTIC_LEVEL),
            UPSTREAM_HASH = source.UPSTREAM_HASH,
            SOURCE_DEPENDENCY_HASH = source.SOURCE_DEPENDENCY_HASH,
            GENERATED_BY_REQUEST_ID = source.GENERATED_BY_REQUEST_ID,
            UPDATED_AT = CURRENT_TIMESTAMP(),
            IS_ACTIVE = TRUE
        WHEN NOT MATCHED THEN INSERT (
            DERIVED_SOURCE_ID,
            DERIVED_SOURCE_NAME,
            SQL_TEXT,
            DRIVING_TABLE,
            SOURCE_TABLES,
            PARENT_DERIVED_SOURCE_IDS,
            BASE_SOURCE_TABLES,
            RELATIONSHIPS,
            FILTERS,
            SELECTED_COLUMNS_BY_TABLE,
            PREVIEW_COLUMNS,
            PURPOSE,
            BUSINESS_DESCRIPTION,
            OUTPUT_COLUMNS,
            COLUMN_SEMANTICS,
            SEMANTIC_PROJECTION,
            LINEAGE_DEPTH,
            SEMANTIC_BUNDLE_ID,
            SEMANTIC_VIEW_NAME,
            SEMANTIC_LEVEL,
            UPSTREAM_HASH,
            SOURCE_DEPENDENCY_HASH,
            GENERATED_BY_REQUEST_ID,
            CREATED_BY,
            CREATED_AT,
            UPDATED_AT,
            IS_ACTIVE
        ) VALUES (
            source.DERIVED_SOURCE_ID,
            source.DERIVED_SOURCE_NAME,
            source.SQL_TEXT,
            source.DRIVING_TABLE,
            source.SOURCE_TABLES,
            source.PARENT_DERIVED_SOURCE_IDS,
            source.BASE_SOURCE_TABLES,
            source.RELATIONSHIPS,
            source.FILTERS,
            source.SELECTED_COLUMNS_BY_TABLE,
            source.PREVIEW_COLUMNS,
            source.PURPOSE,
            source.BUSINESS_DESCRIPTION,
            source.OUTPUT_COLUMNS,
            source.COLUMN_SEMANTICS,
            source.SEMANTIC_PROJECTION,
            source.LINEAGE_DEPTH,
            source.SEMANTIC_BUNDLE_ID,
            source.SEMANTIC_VIEW_NAME,
            source.SEMANTIC_LEVEL,
            source.UPSTREAM_HASH,
            source.SOURCE_DEPENDENCY_HASH,
            source.GENERATED_BY_REQUEST_ID,
            source.CREATED_BY,
            CURRENT_TIMESTAMP(),
            CURRENT_TIMESTAMP(),
            TRUE
        )
        """
        try:
            self._session.sql(merge_sql).collect()
        except Exception as exc:
            if self._storage_unavailable(exc):
                raise SnowflakeQueryError(
                    "Derived source persistence is not available for the current role. "
                    "Please create/grant access to TBL_DERIVED_SOURCES using the deployment setup script."
                ) from exc
            raise SnowflakeQueryError(f"Failed to save derived source: {exc}") from exc

        materialization = self._materialize_secure_view(source_id)
        physical_view_name = materialization.get("physical_view_name")
        try:
            bundle_table = self._settings.qualify_table_name(
                self._settings.snowflake_semantic_bundles_table
            )
            self._session.sql(
                f"UPDATE {bundle_table} SET BUNDLE_ARTIFACT = NULL, "
                "STATUS = 'stale', STALE_REASON = 'derived source changed', "
                "UPDATED_AT = CURRENT_TIMESTAMP() "
                f"WHERE ARRAY_CONTAINS(TO_VARIANT({self._quote_literal(source_id)}), DERIVED_SOURCE_IDS)"
            ).collect()
        except Exception:
            logger.debug("Semantic bundle invalidation after derived-source save was unavailable", exc_info=True)
        from app.core.semantic_context import invalidate_semantic_bundle_cache

        invalidate_semantic_bundle_cache()

        return DerivedSourceRecord(
            derived_source_id=source_id,
            derived_source_name=body.derived_source_name,
            sql_text=body.sql_text,
            source_tables=body.source_tables,
            parent_derived_source_ids=body.parent_derived_source_ids,
            base_source_tables=base_source_tables,
            lineage_depth=lineage_depth,
            upstream_hash=upstream_hash,
            source_dependency_hash=upstream_hash,
            physical_view_name=physical_view_name,
            generated_by_request_id=body.generated_by_request_id,
            driving_table=body.driving_table,
            relationships=body.relationships,
            filters=body.filters,
            selected_columns_by_table=body.selected_columns_by_table,
            purpose=body.purpose,
            business_description=body.business_description,
            output_columns=output_columns,
            column_semantics=column_semantics,
            semantic_projection=semantic_projection,
            preview_columns=validation.preview_columns,
            grain=body.grain,
            keys=body.keys,
            semantic_quality=semantic_quality,
            created_by=current_user,
            is_active=True,
        )

    def _materialize_secure_view(self, source_id: str) -> dict[str, Any]:
        procedure = self._settings.qualify_metadata_object_name(
            "SP_FIR_MATERIALIZE_DERIVED_SOURCE"
        )
        try:
            result = self._session.call(procedure, source_id)
            if isinstance(result, str):
                result = json.loads(result)
        except Exception as exc:
            raise SnowflakeQueryError(
                f"Derived source was saved but its secure view could not be materialized: {exc}"
            ) from exc
        if not isinstance(result, dict) or result.get("status") != "success":
            reason = result.get("reason") if isinstance(result, dict) else str(result)
            raise SnowflakeQueryError(
                f"Derived source secure view materialization failed: {reason or 'unknown error'}"
            )
        return result

    def update_semantic_metadata(
        self,
        *,
        source_ids: list[str],
        semantic_bundle_id: str | None,
        semantic_view_name: str | None,
        semantic_level: str | None,
    ) -> None:
        if not source_ids:
            return
        self.ensure_table_exists()
        ids_sql = ", ".join(self._quote_literal(source_id) for source_id in source_ids if source_id)
        if not ids_sql:
            return
        self._session.sql(
            f"""
            UPDATE {self._table_name}
            SET SEMANTIC_BUNDLE_ID = {self._quote_literal(semantic_bundle_id or "")},
                SEMANTIC_VIEW_NAME = {self._quote_literal(semantic_view_name or "")},
                SEMANTIC_LEVEL = {self._quote_literal(semantic_level or "")},
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE DERIVED_SOURCE_ID IN ({ids_sql})
            """
        ).collect()

    @staticmethod
    def _build_virtual_semantic_projection(
        *,
        source_id: str,
        body: DerivedSourceDefinition,
        output_columns: list[dict[str, Any]],
        preview_columns: list[DerivedSourcePreviewColumn],
        base_source_tables: list[TableRef],
        lineage_depth: int,
        upstream_hash: str,
        column_semantics: list[dict[str, Any]],
        semantic_quality: str,
        semantic_coverage_issues: list[str],
    ) -> dict[str, Any]:
        return {
            "projection_profile": "derived_source_virtual",
            "derived_source_id": source_id,
            "name": body.derived_source_name,
            "description": body.business_description
            or f"Derived source {body.derived_source_name} created from selected source-preparation SQL.",
            "purpose": body.purpose,
            "sql_text": body.sql_text,
            "source_tables": [table.model_dump(mode="json") for table in body.source_tables],
            "base_source_tables": [table.model_dump(mode="json") for table in base_source_tables],
            "parent_derived_source_ids": body.parent_derived_source_ids,
            "driving_table": body.driving_table.model_dump(mode="json") if body.driving_table else None,
            "relationships": [item.model_dump(mode="json") for item in body.relationships],
            "filters": body.filters,
            "selected_columns_by_table": body.selected_columns_by_table,
            "output_columns": output_columns,
            "column_semantics": column_semantics,
            "grain": body.grain,
            "keys": body.keys,
            "semantic_quality": semantic_quality,
            "semantic_coverage_issues": semantic_coverage_issues,
            "preview_columns": [column.model_dump(mode="json") for column in preview_columns],
            "lineage_depth": lineage_depth,
            "upstream_hash": upstream_hash,
            "source_dependency_hash": upstream_hash,
            "generated_by_request_id": body.generated_by_request_id,
        }

    @staticmethod
    def _reconcile_output_columns(
        supplied: list[dict[str, Any]],
        preview_columns: list[DerivedSourcePreviewColumn],
    ) -> list[dict[str, Any]]:
        supplied_by_name = {
            str(item.get("name") or item.get("column_name") or "").upper(): item
            for item in supplied
            if isinstance(item, dict)
        }
        reconciled: list[dict[str, Any]] = []
        for column in preview_columns:
            declared = supplied_by_name.get(column.name.upper(), {})
            reconciled.append(
                {
                    **declared,
                    "name": column.name,
                    "data_type": column.data_type,
                    "is_primary_key": column.is_primary_key,
                }
            )
        return reconciled

    @staticmethod
    def _derive_column_semantics(
        *,
        sql_text: str,
        output_columns: list[dict[str, Any]],
        supplied: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        supplied_by_name = {
            str(item.get("name") or item.get("column_name") or "").upper(): item
            for item in supplied
            if isinstance(item, dict)
        }
        lineage_by_name: dict[str, list[str]] = {}
        try:
            query = sqlglot.parse_one(sql_text, read="snowflake")
            select = query.find(exp.Select)
            if select is not None:
                for expression in select.expressions:
                    output_name = str(expression.alias_or_name or "").upper()
                    if not output_name:
                        continue
                    lineage_by_name[output_name] = sorted(
                        {
                            column.sql(dialect="snowflake")
                            for column in expression.find_all(exp.Column)
                        }
                    )
        except Exception:
            lineage_by_name = {}

        semantics: list[dict[str, Any]] = []
        for output in output_columns:
            name = str(output.get("name") or output.get("column_name") or "").strip()
            if not name:
                continue
            declared = supplied_by_name.get(name.upper(), {})
            inherited_fallback = (
                str(declared.get("business_meaning_status") or "").lower() == "fallback"
                or str(declared.get("semantic_source") or "").lower()
                == "deterministic_sql_lineage"
                or (
                    not str(declared.get("description") or "").strip()
                    and str(declared.get("business_meaning") or "").strip()
                    == name.replace("_", " ").strip().title()
                )
            )
            declared_meaning = (
                ""
                if inherited_fallback
                else str(
                    declared.get("business_meaning")
                    or declared.get("description")
                    or output.get("description")
                    or ""
                ).strip()
            )
            business_meaning = str(
                declared_meaning
                or name.replace("_", " ").strip().title()
            )
            semantics.append(
                {
                    **declared,
                    "name": name,
                    "data_type": output.get("data_type"),
                    "business_meaning": business_meaning,
                    "source_columns": declared.get("source_columns")
                    or lineage_by_name.get(name.upper(), []),
                    "semantic_source": "agent_declared" if declared_meaning else "deterministic_sql_lineage",
                    "business_meaning_status": "declared" if declared_meaning else "fallback",
                }
            )
        return semantics

    @staticmethod
    def _semantic_quality(
        *,
        body: DerivedSourceDefinition,
        output_columns: list[dict[str, Any]],
        column_semantics: list[dict[str, Any]],
    ) -> tuple[str, list[str]]:
        """Distinguish deterministic coverage from an agent-authored semantic contract."""
        issues: list[str] = []
        if not str(body.purpose or "").strip():
            issues.append("purpose is missing")
        if not str(body.business_description or "").strip():
            issues.append("business description is missing")
        if not str(body.grain or "").strip():
            issues.append("row grain is missing")
        if not [str(key).strip() for key in body.keys if str(key).strip()]:
            issues.append("business keys are missing")

        output_names = {
            str(item.get("name") or item.get("column_name") or "").strip().upper()
            for item in output_columns
            if isinstance(item, dict)
        }
        semantic_by_name = {
            str(item.get("name") or item.get("column_name") or "").strip().upper(): item
            for item in column_semantics
            if isinstance(item, dict)
        }
        missing_meanings = sorted(
            name
            for name in output_names
            if not name
            or str(semantic_by_name.get(name, {}).get("business_meaning_status") or "").lower()
            != "declared"
        )
        if missing_meanings:
            issues.append(
                f"{len(missing_meanings)} output column(s) lack agent-declared business meaning"
            )
        missing_types = sorted(
            name
            for name in output_names
            if not str(semantic_by_name.get(name, {}).get("data_type") or "").strip()
        )
        if missing_types:
            issues.append(f"{len(missing_types)} output column(s) lack data type")
        return ("complete" if not issues else "incomplete", issues)

    def _current_user(self) -> str:
        try:
            row = self._session.sql("SELECT CURRENT_USER() AS CURRENT_USER").collect()[0]
            return str(row.as_dict().get("CURRENT_USER") or row.as_dict().get("current_user") or "")
        except Exception:
            return ""

    def _resolve_primary_key_names(self, body: DerivedSourceDefinition) -> set[str]:
        pk_names: set[str] = set()
        for table in body.source_tables:
            columns = self._table_selection._list_columns(table.database, table.schema, table.table)
            selected_names = {
                name.upper()
                for name in body.selected_columns_by_table.get(table.qualified_name, [])
            }
            for column in columns:
                if column.is_primary_key and column.column_name.upper() in selected_names:
                    pk_names.add(column.column_name.upper())
        return pk_names

    def _resolve_base_source_tables(
        self,
        body: DerivedSourceDefinition,
        parent_records: list[DerivedSourceRecord],
    ) -> list[TableRef]:
        seen: dict[str, TableRef] = {table.qualified_name.upper(): table for table in body.source_tables}
        for record in parent_records:
            for table in record.base_source_tables or record.source_tables:
                seen[table.qualified_name.upper()] = table
        return [seen[key] for key in sorted(seen)]

    @staticmethod
    def _lineage_depth(parent_records: list[DerivedSourceRecord]) -> int:
        if not parent_records:
            return 0
        return max(record.lineage_depth for record in parent_records) + 1

    def _upstream_hash(
        self,
        body: DerivedSourceDefinition,
        parent_records: list[DerivedSourceRecord],
    ) -> str:
        payload = {
            "source_tables": sorted(table.qualified_name for table in body.source_tables),
            "parent_derived_source_ids": sorted(body.parent_derived_source_ids),
            "parent_hashes": sorted(filter(None, (record.upstream_hash for record in parent_records))),
            "sql_text": body.sql_text.strip(),
        }
        return hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

    def _row_to_record(self, row: dict[str, Any]) -> DerivedSourceRecord:
        def _coerce_json(value: Any, fallback: Any) -> Any:
            if value is None:
                return fallback
            if isinstance(value, str):
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    return fallback
            return value

        def _value(name: str) -> Any:
            for candidate in (name, name.upper(), name.lower()):
                if candidate in row:
                    return row[candidate]
            return None

        source_tables = _coerce_json(_value("SOURCE_TABLES"), [])
        relationships = _coerce_json(_value("RELATIONSHIPS"), [])
        filters = _coerce_json(_value("FILTERS"), [])
        selected_columns = _coerce_json(_value("SELECTED_COLUMNS_BY_TABLE"), {})
        preview_columns = _coerce_json(_value("PREVIEW_COLUMNS"), [])
        output_columns = _coerce_json(_value("OUTPUT_COLUMNS"), [])
        column_semantics = _coerce_json(_value("COLUMN_SEMANTICS"), [])
        semantic_projection = _coerce_json(_value("SEMANTIC_PROJECTION"), {})
        parent_derived_source_ids = _coerce_json(_value("PARENT_DERIVED_SOURCE_IDS"), [])
        base_source_tables = _coerce_json(_value("BASE_SOURCE_TABLES"), [])
        driving_table = _value("DRIVING_TABLE") or ""

        driving_ref = None
        if driving_table:
            parts = str(driving_table).split(".", 2)
            if len(parts) == 3:
                driving_ref = TableRef(database=parts[0], schema=parts[1], table=parts[2])

        return DerivedSourceRecord(
            derived_source_id=str(_value("DERIVED_SOURCE_ID")),
            derived_source_name=str(_value("DERIVED_SOURCE_NAME")),
            sql_text=str(_value("SQL_TEXT")),
            source_tables=source_tables,
            parent_derived_source_ids=parent_derived_source_ids,
            base_source_tables=base_source_tables,
            lineage_depth=int(_value("LINEAGE_DEPTH") or 0),
            semantic_bundle_id=_value("SEMANTIC_BUNDLE_ID"),
            semantic_view_name=_value("SEMANTIC_VIEW_NAME"),
            semantic_level=_value("SEMANTIC_LEVEL"),
            upstream_hash=_value("UPSTREAM_HASH"),
            source_dependency_hash=_value("SOURCE_DEPENDENCY_HASH") or _value("UPSTREAM_HASH"),
            physical_view_name=_value("PHYSICAL_VIEW_NAME"),
            generated_by_request_id=_value("GENERATED_BY_REQUEST_ID"),
            driving_table=driving_ref,
            relationships=relationships,
            filters=filters,
            selected_columns_by_table=selected_columns,
            purpose=_value("PURPOSE"),
            business_description=_value("BUSINESS_DESCRIPTION"),
            output_columns=output_columns,
            column_semantics=column_semantics,
            semantic_projection=semantic_projection,
            grain=semantic_projection.get("grain") if isinstance(semantic_projection, dict) else None,
            keys=semantic_projection.get("keys", []) if isinstance(semantic_projection, dict) else [],
            semantic_quality=(
                semantic_projection.get("semantic_quality", "incomplete")
                if isinstance(semantic_projection, dict)
                else "incomplete"
            ),
            preview_columns=preview_columns,
            created_by=_value("CREATED_BY"),
            created_at=str(_value("CREATED_AT")) if _value("CREATED_AT") else None,
            updated_at=str(_value("UPDATED_AT")) if _value("UPDATED_AT") else None,
            is_active=bool(_value("IS_ACTIVE")),
        )
