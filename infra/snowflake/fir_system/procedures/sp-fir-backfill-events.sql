-- Default execution is read-only. Run with DRY_RUN => FALSE only after reviewing the report.
CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_BACKFILL_EVENTS(
    "DRY_RUN" BOOLEAN DEFAULT TRUE,
    "MAX_ROWS" INTEGER DEFAULT 10000
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'backfill_events'
EXECUTE AS OWNER
AS
$$
import hashlib
import json
import uuid

NS = "__STTM_METADATA_NAMESPACE__"
NOISY = (
    'signal_evaluate.semantic_context_refreshed',
    'signal_evaluate.selection_changed',
    'signal_evaluate.mapping_context_changed',
)


def backfill_events(session, dry_run=True, max_rows=10000):
    counts = session.sql(f"""
        SELECT
            COUNT(*) AS TOTAL_EVENTS,
            COUNT_IF(EVENT_TYPE IN (?, ?, ?)) AS NOISY_EVENTS,
            COUNT_IF(EVENT_TYPE NOT IN (?, ?, ?)) AS CANDIDATE_EVENTS,
            COUNT_IF(CAPTURED_EVENT_ID IS NOT NULL) AS ALREADY_CAPTURED
        FROM (
            SELECT e.EVENT_ID, e.EVENT_TYPE, captured.CAPTURED_EVENT_ID
            FROM {NS}.TBL_WORKBENCH_FIR_EVENTS e
            LEFT JOIN (
                SELECT DISTINCT FEEDBACK_PAYLOAD:event_id::STRING AS CAPTURED_EVENT_ID
                FROM {NS}.TBL_AGENT_FIR_360
                WHERE FEEDBACK_PAYLOAD:event_id IS NOT NULL
            ) captured ON captured.CAPTURED_EVENT_ID = e.EVENT_ID
        )
    """, [*NOISY, *NOISY]).collect()[0]
    report = {
        'dry_run': bool(dry_run),
        'total_events': int(counts['TOTAL_EVENTS'] or 0),
        'noisy_events': int(counts['NOISY_EVENTS'] or 0),
        'candidate_events': int(counts['CANDIDATE_EVENTS'] or 0),
        'already_captured': int(counts['ALREADY_CAPTURED'] or 0),
        'inserted': 0,
    }
    if dry_run:
        return report
    rows = session.sql(f"""
        SELECT EVENT_ID, EVENT_TYPE, USER_ID, SESSION_ID, PAGE, SURFACE,
               ENTITY_TYPE, ENTITY_IDS, EVENT_PAYLOAD, CONTEXT_KEY, SNAPSHOT_ID, MILESTONE
        FROM {NS}.TBL_WORKBENCH_FIR_EVENTS e
        WHERE EVENT_TYPE NOT IN (?, ?, ?)
          AND NOT EXISTS (
              SELECT 1 FROM {NS}.TBL_AGENT_FIR_360 f
              WHERE f.FEEDBACK_PAYLOAD:event_id::STRING = e.EVENT_ID
          )
        ORDER BY CREATED_AT
        LIMIT ?
    """, [*NOISY, max_rows]).collect()
    for row in rows:
        payload = row['EVENT_PAYLOAD'] or {}
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = {'raw_payload': payload}
        event_type = str(row['EVENT_TYPE'] or '')
        source_type = 'mapping_feedback' if event_type.startswith(('mapping.', 'sttm.')) else 'implicit'
        feedback = {
            **payload,
            'event_id': row['EVENT_ID'],
            'context_key': row['CONTEXT_KEY'],
            'snapshot_id': row['SNAPSHOT_ID'],
            'milestone': row['MILESTONE'],
            'backfilled': True,
        }
        key = hashlib.sha256(f"ui_event|{row['EVENT_ID']}".encode()).hexdigest()[:32]
        session.sql(f"""
            INSERT INTO {NS}.TBL_AGENT_FIR_360 (
                FIR_RECORD_ID, FIR_RECORD_KEY, SOURCE_TYPE, SOURCE_EVENT_TYPE,
                USER_ID, SESSION_ID, PROJECT_ID, STTM_ID, ENTITY_TYPE, ENTITY_IDS,
                PROCESSING_STAGE, PROCESSING_VERSION, FEEDBACK_PAYLOAD,
                INITIAL_CONFIDENCE, CURRENT_CONFIDENCE, TARGET_AGENTS,
                CONTEXT_KEY, SNAPSHOT_ID, MILESTONE
            ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, PARSE_JSON(?), 'pending', '2.0',
                     PARSE_JSON(?), 0.5, 0.5, PARSE_JSON(?), ?, ?, ?
        """, [
            str(uuid.uuid4()), key, source_type, event_type, row['USER_ID'], row['SESSION_ID'],
            payload.get('project_id'), payload.get('sttm_id'), row['ENTITY_TYPE'],
            json.dumps(row['ENTITY_IDS'] or []), json.dumps(feedback),
            json.dumps(['AGT_STTM_BUILDER', 'AGT_SOURCE_MAPPING']),
            row['CONTEXT_KEY'], row['SNAPSHOT_ID'], row['MILESTONE'],
        ]).collect()
        report['inserted'] += 1
    return report
$$;
