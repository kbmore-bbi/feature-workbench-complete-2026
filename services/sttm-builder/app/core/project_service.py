from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import uuid
from datetime import datetime
from typing import Any

from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.conversation_memory import ConversationMemoryService
from app.core.exceptions import AppValidationError, SnowflakeQueryError
from app.core.agent_learning_service import AgentLearningService
from app.core.mapping_knowledge_projector import MappingKnowledgeProjector
from app.core.target_mapping_patterns import TargetMappingPatternService
from app.schema.common import TableRef
from app.schema.project import (
    MappingPrecedentLinkInput,
    MappingPrecedentLinkRecord,
    MappingPrecedentLinksUpdate,
    ProjectCreateRequest,
    ProjectPrecedentLinkInput,
    ProjectPrecedentLinkRecord,
    ProjectPrecedentLinksUpdate,
    ProjectRecord,
    STTMAutosaveRequest,
    STTMAutosaveResponse,
    STTMCreateRequest,
    STTMDetailResponse,
    STTMPublishRequest,
    STTMPublishResponse,
    STTMRecord,
)
from app.schema.workspace_context import WorkbenchContextSnapshotV1

logger = logging.getLogger(__name__)


class ProjectService:
    """Project/STTM persistence facade.

    This service intentionally stores both:
    - normalized rows for project/STTM/source/mapping queries; and
    - full workspace snapshots for lossless resume/autosave.
    """

    _ensured_storage_keys: set[str] = set()
    _table_column_cache: dict[str, set[str]] = {}
    _table_column_type_cache: dict[str, dict[str, str]] = {}

    _LINK_STORAGE_MESSAGE = (
        "Precedent linking is not deployed in this environment. Run the versioned "
        "FIR linking migration and ensure the application role can access the link tables."
    )

    def __init__(
        self,
        *,
        session: Session,
        settings: Settings,
        memory_service: ConversationMemoryService,
    ) -> None:
        self._session = session
        self._settings = settings
        self._memory = memory_service
        self._agent_learning = AgentLearningService(session, settings)
        self._knowledge_projector = MappingKnowledgeProjector(self._agent_learning)

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    @staticmethod
    def _quote_literal(value: Any) -> str:
        return "'" + str(value).replace("'", "''") + "'"

    @staticmethod
    def _normalize_json_value(value: Any) -> Any:
        if isinstance(value, float):
            if math.isnan(value) or math.isinf(value):
                return None
            return value
        if isinstance(value, str):
            return "".join(ch for ch in value if ch >= " " or ch in "\t\n\r")
        if isinstance(value, dict):
            return {str(k): ProjectService._normalize_json_value(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [ProjectService._normalize_json_value(v) for v in value]
        if isinstance(value, datetime):
            return value.isoformat()
        if hasattr(value, "model_dump"):
            return ProjectService._normalize_json_value(value.model_dump(mode="json"))
        return value

    @staticmethod
    def _json_literal(value: Any) -> str:
        normalized = ProjectService._normalize_json_value(value)
        payload = json.dumps(normalized, default=str, allow_nan=False).replace("$$", "$ $")
        return f"$${payload}$$"

    @staticmethod
    def _coerce_json(value: Any, default: Any) -> Any:
        if value is None:
            return default
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            if not value:
                return default
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return default
        try:
            return json.loads(str(value))
        except Exception:
            return default

    @staticmethod
    def _snapshot_to_dict(snapshot: WorkbenchContextSnapshotV1 | dict[str, Any] | None) -> dict[str, Any]:
        if snapshot is None:
            return {}
        if isinstance(snapshot, WorkbenchContextSnapshotV1):
            return snapshot.model_dump(mode="json")
        return ProjectService._normalize_json_value(snapshot) if isinstance(snapshot, dict) else {}

    @staticmethod
    def _snapshot_hash(payload: dict[str, Any]) -> str:
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @staticmethod
    def _table_ref_to_fqn(table: TableRef | dict[str, Any] | None) -> str:
        if table is None:
            return ""
        if isinstance(table, TableRef):
            return table.qualified_name
        database = str(table.get("database") or "")
        schema = str(table.get("schema") or "")
        name = str(table.get("table") or "")
        return ".".join(part for part in (database, schema, name) if part)

    @staticmethod
    def _snapshot_tables(snapshot: dict[str, Any], key: str) -> list[dict[str, Any]]:
        values = snapshot.get(key) if isinstance(snapshot.get(key), list) else []
        return [item for item in values if isinstance(item, dict)]

    def _qualified_name(self, name: str) -> str:
        qualified_name = self._settings.qualify_metadata_object_name(name)
        parts = [part.strip() for part in qualified_name.split(".")]
        if len(parts) != 3 or not all(parts):
            raise SnowflakeQueryError(
                f"Expected fully qualified DATABASE.SCHEMA.OBJECT name, got '{qualified_name}'."
            )
        return ".".join(self._quote_identifier(part) for part in parts)

    def _table_columns(self, table_name: str) -> set[str]:
        """Return existing Snowflake columns for a metadata table.

        Client environments may already have older metadata tables. Request-time DDL is
        intentionally skipped in restricted OAuth/SPCS mode, so persistence must adapt to
        the columns that actually exist instead of assuming the latest local DDL.
        """

        cached = self._table_column_cache.get(table_name)
        if cached is not None:
            return cached
        try:
            rows = self._session.sql(f"DESCRIBE TABLE {table_name}").collect()
            columns: set[str] = set()
            column_types: dict[str, str] = {}
            for row in rows:
                data = row.as_dict()
                name = data.get("name") or data.get("NAME") or data.get("Name")
                if name:
                    normalized_name = str(name).upper()
                    columns.add(normalized_name)
                    column_types[normalized_name] = str(
                        data.get("type") or data.get("TYPE") or data.get("Type") or ""
                    ).upper()
            self._table_column_cache[table_name] = columns
            self._table_column_type_cache[table_name] = column_types
            return columns
        except Exception as exc:
            logger.warning("Unable to inspect metadata table columns for %s: %s", table_name, exc)
            self._table_column_cache[table_name] = set()
            self._table_column_type_cache[table_name] = {}
            return set()

    def _column_type(self, table_name: str, column: str) -> str:
        self._table_columns(table_name)
        return self._table_column_type_cache.get(table_name, {}).get(column.upper(), "")

    def _quote_text_for_column(self, table_name: str, column: str, value: Any) -> str:
        """Fit legacy display text without truncating authoritative JSON state."""
        text = str(value or "")
        column_type = self._column_type(table_name, column)
        size_match = re.search(r"(?:VAR)?CHAR\s*\(\s*(\d+)\s*\)", column_type)
        if size_match:
            text = text[: int(size_match.group(1))]
        return self._quote_literal(text)

    def _actor_column_values(self, table_name: str, user_id: str | None) -> dict[str, str]:
        """Persist string identities without breaking older numeric metadata schemas."""
        actor = str(user_id or "")
        actor_type = self._column_type(table_name, "LAST_MODIFIED_BY")
        is_numeric_column = actor_type.startswith(("NUMBER", "DECIMAL", "NUMERIC", "INT"))
        is_numeric_actor = actor.lstrip("+-").isdigit()
        values = {
            "LAST_MODIFIED_BY": (
                self._quote_literal(actor) if not is_numeric_column or is_numeric_actor else "NULL"
            ),
            "ACTOR_USER_ID": self._quote_literal(actor),
        }
        return self._existing_column_exprs(table_name, values)

    def _existing_column_exprs(self, table_name: str, values: dict[str, str]) -> dict[str, str]:
        columns = self._table_columns(table_name)
        if not columns:
            return values
        return {column: expression for column, expression in values.items() if column.upper() in columns}

    def _has_column(self, table_name: str, column: str) -> bool:
        columns = self._table_columns(table_name)
        return not columns or column.upper() in columns

    def _order_by_expr(self, table_name: str, candidates: list[str], fallback: str) -> str:
        columns = self._table_columns(table_name)
        for column in candidates:
            if not columns or column.upper() in columns:
                return column
        return fallback

    @staticmethod
    def _is_missing_link_storage_error(exc: Exception) -> bool:
        message = str(exc).lower()
        names_link_table = (
            "tbl_fir_project_links" in message or "tbl_fir_mapping_links" in message
        )
        missing_or_forbidden = any(
            marker in message
            for marker in (
                "does not exist or not authorized",
                "does not exist",
                "object does not exist",
                "not authorized",
                "insufficient privileges",
            )
        )
        return names_link_table and missing_or_forbidden

    def _require_link_storage(self, table_name: str, *, field: str) -> None:
        try:
            self._session.sql(f"DESCRIBE TABLE {table_name}").collect()
        except Exception as exc:
            if self._is_missing_link_storage_error(exc):
                raise AppValidationError(
                    self._LINK_STORAGE_MESSAGE,
                    details=[{"field": field, "message": self._LINK_STORAGE_MESSAGE}],
                ) from exc
            raise SnowflakeQueryError(
                f"Unable to verify precedent-link storage {table_name}: {exc}"
            ) from exc

    def _insert_existing_columns(self, table_name: str, values: dict[str, str]) -> None:
        filtered = self._existing_column_exprs(table_name, values)
        if not filtered:
            raise SnowflakeQueryError(f"No writable columns found for metadata table {table_name}.")
        column_sql = ", ".join(filtered.keys())
        value_sql = ",\n                ".join(filtered.values())
        try:
            self._session.sql(
                f"""
                INSERT INTO {table_name} (
                    {column_sql}
                )
                SELECT
                    {value_sql}
                """
            ).collect()
        except Exception as exc:
            raise SnowflakeQueryError(f"Failed to insert metadata into {table_name}: {exc}") from exc

    def _update_existing_columns(self, table_name: str, assignments: dict[str, str], where_sql: str) -> None:
        filtered = self._existing_column_exprs(table_name, assignments)
        if not filtered:
            return
        set_sql = ",\n                ".join(
            f"{column} = {expression}" for column, expression in filtered.items()
        )
        try:
            self._session.sql(
                f"""
                UPDATE {table_name}
                SET {set_sql}
                WHERE {where_sql}
                """
            ).collect()
        except Exception as exc:
            raise SnowflakeQueryError(f"Failed to update metadata in {table_name}: {exc}") from exc

    @property
    def _projects_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_projects_table)

    @property
    def _sttm_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_sttm_table)

    @property
    def _versions_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_sttm_versions_table)

    @property
    def _sources_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_sttm_sources_table)

    @property
    def _attributes_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_sttm_attributes_table)

    @property
    def _snapshots_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_workspace_snapshots_table)

    @property
    def _artifacts_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_agent_artifacts_table)

    @property
    def _project_links_table(self) -> str:
        return self._qualified_name("TBL_FIR_PROJECT_LINKS")

    @property
    def _mapping_links_table(self) -> str:
        return self._qualified_name("TBL_FIR_MAPPING_LINKS")

    def ensure_storage_exists(self) -> None:
        storage_key = "|".join(
            [
                self._projects_table,
                self._sttm_table,
                self._versions_table,
                self._sources_table,
                self._attributes_table,
            ]
        )
        if storage_key in self._ensured_storage_keys:
            return
        if self._settings.uses_custom_oauth and self._settings.spcs_execute_as_caller_enabled:
            logger.info(
                "Skipping ProjectService DDL bootstrap at request time for restricted custom OAuth runtime."
            )
            self._ensured_storage_keys.add(storage_key)
            return
        statements = [
            f"""
            CREATE TABLE IF NOT EXISTS {self._projects_table} (
                PROJECT_ID NUMBER AUTOINCREMENT NOT NULL PRIMARY KEY,
                PROJECT_NAME VARCHAR(255) NOT NULL,
                DESCRIPTION TEXT,
                STATUS VARCHAR(50) DEFAULT 'ACTIVE',
                RUNTIME_SUPPRESSED BOOLEAN DEFAULT FALSE,
                ARCHIVED_AT TIMESTAMP_NTZ,
                CREATED_BY VARCHAR(128),
                PROJECT_METADATA VARIANT,
                CREATED_DATETIME TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                LAST_MODIFIED_DATETIME TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._sttm_table} (
                STTM_ID NUMBER AUTOINCREMENT NOT NULL PRIMARY KEY,
                PROJECT_ID NUMBER NOT NULL,
                STTM_NAME VARCHAR(255),
                DESCRIPTION TEXT,
                TARGET_TABLE STRING,
                CURRENT_VERSION INT DEFAULT 0,
                HAS_UNPUBLISHED_DRAFT BOOLEAN DEFAULT FALSE,
                STATUS VARCHAR(50) DEFAULT 'DRAFT',
                IMPORT_KEY STRING,
                IMPORT_STATE STRING,
                RUNTIME_SUPPRESSED BOOLEAN DEFAULT FALSE,
                SUPERSEDED_BY STRING,
                RAW_MAPPING_SQL TEXT,
                PARSED_MAPPING_MODEL VARIANT,
                DRAFT_PAYLOAD VARIANT,
                SEMANTIC_BUNDLE_ID STRING,
                SEMANTIC_BUNDLE_HASH STRING,
                LAST_SNAPSHOT_ID STRING,
                STTM_METADATA VARIANT,
                LAST_MODIFIED_BY VARCHAR(128),
                CREATED_DATETIME TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                LAST_MODIFIED_DATETIME TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._versions_table} (
                VERSION_ID NUMBER AUTOINCREMENT NOT NULL PRIMARY KEY,
                STTM_ID NUMBER NOT NULL,
                VERSION_NUMBER INT NOT NULL,
                REVISION_NOTE TEXT,
                SNAPSHOT_ID STRING,
                VERSION_PAYLOAD VARIANT,
                RAW_MAPPING_SQL TEXT,
                PARSED_MAPPING_MODEL VARIANT,
                SEMANTIC_BUNDLE_ID STRING,
                SEMANTIC_BUNDLE_HASH STRING,
                MAPPING_VERSION STRING,
                AGENT_ARTIFACT_IDS VARIANT,
                PUBLISHED_BY VARCHAR(128),
                PUBLISHED_DATETIME TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._sources_table} (
                SOURCE_ID NUMBER AUTOINCREMENT NOT NULL PRIMARY KEY,
                STTM_ID NUMBER NOT NULL,
                SOURCE_NAME VARCHAR(255) NOT NULL,
                DATABASE_NAME VARCHAR(255),
                SCHEMA_NAME VARCHAR(255),
                TABLE_NAME VARCHAR(255),
                DESCRIPTION TEXT,
                IS_DRAFT BOOLEAN DEFAULT FALSE,
                EFFECTIVE_FROM_VERSION INT,
                EFFECTIVE_THROUGH_VERSION INT,
                LAST_MODIFIED_BY VARCHAR(128),
                CREATED_DATETIME TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                LAST_MODIFIED_DATETIME TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._attributes_table} (
                ATTRIBUTE_ID NUMBER AUTOINCREMENT NOT NULL PRIMARY KEY,
                STTM_ID NUMBER NOT NULL,
                SOURCE_ID NUMBER,
                ATTRIBUTE_NAME VARCHAR(255) NOT NULL,
                ATTRIBUTE_TYPE VARCHAR(50) NOT NULL,
                SOURCE_COLUMN VARCHAR(255),
                DATA_TYPE VARCHAR(100),
                TRANSFORMATION_LOGIC TEXT,
                DESCRIPTION TEXT,
                CONDITION VARIANT,
                CALCULATION VARIANT,
                MEASURE VARIANT,
                AGGREGATION VARIANT,
                IS_NULLABLE BOOLEAN DEFAULT TRUE,
                IS_PK BOOLEAN DEFAULT FALSE,
                IS_FK BOOLEAN DEFAULT FALSE,
                IS_DRAFT BOOLEAN DEFAULT FALSE,
                EFFECTIVE_FROM_VERSION INT,
                EFFECTIVE_THROUGH_VERSION INT,
                LAST_MODIFIED_BY VARCHAR(128),
                CREATED_DATETIME TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                LAST_MODIFIED_DATETIME TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
        ]
        try:
            for statement in statements:
                self._session.sql(statement).collect()
            self._ensured_storage_keys.add(storage_key)
        except Exception as exc:
            logger.warning(
                "DDL bootstrap failed; storage will be retried on next request: %s", exc
            )

    def create_project(
        self,
        payload: ProjectCreateRequest,
        *,
        user_id: str | None,
        display_name: str | None = None,
    ) -> ProjectRecord:
        if payload.precedent_links:
            # Validate before inserting so a missing migration cannot leave an
            # orphan project behind after a partial request.
            self._require_link_storage(
                self._project_links_table,
                field="precedent_links",
            )

        # Older client schemas keep CREATED_BY as NUMBER. Persist the stable user
        # id there and keep the human-readable name in metadata across schemas.
        created_by_value = user_id or ""
        project_metadata = dict(payload.metadata)
        if display_name:
            project_metadata["created_by_name"] = display_name
        self.ensure_storage_exists()
        self._insert_existing_columns(
            self._projects_table,
            {
                "PROJECT_NAME": self._quote_literal(payload.project_name.strip()),
                "DESCRIPTION": self._quote_literal(payload.description or ""),
                "STATUS": self._quote_literal(payload.status),
                "CREATED_BY": self._quote_literal(created_by_value),
                "CREATED_BY_NAME": self._quote_literal(display_name or ""),
                "PROJECT_METADATA": f"PARSE_JSON({self._json_literal(project_metadata)})",
            },
        )
        project = self._session.sql(
            f"""
            SELECT *
            FROM {self._projects_table}
            WHERE PROJECT_NAME = {self._quote_literal(payload.project_name.strip())}
              AND COALESCE(TO_VARCHAR(CREATED_BY), '') = {self._quote_literal(created_by_value)}
            ORDER BY {self._order_by_expr(self._projects_table, ["CREATED_DATETIME", "PROJECT_ID"], "PROJECT_ID")} DESC
            LIMIT 1
            """
        ).collect()[0]
        record = self._project_from_row(project.as_dict(), counts={})
        if payload.precedent_links:
            links = self.replace_project_links(
                record.project_id,
                ProjectPrecedentLinksUpdate(links=payload.precedent_links),
                user_id=user_id,
            )
            record = record.model_copy(
                update={"linked_project_ids": [item.precedent_project_id for item in links]}
            )
        self._record_fir(
            event_type="project.created",
            user_id=user_id,
            session_id=None,
            request_id=None,
            page="projects",
            surface="dashboard",
            entity_type="project",
            entity_ids=[record.project_id],
            payload=record.model_dump(mode="json"),
        )
        return record

    def list_projects(self) -> list[ProjectRecord]:
        self.ensure_storage_exists()
        order_by = self._order_by_expr(
            self._projects_table,
            ["LAST_MODIFIED_DATETIME", "CREATED_DATETIME", "PROJECT_ID"],
            "PROJECT_ID",
        )
        projects = [
            row.as_dict()
            for row in self._session.sql(
                f"SELECT * FROM {self._projects_table} "
                "WHERE COALESCE(STATUS, 'ACTIVE') <> 'ARCHIVED' "
                f"ORDER BY {order_by} DESC"
            ).collect()
        ]
        counts = self._project_counts()
        return [self._project_from_row(row, counts=counts.get(str(row.get("PROJECT_ID")), {})) for row in projects]

    def get_project(self, project_id: str) -> ProjectRecord | None:
        self.ensure_storage_exists()
        rows = self._session.sql(
            f"SELECT * FROM {self._projects_table} "
            f"WHERE PROJECT_ID = {self._quote_literal(project_id)} "
            "AND COALESCE(STATUS, 'ACTIVE') <> 'ARCHIVED'"
        ).collect()
        if not rows:
            return None
        return self._project_from_row(rows[0].as_dict(), counts=self._project_counts().get(project_id, {}))

    def create_sttm(
        self,
        project_id: str,
        payload: STTMCreateRequest,
        *,
        user_id: str | None,
        session_id: str | None,
        thread_id: str | None,
    ) -> STTMRecord:
        if payload.precedent_links:
            # Validate before inserting so a missing migration cannot leave an
            # orphan STTM behind after a partial request.
            self._require_link_storage(
                self._mapping_links_table,
                field="precedent_links",
            )
        self.ensure_storage_exists()
        snapshot = self._snapshot_to_dict(payload.workspace_snapshot)
        semantic_bundle_id = payload.semantic_bundle_id or self._semantic_bundle_id(snapshot)
        semantic_bundle_hash = payload.semantic_bundle_hash or self._semantic_bundle_hash(snapshot)
        target_fqn = self._table_ref_to_fqn(payload.target_table) or self._table_ref_to_fqn(snapshot.get("target_table"))
        mapping_intent_name = None
        if isinstance(snapshot.get("mapping_intent"), dict):
            mapping_intent_name = snapshot.get("mapping_intent", {}).get("name")
        sttm_name = (
            payload.sttm_name
            or mapping_intent_name
            or f"STTM {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}"
        )
        sttm_metadata = {
            **payload.metadata,
            "actor_user_id": user_id or "",
            "mapping_name": sttm_name,
            "mapping_description": payload.description or "",
        }
        is_historical_import = str(payload.metadata.get("source") or "").lower() == "historical_import"
        self._insert_existing_columns(
            self._sttm_table,
            {
                "PROJECT_ID": self._quote_literal(project_id),
                "STATUS": "'IMPORTING'" if is_historical_import else "'DRAFT'",
                "IMPORT_STATE": "'IMPORTING'" if is_historical_import else "NULL",
                "IMPORT_KEY": self._quote_literal(str(payload.metadata.get("import_key") or "")),
                "RUNTIME_SUPPRESSED": "TRUE" if is_historical_import else "FALSE",
                **self._actor_column_values(self._sttm_table, user_id),
                "STTM_NAME": self._quote_literal(sttm_name),
                "DESCRIPTION": self._quote_literal(payload.description or ""),
                "TARGET_TABLE": self._quote_literal(target_fqn),
                "DRAFT_PAYLOAD": f"PARSE_JSON({self._json_literal(snapshot)})",
                "SEMANTIC_BUNDLE_ID": self._quote_literal(semantic_bundle_id or ""),
                "SEMANTIC_BUNDLE_HASH": self._quote_literal(semantic_bundle_hash or ""),
                "STTM_METADATA": f"PARSE_JSON({self._json_literal(sttm_metadata)})",
            },
        )
        sttm_row = self._session.sql(
            f"""
            SELECT *
            FROM {self._sttm_table}
            WHERE PROJECT_ID = {self._quote_literal(project_id)}
            ORDER BY {self._order_by_expr(self._sttm_table, ["CREATED_DATETIME", "STTM_ID"], "STTM_ID")} DESC
            LIMIT 1
            """
        ).collect()[0].as_dict()
        sttm = self._sttm_from_row(sttm_row, mapping_counts={})
        if payload.precedent_links:
            links = self.replace_mapping_links(
                sttm.sttm_id,
                MappingPrecedentLinksUpdate(links=payload.precedent_links),
                user_id=user_id,
            )
            sttm = sttm.model_copy(
                update={"linked_mapping_ids": [item.precedent_sttm_id for item in links]}
            )
        self._record_fir(
            event_type="mapping.created",
            user_id=user_id,
            session_id=session_id,
            request_id=None,
            page=str(snapshot.get("page") or "mappings"),
            surface=str(snapshot.get("surface") or "new_mapping"),
            entity_type="sttm",
            entity_ids=[project_id, sttm.sttm_id],
            payload={
                "project_id": project_id,
                "sttm_id": sttm.sttm_id,
                "mapping_name": sttm_name,
                "mapping_description": payload.description or "",
                "target_table": target_fqn or None,
                "metadata": payload.metadata,
            },
            context_key=str(snapshot.get("context_key") or ""),
            snapshot_id=str(snapshot.get("snapshot_id") or ""),
            milestone="mapping_created",
        )
        if snapshot:
            self.autosave_sttm(
                sttm.sttm_id,
                STTMAutosaveRequest(
                    workspace_snapshot=snapshot,
                    action="sttm.created",
                    session_id=session_id,
                    thread_id=thread_id,
                    semantic_bundle_id=semantic_bundle_id,
                    semantic_bundle_hash=semantic_bundle_hash,
                    metadata=payload.metadata,
                ),
                user_id=user_id,
            )
            sttm = self.get_sttm_record(sttm.sttm_id) or sttm
        return sttm

    def list_project_links(self, project_id: str) -> list[ProjectPrecedentLinkRecord]:
        try:
            rows = self._session.sql(
                f"""
                SELECT l.*, p.PROJECT_NAME AS PRECEDENT_PROJECT_NAME
                FROM {self._project_links_table} l
                LEFT JOIN {self._projects_table} p
                  ON TO_VARCHAR(p.PROJECT_ID) = l.PRECEDENT_PROJECT_ID
                WHERE l.PROJECT_ID = {self._quote_literal(project_id)}
                  AND LOWER(COALESCE(l.STATUS, 'active')) = 'active'
                ORDER BY l.PRIORITY DESC, l.CREATED_AT
                """
            ).collect()
        except Exception as exc:
            if self._is_missing_link_storage_error(exc):
                logger.warning("Project precedent storage is unavailable: %s", exc)
                return []
            raise
        return [self._project_link_from_row(row.as_dict()) for row in rows]

    def replace_project_links(
        self,
        project_id: str,
        payload: ProjectPrecedentLinksUpdate,
        *,
        user_id: str | None,
    ) -> list[ProjectPrecedentLinkRecord]:
        links = [item for item in payload.links if item.precedent_project_id != project_id]
        try:
            self._require_link_storage(
                self._project_links_table,
                field="precedent_links",
            )
        except AppValidationError:
            if not links:
                return []
            raise
        selected = [item.precedent_project_id for item in links]
        retained_predicate = ""
        if selected:
            selected_sql = ", ".join(self._quote_literal(value) for value in selected)
            retained_predicate = f"AND PRECEDENT_PROJECT_ID NOT IN ({selected_sql})"
        self._session.sql(
            f"""
            UPDATE {self._project_links_table}
            SET STATUS = 'inactive', UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE PROJECT_ID = {self._quote_literal(project_id)}
              {retained_predicate}
              AND LOWER(COALESCE(STATUS, 'active')) = 'active'
            """
        ).collect()
        for item in links:
            link_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"fir-project-link:{project_id}:{item.precedent_project_id}"))
            categories = f"TO_ARRAY(PARSE_JSON({self._json_literal(item.knowledge_categories)}))"
            self._session.sql(
                f"""
                MERGE INTO {self._project_links_table} target
                USING (SELECT
                    {self._quote_literal(link_id)} AS PROJECT_LINK_ID,
                    {self._quote_literal(project_id)} AS PROJECT_ID,
                    {self._quote_literal(item.precedent_project_id)} AS PRECEDENT_PROJECT_ID
                ) source
                ON target.PROJECT_ID = source.PROJECT_ID
                   AND target.PRECEDENT_PROJECT_ID = source.PRECEDENT_PROJECT_ID
                WHEN MATCHED THEN UPDATE SET
                    STATUS = 'active', PRIORITY = {item.priority},
                    KNOWLEDGE_CATEGORIES = {categories},
                    ALLOW_PROJECT_SPECIFIC_VALUES = {str(item.allow_project_specific_values).upper()},
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT (
                    PROJECT_LINK_ID, PROJECT_ID, PRECEDENT_PROJECT_ID, STATUS, PRIORITY,
                    KNOWLEDGE_CATEGORIES, ALLOW_PROJECT_SPECIFIC_VALUES, CREATED_BY
                ) VALUES (
                    source.PROJECT_LINK_ID, source.PROJECT_ID, source.PRECEDENT_PROJECT_ID,
                    'active', {item.priority}, {categories},
                    {str(item.allow_project_specific_values).upper()}, {self._quote_literal(user_id or '')}
                )
                """
            ).collect()
        return self.list_project_links(project_id)

    def list_mapping_links(self, sttm_id: str) -> list[MappingPrecedentLinkRecord]:
        try:
            rows = self._session.sql(
                f"""
                SELECT l.*, s.PROJECT_ID AS PRECEDENT_PROJECT_ID,
                       s.STTM_NAME AS PRECEDENT_STTM_NAME,
                       s.TARGET_TABLE AS PRECEDENT_TARGET_TABLE,
                       s.STATUS AS PRECEDENT_STATUS
                FROM {self._mapping_links_table} l
                LEFT JOIN {self._sttm_table} s
                  ON TO_VARCHAR(s.STTM_ID) = l.PRECEDENT_STTM_ID
                WHERE l.STTM_ID = {self._quote_literal(sttm_id)}
                  AND LOWER(COALESCE(l.STATUS, 'active')) = 'active'
                ORDER BY l.PRIORITY DESC, l.CREATED_AT
                """
            ).collect()
        except Exception as exc:
            if self._is_missing_link_storage_error(exc):
                logger.warning("Mapping precedent storage is unavailable: %s", exc)
                return []
            raise
        return [self._mapping_link_from_row(row.as_dict()) for row in rows]

    def replace_mapping_links(
        self,
        sttm_id: str,
        payload: MappingPrecedentLinksUpdate,
        *,
        user_id: str | None,
    ) -> list[MappingPrecedentLinkRecord]:
        links = [item for item in payload.links if item.precedent_sttm_id != sttm_id]
        try:
            self._require_link_storage(
                self._mapping_links_table,
                field="precedent_links",
            )
        except AppValidationError:
            if not links:
                return []
            raise
        selected = [item.precedent_sttm_id for item in links]
        retained_predicate = ""
        if selected:
            selected_sql = ", ".join(self._quote_literal(value) for value in selected)
            retained_predicate = f"AND PRECEDENT_STTM_ID NOT IN ({selected_sql})"
        self._session.sql(
            f"""
            UPDATE {self._mapping_links_table}
            SET STATUS = 'inactive', UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE STTM_ID = {self._quote_literal(sttm_id)}
              {retained_predicate}
              AND LOWER(COALESCE(STATUS, 'active')) = 'active'
            """
        ).collect()
        for item in links:
            link_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"fir-mapping-link:{sttm_id}:{item.precedent_sttm_id}"))
            categories = f"TO_ARRAY(PARSE_JSON({self._json_literal(item.knowledge_categories)}))"
            self._session.sql(
                f"""
                MERGE INTO {self._mapping_links_table} target
                USING (SELECT
                    {self._quote_literal(link_id)} AS MAPPING_LINK_ID,
                    {self._quote_literal(sttm_id)} AS STTM_ID,
                    {self._quote_literal(item.precedent_sttm_id)} AS PRECEDENT_STTM_ID
                ) source
                ON target.STTM_ID = source.STTM_ID
                   AND target.PRECEDENT_STTM_ID = source.PRECEDENT_STTM_ID
                WHEN MATCHED THEN UPDATE SET
                    STATUS = 'active', PRIORITY = {item.priority},
                    KNOWLEDGE_CATEGORIES = {categories},
                    TARGET_COMPATIBILITY = {self._quote_literal(item.target_compatibility or '')},
                    MAPPING_LIFECYCLE = {self._quote_literal(item.mapping_lifecycle or '')},
                    PURPOSE = {self._quote_literal(item.purpose or '')},
                    CONFIDENCE = {item.confidence},
                    ALLOW_PROJECT_SPECIFIC_VALUES = {str(item.allow_project_specific_values).upper()},
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT (
                    MAPPING_LINK_ID, STTM_ID, PRECEDENT_STTM_ID, STATUS, PRIORITY,
                    KNOWLEDGE_CATEGORIES, TARGET_COMPATIBILITY, MAPPING_LIFECYCLE,
                    PURPOSE, CONFIDENCE, ALLOW_PROJECT_SPECIFIC_VALUES, CREATED_BY
                ) VALUES (
                    source.MAPPING_LINK_ID, source.STTM_ID, source.PRECEDENT_STTM_ID,
                    'active', {item.priority}, {categories},
                    {self._quote_literal(item.target_compatibility or '')},
                    {self._quote_literal(item.mapping_lifecycle or '')},
                    {self._quote_literal(item.purpose or '')}, {item.confidence},
                    {str(item.allow_project_specific_values).upper()},
                    {self._quote_literal(user_id or '')}
                )
                """
            ).collect()
        return self.list_mapping_links(sttm_id)

    def list_sttms(self, project_id: str) -> list[STTMRecord]:
        self.ensure_storage_exists()
        order_by = self._order_by_expr(
            self._sttm_table,
            ["LAST_MODIFIED_DATETIME", "CREATED_DATETIME", "STTM_ID"],
            "STTM_ID",
        )
        rows = self._session.sql(
            f"""
            SELECT *
            FROM {self._sttm_table}
            WHERE PROJECT_ID = {self._quote_literal(project_id)}
              AND COALESCE(STATUS, 'DRAFT') NOT IN ('SUPERSEDED', 'IMPORTING', 'IMPORT_FAILED')
            ORDER BY {order_by} DESC
            """
        ).collect()
        counts = self._mapping_counts_by_sttm()
        return [self._sttm_from_row(row.as_dict(), mapping_counts=counts.get(str(row.as_dict().get("STTM_ID")), {})) for row in rows]

    def list_all_projects_summary(self) -> tuple[list[ProjectRecord], list[STTMRecord]]:
        """Return all projects and all STTMs in 2 queries instead of N+1.

        Query 1: all projects with per-project STTM lifecycle counts.
        Query 2: all STTMs with per-STTM mapping row counts.

        The frontend is responsible for grouping STTMs under their project.
        """
        self.ensure_storage_exists()
        projects = self.list_projects()
        order_by = self._order_by_expr(
            self._sttm_table,
            ["LAST_MODIFIED_DATETIME", "CREATED_DATETIME", "STTM_ID"],
            "STTM_ID",
        )
        rows = self._session.sql(
            f"""
            SELECT *
            FROM {self._sttm_table}
            WHERE COALESCE(STATUS, 'DRAFT') NOT IN ('SUPERSEDED', 'IMPORTING', 'IMPORT_FAILED')
              AND TO_VARCHAR(PROJECT_ID) IN (
                  SELECT TO_VARCHAR(PROJECT_ID)
                  FROM {self._projects_table}
                  WHERE COALESCE(STATUS, 'ACTIVE') <> 'ARCHIVED'
              )
            ORDER BY {order_by} DESC
            """
        ).collect()
        counts = self._mapping_counts_by_sttm()
        sttms = [
            self._sttm_from_row(row.as_dict(), mapping_counts=counts.get(str(row.as_dict().get("STTM_ID")), {}))
            for row in rows
        ]
        return projects, sttms

    def get_sttm_record(self, sttm_id: str) -> STTMRecord | None:
        self.ensure_storage_exists()
        rows = self._session.sql(
            f"SELECT s.* FROM {self._sttm_table} s "
            f"JOIN {self._projects_table} p ON TO_VARCHAR(p.PROJECT_ID) = TO_VARCHAR(s.PROJECT_ID) "
            f"WHERE s.STTM_ID = {self._quote_literal(sttm_id)} "
            "AND COALESCE(s.STATUS, 'DRAFT') NOT IN ('SUPERSEDED', 'IMPORTING', 'IMPORT_FAILED') "
            "AND COALESCE(p.STATUS, 'ACTIVE') <> 'ARCHIVED'"
        ).collect()
        if not rows:
            return None
        counts = self._mapping_counts_by_sttm().get(sttm_id, {})
        return self._sttm_from_row(rows[0].as_dict(), mapping_counts=counts)

    def get_sttm_detail(self, sttm_id: str) -> STTMDetailResponse | None:
        sttm = self.get_sttm_record(sttm_id)
        if sttm is None:
            return None
        sttm = sttm.model_copy(
            update={
                "linked_mapping_ids": [
                    item.precedent_sttm_id for item in self.list_mapping_links(sttm_id)
                ]
            }
        )
        project = self.get_project(sttm.project_id)
        if project is not None:
            project = project.model_copy(
                update={
                    "linked_project_ids": [
                        item.precedent_project_id
                        for item in self.list_project_links(sttm.project_id)
                    ]
                }
            )
        return STTMDetailResponse(
            project=project,
            sttm=sttm,
            latest_snapshot=self._latest_snapshot(sttm_id),
            sources=self._list_sources(sttm_id),
            mapping_rows=self._list_mapping_rows(sttm_id),
            versions=self._list_versions(sttm_id),
            agent_artifacts=self._list_artifacts(sttm_id),
        )

    def autosave_sttm(
        self,
        sttm_id: str,
        payload: STTMAutosaveRequest,
        *,
        user_id: str | None,
    ) -> STTMAutosaveResponse:
        self.ensure_storage_exists()
        sttm = self.get_sttm_record(sttm_id)
        if sttm is None:
            raise SnowflakeQueryError(f"STTM {sttm_id} was not found.")
        snapshot = self._snapshot_to_dict(payload.workspace_snapshot)
        context_hash = str(snapshot.get("context_hash") or self._snapshot_hash(snapshot))
        semantic_bundle_id = payload.semantic_bundle_id or self._semantic_bundle_id(snapshot)
        semantic_bundle_hash = payload.semantic_bundle_hash or self._semantic_bundle_hash(snapshot)
        snapshot_id = self._memory.save_workspace_snapshot(
            session_id=payload.session_id or str(snapshot.get("session_id") or ""),
            thread_id=payload.thread_id or str(snapshot.get("thread_id") or ""),
            context_hash=context_hash,
            snapshot_payload=snapshot,
            context_version=str(snapshot.get("context_version") or "1.0"),
            context_key=str(snapshot.get("context_key") or ""),
            action=payload.action or str(snapshot.get("action") or "workspace.autosaved"),
            milestone=str(snapshot.get("milestone") or payload.action or ""),
            page=str(snapshot.get("page") or ""),
            surface=str(snapshot.get("surface") or ""),
            project_id=sttm.project_id,
            sttm_id=sttm_id,
            semantic_bundle_id=semantic_bundle_id,
            semantic_bundle_hash=semantic_bundle_hash,
            mapping_version=payload.mapping_version or str(snapshot.get("mapping_version") or ""),
            user_id=user_id,
        )
        snapshot["snapshot_id"] = snapshot_id
        saved_source_count = self._replace_sources(sttm_id, snapshot, user_id=user_id)
        saved_mapping_row_count = self._replace_mapping_rows(
            project_id=sttm.project_id,
            sttm_id=sttm_id,
            snapshot=snapshot,
            session_id=payload.session_id or str(snapshot.get("session_id") or ""),
            semantic_bundle_id=semantic_bundle_id,
            semantic_bundle_hash=semantic_bundle_hash,
            user_id=user_id,
        )
        self._update_existing_columns(
            self._sttm_table,
            {
                "HAS_UNPUBLISHED_DRAFT": "TRUE",
                "STATUS": "IFF(STATUS = 'IMPORTING', 'IMPORTING', IFF(STATUS = 'DRAFT', 'DRAFT', 'IN_PROGRESS'))",
                **self._actor_column_values(self._sttm_table, user_id),
                "LAST_MODIFIED_DATETIME": "CURRENT_TIMESTAMP()",
                "DRAFT_PAYLOAD": f"PARSE_JSON({self._json_literal(snapshot)})",
                "RAW_MAPPING_SQL": self._quote_literal(
                    str(snapshot.get("raw_mapping_sql") or snapshot.get("mapping_sql") or "")
                ),
                "PARSED_MAPPING_MODEL": f"PARSE_JSON({self._json_literal(snapshot.get('parsed_mapping_model') or {})})",
                "SEMANTIC_BUNDLE_ID": self._quote_literal(semantic_bundle_id or ""),
                "SEMANTIC_BUNDLE_HASH": self._quote_literal(semantic_bundle_hash or ""),
                "LAST_SNAPSHOT_ID": self._quote_literal(snapshot_id),
            },
            f"STTM_ID = {self._quote_literal(sttm_id)}",
        )
        artifact_count = self._record_agent_artifacts(
            project_id=sttm.project_id,
            sttm_id=sttm_id,
            payload=payload,
            snapshot=snapshot,
            user_id=user_id,
            semantic_bundle_id=semantic_bundle_id,
            semantic_bundle_hash=semantic_bundle_hash,
        )
        fir_count = self._record_autosave_fir_events(
            project_id=sttm.project_id,
            sttm_id=sttm_id,
            payload=payload,
            snapshot=snapshot,
            user_id=user_id,
        )
        normalized_action = str(payload.action or "").lower()
        if any(
            marker in normalized_action
            for marker in (
                "mapping.accepted",
                "mapping.corrected",
                "mapping.edited",
                "sql.applied",
                "sql.validation_passed",
                "historical_import",
            )
        ):
            self._knowledge_projector.project(
                project_id=sttm.project_id,
                sttm_id=sttm_id,
                snapshot=snapshot,
                outcome="validated" if "validation_passed" in normalized_action else normalized_action,
                user_id=user_id,
            )
            evidence_class = (
                "explicit_user_correction"
                if "corrected" in normalized_action
                else "validated_mapping"
                if "validation_passed" in normalized_action
                else "accepted_mapping_row"
            )
            self._record_target_mapping_patterns(
                project_id=sttm.project_id,
                sttm_id=sttm_id,
                snapshot=snapshot,
                evidence_class=evidence_class,
                validation_status=(
                    "validated"
                    if evidence_class in {"explicit_user_correction", "validated_mapping"}
                    else "accepted"
                ),
                base_confidence=0.99
                if evidence_class == "explicit_user_correction"
                else 0.9,
            )
        self._memory.upsert_feature_snapshot(
            feature_key=f"sttm:{sttm_id}:latest",
            user_id=user_id,
            session_id=payload.session_id or str(snapshot.get("session_id") or ""),
            page=str(snapshot.get("page") or ""),
            surface=str(snapshot.get("surface") or ""),
            entity_type="sttm",
            entity_ids=[sttm_id],
            features=self._build_fir_features(snapshot),
            model_targets={
                "mapped_count": saved_mapping_row_count,
                "semantic_bundle_hash": semantic_bundle_hash,
            },
        )
        return STTMAutosaveResponse(
            project_id=sttm.project_id,
            sttm_id=sttm_id,
            snapshot_id=snapshot_id,
            saved_source_count=saved_source_count,
            saved_mapping_row_count=saved_mapping_row_count,
            recorded_artifact_count=artifact_count,
            recorded_fir_event_count=fir_count,
            semantic_bundle_id=semantic_bundle_id,
            semantic_bundle_hash=semantic_bundle_hash,
        )

    def publish_sttm(
        self,
        sttm_id: str,
        payload: STTMPublishRequest,
        *,
        user_id: str | None,
    ) -> STTMPublishResponse:
        self.ensure_storage_exists()
        sttm = self.get_sttm_record(sttm_id)
        if sttm is None:
            raise SnowflakeQueryError(f"STTM {sttm_id} was not found.")
        snapshot_payload = self._snapshot_to_dict(payload.workspace_snapshot) or self._latest_snapshot(sttm_id) or {}
        snapshot_id: str | None = None
        if snapshot_payload:
            autosave = self.autosave_sttm(
                sttm_id,
                STTMAutosaveRequest(
                    workspace_snapshot=snapshot_payload,
                    action="sttm.publish_autosave",
                    session_id=payload.session_id,
                    thread_id=payload.thread_id,
                    semantic_bundle_id=payload.semantic_bundle_id,
                    semantic_bundle_hash=payload.semantic_bundle_hash,
                    mapping_version=payload.mapping_version,
                    metadata=payload.metadata,
                ),
                user_id=user_id,
            )
            snapshot_id = autosave.snapshot_id
        semantic_bundle_id = payload.semantic_bundle_id or self._semantic_bundle_id(snapshot_payload) or sttm.semantic_bundle_id
        semantic_bundle_hash = payload.semantic_bundle_hash or self._semantic_bundle_hash(snapshot_payload) or sttm.semantic_bundle_hash
        next_version = int(sttm.current_version or 0) + 1
        artifact_ids = [item.get("artifact_id") for item in self._list_artifacts(sttm_id) if item.get("artifact_id")]
        self._insert_existing_columns(
            self._versions_table,
            {
                "STTM_ID": self._quote_literal(sttm_id),
                "VERSION_NUMBER": str(next_version),
                "REVISION_NOTE": self._quote_literal(payload.revision_note or ""),
                "PUBLISHED_BY": self._quote_literal(user_id or ""),
                "SNAPSHOT_ID": self._quote_literal(snapshot_id or sttm.last_snapshot_id or ""),
                "VERSION_PAYLOAD": f"PARSE_JSON({self._json_literal(snapshot_payload)})",
                "RAW_MAPPING_SQL": self._quote_literal(
                    str(snapshot_payload.get("raw_mapping_sql") or snapshot_payload.get("mapping_sql") or "")
                ),
                "PARSED_MAPPING_MODEL": f"PARSE_JSON({self._json_literal(snapshot_payload.get('parsed_mapping_model') or {})})",
                "SEMANTIC_BUNDLE_ID": self._quote_literal(semantic_bundle_id or ""),
                "SEMANTIC_BUNDLE_HASH": self._quote_literal(semantic_bundle_hash or ""),
                "MAPPING_VERSION": self._quote_literal(payload.mapping_version or ""),
                "AGENT_ARTIFACT_IDS": f"PARSE_JSON({self._json_literal(artifact_ids)})",
            },
        )
        version_id = self._session.sql(
            f"""
            SELECT VERSION_ID
            FROM {self._versions_table}
            WHERE STTM_ID = {self._quote_literal(sttm_id)}
              AND VERSION_NUMBER = {next_version}
            LIMIT 1
            """
        ).collect()[0].as_dict().get("VERSION_ID")
        self._update_existing_columns(
            self._sttm_table,
            {
                "CURRENT_VERSION": str(next_version),
                "HAS_UNPUBLISHED_DRAFT": "FALSE",
                "STATUS": "'COMPLETE'",
                "IMPORT_STATE": "IFF(IMPORT_KEY IS NULL, IMPORT_STATE, 'COMPLETE')",
                "RUNTIME_SUPPRESSED": "FALSE",
                "RAW_MAPPING_SQL": self._quote_literal(
                    str(snapshot_payload.get("raw_mapping_sql") or snapshot_payload.get("mapping_sql") or "")
                ),
                "PARSED_MAPPING_MODEL": f"PARSE_JSON({self._json_literal(snapshot_payload.get('parsed_mapping_model') or {})})",
                **self._actor_column_values(self._sttm_table, user_id),
                "LAST_MODIFIED_DATETIME": "CURRENT_TIMESTAMP()",
                "SEMANTIC_BUNDLE_ID": self._quote_literal(semantic_bundle_id or ""),
                "SEMANTIC_BUNDLE_HASH": self._quote_literal(semantic_bundle_hash or ""),
            },
            f"STTM_ID = {self._quote_literal(sttm_id)}",
        )
        self._record_fir(
            event_type="sttm.published",
            user_id=user_id,
            session_id=payload.session_id,
            request_id=None,
            page=str(snapshot_payload.get("page") or "summary"),
            surface=str(snapshot_payload.get("surface") or "publish"),
            entity_type="sttm",
            entity_ids=[sttm_id, f"version:{next_version}"],
            payload={
                "project_id": sttm.project_id,
                "sttm_id": sttm_id,
                "version_number": next_version,
                "semantic_bundle_hash": semantic_bundle_hash,
                "mapping_count": len(snapshot_payload.get("mapping_rows") or []),
            },
            context_key=str(snapshot_payload.get("context_key") or ""),
            snapshot_id=snapshot_id or sttm.last_snapshot_id,
            milestone="sttm.published",
        )
        learning_count = self._record_agent_learnings(
            project_id=sttm.project_id,
            sttm_id=sttm_id,
            snapshot=snapshot_payload,
            user_id=user_id,
        )
        learning_count += self._knowledge_projector.project(
            project_id=sttm.project_id,
            sttm_id=sttm_id,
            snapshot=snapshot_payload,
            outcome="published",
            user_id=user_id,
        )
        self._record_target_mapping_patterns(
            project_id=sttm.project_id,
            sttm_id=sttm_id,
            snapshot=snapshot_payload,
            evidence_class="published_mapping",
            validation_status="published",
            base_confidence=0.97,
        )
        logger.debug("Recorded %d published agent learnings for STTM %s", learning_count, sttm_id)
        recommendation_ids: set[str] = set()
        for row in snapshot_payload.get("mapping_rows") or []:
            if not isinstance(row, dict):
                continue
            recommendation_ids.update(
                str(value)
                for value in (row.get("used_recommendation_ids") or [])
                if value
            )
        for artifact in self._list_artifacts(sttm_id):
            artifact_payload = artifact.get("PAYLOAD") if isinstance(artifact.get("PAYLOAD"), dict) else {}
            recommendation_ids.update(
                str(value)
                for value in (
                    artifact.get("USED_RECOMMENDATION_IDS")
                    or artifact_payload.get("used_recommendation_ids")
                    or []
                )
                if value
            )
        for recommendation_id in recommendation_ids:
            self._memory.record_fir_recommendation_outcome(
                recommendation_id=recommendation_id,
                outcome_type="published",
                context_key=str(snapshot_payload.get("context_key") or ""),
                snapshot_id=snapshot_id or sttm.last_snapshot_id,
                user_id=user_id,
                payload={
                    "project_id": sttm.project_id,
                    "sttm_id": sttm_id,
                    "version_number": next_version,
                },
            )
        return STTMPublishResponse(
            project_id=sttm.project_id,
            sttm_id=sttm_id,
            version_id=str(version_id or ""),
            version_number=next_version,
            snapshot_id=snapshot_id or sttm.last_snapshot_id,
            status="COMPLETE",
            semantic_bundle_id=semantic_bundle_id,
            semantic_bundle_hash=semantic_bundle_hash,
        )

    def _project_counts(self) -> dict[str, dict[str, Any]]:
        project_columns = self._table_columns(self._projects_table)
        sttm_columns = self._table_columns(self._sttm_table)
        attribute_columns = self._table_columns(self._attributes_table)
        if project_columns and "PROJECT_ID" not in project_columns:
            return {}
        if sttm_columns and not {"PROJECT_ID", "STTM_ID"}.issubset(sttm_columns):
            return {}

        status_expr = "s.STATUS" if not sttm_columns or "STATUS" in sttm_columns else "'DRAFT'"

        def lifecycle_counts() -> dict[str, dict[str, Any]]:
            try:
                rows = self._session.sql(
                    f"""
                    SELECT
                        p.PROJECT_ID,
                        COUNT(DISTINCT s.STTM_ID) AS STTM_COUNT,
                        COUNT(DISTINCT IFF({status_expr} = 'COMPLETE', s.STTM_ID, NULL)) AS COMPLETE_COUNT,
                        COUNT(DISTINCT IFF({status_expr} IN ('IN_PROGRESS'), s.STTM_ID, NULL)) AS PARTIAL_COUNT,
                        COUNT(DISTINCT IFF({status_expr} = 'DRAFT', s.STTM_ID, NULL)) AS DRAFT_COUNT,
                        0 AS TOTAL_MAPPINGS,
                        0 AS MAPPED_COUNT
                    FROM {self._projects_table} p
                    LEFT JOIN {self._sttm_table} s
                      ON TO_VARCHAR(p.PROJECT_ID) = TO_VARCHAR(s.PROJECT_ID)
                     AND COALESCE(s.STATUS, 'DRAFT') NOT IN ('SUPERSEDED', 'IMPORTING', 'IMPORT_FAILED')
                    WHERE COALESCE(p.STATUS, 'ACTIVE') <> 'ARCHIVED'
                    GROUP BY p.PROJECT_ID
                    """
                ).collect()
                return {str(row.as_dict().get("PROJECT_ID")): row.as_dict() for row in rows}
            except Exception as exc:
                logger.warning("Project counts unavailable; returning projects without counts: %s", exc)
                return {}

        if attribute_columns and "STTM_ID" not in attribute_columns:
            return lifecycle_counts()

        attribute_id_expr = (
            "a.ATTRIBUTE_ID"
            if not attribute_columns or "ATTRIBUTE_ID" in attribute_columns
            else "TO_VARCHAR(a.ATTRIBUTE_NAME)"
            if "ATTRIBUTE_NAME" in attribute_columns
            else "TO_VARCHAR(a.STTM_ID)"
        )
        source_column_expr = (
            "a.SOURCE_COLUMN"
            if not attribute_columns or "SOURCE_COLUMN" in attribute_columns
            else "''"
        )
        transformation_expr = (
            "a.TRANSFORMATION_LOGIC"
            if not attribute_columns or "TRANSFORMATION_LOGIC" in attribute_columns
            else "''"
        )
        if not attribute_columns or {"IS_DRAFT", "EFFECTIVE_THROUGH_VERSION"}.issubset(attribute_columns):
            current_attributes_sql = f"""
                    SELECT a.*
                    FROM {self._attributes_table} a
                    WHERE COALESCE(a.IS_DRAFT, FALSE) = TRUE
                    UNION ALL
                    SELECT a.*
                    FROM {self._attributes_table} a
                    WHERE COALESCE(a.IS_DRAFT, FALSE) = FALSE
                      AND a.EFFECTIVE_THROUGH_VERSION IS NULL
                      AND NOT EXISTS (
                          SELECT 1
                          FROM {self._attributes_table} d
                          WHERE TO_VARCHAR(d.STTM_ID) = TO_VARCHAR(a.STTM_ID)
                            AND COALESCE(d.IS_DRAFT, FALSE) = TRUE
                      )
            """
        else:
            current_attributes_sql = f"""
                    SELECT a.*
                    FROM {self._attributes_table} a
            """

        try:
            rows = self._session.sql(
                f"""
                WITH CURRENT_ATTRIBUTES AS (
{current_attributes_sql}
                )
                SELECT
                    p.PROJECT_ID,
                    COUNT(DISTINCT s.STTM_ID) AS STTM_COUNT,
                    COUNT(DISTINCT IFF({status_expr} = 'COMPLETE', s.STTM_ID, NULL)) AS COMPLETE_COUNT,
                    COUNT(DISTINCT IFF({status_expr} IN ('IN_PROGRESS'), s.STTM_ID, NULL)) AS PARTIAL_COUNT,
                    COUNT(DISTINCT IFF({status_expr} = 'DRAFT', s.STTM_ID, NULL)) AS DRAFT_COUNT,
                    COUNT({attribute_id_expr}) AS TOTAL_MAPPINGS,
                    COUNT(IFF(
                        NULLIF(TRIM(COALESCE({source_column_expr}, '')), '') IS NOT NULL
                        OR NULLIF(TRIM(COALESCE({transformation_expr}, '')), '') IS NOT NULL,
                        {attribute_id_expr},
                        NULL
                    )) AS MAPPED_COUNT
                FROM {self._projects_table} p
                LEFT JOIN {self._sttm_table} s
                  ON TO_VARCHAR(p.PROJECT_ID) = TO_VARCHAR(s.PROJECT_ID)
                 AND COALESCE(s.STATUS, 'DRAFT') NOT IN ('SUPERSEDED', 'IMPORTING', 'IMPORT_FAILED')
                LEFT JOIN CURRENT_ATTRIBUTES a ON TO_VARCHAR(s.STTM_ID) = TO_VARCHAR(a.STTM_ID)
                WHERE COALESCE(p.STATUS, 'ACTIVE') <> 'ARCHIVED'
                GROUP BY p.PROJECT_ID
                """
            ).collect()
            return {str(row.as_dict().get("PROJECT_ID")): row.as_dict() for row in rows}
        except Exception as exc:
            logger.warning("Project attribute counts unavailable; falling back to STTM lifecycle counts: %s", exc)
        return lifecycle_counts()

    def _mapping_counts_by_sttm(self) -> dict[str, dict[str, Any]]:
        attribute_columns = self._table_columns(self._attributes_table)
        if attribute_columns and "STTM_ID" not in attribute_columns:
            return {}
        attribute_id_expr = (
            "ATTRIBUTE_ID"
            if not attribute_columns or "ATTRIBUTE_ID" in attribute_columns
            else "ATTRIBUTE_NAME"
            if "ATTRIBUTE_NAME" in attribute_columns
            else "STTM_ID"
        )
        source_column_expr = "SOURCE_COLUMN" if not attribute_columns or "SOURCE_COLUMN" in attribute_columns else "''"
        transformation_expr = (
            "TRANSFORMATION_LOGIC"
            if not attribute_columns or "TRANSFORMATION_LOGIC" in attribute_columns
            else "''"
        )
        if not attribute_columns or {"IS_DRAFT", "EFFECTIVE_THROUGH_VERSION"}.issubset(attribute_columns):
            current_attributes_sql = f"""
                    SELECT a.*
                    FROM {self._attributes_table} a
                    WHERE COALESCE(a.IS_DRAFT, FALSE) = TRUE
                    UNION ALL
                    SELECT a.*
                    FROM {self._attributes_table} a
                    WHERE COALESCE(a.IS_DRAFT, FALSE) = FALSE
                      AND a.EFFECTIVE_THROUGH_VERSION IS NULL
                      AND NOT EXISTS (
                          SELECT 1
                          FROM {self._attributes_table} d
                          WHERE TO_VARCHAR(d.STTM_ID) = TO_VARCHAR(a.STTM_ID)
                            AND COALESCE(d.IS_DRAFT, FALSE) = TRUE
                      )
            """
        else:
            current_attributes_sql = f"""
                    SELECT a.*
                    FROM {self._attributes_table} a
            """
        try:
            rows = self._session.sql(
                f"""
                WITH CURRENT_ATTRIBUTES AS (
{current_attributes_sql}
                )
                SELECT
                    STTM_ID,
                    COUNT(*) AS MAPPING_COUNT,
                    COUNT(IFF(
                        NULLIF(TRIM(COALESCE({source_column_expr}, '')), '') IS NOT NULL
                        OR NULLIF(TRIM(COALESCE({transformation_expr}, '')), '') IS NOT NULL,
                        {attribute_id_expr},
                        NULL
                    )) AS MAPPED_COUNT
                FROM CURRENT_ATTRIBUTES
                GROUP BY STTM_ID
                """
            ).collect()
            return {str(row.as_dict().get("STTM_ID")): row.as_dict() for row in rows}
        except Exception as exc:
            logger.warning("STTM attribute counts unavailable; returning zero counts: %s", exc)
            return {}

    def _project_from_row(self, row: dict[str, Any], *, counts: dict[str, Any]) -> ProjectRecord:
        total = int(counts.get("TOTAL_MAPPINGS") or 0)
        mapped = int(counts.get("MAPPED_COUNT") or 0)
        metadata = self._coerce_json(row.get("PROJECT_METADATA"), {})
        return ProjectRecord(
            project_id=str(row.get("PROJECT_ID") or ""),
            project_name=str(row.get("PROJECT_NAME") or ""),
            description=str(row.get("DESCRIPTION") or "") or None,
            status=str(row.get("STATUS") or "ACTIVE"),
            created_by=str(
                row.get("CREATED_BY_NAME")
                or metadata.get("created_by_name")
                or row.get("CREATED_BY")
                or ""
            ) or None,
            created_at=row.get("CREATED_DATETIME"),
            updated_at=row.get("LAST_MODIFIED_DATETIME"),
            sttm_count=int(counts.get("STTM_COUNT") or 0),
            complete_count=int(counts.get("COMPLETE_COUNT") or 0),
            partial_count=int(counts.get("PARTIAL_COUNT") or 0),
            draft_count=int(counts.get("DRAFT_COUNT") or 0),
            total_mappings=total,
            mapped_count=mapped,
            coverage_percent=round((mapped / total) * 100, 2) if total else 0,
            metadata=metadata,
        )

    def _project_link_from_row(self, row: dict[str, Any]) -> ProjectPrecedentLinkRecord:
        return ProjectPrecedentLinkRecord(
            project_link_id=str(row.get("PROJECT_LINK_ID") or ""),
            project_id=str(row.get("PROJECT_ID") or ""),
            precedent_project_id=str(row.get("PRECEDENT_PROJECT_ID") or ""),
            status=str(row.get("STATUS") or "active"),
            priority=int(row.get("PRIORITY") or 50),
            knowledge_categories=self._coerce_json(row.get("KNOWLEDGE_CATEGORIES"), []),
            allow_project_specific_values=bool(row.get("ALLOW_PROJECT_SPECIFIC_VALUES")),
            precedent_project_name=str(row.get("PRECEDENT_PROJECT_NAME") or "") or None,
            created_by=str(row.get("CREATED_BY") or "") or None,
            created_at=row.get("CREATED_AT"),
            updated_at=row.get("UPDATED_AT"),
        )

    def _mapping_link_from_row(self, row: dict[str, Any]) -> MappingPrecedentLinkRecord:
        return MappingPrecedentLinkRecord(
            mapping_link_id=str(row.get("MAPPING_LINK_ID") or ""),
            sttm_id=str(row.get("STTM_ID") or ""),
            precedent_sttm_id=str(row.get("PRECEDENT_STTM_ID") or ""),
            status=str(row.get("STATUS") or "active"),
            priority=int(row.get("PRIORITY") or 75),
            knowledge_categories=self._coerce_json(row.get("KNOWLEDGE_CATEGORIES"), []),
            target_compatibility=str(row.get("TARGET_COMPATIBILITY") or "") or None,
            mapping_lifecycle=str(row.get("MAPPING_LIFECYCLE") or "") or None,
            purpose=str(row.get("PURPOSE") or "") or None,
            confidence=float(row.get("CONFIDENCE") or 1.0),
            allow_project_specific_values=bool(row.get("ALLOW_PROJECT_SPECIFIC_VALUES")),
            precedent_project_id=str(row.get("PRECEDENT_PROJECT_ID") or "") or None,
            precedent_sttm_name=str(row.get("PRECEDENT_STTM_NAME") or "") or None,
            precedent_target_table=str(row.get("PRECEDENT_TARGET_TABLE") or "") or None,
            precedent_status=str(row.get("PRECEDENT_STATUS") or "") or None,
            created_by=str(row.get("CREATED_BY") or "") or None,
            created_at=row.get("CREATED_AT"),
            updated_at=row.get("UPDATED_AT"),
        )

    def _sttm_from_row(self, row: dict[str, Any], *, mapping_counts: dict[str, Any]) -> STTMRecord:
        total = int(mapping_counts.get("MAPPING_COUNT") or 0)
        mapped = int(mapping_counts.get("MAPPED_COUNT") or 0)
        return STTMRecord(
            sttm_id=str(row.get("STTM_ID") or ""),
            project_id=str(row.get("PROJECT_ID") or ""),
            sttm_name=str(row.get("STTM_NAME") or "") or None,
            description=str(row.get("DESCRIPTION") or "") or None,
            target_table=str(row.get("TARGET_TABLE") or "") or None,
            current_version=int(row.get("CURRENT_VERSION") or 0),
            has_unpublished_draft=bool(row.get("HAS_UNPUBLISHED_DRAFT")),
            status=str(row.get("STATUS") or "DRAFT"),
            semantic_bundle_id=str(row.get("SEMANTIC_BUNDLE_ID") or "") or None,
            semantic_bundle_hash=str(row.get("SEMANTIC_BUNDLE_HASH") or "") or None,
            last_snapshot_id=str(row.get("LAST_SNAPSHOT_ID") or "") or None,
            created_at=row.get("CREATED_DATETIME"),
            updated_at=row.get("LAST_MODIFIED_DATETIME"),
            mapping_count=total,
            mapped_count=mapped,
            coverage_percent=round((mapped / total) * 100, 2) if total else 0,
            metadata=self._coerce_json(row.get("STTM_METADATA"), {}),
        )

    def _semantic_bundle_id(self, snapshot: dict[str, Any]) -> str | None:
        bundle = snapshot.get("semantic_bundle") if isinstance(snapshot.get("semantic_bundle"), dict) else {}
        semantic = snapshot.get("semantic") if isinstance(snapshot.get("semantic"), dict) else {}
        return str(bundle.get("bundle_id") or semantic.get("bundle_id") or "") or None

    def _semantic_bundle_hash(self, snapshot: dict[str, Any]) -> str | None:
        bundle = snapshot.get("semantic_bundle") if isinstance(snapshot.get("semantic_bundle"), dict) else {}
        semantic = snapshot.get("semantic") if isinstance(snapshot.get("semantic"), dict) else {}
        return str(bundle.get("bundle_hash") or semantic.get("bundle_hash") or "") or None

    def _replace_sources(self, sttm_id: str, snapshot: dict[str, Any], *, user_id: str | None) -> int:
        source_tables = self._snapshot_tables(snapshot, "source_tables")
        derived_sources = snapshot.get("derived_sources") if isinstance(snapshot.get("derived_sources"), list) else []
        source_columns = self._table_columns(self._sources_table)
        if source_columns and "IS_DRAFT" in source_columns:
            self._session.sql(
                f"DELETE FROM {self._sources_table} WHERE STTM_ID = {self._quote_literal(sttm_id)} AND IS_DRAFT = TRUE"
            ).collect()
        else:
            self._session.sql(
                f"DELETE FROM {self._sources_table} WHERE STTM_ID = {self._quote_literal(sttm_id)}"
            ).collect()
        count = 0
        for index, table in enumerate(source_tables, start=1):
            name = self._table_ref_to_fqn(table)
            self._insert_existing_columns(
                self._sources_table,
                {
                    "STTM_ID": self._quote_literal(sttm_id),
                    "SOURCE_NAME": self._quote_literal(str(table.get("alias") or table.get("table") or f"source_{index}")),
                    "DATABASE_NAME": self._quote_literal(str(table.get("database") or "")),
                    "SCHEMA_NAME": self._quote_literal(str(table.get("schema") or "")),
                    "TABLE_NAME": self._quote_literal(str(table.get("table") or "")),
                    "DESCRIPTION": self._quote_literal(name),
                    "IS_DRAFT": "TRUE",
                    **self._actor_column_values(self._sources_table, user_id),
                },
            )
            count += 1
        for index, derived in enumerate(derived_sources, start=1):
            if not isinstance(derived, dict):
                continue
            self._insert_existing_columns(
                self._sources_table,
                {
                    "STTM_ID": self._quote_literal(sttm_id),
                    "SOURCE_NAME": self._quote_literal(str(derived.get("name") or derived.get("id") or f"derived_{index}")),
                    "DESCRIPTION": self._quote_literal("DERIVED_SOURCE:" + str(derived.get("id") or "")),
                    "IS_DRAFT": "TRUE",
                    **self._actor_column_values(self._sources_table, user_id),
                },
            )
            count += 1
        return count

    def _replace_mapping_rows(
        self,
        *,
        project_id: str,
        sttm_id: str,
        snapshot: dict[str, Any],
        session_id: str | None,
        semantic_bundle_id: str | None,
        semantic_bundle_hash: str | None,
        user_id: str | None,
    ) -> int:
        rows = snapshot.get("mapping_rows") if isinstance(snapshot.get("mapping_rows"), list) else []
        attribute_columns = self._table_columns(self._attributes_table)
        if attribute_columns and "IS_DRAFT" in attribute_columns:
            self._session.sql(
                f"""
                DELETE FROM {self._attributes_table}
                WHERE STTM_ID = {self._quote_literal(sttm_id)}
                  AND COALESCE(IS_DRAFT, FALSE) = TRUE
                """
            ).collect()
        else:
            self._session.sql(
                f"DELETE FROM {self._attributes_table} WHERE STTM_ID = {self._quote_literal(sttm_id)}"
            ).collect()
        for item in rows:
            if not isinstance(item, dict):
                continue
            source_columns = item.get("source_columns") or []
            if isinstance(source_columns, list):
                source_column_text = ", ".join(str(value) for value in source_columns if value)
            else:
                source_column_text = str(source_columns or "")
            mapping_mode = (
                "constant"
                if str(item.get("mapping_mode") or "source").lower() == "constant"
                else "source"
            )
            constant_value = item.get("constant_value")
            transformation_logic = (
                item.get("expression")
                or item.get("transformation_expr")
                or item.get("natural_language_rule")
                or item.get("rule")
                or item.get("preprocessing_rule")
                or (
                    f"CONSTANT({json.dumps(constant_value)})"
                    if mapping_mode == "constant"
                    else ""
                )
                or ""
            )
            self._insert_existing_columns(
                self._attributes_table,
                {
                    "STTM_ID": self._quote_literal(sttm_id),
                    "ATTRIBUTE_NAME": self._quote_literal(str(item.get("target_column") or "")),
                    "ATTRIBUTE_TYPE": self._quote_literal("TRANSFORMED" if transformation_logic else "RAW"),
                    # Legacy environments may define SOURCE_COLUMN as a short
                    # VARCHAR. The complete list remains authoritative in
                    # CONDITION.source_columns below.
                    "SOURCE_COLUMN": self._quote_text_for_column(
                        self._attributes_table,
                        "SOURCE_COLUMN",
                        source_column_text,
                    ),
                    "DATA_TYPE": self._quote_literal(str(item.get("target_type") or item.get("target_data_type") or "")),
                    "TRANSFORMATION_LOGIC": self._quote_literal(str(transformation_logic)),
                    "DESCRIPTION": self._quote_literal(item.get("description") or ""),
                    "CONDITION": "PARSE_JSON(" + self._json_literal({
                        "mapping_row_id": str(item.get("id") or item.get("mapping_row_id") or uuid.uuid4()),
                        "project_id": project_id,
                        "session_id": session_id or "",
                        "target_table": self._table_ref_to_fqn(snapshot.get("target_table")),
                        "source_columns": source_columns,
                        "source_expressions": item.get("source_expressions") or [],
                        "mapping_mode": mapping_mode,
                        "constant_value": constant_value,
                        "preprocessing_rule": item.get("rule") or item.get("preprocessing_rule") or "",
                        "natural_language_rule": item.get("natural_language_rule") or "",
                        "load_order": item.get("load_order"),
                        "status": item.get("status") or "draft",
                        "confidence": item.get("confidence"),
                        "confidence_reason": item.get("confidence_reason") or "",
                        "alternatives": item.get("alternatives") or [],
                        "agent_artifact_id": item.get("agent_artifact_id") or "",
                        "semantic_bundle_id": semantic_bundle_id or "",
                        "semantic_bundle_hash": semantic_bundle_hash or "",
                        "fir_context_key": item.get("fir_context_key") or "",
                    }) + ")",
                    "CALCULATION": "PARSE_JSON(" + self._json_literal(item.get("calculation") or {}) + ")",
                    "MEASURE": "PARSE_JSON(" + self._json_literal(item.get("measure") or {}) + ")",
                    "AGGREGATION": "PARSE_JSON(" + self._json_literal(item.get("aggregation") or {}) + ")",
                    "IS_DRAFT": "TRUE",
                    **self._actor_column_values(self._attributes_table, user_id),
                },
            )
        return len([item for item in rows if isinstance(item, dict)])

    def _record_agent_artifacts(
        self,
        *,
        project_id: str,
        sttm_id: str,
        payload: STTMAutosaveRequest,
        snapshot: dict[str, Any],
        user_id: str | None,
        semantic_bundle_id: str | None,
        semantic_bundle_hash: str | None,
    ) -> int:
        artifacts = list(payload.agent_artifacts or [])
        artifacts.extend(snapshot.get("mapping_artifacts") or [])
        count = 0
        for artifact in artifacts:
            if not isinstance(artifact, dict):
                continue
            artifact_id = self._memory.record_agent_artifact(
                request_id=str(artifact.get("request_id") or ""),
                session_id=payload.session_id or str(snapshot.get("session_id") or ""),
                thread_id=payload.thread_id or str(snapshot.get("thread_id") or ""),
                agent_name=str(artifact.get("agent_name") or artifact.get("agent") or "unknown_agent"),
                artifact_type=str(artifact.get("artifact_type") or artifact.get("type") or "agent_artifact"),
                payload={**artifact, "project_id": project_id, "sttm_id": sttm_id},
                artifact_status=str(artifact.get("artifact_status") or artifact.get("status") or "draft"),
                entity_type=str(artifact.get("entity_type") or "sttm"),
                entity_ids=[project_id, sttm_id, *[str(v) for v in artifact.get("entity_ids", []) if v]],
                semantic_bundle_id=semantic_bundle_id,
                semantic_bundle_hash=semantic_bundle_hash,
                summary=str(artifact.get("summary") or ""),
                created_by=user_id,
                context_key=str(snapshot.get("context_key") or artifact.get("context_key") or ""),
                snapshot_id=str(snapshot.get("snapshot_id") or artifact.get("snapshot_id") or ""),
                retrieved_inference_ids=[
                    str(value) for value in (artifact.get("retrieved_inference_ids") or []) if value
                ],
                retrieved_recommendation_ids=[
                    str(value) for value in (artifact.get("retrieved_recommendation_ids") or []) if value
                ],
                used_inference_ids=[
                    str(value) for value in (artifact.get("used_inference_ids") or []) if value
                ],
                used_recommendation_ids=[
                    str(value) for value in (artifact.get("used_recommendation_ids") or []) if value
                ],
            )
            artifact["artifact_id"] = artifact_id
            count += 1
        return count

    def _record_autosave_fir_events(
        self,
        *,
        project_id: str,
        sttm_id: str,
        payload: STTMAutosaveRequest,
        snapshot: dict[str, Any],
        user_id: str | None,
    ) -> int:
        events = list(payload.fir_events or [])
        events.append(
            {
                "event_type": payload.action or "workspace.autosaved",
                "entity_type": "sttm",
                "entity_ids": [project_id, sttm_id],
                "event_payload": {
                    "project_id": project_id,
                    "sttm_id": sttm_id,
                    "context_hash": snapshot.get("context_hash"),
                    "mapping_count": len(snapshot.get("mapping_rows") or []),
                    "source_count": len(snapshot.get("source_tables") or []),
                    "derived_source_count": len(snapshot.get("derived_sources") or []),
                    "validation_history_count": len(snapshot.get("validation_history") or []),
                },
            }
        )
        for validation in snapshot.get("validation_history") or []:
            if isinstance(validation, dict):
                status = "sql.validation_passed" if validation.get("valid") is True else "sql.validation_failed"
                events.append(
                    {
                        "event_type": status,
                        "entity_type": "validation",
                        "entity_ids": [project_id, sttm_id],
                        "event_payload": validation,
                    }
                )
        count = 0
        for event in events:
            if not isinstance(event, dict):
                continue
            self._record_fir(
                event_type=str(event.get("event_type") or "workspace.event"),
                user_id=user_id,
                session_id=payload.session_id or str(snapshot.get("session_id") or ""),
                request_id=str(event.get("request_id") or ""),
                page=str(snapshot.get("page") or event.get("page") or ""),
                surface=str(snapshot.get("surface") or event.get("surface") or ""),
                entity_type=str(event.get("entity_type") or "sttm"),
                entity_ids=[str(v) for v in event.get("entity_ids", [project_id, sttm_id]) if v],
                payload=event.get("event_payload") if isinstance(event.get("event_payload"), dict) else event,
                context_key=str(snapshot.get("context_key") or ""),
                snapshot_id=str(snapshot.get("snapshot_id") or ""),
                milestone=str(snapshot.get("milestone") or payload.action or ""),
            )
            count += 1
        return count

    def _record_fir(
        self,
        *,
        event_type: str,
        user_id: str | None,
        session_id: str | None,
        request_id: str | None,
        page: str | None,
        surface: str | None,
        entity_type: str | None,
        entity_ids: list[str] | None,
        payload: dict[str, Any] | None,
        context_key: str | None = None,
        snapshot_id: str | None = None,
        milestone: str | None = None,
    ) -> None:
        try:
            self._memory.record_fir_event(
                event_type=event_type,
                user_id=user_id,
                session_id=session_id,
                request_id=request_id,
                page=page,
                surface=surface,
                entity_type=entity_type,
                entity_ids=entity_ids,
                event_payload=payload,
                context_key=context_key,
                snapshot_id=snapshot_id,
                milestone=milestone,
            )
        except Exception as exc:  # pragma: no cover - FIR should not block save/publish
            logger.warning("Failed to record FIR event %s: %s", event_type, exc)

    def _record_agent_learnings(
        self,
        *,
        project_id: str,
        sttm_id: str,
        snapshot: dict[str, Any],
        user_id: str | None,
    ) -> int:
        """Record only explicit corrections, accepted rows, and trusted imports.

        ``ai_suggested`` describes origin, not acceptance. Treating it as user
        approval pollutes FIR with every unreviewed proposal and causes later
        mappings to reinforce an agent's own mistakes.
        """
        mapping_rows = snapshot.get("mapping_rows") or []
        if not isinstance(mapping_rows, list):
            return 0

        target_table = self._table_ref_to_fqn(snapshot.get("target_table"))
        source_tables = [
            self._table_ref_to_fqn(table)
            for table in self._snapshot_tables(snapshot, "source_tables")
            if self._table_ref_to_fqn(table)
        ]
        count = 0
        for row in mapping_rows:
            if not isinstance(row, dict):
                continue

            status = str(row.get("status") or "").lower()
            confidence = float(row.get("confidence") or 0.0)
            target_column = str(
                row.get("target_column")
                or row.get("target_attribute")
                or row.get("attribute_name")
                or ""
            )
            provenance = str(row.get("provenance") or "").strip().lower()
            is_historical_precedent = provenance in {
                "historical_import",
                "published_mapping",
                "client_asset_import",
            }
            is_accepted = bool(row.get("accepted")) or is_historical_precedent

            if not target_column or status != "mapped":
                continue

            # Corrections always outrank acceptance and precedent evidence.
            if row.get("was_corrected"):
                incorrect_source = self._extract_source_columns(row.get("original_source") or {})
                correct_source = self._extract_source_columns(row)
                error_category = str(row.get("correction_category") or "manual_edit")
                prevention_hint = str(row.get("correction_reason") or "User corrected the AI suggestion")

                try:
                    self._agent_learning.record_mapping_correction(
                        target_column=target_column,
                        incorrect_source=incorrect_source,
                        correct_source=correct_source,
                        error_category=error_category,
                        prevention_hint=prevention_hint,
                        project_id=project_id,
                        sttm_id=sttm_id,
                        user_id=user_id,
                    )
                    count += 1
                except Exception as exc:
                    logger.debug("Failed to record mapping correction learning: %s", exc)
                continue

            if is_accepted and confidence >= 0.7:
                source_columns = self._extract_source_columns(row)
                preprocessing_rule = str(
                    row.get("preprocessing_rule")
                    or row.get("rule")
                    or row.get("expression")
                    or row.get("natural_language_rule")
                    or row.get("source_expression")
                    or ""
                )
                preprocessing_rule_type = str(
                    row.get("preprocessing_rule_type")
                    or ("Historical" if is_historical_precedent else "Direct")
                )

                try:
                    self._agent_learning.record_mapping_acceptance(
                        target_column=target_column,
                        source_columns=source_columns,
                        preprocessing_rule=preprocessing_rule,
                        preprocessing_rule_type=preprocessing_rule_type,
                        confidence_score=confidence,
                        project_id=project_id,
                        sttm_id=sttm_id,
                        user_id=user_id,
                        target_table=target_table or None,
                        source_tables=source_tables,
                        provenance=provenance or None,
                    )
                    count += 1
                except Exception as exc:
                    logger.debug("Failed to record mapping acceptance learning: %s", exc)

        return count

    def _record_target_mapping_patterns(
        self,
        *,
        project_id: str,
        sttm_id: str,
        snapshot: dict[str, Any],
        evidence_class: str,
        validation_status: str,
        base_confidence: float,
    ) -> int:
        """Persist one reusable, typed FIR pattern for each trusted mapping row.

        This deliberately runs after deterministic mapping persistence. Agent
        enrichment may resume later, but accepted/corrected/published evidence
        is immediately available for target-column retrieval.
        """
        if not self._settings.fir_target_mapping_patterns_v2:
            return 0
        rows = snapshot.get("mapping_rows")
        if not isinstance(rows, list):
            return 0
        target_table = self._table_ref_to_fqn(snapshot.get("target_table"))
        source_tables = [
            self._table_ref_to_fqn(item)
            for item in self._snapshot_tables(snapshot, "source_tables")
            if self._table_ref_to_fqn(item)
        ]
        trusted_rows: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            status = str(row.get("status") or "").lower()
            if status not in {"mapped", "accepted", "complete", "published"}:
                continue
            target_column = str(
                row.get("target_column")
                or row.get("target_attribute")
                or row.get("attribute_name")
                or ""
            ).strip()
            if not target_column:
                continue
            trusted_rows.append(
                {
                    **row,
                    "target_alias": target_column,
                    "target_table": target_table,
                    "source_columns": self._extract_source_columns(row),
                    "transformation": (
                        row.get("preprocessing_rule")
                        or row.get("rule")
                        or row.get("expression")
                        or row.get("source_expression")
                        or ""
                    ),
                    "field_definition": (
                        row.get("natural_language_rule")
                        or row.get("description")
                        or row.get("business_rationale")
                    ),
                }
            )
        if not trusted_rows:
            return 0
        snapshot_hash = self._snapshot_hash(
            {
                "target_table": target_table,
                "source_tables": source_tables,
                "mapping_rows": trusted_rows,
                "relationships": snapshot.get("relationships") or [],
                "derived_sources": snapshot.get("derived_sources") or [],
            }
        )
        asset_id = f"sttm_{sttm_id}_{snapshot_hash[:20]}"
        parsed_document = {
            "target_table": target_table,
            "source_tables": source_tables,
            "source_system": self._infer_source_vendor(source_tables),
            "entity_meaning": snapshot.get("mapping_intent"),
            "column_mappings": trusted_rows,
            "join_patterns": snapshot.get("relationships") or [],
            "ctes": snapshot.get("derived_sources") or [],
            "business_rules": [
                item
                for item in (
                    snapshot.get("filters")
                    or snapshot.get("query_shaping_rules")
                    or []
                )
                if isinstance(item, dict)
            ],
        }
        try:
            service = TargetMappingPatternService(self._session, self._settings)
            extracted = service.extract_document_patterns(
                asset_id=asset_id,
                project_id=project_id,
                parsed_document=parsed_document,
                evidence_class=evidence_class,
                base_confidence=base_confidence,
            )
            patterns = [
                pattern.model_copy(
                    update={
                        "sttm_id": sttm_id,
                        "validation_status": validation_status,
                        "provenance": {
                            **pattern.provenance,
                            "sttm_id": sttm_id,
                            "evidence_class": evidence_class,
                        },
                        "evidence_ids": sorted(
                            {*pattern.evidence_ids, sttm_id}
                        ),
                    }
                )
                for pattern in extracted
            ]
            count = service.upsert_patterns(patterns)
            if self._settings.fir_durable_jobs_v2:
                service.create_learning_job(
                    asset_id=asset_id,
                    project_id=project_id,
                    patterns=patterns,
                )
            return count
        except Exception as exc:  # FIR learning must never block user saves.
            logger.warning(
                "Failed to record target-column patterns for STTM %s: %s",
                sttm_id,
                exc,
            )
            return 0

    @staticmethod
    def _infer_source_vendor(source_tables: list[str]) -> str | None:
        joined = " ".join(source_tables).upper()
        for vendor in (
            "REDTAIL",
            "EVERNEST",
            "SALESFORCE",
            "WEALTHBOX",
            "ADDEPAR",
            "ORION",
            "TAMARAC",
        ):
            if vendor in joined:
                return vendor
        return None

    def _extract_source_columns(self, row: dict[str, Any] | Any) -> list[str]:
        """Extract source columns from a mapping row or source object."""
        if not isinstance(row, dict):
            return []

        source_cols = row.get("source_columns") or row.get("source_column") or row.get("source_expression")
        if source_cols is None:
            return []

        if isinstance(source_cols, list):
            return [str(c) for c in source_cols if c]
        if isinstance(source_cols, str):
            try:
                parsed = json.loads(source_cols)
                if isinstance(parsed, list):
                    return [str(c) for c in parsed if c]
            except (json.JSONDecodeError, TypeError):
                pass
            if source_cols:
                return [source_cols]
        return []

    def _build_fir_features(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        mapping_rows = snapshot.get("mapping_rows") if isinstance(snapshot.get("mapping_rows"), list) else []
        confidence_values = [
            float(row.get("confidence"))
            for row in mapping_rows
            if isinstance(row, dict) and row.get("confidence") is not None
        ]
        return {
            "source_count": len(snapshot.get("source_tables") or []),
            "derived_source_count": len(snapshot.get("derived_sources") or []),
            "relationship_count": len(snapshot.get("relationships") or []),
            "mapping_count": len(mapping_rows),
            "mapped_count": len(
                [
                    row
                    for row in mapping_rows
                    if isinstance(row, dict)
                    and str(row.get("status") or "").lower() in {"mapped", "accepted", "complete"}
                ]
            ),
            "average_confidence": round(sum(confidence_values) / len(confidence_values), 4)
            if confidence_values
            else None,
            "semantic_bundle_hash": self._semantic_bundle_hash(snapshot),
            "has_sql": bool(snapshot.get("mapping_sql") or snapshot.get("mapping_preview_sql")),
        }

    def _latest_snapshot(self, sttm_id: str) -> dict[str, Any] | None:
        try:
            rows = self._session.sql(
                f"""
                SELECT SNAPSHOT_ID, SNAPSHOT_PAYLOAD, RAW_MAPPING_SQL, PARSED_MAPPING_MODEL
                FROM {self._snapshots_table}
                WHERE STTM_ID = {self._quote_literal(sttm_id)}
                ORDER BY CREATED_AT DESC
                LIMIT 1
                """
            ).collect()
            if not rows:
                return None
            row = rows[0].as_dict()
            snapshot = self._coerce_json(row.get("SNAPSHOT_PAYLOAD"), {})
            # Keep the immutable columns authoritative. Older payload JSON can
            # predate these fields even when the migrated snapshot row has
            # already been backfilled with the original SQL/model.
            raw_mapping_sql = str(row.get("RAW_MAPPING_SQL") or "")
            if raw_mapping_sql:
                snapshot["raw_mapping_sql"] = raw_mapping_sql
                snapshot.setdefault("mapping_sql", raw_mapping_sql)
            parsed_mapping_model = self._coerce_json(row.get("PARSED_MAPPING_MODEL"), {})
            if parsed_mapping_model:
                snapshot["parsed_mapping_model"] = parsed_mapping_model
            snapshot.setdefault("snapshot_id", str(row.get("SNAPSHOT_ID") or ""))
            return snapshot
        except Exception as exc:
            logger.warning("Latest snapshot unavailable for STTM %s: %s", sttm_id, exc)
            return None

    def _list_sources(self, sttm_id: str) -> list[dict[str, Any]]:
        try:
            order_by = self._order_by_expr(
                self._sources_table,
                ["SOURCE_ID", "SOURCE_NAME", "TABLE_NAME"],
                "STTM_ID",
            )
            rows = self._session.sql(
                f"""
                SELECT *
                FROM {self._sources_table}
                WHERE STTM_ID = {self._quote_literal(sttm_id)}
                ORDER BY {order_by}
                """
            ).collect()
            return [row.as_dict() for row in rows]
        except Exception as exc:
            logger.warning("STTM sources unavailable for %s: %s", sttm_id, exc)
            return []

    def _list_mapping_rows(self, sttm_id: str) -> list[dict[str, Any]]:
        try:
            attribute_columns = self._table_columns(self._attributes_table)
            if attribute_columns and "STTM_ID" not in attribute_columns:
                return []
            order_by = self._order_by_expr(
                self._attributes_table,
                ["ATTRIBUTE_NAME", "ATTRIBUTE_ID"],
                "STTM_ID",
            )
            if not attribute_columns or {"IS_DRAFT", "EFFECTIVE_THROUGH_VERSION"}.issubset(attribute_columns):
                current_attributes_sql = f"""
                    SELECT a.*
                    FROM {self._attributes_table} a
                    WHERE TO_VARCHAR(a.STTM_ID) = {self._quote_literal(sttm_id)}
                      AND COALESCE(a.IS_DRAFT, FALSE) = TRUE
                    UNION ALL
                    SELECT a.*
                    FROM {self._attributes_table} a
                    WHERE TO_VARCHAR(a.STTM_ID) = {self._quote_literal(sttm_id)}
                      AND COALESCE(a.IS_DRAFT, FALSE) = FALSE
                      AND a.EFFECTIVE_THROUGH_VERSION IS NULL
                      AND NOT EXISTS (
                          SELECT 1
                          FROM {self._attributes_table} d
                          WHERE TO_VARCHAR(d.STTM_ID) = TO_VARCHAR(a.STTM_ID)
                            AND COALESCE(d.IS_DRAFT, FALSE) = TRUE
                      )
                """
            else:
                current_attributes_sql = f"""
                    SELECT a.*
                    FROM {self._attributes_table} a
                    WHERE TO_VARCHAR(a.STTM_ID) = {self._quote_literal(sttm_id)}
                """
            rows = self._session.sql(
                f"""
                WITH CURRENT_ATTRIBUTES AS (
{current_attributes_sql}
                )
                SELECT *
                FROM CURRENT_ATTRIBUTES
                ORDER BY {order_by}
                """
            ).collect()
            mapping_rows: list[dict[str, Any]] = []
            for row in rows:
                data = row.as_dict()
                condition = self._coerce_json(data.get("CONDITION"), {})
                source_columns = condition.get("source_columns")
                if not isinstance(source_columns, list):
                    source_text = str(data.get("SOURCE_COLUMN") or "")
                    source_columns = [part.strip() for part in source_text.split(",") if part.strip()]
                mapping_rows.append(
                    {
                        "id": str(condition.get("mapping_row_id") or data.get("ATTRIBUTE_ID") or ""),
                        "mapping_row_id": str(condition.get("mapping_row_id") or data.get("ATTRIBUTE_ID") or ""),
                        "target_column": str(data.get("ATTRIBUTE_NAME") or ""),
                        "target_type": str(data.get("DATA_TYPE") or "") or None,
                        "source_columns": source_columns,
                        "mapping_mode": str(condition.get("mapping_mode") or "source"),
                        "constant_value": condition.get("constant_value"),
                        "rule": str(condition.get("preprocessing_rule") or "") or None,
                        "expression": (
                            None
                            if str(condition.get("mapping_mode") or "source") == "constant"
                            else str(data.get("TRANSFORMATION_LOGIC") or "") or None
                        ),
                        "natural_language_rule": str(condition.get("natural_language_rule") or "") or None,
                        "description": str(data.get("DESCRIPTION") or "") or None,
                        "load_order": condition.get("load_order"),
                        "status": str(condition.get("status") or ("mapped" if source_columns or data.get("TRANSFORMATION_LOGIC") else "draft")),
                        "confidence": condition.get("confidence"),
                        "confidence_reason": condition.get("confidence_reason"),
                        "alternatives": condition.get("alternatives") if isinstance(condition.get("alternatives"), list) else [],
                        "agent_artifact_id": condition.get("agent_artifact_id"),
                        "semantic_bundle_id": condition.get("semantic_bundle_id"),
                        "semantic_bundle_hash": condition.get("semantic_bundle_hash"),
                        "attribute_id": str(data.get("ATTRIBUTE_ID") or ""),
                    }
                )
            return mapping_rows
        except Exception as exc:
            logger.warning("STTM attributes unavailable for %s: %s", sttm_id, exc)
            return []

    def _list_versions(self, sttm_id: str) -> list[dict[str, Any]]:
        try:
            order_by = self._order_by_expr(
                self._versions_table,
                ["VERSION_NUMBER", "VERSION_ID", "PUBLISHED_DATETIME"],
                "STTM_ID",
            )
            rows = self._session.sql(
                f"""
                SELECT *
                FROM {self._versions_table}
                WHERE STTM_ID = {self._quote_literal(sttm_id)}
                ORDER BY {order_by} DESC
                """
            ).collect()
            return [row.as_dict() for row in rows]
        except Exception as exc:
            logger.warning("STTM versions unavailable for %s: %s", sttm_id, exc)
            return []

    def _list_artifacts(self, sttm_id: str) -> list[dict[str, Any]]:
        try:
            rows = self._session.sql(
                f"""
                SELECT *
                FROM {self._artifacts_table}
                WHERE ARRAY_CONTAINS({self._quote_literal(sttm_id)}::VARIANT, ENTITY_IDS)
                   OR PAYLOAD:sttm_id::STRING = {self._quote_literal(sttm_id)}
                ORDER BY CREATED_AT DESC
                LIMIT 100
                """
            ).collect()
            return [
                {
                    **row.as_dict(),
                    "PAYLOAD": self._coerce_json(row.as_dict().get("PAYLOAD"), {}),
                    "ENTITY_IDS": self._coerce_json(row.as_dict().get("ENTITY_IDS"), []),
                }
                for row in rows
            ]
        except Exception as exc:
            logger.warning("Agent artifacts unavailable for STTM %s: %s", sttm_id, exc)
            return []
