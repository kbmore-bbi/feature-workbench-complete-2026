import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.exceptions import SnowflakeAgentError, SnowflakeQueryError
from app.core.snowflake import (
    SnowflakeClient,
    build_caller_token,
    get_local_rest_session_context,
    using_local_dev_auth,
)
from app.core.snowflake_agent import SnowflakeAgentClient
from app.schema.common import TableRef
from app.schema.semantic_model import GenerateRequest, JobStatus

logger = logging.getLogger(__name__)

# In-memory job store — lives for the process lifetime (single-instance deployment)
_jobs: dict[str, JobStatus] = {}


class SemanticModelService:

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._agent_name = settings.snowflake_semantic_model_agent
        if not self._agent_name:
            raise SnowflakeAgentError(
                "SNOWFLAKE_SEMANTIC_MODEL_AGENT is not set. Expected: DATABASE.SCHEMA.AGENT_NAME"
            )
        self._table = settings.qualify_table_name(settings.snowflake_semantic_model_table)

    def submit(self, req: GenerateRequest) -> tuple[str, int]:
        """Register a pending job, return (job_id, total_tasks)."""
        unique_schemas = _unique_schemas(req.tables)
        # SCHEMA per unique schema + TABLE + ATTRIBUTE per table
        total = len(unique_schemas) + len(req.tables) * 2

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
    ) -> dict[str, int]:
        generated = 0
        skipped = 0

        for db, schema in _unique_schemas(tables):
            outcome = _execute_task(
                session,
                agent_client,
                self._table,
                self._agent_name,
                "SCHEMA",
                db,
                schema,
                "",
                force,
            )
            generated += 1 if outcome == "generated" else 0
            skipped += 1 if outcome == "skipped" else 0

        for table in tables:
            table_db = table.database.upper()
            table_schema = table.schema.upper()
            table_name = table.table.upper()
            for scope in ("TABLE", "ATTRIBUTE"):
                outcome = _execute_task(
                    session,
                    agent_client,
                    self._table,
                    self._agent_name,
                    scope,
                    table_db,
                    table_schema,
                    table_name,
                    force,
                )
                generated += 1 if outcome == "generated" else 0
                skipped += 1 if outcome == "skipped" else 0

        return {"generated": generated, "skipped": skipped}

    def get_table_records(
        self,
        session: Session,
        tables: list[TableRef],
    ) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        for table in tables:
            record = self.get_record(
                session=session,
                scope="TABLE",
                db_name=table.database,
                schema_name=table.schema,
                table_name=table.table,
            )
            if record:
                records.append(record)
        return records

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

        sf_client = SnowflakeClient(settings=self._settings, user_token=user_token)
        try:
            session = sf_client.session
            agent_client = self._build_agent_client(user_token)

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
                )

            for tbl in req.tables:
                for scope in ("TABLE", "ATTRIBUTE"):
                    _run_task(
                        job,
                        session,
                        agent_client,
                        self._table,
                        self._agent_name,
                        scope,
                        tbl.database.upper(),
                        tbl.schema.upper(),
                        tbl.table.upper(),
                        req.force,
                    )

            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)

        except Exception as exc:
            logger.exception("Semantic model batch failed for job %s", job_id)
            job.status = "failed"
            job.errors.append(str(exc))
            job.completed_at = datetime.now(timezone.utc)
        finally:
            sf_client.close()

    def _build_agent_client(self, user_token: str) -> SnowflakeAgentClient:
        if using_local_dev_auth(self._settings, user_token):
            context = get_local_rest_session_context(self._settings)
            return SnowflakeAgentClient(
                token=context.token,
                host=context.host,
                auth_mode="snowflake_token",
            )

        return SnowflakeAgentClient(
            token=build_caller_token(user_token),
            host=self._settings.resolved_snowflake_host or None,
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
) -> str:
    current_hash = _compute_ddl_hash(session, scope, db, schema, tbl)
    if not force and _is_fresh(session, sm_table, scope, db, schema, tbl, current_hash):
        return "skipped"

    prompt = _build_prompt(scope, db, schema, tbl)
    raw_text, _ = agent_client.run(
        [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        agent=agent_name,
    )
    envelope = _parse_response(raw_text)
    _upsert(session, sm_table, scope, db, schema, tbl, envelope, current_hash)
    return "generated"


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


def _build_prompt(scope: str, db: str, schema: str, tbl: str) -> str:
    payload: dict[str, Any] = {"scope": scope, "database": db, "schema": schema}
    if tbl:
        payload["table"] = tbl
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

    if scope == "ATTRIBUTE":
        if not isinstance(semantic_model, list):
            raise SnowflakeAgentError("ATTRIBUTE scope: expected semantic_model to be an array")
        for item in semantic_model:
            attr = (item.get("attribute") or "").upper()
            if attr:
                _merge_row(session, sm_table, "ATTRIBUTE", db, schema, tbl, attr, item, ddl_hash)
    else:
        _merge_row(session, sm_table, scope, db, schema, tbl, "", semantic_model, ddl_hash)


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
    model_json = json.dumps(model).replace("'", "''")
    session.sql(f"""
        MERGE INTO {sm_table} AS tgt
        USING (
            SELECT
                '{scope}'                    AS SCOPE,
                '{db}'                       AS DB_NAME,
                '{schema}'                   AS SCHEMA_NAME,
                '{tbl}'                      AS TABLE_NAME,
                '{attr}'                     AS ATTRIBUTE_NAME,
                PARSE_JSON('{model_json}')   AS SEMANTIC_MODEL,
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
