-- ============================================================
-- SP_FIR_STORE_RECOMMENDATION
-- Thin CRUD tool for AGT_FIR_SYSTEM: stores the agent's recommendation.
-- The agent provides ALL content (target, trigger, type, payload, display).
-- This procedure just writes to the database.
-- ============================================================

-- Remove the FIR 1.x overload before installing the 2.0 signature with
-- optional exact-context fields.
DROP PROCEDURE IF EXISTS __STTM_METADATA_NAMESPACE__.SP_FIR_STORE_RECOMMENDATION(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMBER, VARCHAR, FLOAT, VARCHAR,
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR
);

DROP PROCEDURE IF EXISTS __STTM_METADATA_NAMESPACE__.SP_FIR_STORE_RECOMMENDATION(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, NUMBER, VARCHAR, FLOAT, VARCHAR,
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR
);

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_STORE_RECOMMENDATION(
    "FIR_RECORD_ID" VARCHAR,
    "TARGET_AGENT" VARCHAR,
    "TRIGGER_TYPE" VARCHAR,
    "RECOMMENDATION_TYPE" VARCHAR,
    "PRIORITY" INTEGER,
    "AGENT_PAYLOAD" VARCHAR,
    "CONFIDENCE" FLOAT,
    "AGENT_NOTES" VARCHAR,
    "DISPLAY_MESSAGE" VARCHAR DEFAULT NULL,
    "DISPLAY_OPTIONS" VARCHAR DEFAULT NULL,
    "NOTIFICATION_LAYER" VARCHAR DEFAULT NULL,
    "APPLICABLE_PROJECTS" VARCHAR DEFAULT NULL,
    "APPLICABLE_TABLES" VARCHAR DEFAULT NULL,
    "APPLICABLE_COLUMNS" VARCHAR DEFAULT NULL,
    "CONTEXT_KEY" VARCHAR DEFAULT NULL,
    "SOURCE_SET_HASH" VARCHAR DEFAULT NULL,
    "TARGET_FQN" VARCHAR DEFAULT NULL,
    "DERIVED_SET_HASH" VARCHAR DEFAULT NULL,
    "MILESTONE" VARCHAR DEFAULT NULL,
    "QUESTION_ID" VARCHAR DEFAULT NULL,
    "EVIDENCE_IDS" VARCHAR DEFAULT NULL,
    "VALIDATION_STATUS" VARCHAR DEFAULT 'unvalidated',
    "SCOPE_TYPE" VARCHAR DEFAULT NULL,
    "SCOPE_KEY" VARCHAR DEFAULT NULL,
    "APPLICABLE_SCHEMAS" VARCHAR DEFAULT NULL,
    "RECOMMENDATION_CATEGORY" VARCHAR DEFAULT NULL,
    "ACTION_CONTRACT" VARCHAR DEFAULT NULL,
    "GROUP_KEY" VARCHAR DEFAULT NULL,
    "CONTENT_VERSION" INTEGER DEFAULT 1,
    "SUPERSEDES_RECOMMENDATION_ID" VARCHAR DEFAULT NULL,
    "EVIDENCE_SUMMARY" VARCHAR DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'store_recommendation'
EXECUTE AS OWNER
AS
$$
import hashlib
import json
import re
import uuid
from datetime import datetime


def store_recommendation(
    session,
    fir_record_id: str,
    target_agent: str,
    trigger_type: str,
    recommendation_type: str,
    priority: int,
    agent_payload: str,
    confidence: float,
    agent_notes: str,
    display_message: str = None,
    display_options: str = None,
    notification_layer: str = None,
    applicable_projects: str = None,
    applicable_tables: str = None,
    applicable_columns: str = None,
    context_key: str = None,
    source_set_hash: str = None,
    target_fqn: str = None,
    derived_set_hash: str = None,
    milestone: str = None,
    question_id: str = None,
    evidence_ids: str = None,
    validation_status: str = 'unvalidated',
    scope_type: str = None,
    scope_key: str = None,
    applicable_schemas: str = None,
    recommendation_category: str = None,
    action_contract: str = None,
    group_key: str = None,
    content_version: int = 1,
    supersedes_recommendation_id: str = None,
    evidence_summary: str = None
) -> dict:
    """Store the agent's crafted recommendation."""

    recommendation_id = str(uuid.uuid4())

    def _clean_identifier(value):
        if value is None:
            return None
        normalized = str(value).strip()
        if normalized.lower() in {'', 'none', 'null', 'undefined', 'n/a'}:
            return None
        return normalized

    def _parse_json_safe(value):
        if value is None:
            return None
        if isinstance(value, (list, dict)):
            return value
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return None

    def _normalized_values(value):
        parsed = _parse_json_safe(value)
        if not isinstance(parsed, list):
            return []
        return sorted({
            str(item).strip().upper()
            for item in parsed
            if str(item).strip()
        })

    def _stable_hash(values):
        return hashlib.sha256(
            json.dumps(values, separators=(',', ':')).encode('utf-8')
        ).hexdigest()

    fir_record_id = _clean_identifier(fir_record_id)
    context_key = _clean_identifier(context_key)
    source_set_hash = _clean_identifier(source_set_hash)
    target_fqn = _clean_identifier(target_fqn)
    derived_set_hash = _clean_identifier(derived_set_hash)
    milestone = _clean_identifier(milestone)
    question_id = _clean_identifier(question_id)
    scope_type = _clean_identifier(scope_type)
    scope_key = _clean_identifier(scope_key)
    group_key = _clean_identifier(group_key)
    supersedes_recommendation_id = _clean_identifier(supersedes_recommendation_id)

    # Exact context is lineage data, not model-authored content. Prefer the
    # enriched FIR-360 record whenever the agent supplies an empty, "None", or
    # fabricated context key.
    lineage_rows = session.sql("""
        SELECT
            f.FIR_RECORD_ID,
            f.CONTEXT_KEY,
            f.FIR_RECORD_KEY,
            f.MILESTONE,
            e.SOURCE_TABLES,
            e.TARGET_TABLE,
            e.DERIVED_SOURCE_IDS
        FROM __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 f
        LEFT JOIN __STTM_METADATA_NAMESPACE__.TBL_FIR_CONTEXT_EVIDENCE e
          ON e.EVIDENCE_CONTEXT_ID = f.EVIDENCE_CONTEXT_ID
        WHERE f.FIR_RECORD_ID = ? OR f.FIR_RECORD_KEY = ?
        LIMIT 1
    """, [fir_record_id, fir_record_id]).collect() if fir_record_id else []
    if not lineage_rows:
        return {
            'status': 'rejected',
            'error': 'Unknown FIR record. Use fir_record_id exactly as returned by ReadPendingFIR.',
            'supplied_fir_record_id': fir_record_id,
        }

    lineage = lineage_rows[0]
    fir_record_id = _clean_identifier(lineage['FIR_RECORD_ID'])
    authoritative_context_key = (
        _clean_identifier(lineage['CONTEXT_KEY'])
        or _clean_identifier(lineage['FIR_RECORD_KEY'])
    )
    if authoritative_context_key and authoritative_context_key.startswith('ctx_'):
        context_key = authoritative_context_key
    elif not (context_key and context_key.startswith('ctx_')):
        context_key = None
    milestone = milestone or _clean_identifier(lineage['MILESTONE'])
    target_fqn = (_clean_identifier(lineage['TARGET_TABLE']) or target_fqn)
    target_fqn = target_fqn.upper() if target_fqn else None

    # Checkpoint ownership is deterministic. Do not allow model-authored goal
    # labels to classify join, derived-source, or column-review prompts under a
    # different FIR question family.
    canonical_question_by_milestone = {
        'project_created': 'Q1',
        'mapping_created': 'Q1',
        'schema_browsed': 'Q1',
        'selection_changed': 'Q1',
        'target_selected': 'Q1',
        'source_set_completed': 'Q6',
        'join_completed': 'Q6',
        'derived_source_planning': 'Q7',
        'derived_source_selected': 'Q7',
        'derived_source_saved': 'Q7',
        'source_query_review': 'Q7',
        'mapping_ready': 'Q2',
        'before_auto_map': 'Q6',
        'on_auto_map_review': 'Q2',
        'on_transformation_review': 'Q7',
        'before_validation': 'Q6',
        'after_validation': 'Q6',
    }
    canonical_question_id = canonical_question_by_milestone.get(
        str(milestone or '').strip().lower()
    )
    if target_agent == 'APP_USER_NOTIFICATION' and canonical_question_id:
        question_id = canonical_question_id

    authoritative_sources = _normalized_values(lineage['SOURCE_TABLES'])
    authoritative_derived = _normalized_values(lineage['DERIVED_SOURCE_IDS'])
    if authoritative_sources:
        source_set_hash = _stable_hash(authoritative_sources)
    elif not (source_set_hash and re.fullmatch(r'[0-9a-fA-F]{64}', source_set_hash)):
        source_set_hash = None
    derived_set_hash = _stable_hash(authoritative_derived)

    # Parse JSON string parameters
    payload_parsed = _parse_json_safe(agent_payload) or {}
    options_parsed = _parse_json_safe(display_options)
    projects_parsed = _parse_json_safe(applicable_projects)
    tables_parsed = _parse_json_safe(applicable_tables)
    columns_parsed = _parse_json_safe(applicable_columns)
    evidence_parsed = _parse_json_safe(evidence_ids) or []
    schemas_parsed = _parse_json_safe(applicable_schemas) or []
    action_contract_parsed = _parse_json_safe(action_contract) or []
    if not tables_parsed and (authoritative_sources or target_fqn):
        tables_parsed = [
            *authoritative_sources,
            *([target_fqn] if target_fqn else []),
        ]
    if not schemas_parsed:
        schemas_parsed = sorted({
            '.'.join(str(table).split('.')[:2]).upper()
            for table in (tables_parsed or [])
            if len(str(table).split('.')) >= 2
        })

    category_by_type = {
        'table_suggestion': 'source_discovery',
        'relationship_hint': 'relationship',
        'derived_source_suggestion': 'derived_source',
        'column_mapping_hint': 'column_mapping',
        'transformation_pattern': 'transformation',
        'correction_warning': 'validation',
        'semantic_qa': 'analysis',
        'feedback_question': 'analysis',
        'mapping_insight': 'column_mapping',
        'business_rule': 'query_shaping',
    }
    recommendation_category = (
        _clean_identifier(recommendation_category)
        or category_by_type.get(str(recommendation_type or '').lower())
        or 'analysis'
    )
    checkpoint = str(milestone or '').strip().lower()
    canonical_category_by_checkpoint = {
        'schema_browsed': 'source_discovery',
        'selection_changed': 'source_discovery',
        'source_set_completed': 'relationship',
        'join_completed': 'relationship',
        'target_selected': 'target_context',
        'derived_source_planning': 'derived_source',
        'derived_source_selected': 'derived_source',
        'derived_source_saved': 'derived_source',
        'source_query_review': 'query_shaping',
        'mapping_ready': 'column_mapping',
        'before_auto_map': 'column_mapping',
        'on_auto_map_review': 'column_mapping',
        'on_transformation_review': 'transformation',
        'before_validation': 'validation',
        'after_validation': 'validation',
        'before_publish': 'publish',
        'sttm_published': 'publish',
    }
    if target_agent == 'APP_USER_NOTIFICATION':
        recommendation_category = canonical_category_by_checkpoint.get(
            checkpoint,
            recommendation_category,
        )
        if question_id == 'Q6':
            recommendation_category = 'relationship'
        elif question_id == 'Q7':
            recommendation_category = 'derived_source'
        elif question_id == 'Q9':
            recommendation_category = 'query_shaping'
        elif checkpoint == 'target_selected':
            recommendation_category = 'target_context'
        elif checkpoint in {'schema_browsed', 'selection_changed'}:
            recommendation_category = 'source_discovery'
    scope_type = scope_type or (
        'schema' if str(milestone or '').lower() == 'schema_browsed'
        else 'derived_source' if 'derived_source' in str(milestone or '').lower()
        else 'target' if str(milestone or '').lower() == 'target_selected'
        else 'mapping' if str(milestone or '').lower() in {
            'mapping_ready', 'before_auto_map', 'on_auto_map_review',
            'on_transformation_review', 'before_validation', 'after_validation',
            'before_publish', 'sttm_published'
        }
        else 'table_set'
    )
    if not scope_key:
        scope_identity = {
            'scope_type': scope_type,
            'context_key': context_key,
            'source_set_hash': source_set_hash,
            'target_fqn': target_fqn,
            'derived_set_hash': derived_set_hash,
            'schemas': schemas_parsed,
        }
        scope_key = 'scope_' + hashlib.sha256(
            json.dumps(scope_identity, sort_keys=True, separators=(',', ':')).encode('utf-8')
        ).hexdigest()[:40]
    if not group_key:
        insight_identity = {
            'fir_record_id': fir_record_id,
            'target_agent': target_agent,
            'checkpoint': milestone or trigger_type,
            'recommendation_type': recommendation_type,
            'recommendation_category': recommendation_category,
            'question_id': question_id,
            'scope_key': scope_key,
            'tables': _normalized_values(tables_parsed),
            'columns': _normalized_values(columns_parsed),
            'inference_ids': sorted(
                str(value)
                for value in (
                    payload_parsed.get('used_inference_ids')
                    or payload_parsed.get('inference_ids')
                    or []
                )
                if str(value).strip()
            ),
            'subject': (
                payload_parsed.get('subject_key')
                or payload_parsed.get('pattern_key')
                or payload_parsed.get('inference_summary')
                or payload_parsed.get('current_understanding')
                or display_message
                or ''
            ),
        }
        group_key = hashlib.sha256(
            json.dumps(
                insight_identity,
                sort_keys=True,
                separators=(',', ':'),
                default=str,
            ).encode('utf-8')
        ).hexdigest()

    if not action_contract_parsed and isinstance(options_parsed, list):
        action_contract_parsed = []
        for index, option in enumerate(options_parsed):
            if isinstance(option, dict):
                label = str(option.get('label') or option.get('id') or f'Option {index + 1}')
                action_contract_parsed.append({
                    'id': str(option.get('id') or f'option_{index + 1}'),
                    'label': label,
                    'action': str(option.get('action') or 'open_assistant_explanation'),
                    'payload': option.get('payload') or {'recommendation_id': recommendation_id},
                    'requires_confirmation': bool(option.get('requires_confirmation', False)),
                    'requires_comment': bool(option.get('requires_comment', False)),
                })
            else:
                label = str(option)
                action_contract_parsed.append({
                    'id': re.sub(r'[^a-z0-9]+', '_', label.lower()).strip('_') or f'option_{index + 1}',
                    'label': label,
                    'action': 'open_assistant_explanation',
                    'payload': {'recommendation_id': recommendation_id},
                    'requires_confirmation': False,
                    'requires_comment': False,
                })

    # INSERT into TBL_FIR_AGENT_RECOMMENDATIONS (explicit column list to match table order)
    options_json = json.dumps(options_parsed) if options_parsed else ''
    projects_json = json.dumps(projects_parsed) if projects_parsed else ''
    tables_json = json.dumps(tables_parsed) if tables_parsed else ''
    columns_json = json.dumps(columns_parsed) if columns_parsed else ''
    schemas_json = json.dumps(schemas_parsed) if schemas_parsed else ''
    action_contract_json = json.dumps(action_contract_parsed) if action_contract_parsed else ''

    session.sql("""
        INSERT INTO __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS (
            AGENT_RECOMMENDATION_ID, FIR_RECORD_ID, TARGET_AGENT, TRIGGER_TYPE,
            TRIGGER_CONDITION, RECOMMENDATION_TYPE, RECOMMENDATION_PRIORITY,
            AGENT_PAYLOAD, APPLICABLE_PROJECTS, APPLICABLE_TABLES, APPLICABLE_COLUMNS,
            APPLICABLE_SCHEMAS, SCOPE_TYPE, SCOPE_KEY, RECOMMENDATION_CATEGORY,
            ACTION_CONTRACT, GROUP_KEY, CONTENT_VERSION, SUPERSEDES_RECOMMENDATION_ID,
            EVIDENCE_SUMMARY,
            CONFIDENCE, USAGE_COUNT, SUCCESS_COUNT, LAST_USED_AT,
            CREATED_AT, UPDATED_AT, STATUS,
            AGENT_NOTES, DISPLAY_MESSAGE, DISPLAY_OPTIONS, NOTIFICATION_LAYER,
            CONTEXT_KEY, CONTEXT_VERSION, SOURCE_SET_HASH, TARGET_FQN,
            DERIVED_SET_HASH, MILESTONE, QUESTION_ID, EVIDENCE_IDS, VALIDATION_STATUS
        )
        SELECT
            ?, ?, ?, ?,
            NULL, ?, ?,
            PARSE_JSON(?), TRY_PARSE_JSON(?), TRY_PARSE_JSON(?), TRY_PARSE_JSON(?),
            TRY_PARSE_JSON(?), ?, ?, ?, TRY_PARSE_JSON(?), ?, ?, ?, ?,
            ?, 0, 0, NULL,
            CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), 'active',
            ?, ?, TRY_PARSE_JSON(?), ?,
            ?, '2.0', ?, ?, ?, ?, ?, PARSE_JSON(?), ?
    """, [
        recommendation_id, fir_record_id, target_agent, trigger_type,
        recommendation_type, priority,
        json.dumps(payload_parsed), projects_json, tables_json, columns_json,
        schemas_json, scope_type, scope_key, recommendation_category,
        action_contract_json, group_key, max(1, int(content_version or 1)),
        supersedes_recommendation_id, evidence_summary,
        confidence,
        agent_notes, display_message, options_json, notification_layer,
        context_key, source_set_hash, target_fqn, derived_set_hash, milestone,
        question_id, json.dumps(evidence_parsed), validation_status
    ]).collect()

    # Update FIR_360 processing stage
    session.sql("""
        UPDATE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
        SET RECOMMENDATION_ID = ?,
            PROCESSING_STAGE = 'completed',
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE FIR_RECORD_ID = ?
          AND PROCESSING_STAGE = 'inference_generated'
    """, [recommendation_id, fir_record_id]).collect()

    return {
        'status': 'success',
        'recommendation_id': recommendation_id,
        'fir_record_id': fir_record_id,
        'target_agent': target_agent,
        'trigger_type': trigger_type,
        'recommendation_type': recommendation_type,
        'priority': priority,
        'confidence': confidence,
        'is_user_notification': target_agent == 'APP_USER_NOTIFICATION'
        , 'context_key': context_key
        , 'question_id': question_id
    }
$$;
