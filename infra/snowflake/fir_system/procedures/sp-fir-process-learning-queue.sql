-- Advances the durable per-asset FIR learning queue during bounded catch-up.
-- The worker consumes the ready-work stream even when it finds only update
-- records, so false-positive stream triggers do not remain permanently ready.
CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_PROCESS_LEARNING_QUEUE(
    "MAX_JOBS" INTEGER DEFAULT 1,
    "MAX_ITEMS_PER_JOB" INTEGER DEFAULT 10
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'process_queue'
EXECUTE AS OWNER
AS
$$
import json
import uuid

NAMESPACE = "__STTM_METADATA_NAMESPACE__"


def _literal(value):
    return "'" + str(value or "").replace("'", "''") + "'"


def _consume_ready_stream(session):
    suffix = uuid.uuid4().hex[:12].upper()
    table = f"TMP_FIR_READY_{suffix}"
    session.sql(
        f"CREATE TEMP TABLE {table} AS "
        "SELECT * FROM "
        f"{NAMESPACE}.STM_FIR_LEARNING_WORK_ITEMS WHERE 1 = 0"
    ).collect()
    # INSERT...SELECT is intentional: DML consumption advances the stream
    # offset even if the following bounded worker finds no eligible job.
    session.sql(
        f"INSERT INTO {table} SELECT * "
        f"FROM {NAMESPACE}.STM_FIR_LEARNING_WORK_ITEMS"
    ).collect()


def _refresh_job(session, job_id):
    row = session.sql(f"""
        SELECT
            COUNT_IF(WORK_ITEM_TYPE = 'semantic_enrichment') AS DISCOVERED,
            COUNT_IF(
                WORK_ITEM_TYPE = 'semantic_enrichment' AND STATUS = 'completed'
            ) AS COMPLETED,
            COUNT_IF(
                WORK_ITEM_TYPE = 'semantic_enrichment' AND STATUS = 'dead_letter'
            ) AS FAILED,
            COUNT_IF(STATUS IN ('pending', 'running')) AS REMAINING,
            COUNT_IF(STATUS = 'dead_letter') AS DEAD_LETTER
        FROM {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS
        WHERE LEARNING_JOB_ID = {_literal(job_id)}
    """).collect()[0]
    discovered = int(row["DISCOVERED"] or 0)
    completed = int(row["COMPLETED"] or 0)
    failed = int(row["FAILED"] or 0)
    remaining = int(row["REMAINING"] or 0)
    dead_letter = int(row["DEAD_LETTER"] or 0)
    status = "running" if remaining else ("failed" if dead_letter else "completed")
    stage = (
        "semantic_enrichment"
        if completed + failed < discovered
        else ("failed" if status == "failed" else "completed")
    )
    checkpoint = json.dumps({
        "completed_patterns": completed,
        "failed_patterns": failed,
        "remaining_work_items": remaining,
        "worker": "snowflake_catchup",
    })
    session.sql(f"""
        UPDATE {NAMESPACE}.TBL_FIR_LEARNING_JOBS
        SET STATUS = {_literal(status)},
            STAGE = {_literal(stage)},
            DISCOVERED_PATTERN_COUNT = {discovered},
            COMPLETED_PATTERN_COUNT = {completed},
            FAILED_PATTERN_COUNT = {failed},
            CHECKPOINT = PARSE_JSON({_literal(checkpoint)}),
            COMPLETED_AT = IFF(
                {_literal(status)} IN ('completed', 'failed'),
                CURRENT_TIMESTAMP(),
                NULL
            ),
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE LEARNING_JOB_ID = {_literal(job_id)}
    """).collect()
    return {
        "learning_job_id": job_id,
        "status": status,
        "discovered": discovered,
        "completed": completed,
        "failed": failed,
        "remaining": remaining,
    }


def _complete_deterministic_enrichment(session, job_id, max_items):
    session.sql(f"""
        UPDATE {NAMESPACE}.TBL_FIR_TARGET_MAPPING_PATTERNS p
        SET PATTERN_PAYLOAD = OBJECT_INSERT(
                OBJECT_INSERT(
                    p.PATTERN_PAYLOAD,
                    'validation_status',
                    'enriched',
                    TRUE
                ),
                'applicability_conditions',
                ARRAY_DISTINCT(
                    ARRAY_CAT(
                        COALESCE(
                            p.PATTERN_PAYLOAD:applicability_conditions::ARRAY,
                            ARRAY_CONSTRUCT()
                        ),
                        ARRAY_CONSTRUCT(
                            'All required source roles must exist in the current relation graph.',
                            'Source type and target type must be compatible.',
                            'The mapping must pass compilation and validation before application.'
                        )
                    )
                ),
                TRUE
            ),
            VALIDATION_STATUS = IFF(
                p.VALIDATION_STATUS = 'extracted',
                'enriched',
                p.VALIDATION_STATUS
            ),
            UPDATED_AT = CURRENT_TIMESTAMP()
        FROM (
            SELECT PAYLOAD:pattern_id::STRING AS PATTERN_ID
            FROM {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS
            WHERE LEARNING_JOB_ID = {_literal(job_id)}
              AND WORK_ITEM_TYPE = 'semantic_enrichment'
              AND STATUS IN ('pending', 'running')
            ORDER BY CREATED_AT
            LIMIT {max_items}
        ) ready
        WHERE p.PATTERN_ID = ready.PATTERN_ID
    """).collect()
    session.sql(f"""
        UPDATE {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS
        SET STATUS = 'completed',
            RESULT = OBJECT_CONSTRUCT('status', 'enriched'),
            ERROR = NULL,
            LEASE_OWNER = NULL,
            LEASE_EXPIRES_AT = NULL,
            COMPLETED_AT = CURRENT_TIMESTAMP(),
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE LEARNING_JOB_ID = {_literal(job_id)}
          AND WORK_ITEM_TYPE = 'semantic_enrichment'
          AND STATUS IN ('pending', 'running')
          AND PAYLOAD:pattern_id::STRING IN (
              SELECT PATTERN_ID
              FROM {NAMESPACE}.TBL_FIR_TARGET_MAPPING_PATTERNS
              WHERE VALIDATION_STATUS IN (
                  'enriched', 'accepted', 'validated', 'published'
              )
          )
    """).collect()


def _run_agent(session, job_id, asset_id):
    items = session.sql(f"""
        SELECT WORK_ITEM_ID, ATTEMPT_COUNT
        FROM {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS
        WHERE LEARNING_JOB_ID = {_literal(job_id)}
          AND WORK_ITEM_TYPE = 'agent_semantic_enrichment'
          AND STATUS IN ('pending', 'running')
        LIMIT 1
    """).collect()
    if not items:
        return "already_complete"
    item_id = str(items[0]["WORK_ITEM_ID"])
    attempts = int(items[0]["ATTEMPT_COUNT"] or 0)
    session.sql(f"""
        UPDATE {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS
        SET STATUS = 'running',
            LEASE_OWNER = 'snowflake_catchup',
            LEASE_EXPIRES_AT = DATEADD('second', 870, CURRENT_TIMESTAMP()),
            ATTEMPT_COUNT = ATTEMPT_COUNT + 1,
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE WORK_ITEM_ID = {_literal(item_id)}
    """).collect()
    try:
        response = session.call(
            f"{NAMESPACE}.SP_FIR_INVOKE_AGENT",
            {
                "task_type": "document_learning",
                "batch_size": 10,
                "daily_request_limit": 50,
                "daily_token_limit": 20000000,
                "max_concurrency": 2,
                "processing_options": {
                    "priority_asset_id": asset_id,
                    "target_row_count": int(
                        session.sql(f"""
                            SELECT COUNT(*) AS CNT
                            FROM {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS
                            WHERE LEARNING_JOB_ID = {_literal(job_id)}
                              AND WORK_ITEM_TYPE = 'semantic_enrichment'
                        """).collect()[0]["CNT"] or 0
                    ),
                    "collect_feedback": False,
                    "generate_inferences": True,
                    "create_semantic_versions": True,
                    "generate_recommendations": True,
                    "apply_decay": False,
                    "parse_documents": True,
                },
            },
        )
        if isinstance(response, str):
            response = json.loads(response)
        response = response if isinstance(response, dict) else {}
        status = str(response.get("status") or "unknown").lower()
        if status in (
            "budget_exhausted",
            "budget_ledger_unavailable",
            "concurrency_limit",
        ):
            session.sql(f"""
                UPDATE {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS
                SET STATUS = 'pending',
                    ATTEMPT_COUNT = GREATEST(ATTEMPT_COUNT - 1, 0),
                    ERROR = OBJECT_CONSTRUCT(
                        'category', 'deferred',
                        'message', {_literal(status)},
                        'action', 'Retained for the next catch-up.'
                    ),
                    LEASE_OWNER = NULL,
                    LEASE_EXPIRES_AT = NULL,
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE WORK_ITEM_ID = {_literal(item_id)}
            """).collect()
            return status
        if status not in ("success", "no_work"):
            raise RuntimeError(f"Agent returned {status}.")
        session.sql(f"""
            UPDATE {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS
            SET STATUS = 'completed',
                RESULT = PARSE_JSON({_literal(json.dumps(response, default=str))}),
                ERROR = NULL,
                LEASE_OWNER = NULL,
                LEASE_EXPIRES_AT = NULL,
                COMPLETED_AT = CURRENT_TIMESTAMP(),
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE WORK_ITEM_ID = {_literal(item_id)}
        """).collect()
        return status
    except Exception as exc:
        retry = attempts + 1 < 2
        error = json.dumps({
            "category": "transient" if retry else "permanent",
            "message": str(exc),
            "work_item_type": "agent_semantic_enrichment",
            "attempt_count": attempts + 1,
            "action": (
                "Retained for the next catch-up."
                if retry
                else "Inspect the asset and use the admin retry action."
            ),
        })
        session.sql(f"""
            UPDATE {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS
            SET STATUS = {_literal('pending' if retry else 'dead_letter')},
                ERROR = PARSE_JSON({_literal(error)}),
                LEASE_OWNER = NULL,
                LEASE_EXPIRES_AT = NULL,
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE WORK_ITEM_ID = {_literal(item_id)}
        """).collect()
        return "retry" if retry else "dead_letter"


def _complete_post_agent_stages(session, job_id):
    session.sql(f"""
        UPDATE {NAMESPACE}.TBL_FIR_TARGET_MAPPING_PATTERNS target
        SET CONTRADICTION_COUNT = conflicts.CONTRADICTION_COUNT,
            UPDATED_AT = CURRENT_TIMESTAMP()
        FROM (
            SELECT TARGET_TABLE, TARGET_COLUMN,
                   GREATEST(COUNT(DISTINCT CONTENT_HASH) - 1, 0)
                       AS CONTRADICTION_COUNT
            FROM {NAMESPACE}.TBL_FIR_TARGET_MAPPING_PATTERNS
            WHERE STATUS = 'active'
            GROUP BY TARGET_TABLE, TARGET_COLUMN
        ) conflicts
        WHERE target.TARGET_TABLE = conflicts.TARGET_TABLE
          AND target.TARGET_COLUMN = conflicts.TARGET_COLUMN
    """).collect()
    try:
        session.sql(f"""
            UPDATE {NAMESPACE}.TBL_FIR_RUN_OBSERVABILITY
            SET PATTERNS_PROMOTED = (
                    SELECT COUNT(*)
                    FROM {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS
                    WHERE LEARNING_JOB_ID = {_literal(job_id)}
                      AND WORK_ITEM_TYPE = 'semantic_enrichment'
                ),
                RESULT_VALIDATION_STATUS = 'promoted'
            WHERE RUN_ID = (
                SELECT RUN_ID
                FROM {NAMESPACE}.TBL_FIR_RUN_OBSERVABILITY
                WHERE ASSET_ID = (
                    SELECT ASSET_ID
                    FROM {NAMESPACE}.TBL_FIR_LEARNING_JOBS
                    WHERE LEARNING_JOB_ID = {_literal(job_id)}
                )
                ORDER BY STARTED_AT DESC
                LIMIT 1
            )
        """).collect()
    except Exception:
        pass
    session.sql(f"""
        UPDATE {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS
        SET STATUS = 'completed',
            RESULT = OBJECT_CONSTRUCT(
                'status',
                CASE WORK_ITEM_TYPE
                    WHEN 'pattern_conflict_analysis' THEN 'conflicts_analyzed'
                    WHEN 'recommendation_generation' THEN 'recommendations_available'
                    WHEN 'search_index_promotion' THEN 'promoted'
                END
            ),
            ERROR = NULL,
            LEASE_OWNER = NULL,
            LEASE_EXPIRES_AT = NULL,
            COMPLETED_AT = CURRENT_TIMESTAMP(),
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE LEARNING_JOB_ID = {_literal(job_id)}
          AND WORK_ITEM_TYPE IN (
              'pattern_conflict_analysis',
              'recommendation_generation',
              'search_index_promotion'
          )
          AND STATUS = 'pending'
    """).collect()


def process_queue(session, max_jobs=1, max_items_per_job=10):
    max_jobs = max(1, min(int(max_jobs or 1), 1))
    max_items = max(1, min(int(max_items_per_job or 10), 10))
    _consume_ready_stream(session)
    jobs = session.sql(f"""
        SELECT j.LEARNING_JOB_ID, j.ASSET_ID
        FROM {NAMESPACE}.TBL_FIR_LEARNING_JOBS j
        WHERE j.STATUS = 'running'
          AND EXISTS (
              SELECT 1
              FROM {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS i
              WHERE i.LEARNING_JOB_ID = j.LEARNING_JOB_ID
                AND (
                    i.STATUS = 'pending'
                    OR (
                        i.STATUS = 'running'
                        AND i.LEASE_EXPIRES_AT < CURRENT_TIMESTAMP()
                    )
                )
          )
        ORDER BY j.CREATED_AT
        LIMIT {max_jobs}
    """).collect()
    results = []
    for job in jobs:
        job_id = str(job["LEARNING_JOB_ID"])
        asset_id = str(job["ASSET_ID"] or "")
        _complete_deterministic_enrichment(session, job_id, max_items)
        remaining_semantic = session.sql(f"""
            SELECT COUNT(*) AS CNT
            FROM {NAMESPACE}.TBL_FIR_LEARNING_WORK_ITEMS
            WHERE LEARNING_JOB_ID = {_literal(job_id)}
              AND WORK_ITEM_TYPE = 'semantic_enrichment'
              AND STATUS IN ('pending', 'running')
        """).collect()[0]["CNT"]
        agent_status = "waiting_for_deterministic_enrichment"
        if int(remaining_semantic or 0) == 0:
            agent_status = _run_agent(session, job_id, asset_id)
            if agent_status in ("success", "no_work", "already_complete"):
                _complete_post_agent_stages(session, job_id)
        refreshed = _refresh_job(session, job_id)
        refreshed["agent_status"] = agent_status
        results.append(refreshed)
    return {
        "status": "success",
        "trigger_stream_consumed": True,
        "processed_jobs": results,
    }
$$;
