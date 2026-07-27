-- ============================================================
-- SP_FIR_READ_PENDING_RECORDS
-- Thin CRUD tool for AGT_FIR_SYSTEM: reads raw pending records.
-- The agent does ALL reasoning; this procedure just fetches data.
-- ============================================================

DROP PROCEDURE IF EXISTS __STTM_METADATA_NAMESPACE__.SP_FIR_READ_PENDING_RECORDS(
    INTEGER, VARCHAR
);

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_READ_PENDING_RECORDS(
    "BATCH_SIZE" INTEGER DEFAULT 50,
    "PROCESSING_STAGE" VARCHAR DEFAULT 'pending',
    "PROJECT_ID" VARCHAR DEFAULT NULL,
    "STTM_ID" VARCHAR DEFAULT NULL,
    "CONTEXT_KEY" VARCHAR DEFAULT NULL,
    "SQL_ASSET_ID" VARCHAR DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'read_pending_records'
EXECUTE AS OWNER
AS
$$
import json

def _json(value, default):
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _compact_goal(goal):
    if not isinstance(goal, dict):
        return goal
    allowed = (
        'INFERENCE_GOAL_ID', 'NAME', 'SUBJECT_TYPE', 'TRIGGER_MILESTONES',
        'GOAL_OWNER', 'CATEGORY', 'RESPONSE_STORAGE', 'OUTPUT_TARGETS', 'VERSION',
    )
    normalized = {str(key).upper(): value for key, value in goal.items()}
    return {key.lower(): normalized.get(key) for key in allowed if normalized.get(key) is not None}


def _compact_semantic(item):
    if not isinstance(item, dict):
        return item
    table_semantic = item.get('table_semantic') or {}
    native_semantic = item.get('native_semantic_view') or {}
    curated_semantic = item.get('curated_semantic') or {}
    return {
        'table_fqn': item.get('table_fqn'),
        'semantic_ready': bool(item.get('semantic_ready')),
        'description': (
            table_semantic.get('DESCRIPTION')
            or table_semantic.get('BUSINESS_DESCRIPTION')
        ),
        'column_semantic_count': len(item.get('column_semantics') or []),
        'native_semantic_available': bool(native_semantic),
        'curated_version_id': curated_semantic.get('VERSION_ID'),
        'curated_version_label': curated_semantic.get('VERSION_LABEL'),
        'curated_confidence': curated_semantic.get('CONFIDENCE'),
        'details_available_via': 'ReadSemanticEvidence',
    }


def _compact_evidence(value):
    evidence = _json(value, {})
    if not isinstance(evidence, dict):
        return {}
    compact = dict(evidence)
    compact['active_inference_goals'] = [
        _compact_goal(goal)
        for goal in (_json(compact.get('active_inference_goals'), []) or [])
    ]
    document = compact.get('document_asset')
    if isinstance(document, dict):
        document = dict(document)
        sql_text = document.pop(
            'DOCUMENT_TEXT',
            document.pop(
                'document_text',
                document.pop('SQL_TEXT', document.pop('sql_text', None)),
            ),
        )
        if sql_text is not None:
            document['sql_length'] = len(str(sql_text))
            document['sql_available_via'] = 'ReadDocuments'
        compact['document_asset'] = document
    compact['semantic_registry'] = [
        _compact_semantic(item)
        for item in (_json(compact.get('semantic_registry'), []) or [])
    ]
    for key, limit in (
        ('prior_inferences', 25),
        ('recommendation_outcomes', 25),
        ('freshness_features', 50),
        ('profile_features', 50),
    ):
        values = compact.get(key)
        if isinstance(values, list) and len(values) > limit:
            compact[key] = values[:limit]
            compact[f'{key}_total'] = len(values)
    return compact


def read_pending_records(
    session,
    batch_size: int = 50,
    processing_stage: str = 'pending',
    project_id: str = None,
    sttm_id: str = None,
    context_key: str = None,
    sql_asset_id: str = None,
) -> dict:
    """Read raw pending records from TBL_AGENT_FIR_360 for agent processing."""
    filters = ["f.PROCESSING_STAGE = ?", "f.EVIDENCE_CONTEXT_ID IS NOT NULL", "e.EVIDENCE_STATUS = 'ready'"]
    params = [processing_stage]
    for expression, value in (
        ("f.PROJECT_ID = ?", project_id),
        ("f.STTM_ID = ?", sttm_id),
        ("f.CONTEXT_KEY = ?", context_key),
        ("f.FEEDBACK_PAYLOAD:sql_asset_id::STRING = ?", sql_asset_id),
    ):
        if value is not None and str(value).strip():
            filters.append(expression)
            params.append(str(value).strip())
    params.append(max(1, min(int(batch_size or 50), 200)))
    results = session.sql(f"""
        SELECT
            f.FIR_RECORD_ID,
            f.FIR_RECORD_KEY,
            f.FEEDBACK_ID,
            f.SOURCE_TYPE,
            f.SOURCE_EVENT_TYPE,
            f.USER_ID,
            f.SESSION_ID,
            f.PROJECT_ID,
            f.STTM_ID,
            f.SEMANTIC_BUNDLE_ID,
            f.ENTITY_TYPE,
            f.ENTITY_IDS,
            f.FEEDBACK_PAYLOAD,
            f.INITIAL_CONFIDENCE,
            f.CURRENT_CONFIDENCE,
            f.TARGET_AGENTS,
            f.CONTEXT_KEY,
            f.SNAPSHOT_ID,
            f.MILESTONE,
            f.EVIDENCE_CONTEXT_ID,
            e.EVIDENCE_PAYLOAD AS CONTEXT_EVIDENCE,
            f.CREATED_AT
        FROM __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 f
        JOIN __STTM_METADATA_NAMESPACE__.TBL_FIR_CONTEXT_EVIDENCE e
          ON e.EVIDENCE_CONTEXT_ID = f.EVIDENCE_CONTEXT_ID
        WHERE {' AND '.join(filters)}
        ORDER BY COALESCE(f.FEEDBACK_PAYLOAD:priority::BOOLEAN, FALSE) DESC,
                 f.CREATED_AT ASC
        LIMIT ?
    """, params).collect()

    records = []
    for row in results:
        record = {
            'fir_record_id': row['FIR_RECORD_ID'],
            'fir_record_key': row['FIR_RECORD_KEY'],
            'feedback_id': row['FEEDBACK_ID'],
            'source_type': row['SOURCE_TYPE'],
            'source_event_type': row['SOURCE_EVENT_TYPE'],
            'user_id': row['USER_ID'],
            'session_id': row['SESSION_ID'],
            'project_id': row['PROJECT_ID'],
            'sttm_id': row['STTM_ID'],
            'semantic_bundle_id': row['SEMANTIC_BUNDLE_ID'],
            'entity_type': row['ENTITY_TYPE'],
            'entity_ids': row['ENTITY_IDS'],
            'feedback_payload': json.loads(row['FEEDBACK_PAYLOAD']) if isinstance(row['FEEDBACK_PAYLOAD'], str) else row['FEEDBACK_PAYLOAD'],
            'initial_confidence': row['INITIAL_CONFIDENCE'],
            'current_confidence': row['CURRENT_CONFIDENCE'],
            'target_agents': row['TARGET_AGENTS'],
            'context_key': row['CONTEXT_KEY'],
            'snapshot_id': row['SNAPSHOT_ID'],
            'milestone': row['MILESTONE'],
            'evidence_context_id': row['EVIDENCE_CONTEXT_ID'],
            'context_evidence': _compact_evidence(row['CONTEXT_EVIDENCE']),
            'created_at': str(row['CREATED_AT']) if row['CREATED_AT'] else None
        }
        records.append(record)

    return {
        'status': 'success',
        'record_count': len(records),
        'processing_stage': processing_stage,
        'filters': {
            'project_id': project_id,
            'sttm_id': sttm_id,
            'context_key': context_key,
            'sql_asset_id': sql_asset_id,
        },
        'records': records
    }
$$;
