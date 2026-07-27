import json
import hashlib
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.exceptions import SnowflakeAgentError, SnowflakeQueryError
from app.core.snowflake import (
    SnowflakeClient,
    get_local_cached_client,
    get_local_rest_session_context,
    using_local_dev_auth,
)
from app.core.snowflake_agent import SnowflakeAgentClient
from app.schema.common import TableRef
from app.schema.semantic_context import SemanticLevel
from app.schema.semantic_model import GenerateRequest, JobStatus

logger = logging.getLogger(__name__)

# In-memory job store — lives for the process lifetime (single-instance deployment)
_jobs: dict[str, JobStatus] = {}


class SemanticModelService:

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._agent_name = settings.resolved_semantic_model_agent
        if not self._agent_name:
            raise SnowflakeAgentError(
                "Could not resolve the semantic model agent. Set "
                "SNOWFLAKE_SEMANTIC_MODEL_AGENT or provide the metadata "
                "database/schema configuration."
            )
        self._table = settings.qualify_table_name(settings.snowflake_semantic_model_table)
        self._table_views_table = settings.resolved_semantic_views_table
        self._column_views_table = settings.resolved_semantic_column_views_table
        self._native_views_table = settings.resolved_semantic_native_views_table

    @staticmethod
    def _sql_literal(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    def submit(self, req: GenerateRequest) -> tuple[str, int]:
        """Register a pending job, return (job_id, total_tasks)."""
        unique_schemas = _unique_schemas(req.tables)
        # SCHEMA per unique schema + TABLE per table. TABLE responses also contain
        # attribute-level semantics and are persisted together.
        total = len(unique_schemas) + len(req.tables)

        job_id = str(uuid.uuid4())
        _jobs[job_id] = JobStatus(
            job_id=job_id,
            status="pending",
            tables=[t.qualified_name for t in req.tables],
            total=total,
            started_at=datetime.now(timezone.utc),
        )
        return job_id, total

    def get_job(self, job_id: str) -> JobStatus | None:
        return _jobs.get(job_id)

    def get_record(
        self,
        session: Session,
        scope: str,
        db_name: str,
        schema_name: str,
        table_name: str = "",
        attribute_name: str = "",
    ) -> dict | None:
        rows = session.sql(f"""
            SELECT SCOPE, DB_NAME, SCHEMA_NAME, TABLE_NAME, ATTRIBUTE_NAME,
                   SEMANTIC_MODEL, GENERATED_AT, UPDATED_AT
            FROM {self._table}
            WHERE SCOPE          = '{scope.upper()}'
              AND DB_NAME        = '{db_name.upper()}'
              AND SCHEMA_NAME    = '{schema_name.upper()}'
              AND TABLE_NAME     = '{table_name.upper()}'
              AND ATTRIBUTE_NAME = '{attribute_name.upper()}'
        """).collect()
        if not rows:
            return None
        r = rows[0]
        sm_raw = r["SEMANTIC_MODEL"]
        return {
            "scope": r["SCOPE"],
            "database": r["DB_NAME"],
            "schema_name": r["SCHEMA_NAME"],
            "table_name": r["TABLE_NAME"] or None,
            "attribute_name": r["ATTRIBUTE_NAME"] or None,
            "semantic_model": json.loads(sm_raw) if isinstance(sm_raw, str) else sm_raw,
            "generated_at": r["GENERATED_AT"],
            "updated_at": r["UPDATED_AT"],
        }

    def ensure_tables(
        self,
        session: Session,
        agent_client: SnowflakeAgentClient,
        tables: list[TableRef],
        force: bool = False,
        semantic_level: SemanticLevel = SemanticLevel.L1_CONTEXT,
    ) -> dict[str, int]:
        generated = 0
        skipped = 0

        for table in tables:
            table_db = table.database.upper()
            table_schema = table.schema.upper()
            table_name = table.table.upper()
            outcome = _execute_task(
                session,
                agent_client,
                self._table,
                self._agent_name,
                "TABLE",
                table_db,
                table_schema,
                table_name,
                force,
                semantic_level,
            )
            generated += 1 if outcome == "generated" else 0
            skipped += 1 if outcome == "skipped" else 0

        return {"generated": generated, "skipped": skipped}

    def get_table_records(
        self,
        session: Session,
        tables: list[TableRef],
    ) -> list[dict[str, Any]]:
        if not tables:
            return []

        v2_records = self._get_v2_table_view_records(session, tables)
        self._merge_native_views(session, tables, v2_records)
        self._merge_v2_column_views(session, tables, v2_records)
        self._overlay_curated_versions(session, v2_records)
        records_by_fqn = {
            _record_fqn(record): record
            for record in v2_records
            if _record_fqn(record)
        }
        missing_tables = [
            table
            for table in tables
            if table.qualified_name.upper() not in records_by_fqn
        ]
        if missing_tables:
            for record in self._get_legacy_table_records(session, missing_tables):
                fqn = _record_fqn(record)
                if fqn and fqn not in records_by_fqn:
                    records_by_fqn[fqn] = record

        return [
            records_by_fqn[table.qualified_name.upper()]
            for table in tables
            if table.qualified_name.upper() in records_by_fqn
        ]

    def _get_v2_table_view_records(
        self,
        session: Session,
        tables: list[TableRef],
    ) -> list[dict[str, Any]]:
        """Read canonical AGT_SEMANTIC_MODEL_V2 table assets.

        V2 owns generation and persistence. Request paths only read the stored
        JSON from SEM_TABLE_VIEWS and normalize it into the legacy record shape
        used by the bundle composer. If the client environment has not moved to
        the V2 registry yet, this method quietly returns no records so callers
        can fall back to TBL_SEMANTIC_MODELS.
        """
        if not tables:
            return []

        values_sql = ", ".join(
            "("
            f"{self._sql_literal(table.database.upper())}, "
            f"{self._sql_literal(table.schema.upper())}, "
            f"{self._sql_literal(table.table.upper())}"
            ")"
            for table in tables
        )
        try:
            rows = session.sql(f"""
                WITH requested(DATABASE_NAME, SCHEMA_NAME, TABLE_NAME) AS (
                    SELECT * FROM VALUES {values_sql}
                )
                SELECT
                    t.VIEW_ID,
                    t.DATABASE_NAME,
                    t.SCHEMA_NAME,
                    t.TABLE_NAME,
                    t.FQN,
                    t.VERSION,
                    t.STATUS,
                    t.ROW_COUNT,
                    t.COLUMN_COUNT,
                    t.COLUMN_SET_HASH,
                    t.LAST_ALTERED_TS,
                    t.SEMANTIC_VIEW,
                    t.GENERATED_AT,
                    t.GENERATED_AT AS UPDATED_AT
                FROM {self._table_views_table} AS t
                INNER JOIN requested AS r
                    ON UPPER(t.DATABASE_NAME) = r.DATABASE_NAME
                   AND UPPER(t.SCHEMA_NAME) = r.SCHEMA_NAME
                   AND UPPER(t.TABLE_NAME) = r.TABLE_NAME
                WHERE COALESCE(UPPER(t.STATUS), 'ACTIVE') = 'ACTIVE'
                QUALIFY ROW_NUMBER() OVER (
                    PARTITION BY UPPER(t.DATABASE_NAME), UPPER(t.SCHEMA_NAME), UPPER(t.TABLE_NAME)
                    ORDER BY t.GENERATED_AT DESC
                ) = 1
            """).collect()
        except Exception as exc:
            logger.warning(
                "V2 semantic registry query FAILED at %s (falling back to %s): %s",
                self._table_views_table,
                self._table,
                exc,
            )
            return []

        records: list[dict[str, Any]] = []
        for row in rows:
            r = row.as_dict() if hasattr(row, "as_dict") else dict(row)
            database = str(_pick_value(r, "DATABASE_NAME") or "").upper()
            schema_name = str(_pick_value(r, "SCHEMA_NAME") or "").upper()
            table_name = str(_pick_value(r, "TABLE_NAME") or "").upper()
            semantic_payload = _json_loads_if_needed(_pick_value(r, "SEMANTIC_VIEW"))
            registry_meta = {
                "source": "SEM_TABLE_VIEWS",
                "view_id": _pick_value(r, "VIEW_ID"),
                "fqn": _pick_value(r, "FQN") or f"{database}.{schema_name}.{table_name}",
                "version": _pick_value(r, "VERSION"),
                "status": _pick_value(r, "STATUS"),
                "row_count": _pick_value(r, "ROW_COUNT"),
                "column_count": _pick_value(r, "COLUMN_COUNT"),
                "column_set_hash": _pick_value(r, "COLUMN_SET_HASH"),
                "last_altered_ts": _pick_value(r, "LAST_ALTERED_TS"),
                "physical_view_name": None,
                "yaml_hash": None,
                "producer_agent": None,
                "request_id": None,
                "parent_view_id": None,
                "change_reason": None,
            }
            records.append(
                {
                    "scope": "TABLE",
                    "database": database,
                    "schema_name": schema_name,
                    "table_name": table_name or None,
                    "attribute_name": None,
                    "semantic_model": _normalize_v2_semantic_payload(
                        semantic_payload,
                        registry_meta=registry_meta,
                    ),
                    "generated_at": _pick_value(r, "GENERATED_AT"),
                    "updated_at": _pick_value(r, "UPDATED_AT"),
                    "semantic_source": "SEM_TABLE_VIEWS",
                    "semantic_registry": registry_meta,
                }
            )
        return records

    def _merge_native_views(
        self,
        session: Session,
        tables: list[TableRef],
        table_records: list[dict[str, Any]],
    ) -> None:
        """Attach Snowflake's complete native DDL/YAML without replacing rich JSON."""
        if not tables:
            return
        values_sql = ", ".join(
            "("
            f"{self._sql_literal(table.database.upper())}, "
            f"{self._sql_literal(table.schema.upper())}, "
            f"{self._sql_literal(table.table.upper())}"
            ")"
            for table in tables
        )
        try:
            rows = session.sql(f"""
                WITH requested(DATABASE_NAME, SCHEMA_NAME, TABLE_NAME) AS (
                    SELECT * FROM VALUES {values_sql}
                )
                SELECT
                    n.NATIVE_VIEW_ID, n.DATABASE_NAME, n.SCHEMA_NAME, n.TABLE_NAME,
                    n.SOURCE_FQN, n.TABLE_VIEW_ID, n.VIEW_NAME, n.TARGET_DB,
                    n.TARGET_SCHEMA, n.TARGET_FQN, n.DDL_TEXT, n.CA_YAML_MODEL,
                    n.FACTS_COUNT, n.DIMENSIONS_COUNT, n.JOINS_COUNT,
                    n.HAS_LOW_CONFIDENCE_JOINS, n.HAS_FLAGGED_EXCLUDED,
                    n.PK_CONFIRMED, n.PHASE2_ENABLED, n.STATUS, n.CREATED_AT,
                    n.GENERATED_BY, n.ERROR_MESSAGE
                FROM {self._native_views_table} n
                INNER JOIN requested r
                    ON UPPER(n.DATABASE_NAME) = r.DATABASE_NAME
                   AND UPPER(n.SCHEMA_NAME) = r.SCHEMA_NAME
                   AND UPPER(n.TABLE_NAME) = r.TABLE_NAME
                WHERE COALESCE(UPPER(n.STATUS), 'ACTIVE') = 'ACTIVE'
                QUALIFY ROW_NUMBER() OVER (
                    PARTITION BY UPPER(n.DATABASE_NAME), UPPER(n.SCHEMA_NAME), UPPER(n.TABLE_NAME)
                    ORDER BY n.CREATED_AT DESC
                ) = 1
            """).collect()
        except Exception as exc:
            logger.warning("Native semantic registry query failed at %s: %s", self._native_views_table, exc)
            return

        records_by_fqn = {_record_fqn(record): record for record in table_records}
        for row in rows:
            data = row.as_dict() if hasattr(row, "as_dict") else dict(row)
            fqn = ".".join(
                str(_pick_value(data, key) or "").upper()
                for key in ("DATABASE_NAME", "SCHEMA_NAME", "TABLE_NAME")
            )
            record = records_by_fqn.get(fqn)
            if record is None:
                database, schema_name, table_name = fqn.split(".", 2)
                record = {
                    "scope": "TABLE",
                    "database": database,
                    "schema_name": schema_name,
                    "table_name": table_name,
                    "attribute_name": None,
                    "semantic_model": {"attributes": [], "relationships": {"outgoing": [], "incoming": []}},
                    "generated_at": _pick_value(data, "CREATED_AT"),
                    "updated_at": _pick_value(data, "CREATED_AT"),
                    "semantic_source": "SEM_NATIVE_VIEWS",
                    "semantic_registry": {},
                }
                table_records.append(record)
                records_by_fqn[fqn] = record
            if not isinstance(record.get("semantic_model"), dict):
                record["semantic_model"] = {}
            native = {
                key.lower(): _pick_value(data, key)
                for key in (
                    "NATIVE_VIEW_ID", "SOURCE_FQN", "TABLE_VIEW_ID", "VIEW_NAME",
                    "TARGET_DB", "TARGET_SCHEMA", "TARGET_FQN", "DDL_TEXT",
                    "CA_YAML_MODEL", "FACTS_COUNT", "DIMENSIONS_COUNT", "JOINS_COUNT",
                    "HAS_LOW_CONFIDENCE_JOINS", "HAS_FLAGGED_EXCLUDED", "PK_CONFIRMED",
                    "PHASE2_ENABLED", "STATUS", "CREATED_AT", "GENERATED_BY", "ERROR_MESSAGE",
                )
            }
            yaml_model = str(native.get("ca_yaml_model") or "")
            model = record["semantic_model"]
            model["native_semantic_view"] = native
            semantic_view = model.get("semantic_view")
            semantic_view = dict(semantic_view) if isinstance(semantic_view, dict) else {}
            semantic_view.update({
                "name": native.get("target_fqn"),
                "ddl": native.get("ddl_text"),
                "yaml": yaml_model or semantic_view.get("yaml"),
                "yaml_hash": hashlib.sha256(yaml_model.encode("utf-8")).hexdigest() if yaml_model else semantic_view.get("yaml_hash"),
                "native_view_id": native.get("native_view_id"),
                "source": "SEM_NATIVE_VIEWS",
            })
            model["semantic_view"] = {key: value for key, value in semantic_view.items() if value is not None}
            registry = record.get("semantic_registry")
            if isinstance(registry, dict):
                registry.update({
                    "physical_view_name": native.get("target_fqn"),
                    "native_view_id": native.get("native_view_id"),
                    "native_table_view_id": native.get("table_view_id"),
                    "native_semantic_source": self._native_views_table,
                })

    def _merge_v2_column_views(
        self,
        session: Session,
        tables: list[TableRef],
        table_records: list[dict[str, Any]],
    ) -> None:
        """Overlay the latest active SEM_COLUMN_VIEWS row onto embedded attributes."""
        if not tables or not table_records:
            return
        values_sql = ", ".join(
            "("
            f"{self._sql_literal(table.database.upper())}, "
            f"{self._sql_literal(table.schema.upper())}, "
            f"{self._sql_literal(table.table.upper())}"
            ")"
            for table in tables
        )
        try:
            rows = session.sql(f"""
                WITH requested(DATABASE_NAME, SCHEMA_NAME, TABLE_NAME) AS (
                    SELECT * FROM VALUES {values_sql}
                )
                SELECT c.DATABASE_NAME, c.SCHEMA_NAME, c.TABLE_NAME, c.COLUMN_NAME,
                       c.DATA_TYPE, c.ATTRIBUTE_VIEW, c.VIEW_ID, c.TABLE_VIEW_ID,
                       c.COLUMN_DESCRIPTION, c.GENERATED_AT, c.GENERATED_AT AS UPDATED_AT
                FROM {self._column_views_table} c
                INNER JOIN requested r
                    ON UPPER(c.DATABASE_NAME) = r.DATABASE_NAME
                   AND UPPER(c.SCHEMA_NAME) = r.SCHEMA_NAME
                   AND UPPER(c.TABLE_NAME) = r.TABLE_NAME
                WHERE COALESCE(UPPER(c.STATUS), 'ACTIVE') = 'ACTIVE'
                QUALIFY ROW_NUMBER() OVER (
                    PARTITION BY UPPER(c.DATABASE_NAME), UPPER(c.SCHEMA_NAME),
                                 UPPER(c.TABLE_NAME), UPPER(c.COLUMN_NAME)
                    ORDER BY c.GENERATED_AT DESC
                ) = 1
            """).collect()
        except Exception as exc:
            logger.warning("Column semantic registry query failed: %s", exc)
            return

        records_by_fqn = {_record_fqn(record): record for record in table_records}
        columns_by_fqn: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            data = row.as_dict() if hasattr(row, "as_dict") else dict(row)
            fqn = ".".join(
                str(_pick_value(data, key) or "").upper()
                for key in ("DATABASE_NAME", "SCHEMA_NAME", "TABLE_NAME")
            )
            payload = _json_loads_if_needed(_pick_value(data, "ATTRIBUTE_VIEW"))
            payload = dict(payload) if isinstance(payload, dict) else {}
            payload["name"] = str(payload.get("name") or _pick_value(data, "COLUMN_NAME") or "")
            payload["data_type"] = str(payload.get("data_type") or _pick_value(data, "DATA_TYPE") or "VARCHAR")
            column_description = str(_pick_value(data, "COLUMN_DESCRIPTION") or "").strip()
            if column_description and not payload.get("description"):
                payload["description"] = column_description
            if payload.get("role") and not payload.get("semantic_role"):
                payload["semantic_role"] = payload["role"]
            payload["semantic_registry"] = {
                "source": "SEM_COLUMN_VIEWS",
                "view_id": _pick_value(data, "VIEW_ID"),
                "table_view_id": _pick_value(data, "TABLE_VIEW_ID"),
            }
            columns_by_fqn.setdefault(fqn, []).append(payload)

        for fqn, columns in columns_by_fqn.items():
            record = records_by_fqn.get(fqn)
            if not record:
                continue
            model = record.get("semantic_model")
            if not isinstance(model, dict):
                continue
            embedded = {
                str(item.get("name") or "").upper(): item
                for item in (model.get("attributes") or [])
                if isinstance(item, dict) and item.get("name")
            }
            for column in columns:
                key = str(column.get("name") or "").upper()
                embedded[key] = {**embedded.get(key, {}), **column}
            model["attributes"] = list(embedded.values())
            model["column_semantic_source"] = "SEM_COLUMN_VIEWS"

    def _overlay_curated_versions(
        self,
        session: Session,
        table_records: list[dict[str, Any]],
    ) -> None:
        fqns = [_record_fqn(record) for record in table_records if _record_fqn(record)]
        if not fqns:
            return
        values = ", ".join(self._sql_literal(fqn) for fqn in fqns)
        try:
            rows = session.sql(f"""
                SELECT SEMANTIC_VIEW_FQN, VERSION_ID, VERSION_LABEL, VERSION_NUMBER,
                       BUSINESS_GLOSSARY, RELATIONSHIP_RULES, TRANSFORMATION_PATTERNS,
                       COLUMN_SEMANTICS, QA_PAIRS, CONFIDENCE, VALIDATION_STATUS
                FROM {self._settings.qualify_metadata_object_name('TBL_SEMANTIC_VIEW_VERSIONS')}
                WHERE UPPER(SEMANTIC_VIEW_FQN) IN ({values})
                  AND COALESCE(LOWER(VALIDATION_STATUS), 'unvalidated') IN (
                      'validated', 'approved', 'active', 'confirmed'
                  )
                QUALIFY ROW_NUMBER() OVER (
                    PARTITION BY UPPER(SEMANTIC_VIEW_FQN)
                    ORDER BY VERSION_NUMBER DESC, CREATED_AT DESC
                ) = 1
            """).collect()
        except Exception as exc:
            logger.debug("No curated semantic overlays available: %s", exc)
            return

        records_by_fqn = {_record_fqn(record): record for record in table_records}
        for row in rows:
            data = row.as_dict() if hasattr(row, "as_dict") else dict(row)
            fqn = str(_pick_value(data, "SEMANTIC_VIEW_FQN") or "").upper()
            record = records_by_fqn.get(fqn)
            if not record or not isinstance(record.get("semantic_model"), dict):
                continue
            model = record["semantic_model"]
            glossary = _json_loads_if_needed(_pick_value(data, "BUSINESS_GLOSSARY"))
            relationships = _json_loads_if_needed(_pick_value(data, "RELATIONSHIP_RULES"))
            column_semantics = _json_loads_if_needed(_pick_value(data, "COLUMN_SEMANTICS"))
            qa_pairs = _json_loads_if_needed(_pick_value(data, "QA_PAIRS"))
            if isinstance(glossary, dict):
                for key in ("description", "domain_summary", "business_context", "business_process", "grain"):
                    if glossary.get(key):
                        model[key] = glossary[key]
                model["business_glossary"] = glossary
            if relationships:
                model["relationships"] = relationships
            if isinstance(column_semantics, (list, dict)):
                overlays = column_semantics if isinstance(column_semantics, list) else [
                    {"name": key, **value}
                    for key, value in column_semantics.items()
                    if isinstance(value, dict)
                ]
                embedded = {
                    str(item.get("name") or "").upper(): item
                    for item in (model.get("attributes") or [])
                    if isinstance(item, dict) and item.get("name")
                }
                for item in overlays:
                    key = str(item.get("name") or item.get("column_name") or "").upper()
                    if key:
                        embedded[key] = {**embedded.get(key, {}), **item, "name": key}
                model["attributes"] = list(embedded.values())
            if isinstance(qa_pairs, list):
                verified = [item for item in qa_pairs if isinstance(item, dict) and item.get("sql")]
                if verified:
                    model["verified_queries"] = verified
            model["curated_semantic_version"] = {
                "version_id": _pick_value(data, "VERSION_ID"),
                "version_label": _pick_value(data, "VERSION_LABEL"),
                "confidence": _pick_value(data, "CONFIDENCE"),
                "validation_status": _pick_value(data, "VALIDATION_STATUS"),
                "transformation_patterns": _json_loads_if_needed(_pick_value(data, "TRANSFORMATION_PATTERNS")),
            }

    def _get_legacy_table_records(
        self,
        session: Session,
        tables: list[TableRef],
    ) -> list[dict[str, Any]]:
        if not tables:
            return []

        values_sql = ", ".join(
            "("
            f"{self._sql_literal(table.database.upper())}, "
            f"{self._sql_literal(table.schema.upper())}, "
            f"{self._sql_literal(table.table.upper())}"
            ")"
            for table in tables
        )
        rows = session.sql(f"""
            WITH requested(DB_NAME, SCHEMA_NAME, TABLE_NAME) AS (
                SELECT * FROM VALUES {values_sql}
            )
            SELECT m.SCOPE, m.DB_NAME, m.SCHEMA_NAME, m.TABLE_NAME, m.ATTRIBUTE_NAME,
                   m.SEMANTIC_MODEL, m.GENERATED_AT, m.UPDATED_AT
            FROM {self._table} AS m
            INNER JOIN requested AS r
                ON m.DB_NAME = r.DB_NAME
               AND m.SCHEMA_NAME = r.SCHEMA_NAME
               AND m.TABLE_NAME = r.TABLE_NAME
            WHERE m.SCOPE = 'TABLE'
              AND COALESCE(m.ATTRIBUTE_NAME, '') = ''
        """).collect()

        records: list[dict[str, Any]] = []
        for row in rows:
            r = row.as_dict() if hasattr(row, "as_dict") else dict(row)
            sm_raw = r["SEMANTIC_MODEL"]
            records.append(
                {
                    "scope": r["SCOPE"],
                    "database": r["DB_NAME"],
                    "schema_name": r["SCHEMA_NAME"],
                    "table_name": r["TABLE_NAME"] or None,
                    "attribute_name": r["ATTRIBUTE_NAME"] or None,
                    "semantic_model": json.loads(sm_raw) if isinstance(sm_raw, str) else sm_raw,
                    "generated_at": r["GENERATED_AT"],
                    "updated_at": r["UPDATED_AT"],
                }
            )
        return records

    def compute_ddl_hash(
        self,
        session: Session,
        *,
        scope: str,
        db_name: str,
        schema_name: str,
        table_name: str = "",
    ) -> str:
        return _compute_ddl_hash(session, scope, db_name.upper(), schema_name.upper(), table_name.upper())

    def upsert_table_record(
        self,
        session: Session,
        *,
        table: TableRef,
        semantic_model: dict[str, Any],
        ddl_hash: str | None = None,
    ) -> None:
        resolved_hash = ddl_hash or self.compute_ddl_hash(
            session,
            scope="TABLE",
            db_name=table.database,
            schema_name=table.schema,
            table_name=table.table,
        )
        _merge_row(
            session,
            self._table,
            "TABLE",
            table.database.upper(),
            table.schema.upper(),
            table.table.upper(),
            "",
            semantic_model,
            resolved_hash,
        )

    # ------------------------------------------------------------------
    # Background task
    # ------------------------------------------------------------------

    def run_generation(
        self,
        job_id: str,
        req: GenerateRequest,
        user_token: str,
    ) -> None:
        job = _jobs[job_id]
        job.status = "running"

        if (
            using_local_dev_auth(self._settings, user_token)
            and self._settings.local_dev_uses_externalbrowser
        ):
            sf_client = get_local_cached_client(self._settings)
            should_close_client = False
        else:
            sf_client = SnowflakeClient(settings=self._settings, user_token=user_token)
            should_close_client = True
        try:
            session = sf_client.session
            agent_client = self._build_agent_client(sf_client, user_token)

            for db, schema in _unique_schemas(req.tables):
                _run_task(
                    job,
                    session,
                    agent_client,
                    self._table,
                    self._agent_name,
                    "SCHEMA",
                    db,
                    schema,
                    "",
                    req.force,
                    SemanticLevel.L1_CONTEXT,
                )

            for tbl in req.tables:
                _run_task(
                    job,
                    session,
                    agent_client,
                    self._table,
                    self._agent_name,
                    "TABLE",
                    tbl.database.upper(),
                    tbl.schema.upper(),
                    tbl.table.upper(),
                    req.force,
                    SemanticLevel.L1_CONTEXT,
                )

            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)

        except Exception as exc:
            logger.exception("Semantic model batch failed for job %s", job_id)
            job.status = "failed"
            job.errors.append(str(exc))
            job.completed_at = datetime.now(timezone.utc)
        finally:
            if should_close_client:
                sf_client.close()

    def _build_agent_client(
        self,
        sf_client: SnowflakeClient,
        user_token: str,
    ) -> SnowflakeAgentClient:
        if using_local_dev_auth(self._settings, user_token):
            context = get_local_rest_session_context(self._settings)
            return SnowflakeAgentClient(
                token=context.token,
                host=context.host,
                auth_mode="snowflake_token",
            )

        context = sf_client.get_rest_session_context()
        return SnowflakeAgentClient(
            token=context.token,
            host=context.host,
            auth_mode="snowflake_token",
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _unique_schemas(tables: list[TableRef]) -> list[tuple[str, str]]:
    """Return (database, schema) pairs in first-seen order, uppercased."""
    seen: set[tuple[str, str]] = set()
    result: list[tuple[str, str]] = []
    for t in tables:
        key = (t.database.upper(), t.schema.upper())
        if key not in seen:
            seen.add(key)
            result.append(key)
    return result


def _run_task(
    job: JobStatus,
    session: Session,
    agent_client: SnowflakeAgentClient,
    sm_table: str,
    agent_name: str,
    scope: str,
    db: str,
    schema: str,
    tbl: str,
    force: bool,
    semantic_level: SemanticLevel,
) -> None:
    label = f"{scope} {db}.{schema}{'.'+tbl if tbl else ''}"
    try:
        outcome = _execute_task(
            session,
            agent_client,
            sm_table,
            agent_name,
            scope,
            db,
            schema,
            tbl,
            force,
            semantic_level,
        )
        if outcome == "skipped":
            job.skipped += 1
            logger.debug("Skipped (fresh): %s", label)
            return

        job.completed += 1
        logger.debug("Generated: %s", label)

    except Exception as exc:
        job.failed_count += 1
        job.errors.append(f"{label}: {exc}")
        logger.exception("Failed to generate semantic model for %s", label)


def _execute_task(
    session: Session,
    agent_client: SnowflakeAgentClient,
    sm_table: str,
    agent_name: str,
    scope: str,
    db: str,
    schema: str,
    tbl: str,
    force: bool,
    semantic_level: SemanticLevel,
) -> str:
    current_hash = _compute_ddl_hash(session, scope, db, schema, tbl)
    if not force and _is_fresh(session, sm_table, scope, db, schema, tbl, current_hash):
        return "skipped"

    if scope == "TABLE":
        envelope = _build_fast_table_envelope(
            session=session,
            sm_table=sm_table,
            db=db,
            schema=schema,
            tbl=tbl,
            semantic_level=semantic_level,
        )
    elif scope == "SCHEMA":
        envelope = _build_fast_schema_envelope(
            session=session,
            db=db,
            schema=schema,
        )
    else:
        prompt = _build_prompt(scope, db, schema, tbl, semantic_level)
        raw_text, _ = agent_client.run(
            [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
            agent=agent_name,
        )
        envelope = _parse_response(raw_text)
    _upsert(session, sm_table, scope, db, schema, tbl, envelope, current_hash)
    return "generated"


def _build_fast_schema_envelope(
    *,
    session: Session,
    db: str,
    schema: str,
) -> dict[str, Any]:
    rows = session.sql(
        f"""
        SELECT TABLE_NAME
        FROM "{db}".INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = '{schema}'
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
        """
    ).collect()
    table_names = []
    for row in rows:
        row_dict = row.as_dict(recursive=True) if hasattr(row, "as_dict") else dict(row)
        if row_dict.get("TABLE_NAME"):
            table_names.append(str(row_dict["TABLE_NAME"]))
    schema_label = _pretty_label(schema)
    tables = [
        {
            "name": name,
            "description": _infer_table_description(name, outgoing_count=0, incoming_count=0),
            "primary_keys": [],
            "relationships": {"outgoing": [], "incoming": []},
        }
        for name in table_names
    ]
    return {
        "semantic_model": {
            "description": f"{schema_label} contains operational tables used for STTM discovery and mapping.",
            "domain_summary": (
                f"This schema groups {len(table_names)} source tables that can be selected, joined, "
                "and transformed in the migration workbench."
            ),
            "tables": tables,
        }
    }


def _build_fast_table_envelope(
    *,
    session: Session,
    sm_table: str,
    db: str,
    schema: str,
    tbl: str,
    semantic_level: SemanticLevel,
) -> dict[str, Any]:
    context_bundle = _fetch_table_context_bundle(session, sm_table, db, schema, tbl)
    relationships = _normalize_bundle_relationships(context_bundle, db, schema, tbl)
    outgoing = relationships["outgoing"]
    incoming = relationships["incoming"]
    description = _infer_table_description(
        tbl,
        table_comment=str(context_bundle.get("table_comment") or ""),
        outgoing_count=len(outgoing),
        incoming_count=len(incoming),
    )
    domain_summary = _infer_table_domain_summary(
        tbl,
        table_comment=str(context_bundle.get("table_comment") or ""),
        outgoing_count=len(outgoing),
        incoming_count=len(incoming),
    )
    attribute_models = _build_attribute_models(
        table_name=tbl,
        columns=context_bundle.get("columns") or [],
        sample_rows=context_bundle.get("sample_rows") or [],
        outgoing=outgoing,
        incoming=incoming,
        semantic_level=semantic_level,
    )
    semantic_attributes = [
        {
            "name": item["name"],
            "data_type": item["data_type"],
            "constraints": item["constraints"],
            "description": item["description"],
            "summary": item["description"],
            "business_meaning": item["business_meaning"],
            "semantic_role": item["semantic_role"],
            "default_aggregation": item["default_aggregation"],
            "semantic_notes": item["semantic_notes"],
        }
        for item in attribute_models
    ]
    return {
        "semantic_model": {
            "description": description,
            "domain_summary": domain_summary,
            "relationships": {
                "outgoing": outgoing,
                "incoming": incoming,
            },
            "attributes": semantic_attributes,
            "semantic_notes": _build_table_notes(
                table_name=tbl,
                outgoing=outgoing,
                incoming=incoming,
                columns=attribute_models,
                semantic_level=semantic_level,
            ),
        },
        "attribute_semantic_model": attribute_models,
    }


def _fetch_table_context_bundle(
    session: Session,
    sm_table: str,
    db: str,
    schema: str,
    tbl: str,
) -> dict[str, Any]:
    metadata_prefix = ".".join(sm_table.split(".")[:2])
    proc_name = f"{metadata_prefix}.SP_GET_TABLE_CONTEXT_BUNDLE"
    row = session.sql(
        f"CALL {proc_name}('{db}', '{schema}', '{tbl}', 5)"
    ).collect()[0]
    payload = row[0]
    if isinstance(payload, dict):
        return payload
    if hasattr(payload, "as_dict"):
        return payload.as_dict()
    if isinstance(payload, str):
        return json.loads(payload)
    if payload is None:
        raise SnowflakeQueryError(f"Table context bundle returned no payload for {db}.{schema}.{tbl}")
    return json.loads(str(payload))


def _normalize_bundle_relationships(
    bundle: dict[str, Any],
    db: str,
    schema: str,
    tbl: str,
) -> dict[str, list[dict[str, Any]]]:
    rels = bundle.get("relationships") or {}
    outgoing_rows = rels.get("outgoing") or []
    incoming_rows = rels.get("incoming") or []

    def _normalize(items: list[dict[str, Any]], direction: str) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for item in items:
            mappings = item.get("column_mappings") or []
            related_table = f"{db}.{item.get('schema')}.{item.get('table')}"
            relation = {
                "relationship_name": item.get("constraint_name") or f"{tbl}_{direction}_{item.get('table')}",
                "direction": direction,
                "related_table": related_table,
                "confidence": "HIGH",
                "inferred_method": "FORMAL_CONSTRAINT",
                "column_mappings": [
                    {
                        "source_column": mapping.get("fk_column") if direction == "outgoing" else mapping.get("pk_column"),
                        "related_column": mapping.get("pk_column") if direction == "outgoing" else mapping.get("fk_column"),
                    }
                    for mapping in mappings
                    if mapping.get("fk_column") or mapping.get("pk_column")
                ],
                "business_meaning": _relationship_business_meaning(tbl, item.get("table") or "", direction),
            }
            normalized.append(relation)
        return normalized

    return {
        "outgoing": _normalize(outgoing_rows, "outgoing"),
        "incoming": _normalize(incoming_rows, "incoming"),
    }


def _build_attribute_models(
    *,
    table_name: str,
    columns: list[dict[str, Any]],
    sample_rows: list[Any],
    outgoing: list[dict[str, Any]],
    incoming: list[dict[str, Any]],
    semantic_level: SemanticLevel,
) -> list[dict[str, Any]]:
    sample_maps = [row if isinstance(row, dict) else {} for row in sample_rows]
    role_hints = {
        mapping["source_column"]: {
            "related_table": relation.get("related_table"),
            "related_column": mapping.get("related_column"),
        }
        for relation in outgoing
        for mapping in relation.get("column_mappings") or []
        if mapping.get("source_column")
    }
    attribute_models: list[dict[str, Any]] = []
    for column in columns:
        name = str(column.get("name") or "")
        data_type = str(column.get("data_type") or "VARCHAR")
        semantic_role = _infer_semantic_role(name, data_type, column)
        default_aggregation = _infer_default_aggregation(name, data_type, semantic_role)
        constraints = _build_constraints(column, role_hints.get(name))
        sample_values = _collect_sample_values(sample_maps, name)
        description = _infer_column_description(
            name,
            table_name,
            semantic_role,
            column_comment=str(column.get("comment") or ""),
            sample_values=sample_values,
        )
        business_meaning = _infer_business_meaning(
            column_name=name,
            table_name=table_name,
            semantic_role=semantic_role,
            related_info=role_hints.get(name),
            column_comment=str(column.get("comment") or ""),
            sample_values=sample_values,
        )
        semantic_notes = _build_attribute_notes(
            column_name=name,
            data_type=data_type,
            semantic_role=semantic_role,
            column=column,
            semantic_level=semantic_level,
            sample_values=sample_values,
            outgoing=outgoing,
            incoming=incoming,
        )
        value_profile = _build_value_profile(column, sample_values)
        attribute_models.append(
            {
                "name": name,
                "data_type": data_type,
                "nullable": str(column.get("is_nullable") or "YES").upper() == "YES",
                "constraints": constraints,
                "description": description,
                "business_meaning": business_meaning,
                "semantic_role": semantic_role,
                "default_aggregation": default_aggregation,
                "data_quality": {
                    "row_count": int(column.get("row_count") or 0),
                    "null_count": int(column.get("null_count") or 0),
                    "null_pct": float(column.get("null_pct") or 0.0),
                    "distinct_count": int(column.get("distinct_count")) if column.get("distinct_count") is not None else 0,
                },
                "value_profile": value_profile,
                "semantic_notes": semantic_notes,
            }
        )
    return attribute_models


def _build_constraints(column: dict[str, Any], related_info: dict[str, Any] | None) -> list[Any]:
    constraints: list[Any] = []
    if column.get("is_primary_key"):
        constraints.append("PRIMARY_KEY")
    if str(column.get("is_nullable") or "YES").upper() == "NO":
        constraints.append("NOT_NULL")
    if column.get("is_foreign_key"):
        constraints.append(
            {
                    "type": "FOREIGN_KEY",
                    "confidence": "HIGH",
                    "references": {
                    "table": str((related_info or {}).get("related_table") or ""),
                    "column": str((related_info or {}).get("related_column") or ""),
                },
            }
        )
    distinct_count = column.get("distinct_count")
    row_count = column.get("row_count")
    if (
        distinct_count is not None
        and row_count is not None
        and row_count > 0
        and distinct_count == row_count
        and not column.get("is_primary_key")
        and _looks_like_identifier(str(column.get("name") or ""))
    ):
        constraints.append("UNIQUE")
    return constraints


def _build_value_profile(column: dict[str, Any], sample_values: list[Any]) -> dict[str, Any]:
    distinct_count = column.get("distinct_count")
    range_stats = {
        "row_count": int(column.get("row_count") or 0),
        "null_count": int(column.get("null_count") or 0),
        "null_pct": float(column.get("null_pct") or 0.0),
        "distinct_count": int(distinct_count or 0),
    }
    profile: dict[str, Any] = {"range_stats": range_stats}
    compact_values = [value for value in sample_values if value is not None][:10]
    if distinct_count is not None and distinct_count <= 12:
        profile["unique_values"] = compact_values
    else:
        profile["sample_values"] = compact_values
    return profile


def _build_table_notes(
    *,
    table_name: str,
    outgoing: list[dict[str, Any]],
    incoming: list[dict[str, Any]],
    columns: list[dict[str, Any]],
    semantic_level: SemanticLevel,
) -> list[str]:
    notes: list[str] = []
    if outgoing:
        notes.append(f"Has {len(outgoing)} outgoing formal relationship(s) to related business entities.")
    if incoming:
        notes.append(f"Receives {len(incoming)} incoming formal relationship(s) from dependent tables.")
    if any(item.get("semantic_role") == "audit_attribute" for item in columns):
        notes.append("Contains audit or exception-tracking attributes that may drive latest-record or review workflows.")
    if any(item.get("semantic_role") == "metric" for item in columns):
        notes.append("Contains numeric measures that should be aggregated carefully in downstream analytics.")
    if any(
        _looks_like_pii(str(item.get("name") or ""), [])
        or (
            str(item.get("semantic_role") or "") == "audit_attribute"
            and "NOTE" in str(item.get("name") or "").upper()
        )
        for item in columns
    ):
        notes.append("Contains potentially sensitive business identifiers or free-text review content; apply governance and masking controls before broad exposure.")
    if semantic_level == SemanticLevel.L3_MAPPING_ENRICHED:
        notes.append("Suitable for source-to-target mapping decisions, including direct, derived, and note-driven target fields.")
    return notes


def _build_attribute_notes(
    *,
    column_name: str,
    data_type: str,
    semantic_role: str,
    column: dict[str, Any],
    semantic_level: SemanticLevel,
    sample_values: list[Any],
    outgoing: list[dict[str, Any]],
    incoming: list[dict[str, Any]],
) -> list[str]:
    notes: list[str] = []
    if float(column.get("null_pct") or 0.0) >= 50.0:
        notes.append("High null rate; downstream mappings should confirm whether this field is optional or sparsely populated.")
    if semantic_role == "foreign_key":
        notes.append("Join-oriented field backed by a formal relationship; safe candidate for source-to-target lineage joins.")
    if semantic_role == "audit_attribute":
        notes.append("Audit-style field often participates in latest-record, exception, or review logic.")
    if semantic_role == "metric":
        notes.append("Business measure; aggregation should follow the target field grain.")
    if _looks_like_pii(column_name, sample_values):
        notes.append("Potentially sensitive attribute; validate governance and masking rules before exposing broadly.")
    if column_name.upper() == "NOTE_TEXT":
        notes.append("Free-text notes may contain sensitive customer, workflow, or reviewer details that need controlled access.")
    if semantic_level == SemanticLevel.L3_MAPPING_ENRICHED and semantic_role in {"metric", "audit_attribute", "foreign_key"}:
        notes.append("Candidate for derived or multi-source target mappings when business rules combine facts, notes, or audit context.")
    if not outgoing and not incoming and semantic_role == "identifier":
        notes.append("Identifier has no formal key relationship in metadata; business usage may still depend on application-level joins.")
    return notes


def _collect_sample_values(sample_rows: list[dict[str, Any]], column_name: str) -> list[Any]:
    values: list[Any] = []
    seen: set[str] = set()
    for row in sample_rows:
        value = row.get(column_name)
        marker = json.dumps(value, default=str, sort_keys=True)
        if marker in seen:
            continue
        seen.add(marker)
        values.append(value)
    return values


def _infer_table_description(table_name: str, *, table_comment: str, outgoing_count: int, incoming_count: int) -> str:
    if table_comment.strip():
        return table_comment.strip()
    normalized = table_name.upper()
    if "NOTE" in normalized:
        return "Stores note, activity, or review commentary linked to business records."
    if {"LOAN", "INCOME", "CALCULATION"}.issubset(set(_split_tokens(table_name))):
        if outgoing_count or incoming_count:
            return (
                "Stores loan income calculation records used to assess claimed income, downstream review outcomes, "
                "and related note-driven audit context."
            )
        return "Stores loan income calculation records used to assess claimed income and downstream review outcomes."
    if "HISTORY" in normalized:
        return "Stores historical state changes or audit history for a business process."
    return f"Stores {_pretty_label(table_name).lower()} records used in the migration workbench."


def _infer_table_domain_summary(table_name: str, *, table_comment: str, outgoing_count: int, incoming_count: int) -> str:
    if table_comment.strip():
        return (
            f"{table_comment.strip()} "
            f"This table currently has {outgoing_count} outgoing and {incoming_count} incoming formal relationship(s) in metadata."
        ).strip()
    normalized = table_name.upper()
    if "NOTE" in normalized:
        return (
            "This table captures human-entered or system-generated notes and activities that provide business context, "
            "exceptions, and audit explanations for related operational records."
        )
    if {"LOAN", "INCOME", "CALCULATION"}.issubset(set(_split_tokens(table_name))):
        return (
            "This table represents income calculation outcomes for loan processing, including raw amounts, review flags, "
            "and identifiers needed for target migration mappings. It commonly acts as the business grain for note, review, and audit enrichment."
        )
    if outgoing_count or incoming_count:
        return (
            f"This table participates in {outgoing_count + incoming_count} formal relationship(s), so it likely contributes "
            "to a broader business workflow rather than standing alone."
        )
    return "This table contains source attributes that may contribute to downstream business mappings and reporting."


def _infer_column_description(
    column_name: str,
    table_name: str,
    semantic_role: str,
    *,
    column_comment: str,
    sample_values: list[Any],
) -> str:
    if column_comment.strip():
        return column_comment.strip()
    pretty = _pretty_label(column_name)
    business_template = _column_business_template(column_name, table_name, sample_values)
    if business_template:
        return business_template
    if semantic_role == "primary_key":
        return f"Unique identifier for each { _pretty_label(table_name).lower() } record."
    if semantic_role == "foreign_key":
        return f"Reference used to connect this row to a related business record through joins."
    if semantic_role == "time_dimension":
        return f"Timestamp or date field recording when {pretty.lower()} occurred."
    if semantic_role == "metric":
        return f"Numeric business measure for {pretty.lower()}."
    if semantic_role == "audit_attribute":
        return f"Audit or review attribute capturing {pretty.lower()}."
    return pretty


def _infer_business_meaning(
    *,
    column_name: str,
    table_name: str,
    semantic_role: str,
    related_info: dict[str, Any] | None,
    column_comment: str,
    sample_values: list[Any],
) -> str:
    if column_comment.strip():
        return column_comment.strip()
    pretty = _pretty_label(column_name).lower()
    table_pretty = _pretty_label(table_name).lower()
    business_template = _column_business_template(column_name, table_name, sample_values)
    if business_template:
        return business_template
    if semantic_role == "primary_key":
        return f"Stable row identifier for {table_pretty}; useful for deduplication and downstream key mapping."
    if semantic_role == "foreign_key":
        related_table = str((related_info or {}).get("related_table") or "").split(".")[-1]
        related_column = str((related_info or {}).get("related_column") or "")
        related_text = (
            f" { _pretty_label(related_table).lower() } via {related_column}"
            if related_table and related_column
            else " a related entity"
        )
        return f"Business key used to join {table_pretty} records to{related_text}."
    if semantic_role == "time_dimension":
        return f"Supports business timing, ordering, and latest-record logic for {table_pretty}."
    if semantic_role == "metric":
        return f"Quantitative measure that may feed target amounts, balances, counts, or analytic calculations."
    if semantic_role == "audit_attribute":
        return f"Carries review, exception, note, or audit context that can explain why a record changed or was flagged."
    if semantic_role == "identifier":
        return f"Business identifier that may be reused across joins, lineage checks, or target key mappings."
    if semantic_role == "dimension":
        return f"Descriptive business attribute that classifies or labels {table_pretty} records."
    return f"Operational source attribute describing {pretty} for {table_pretty}."


def _relationship_business_meaning(source_table: str, related_table: str, direction: str) -> str:
    source_pretty = _pretty_label(source_table).lower()
    related_pretty = _pretty_label(related_table).lower()
    if direction == "outgoing":
        return f"{source_pretty.capitalize()} records depend on or reference {related_pretty} records in business workflows."
    return f"{related_pretty.capitalize()} records depend on or reference {source_pretty} records in business workflows."


def _column_business_template(column_name: str, table_name: str, sample_values: list[Any]) -> str | None:
    name = column_name.upper()
    table = table_name.upper()
    if name == "VERIFIED_INCOME_ID":
        return "Identifier for the verified income assessment record used to link business calculations and downstream mappings."
    if name == "AUTO_CALCULATED":
        return "Indicates whether the income calculation result was produced automatically by the rules engine rather than manual review."
    if name == "INCOME_ID":
        if "NOTE" in table:
            return "Foreign key linking the note back to the income calculation record it explains or annotates."
        return "Primary business key for the income calculation record."
    if name == "LOAN_UUID":
        return "Stable technical identifier for the loan record used to preserve lineage across systems and downstream models."
    if name == "LOAN_ID":
        return "Business or operational loan identifier used to reconcile the calculation record back to the originating loan."
    if name == "CUSTOMER_APPLICATION_UUID":
        return "Stable technical identifier for the customer application associated with the loan-income calculation."
    if name == "CUSTOMER_APPLICATION_ID":
        return "Operational customer application identifier used to trace the calculation back to the source application journey."
    if name == "CUSTOMER_UUID":
        return "Stable technical identifier for the customer linked to the loan-income calculation and downstream reporting."
    if name == "CUSTOMER_ID":
        return "Operational customer identifier used to connect the calculation record to the customer master or servicing context."
    if name == "ADMIN_USER_UUID":
        return "Stable technical identifier for the administrative user who reviewed, approved, or managed the calculation record."
    if name == "LEGACY_SYSTEM_ID":
        return "Identifier carried from the legacy source platform for reconciliation, lineage, and migration traceability."
    if name == "DATA":
        return "Semi-structured payload containing additional calculation inputs, outputs, or workflow metadata not modeled as separate columns."
    if name == "NOTE_TEXT":
        return "Free-text note entered during business review, audit, or exception handling."
    if name == "NOTABLE_ID":
        return "Identifier of the business record that this note is attached to within the source workflow."
    if name == "NOTABLE_TYPE":
        return "Business entity type that this note is attached to."
    if name == "NOTE_TYPE":
        return "Business classification of the note, such as review, audit, or system-generated commentary."
    if name == "ACTIVITY":
        return "Business activity or workflow step associated with the note."
    if name == "ACTION":
        return "Recorded action taken during the workflow or review process."
    if name == "AUTHOR_ID":
        return "Identifier of the user or system that authored the note."
    if name == "REVIEWED_BY_CALC_ID":
        return "Identifier of the related calculation or reviewer context that performed or triggered the review of this record."
    if name == "REVIEWED_CALC_ID":
        return "Identifier of the prior or related calculation record referenced during review and exception handling."
    if name == "VERIFICATION_TASK_NAME":
        return "Name of the verification or business-review task that produced this calculation context."
    if name == "CLAIMED_INCOME":
        return "Income amount claimed by the customer and used as input to the calculation workflow."
    if name == "TOTAL_AMOUNT_CENTS":
        return "Calculated income amount stored in cents before presentation-level formatting."
    if name == "OUTCOME":
        return "Result of the income calculation or verification workflow."
    if name == "REJECTED_FLAG":
        return "Indicates whether the calculation or review outcome was rejected."
    if name == "ERROR_REASON":
        return "Business explanation for why the calculation or review failed validation."
    if name == "ERROR_REASON_FLAG":
        return "Indicates whether an error reason was captured for the record."
    if name == "PARTNER":
        return "Partner or origin channel associated with the business record."
    if name == "PORTAL_USER_ID":
        return "Identifier of the portal user associated with the calculation workflow."
    if name in {"CREATED_TIME", "UPDATED_TIME"}:
        return f"Timestamp showing when the { _pretty_label(table_name).lower() } record was {name.split('_')[0].lower()}."
    if name == "SIMULATED_TERMS_FLAG":
        return "Indicates whether simulated loan terms were used or captured for this calculation."
    if name in {"SIMULATED_TERMS", "SIMULATED_TERMS_TABLE"}:
        return "Serialized structure containing simulated loan-term scenarios used during the calculation workflow."
    if name == "ORIGINAL_APR_PERCENTAGE":
        return "Original annual percentage rate associated with the loan scenario being evaluated."
    if name == "ORIGINAL_LOAN_AMOUNT_PENNIES":
        return "Original loan amount captured in pennies before currency normalization."
    if name == "ORIGINAL_TERM":
        return "Original term length of the loan being evaluated."
    if _looks_like_pii(column_name, sample_values):
        return f"Potentially sensitive business attribute for {_pretty_label(column_name).lower()}."
    return None


def _infer_semantic_role(column_name: str, data_type: str, column: dict[str, Any]) -> str:
    name = column_name.upper()
    dtype = str(data_type or "").upper()
    if column.get("is_primary_key"):
        return "primary_key"
    if column.get("is_foreign_key"):
        return "foreign_key"
    if _is_time_type(data_type) or any(token in name for token in ["DATE", "TIME", "TIMESTAMP"]):
        return "time_dimension"
    if dtype not in {"VARIANT", "BOOLEAN"} and any(token in name for token in ["AMOUNT", "TOTAL", "BALANCE", "RATE", "PERCENT", "PCT", "COUNT", "QTY", "QUANTITY", "CENTS", "SCORE"]):
        return "metric"
    if any(token in name for token in ["NOTE", "COMMENT", "REASON", "ERROR", "ACTIVITY", "STATUS", "ACTION", "REVIEW", "AUDIT", "FLAG"]):
        return "audit_attribute"
    if _looks_like_identifier(column_name):
        return "identifier"
    if _is_numeric_type(data_type):
        return "metric"
    if any(token in name for token in ["TYPE", "CATEGORY", "PARTNER", "SOURCE", "STATE"]):
        return "dimension"
    return "attribute"


def _infer_default_aggregation(column_name: str, data_type: str, semantic_role: str) -> str:
    name = column_name.upper()
    if semantic_role in {"primary_key", "foreign_key", "identifier", "attribute", "dimension", "audit_attribute"}:
        return "none"
    if semantic_role == "time_dimension":
        return "latest" if any(token in name for token in ["UPDATED", "MODIFIED", "CREATED", "CURRENT", "LATEST"]) else "max"
    if semantic_role == "metric":
        if any(token in name for token in ["RATE", "RATIO", "PERCENT", "PCT"]):
            return "avg"
        if any(token in name for token in ["COUNT", "AMOUNT", "TOTAL", "BALANCE", "QTY", "QUANTITY", "CENTS"]):
            return "sum"
        return "max" if not _is_numeric_type(data_type) else "avg"
    return "none"


def _is_numeric_type(data_type: str) -> bool:
    return str(data_type or "").upper() in {
        "NUMBER", "DECIMAL", "NUMERIC", "INT", "INTEGER", "BIGINT", "SMALLINT", "FLOAT", "DOUBLE", "REAL"
    }


def _is_time_type(data_type: str) -> bool:
    upper = str(data_type or "").upper()
    return any(token in upper for token in ["DATE", "TIME", "TIMESTAMP"])


def _looks_like_identifier(column_name: str) -> bool:
    name = column_name.upper()
    return any(
        name == token or name.endswith(f"_{token}") or name.startswith(f"{token}_")
        for token in ["ID", "UUID", "KEY", "CODE", "NUMBER", "NUM"]
    )


def _looks_like_pii(column_name: str, sample_values: list[Any]) -> bool:
    name = column_name.upper()
    if any(token in name for token in ["EMAIL", "PHONE", "MOBILE", "SSN", "ADDRESS", "NAME", "DOB", "BIRTH", "TIN", "PAN", "TAX"]):
        return True
    if any(token in name for token in ["CUSTOMER", "USER", "AUTHOR", "PERSON", "BORROWER"]) and _looks_like_identifier(column_name):
        return True
    if "NOTE_TEXT" in name:
        return True
    return any(isinstance(value, str) and "@" in value for value in sample_values)


def _pretty_label(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("_", " ")).strip().title()


def _split_tokens(value: str) -> list[str]:
    return [token for token in re.split(r"[_\W]+", str(value or "").upper()) if token]


def _compute_ddl_hash(session: Session, scope: str, db: str, schema: str, tbl: str) -> str:
    if scope == "SCHEMA":
        sql = f"""
            SELECT COALESCE(
                MD5(
                    LISTAGG(
                        TABLE_NAME || CHR(31) || COLUMN_NAME || CHR(31) || DATA_TYPE || CHR(31) || IS_NULLABLE,
                        ''
                    ) WITHIN GROUP (ORDER BY TABLE_NAME, ORDINAL_POSITION)
                ),
                'EMPTY'
            ) AS HASH
            FROM {db}.INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = '{schema}'
        """
    else:
        sql = f"SELECT MD5(GET_DDL('TABLE', '{db}.{schema}.{tbl}')) AS HASH"

    rows = session.sql(sql).collect()
    if not rows or rows[0]["HASH"] is None:
        raise SnowflakeQueryError(f"Could not compute DDL hash for {scope} {db}.{schema}")
    return rows[0]["HASH"]


def _is_fresh(
    session: Session, sm_table: str,
    scope: str, db: str, schema: str, tbl: str, current_hash: str,
) -> bool:
    if scope == "ATTRIBUTE":
        rows = session.sql(f"""
            SELECT COUNT(*) AS CNT FROM {sm_table}
            WHERE SCOPE = 'ATTRIBUTE'
              AND DB_NAME = '{db}' AND SCHEMA_NAME = '{schema}' AND TABLE_NAME = '{tbl}'
              AND DDL_HASH = '{current_hash}'
        """).collect()
        return rows[0]["CNT"] > 0

    rows = session.sql(f"""
        SELECT DDL_HASH FROM {sm_table}
        WHERE SCOPE = '{scope}'
          AND DB_NAME = '{db}' AND SCHEMA_NAME = '{schema}'
          AND TABLE_NAME = '{tbl}' AND ATTRIBUTE_NAME = ''
    """).collect()
    return bool(rows) and rows[0]["DDL_HASH"] == current_hash


def _build_prompt(
    scope: str,
    db: str,
    schema: str,
    tbl: str,
    semantic_level: SemanticLevel,
) -> str:
    payload: dict[str, Any] = {
        "contract_version": "1.0",
        "operation": "semantic_model.generate",
        "context": {
            "semantic_level_requested": semantic_level.value,
            "source_tables": (
                [{"database": db, "schema": schema, "table": tbl}]
                if scope == "TABLE" and tbl
                else []
            ),
        },
        "data": {
            "scope": scope,
            "database": db,
            "schema": schema,
            "semantic_level": semantic_level.value,
        },
    }
    if tbl:
        payload["data"]["table"] = tbl
    return json.dumps(payload)


def _parse_response(raw: str) -> dict:
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError as exc:
            raise SnowflakeAgentError(f"Semantic model agent returned invalid JSON: {exc}") from exc
    raise SnowflakeAgentError(f"No JSON found in agent response: {raw[:300]}")


def _upsert(
    session: Session,
    sm_table: str,
    scope: str,
    db: str,
    schema: str,
    tbl: str,
    envelope: dict,
    ddl_hash: str,
) -> None:
    semantic_model = envelope.get("semantic_model", {})

    if scope == "TABLE":
        existing_rows = session.sql(
            f"""
            SELECT SEMANTIC_MODEL
            FROM {sm_table}
            WHERE SCOPE = 'TABLE'
              AND DB_NAME = '{db}'
              AND SCHEMA_NAME = '{schema}'
              AND TABLE_NAME = '{tbl}'
              AND ATTRIBUTE_NAME = ''
            """
        ).collect()
        if existing_rows:
            existing_model = existing_rows[0]["SEMANTIC_MODEL"]
            if isinstance(existing_model, str):
                try:
                    existing_model = json.loads(existing_model)
                except json.JSONDecodeError:
                    existing_model = {}
            if isinstance(existing_model, dict):
                existing_semantic_view = existing_model.get("semantic_view")
                if existing_semantic_view and isinstance(semantic_model, dict) and not semantic_model.get("semantic_view"):
                    semantic_model = dict(semantic_model)
                    semantic_model["semantic_view"] = existing_semantic_view
        _merge_row(session, sm_table, scope, db, schema, tbl, "", semantic_model, ddl_hash)
        attribute_models = envelope.get("attribute_semantic_model", [])
        if attribute_models is None:
            attribute_models = []
        if not isinstance(attribute_models, list):
            raise SnowflakeAgentError(
                "TABLE scope: expected attribute_semantic_model to be an array when present"
            )
        _replace_attribute_rows(session, sm_table, db, schema, tbl, attribute_models, ddl_hash)
        return

    _merge_row(session, sm_table, scope, db, schema, tbl, "", semantic_model, ddl_hash)


def _pick_value(row: dict[str, Any], name: str) -> Any:
    for candidate in (name, name.upper(), name.lower()):
        if candidate in row:
            return row[candidate]
    return None


def _json_loads_if_needed(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _record_fqn(record: dict[str, Any]) -> str:
    database = str(record.get("database") or "").upper()
    schema = str(record.get("schema_name") or "").upper()
    table = str(record.get("table_name") or "").upper()
    if not database or not schema or not table:
        return ""
    return f"{database}.{schema}.{table}"


def _normalize_v2_semantic_payload(
    semantic_payload: Any,
    *,
    registry_meta: dict[str, Any],
) -> dict[str, Any]:
    """Normalize a rich V2 semantic registry row without losing the original.

    The composer and agents expect a table-level semantic model with common
    fields like description, attributes, relationships, and semantic_view. V2
    stores a richer envelope. This function preserves that envelope under
    `_v2_payload` while lifting the common fields to the top level.
    """
    if not isinstance(semantic_payload, dict):
        semantic_payload = {"raw_value": semantic_payload}

    model = semantic_payload.get("semantic_model")
    normalized: dict[str, Any]
    if isinstance(model, dict):
        normalized = dict(model)
    else:
        normalized = {}

    for key in (
        "description",
        "domain_summary",
        "business_context",
        "business_process",
        "grain",
        "relationships",
        "relationship_candidates",
        "metrics",
        "verified_queries",
        "custom_instructions",
    ):
        if key not in normalized and key in semantic_payload:
            normalized[key] = semantic_payload[key]

    attributes = normalized.get("attributes")
    if not isinstance(attributes, list) or not attributes:
        payload_attributes = semantic_payload.get("attribute_semantic_model")
        if isinstance(payload_attributes, list):
            normalized["attributes"] = payload_attributes
        elif isinstance(payload_attributes, dict):
            normalized["attributes"] = payload_attributes.get("attributes") or []

    semantic_view = normalized.get("semantic_view")
    if not isinstance(semantic_view, dict):
        semantic_view = {}
    if registry_meta.get("physical_view_name"):
        semantic_view.setdefault("name", registry_meta.get("physical_view_name"))
    if registry_meta.get("yaml_hash"):
        semantic_view.setdefault("yaml_hash", registry_meta.get("yaml_hash"))
    if semantic_view:
        normalized["semantic_view"] = semantic_view

    if semantic_payload.get("pk_detection") is not None:
        normalized.setdefault("pk_detection", semantic_payload.get("pk_detection"))
    normalized["semantic_registry"] = registry_meta
    normalized["_v2_payload"] = semantic_payload
    normalized["_projection_source"] = "AGT_SEMANTIC_MODEL_V2"
    return normalized


def _merge_row(
    session: Session,
    sm_table: str,
    scope: str,
    db: str,
    schema: str,
    tbl: str,
    attr: str,
    model: Any,
    ddl_hash: str,
) -> None:
    model_json = json.dumps(model, default=str).replace("$$", "$ $")
    session.sql(f"""
        MERGE INTO {sm_table} AS tgt
        USING (
            SELECT
                '{scope}'                    AS SCOPE,
                '{db}'                       AS DB_NAME,
                '{schema}'                   AS SCHEMA_NAME,
                '{tbl}'                      AS TABLE_NAME,
                '{attr}'                     AS ATTRIBUTE_NAME,
                PARSE_JSON($${model_json}$$) AS SEMANTIC_MODEL,
                '{ddl_hash}'                 AS DDL_HASH,
                CURRENT_TIMESTAMP()          AS NOW
        ) AS src
        ON  tgt.SCOPE          = src.SCOPE
        AND tgt.DB_NAME        = src.DB_NAME
        AND tgt.SCHEMA_NAME    = src.SCHEMA_NAME
        AND tgt.TABLE_NAME     = src.TABLE_NAME
        AND tgt.ATTRIBUTE_NAME = src.ATTRIBUTE_NAME
        WHEN MATCHED THEN UPDATE SET
            tgt.SEMANTIC_MODEL = src.SEMANTIC_MODEL,
            tgt.DDL_HASH       = src.DDL_HASH,
            tgt.UPDATED_AT     = src.NOW
        WHEN NOT MATCHED THEN INSERT (
            SCOPE, DB_NAME, SCHEMA_NAME, TABLE_NAME, ATTRIBUTE_NAME,
            SEMANTIC_MODEL, DDL_HASH, GENERATED_AT, UPDATED_AT
        ) VALUES (
            src.SCOPE, src.DB_NAME, src.SCHEMA_NAME, src.TABLE_NAME, src.ATTRIBUTE_NAME,
            src.SEMANTIC_MODEL, src.DDL_HASH, src.NOW, src.NOW
        )
    """).collect()


def _replace_attribute_rows(
    session: Session,
    sm_table: str,
    db: str,
    schema: str,
    tbl: str,
    attribute_models: list[Any],
    ddl_hash: str,
) -> None:
    rows: list[tuple[str, str]] = []
    for item in attribute_models:
        if not isinstance(item, dict):
            continue
        attr = str(item.get("name") or item.get("attribute") or "").upper().strip()
        if not attr:
            continue
        model_json = json.dumps(item, default=str).replace("'", "''").replace("$$", "$ $")
        rows.append((attr, model_json))
    if not rows:
        return

    session.sql(
        f"""
        DELETE FROM {sm_table}
        WHERE SCOPE = 'ATTRIBUTE'
          AND DB_NAME = '{db}'
          AND SCHEMA_NAME = '{schema}'
          AND TABLE_NAME = '{tbl}'
        """
    ).collect()

    values_sql = ",\n                ".join(
        f"('{attr}', '{model_json}')"
        for attr, model_json in rows
    )
    session.sql(
        f"""
        INSERT INTO {sm_table} (
            SCOPE, DB_NAME, SCHEMA_NAME, TABLE_NAME, ATTRIBUTE_NAME,
            SEMANTIC_MODEL, DDL_HASH, GENERATED_AT, UPDATED_AT
        )
        SELECT
            'ATTRIBUTE',
            '{db}',
            '{schema}',
            '{tbl}',
            src.ATTRIBUTE_NAME,
            PARSE_JSON(src.SEMANTIC_MODEL_JSON),
            '{ddl_hash}',
            CURRENT_TIMESTAMP(),
            CURRENT_TIMESTAMP()
        FROM (
            SELECT column1 AS ATTRIBUTE_NAME, column2 AS SEMANTIC_MODEL_JSON
            FROM VALUES
                {values_sql}
        ) AS src
        """
    ).collect()
