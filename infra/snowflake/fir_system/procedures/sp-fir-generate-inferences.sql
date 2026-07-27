-- ============================================================
-- SP_FIR_GENERATE_INFERENCES
-- Generates inferences from collected feedback in TBL_AGENT_FIR_360.
-- Creates typed inferences with full lineage.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_GENERATE_INFERENCES(
    "BATCH_SIZE" INTEGER DEFAULT 100
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'generate_inferences'
EXECUTE AS OWNER
AS
$$
import json
import uuid
from datetime import datetime
from typing import Any


def _determine_inference_type(source_type: str, event_type: str, feedback_payload: dict) -> str:
    """Determine the type of inference to generate based on feedback."""
    if source_type == 'implicit' and 'semantic_view' in event_type:
        return 'semantic_evolution'
    elif source_type == 'mapping_feedback':
        if event_type == 'mapping.edit':
            return 'mapping_correction'
        elif event_type in ('mapping.accept', 'sttm.publish'):
            return 'mapping_pattern'
        else:
            return 'mapping_pattern'
    elif source_type == 'implicit' and 'derived_source' in event_type:
        return 'derived_source_pattern'
    elif source_type == 'conversation':
        return 'conversation_pattern'
    elif source_type == 'document_upload':
        if 'sql' in event_type:
            return 'document_sql_pattern'
        elif 'excel' in event_type:
            return 'document_mapping_pattern'
        else:
            return 'document_pattern'
    elif source_type == 'explicit':
        return 'explicit_feedback'
    else:
        return 'general_pattern'


def _generate_inference_summary(inference_type: str, feedback_payload: dict, source_type: str) -> str:
    """Generate a human-readable summary for the inference."""
    summaries = {
        'semantic_evolution': f"Semantic view {feedback_payload.get('fqn', 'unknown')} evolved: {feedback_payload.get('change_reason', 'updated')}",
        'mapping_pattern': f"Mapping pattern: {feedback_payload.get('source_column', '?')} → {feedback_payload.get('target_column', '?')} with rule {feedback_payload.get('processing_rule', 'DIRECT')}",
        'mapping_correction': f"Mapping corrected: {feedback_payload.get('source_column', '?')} → {feedback_payload.get('target_column', '?')} (user modified)",
        'derived_source_pattern': f"Derived source '{feedback_payload.get('derived_source_name', 'unknown')}' created for: {feedback_payload.get('purpose', 'data preparation')}",
        'conversation_pattern': f"Conversation with {feedback_payload.get('agent_name', 'agent')} - {feedback_payload.get('content_length', 0)} chars",
        'explicit_feedback': f"User feedback: {feedback_payload.get('category', 'general')} - {feedback_payload.get('option_selected', feedback_payload.get('rating', 'N/A'))}",
        'document_sql_pattern': f"Uploaded SQL script '{feedback_payload.get('title', 'unknown')}': {feedback_payload.get('sql_kind', 'historical_mapping')} ({feedback_payload.get('sql_length', 0)} chars)",
        'document_mapping_pattern': f"Uploaded mapping Excel '{feedback_payload.get('title', 'unknown')}': {feedback_payload.get('sql_kind', 'mapping')} format",
        'document_pattern': f"Uploaded document '{feedback_payload.get('title', 'unknown')}': {feedback_payload.get('sql_kind', 'unknown')} format",
        'general_pattern': f"Pattern from {source_type}: {json.dumps(feedback_payload)[:100]}..."
    }
    return summaries.get(inference_type, f"Inference from {source_type}")


def _extract_business_understanding(inference_type: str, feedback_payload: dict) -> dict:
    """Extract business understanding from the feedback for semantic enrichment."""
    understanding = {
        'extracted_at': datetime.utcnow().isoformat(),
        'inference_type': inference_type
    }

    if inference_type == 'mapping_pattern' or inference_type == 'mapping_correction':
        understanding['column_relationship'] = {
            'source': feedback_payload.get('source_column'),
            'target': feedback_payload.get('target_column'),
            'rule': feedback_payload.get('processing_rule'),
            'rationale': feedback_payload.get('mapping_rationale'),
            'transformation': feedback_payload.get('transformation_expression')
        }
        if feedback_payload.get('mapping_source') == 'ai':
            understanding['ai_suggestion_accepted'] = True
            understanding['ai_confidence'] = feedback_payload.get('ai_confidence')

    elif inference_type == 'derived_source_pattern':
        understanding['derived_source'] = {
            'name': feedback_payload.get('derived_source_name'),
            'purpose': feedback_payload.get('purpose'),
            'business_description': feedback_payload.get('business_description'),
            'source_tables': feedback_payload.get('source_tables'),
            'relationships': feedback_payload.get('relationships')
        }

    elif inference_type == 'semantic_evolution':
        understanding['semantic_change'] = {
            'view_fqn': feedback_payload.get('fqn'),
            'version': feedback_payload.get('version'),
            'change_reason': feedback_payload.get('change_reason'),
            'semantic_level': feedback_payload.get('semantic_level')
        }

    elif inference_type == 'explicit_feedback':
        understanding['user_feedback'] = {
            'category': feedback_payload.get('category'),
            'option_selected': feedback_payload.get('option_selected'),
            'rating': feedback_payload.get('rating'),
            'comment': feedback_payload.get('comment')
        }

    elif inference_type in ('document_sql_pattern', 'document_mapping_pattern', 'document_pattern'):
        attrs = feedback_payload.get('attributes', '{}')
        if isinstance(attrs, str):
            try:
                attrs = json.loads(attrs)
            except Exception:
                attrs = {}
        understanding['document_upload'] = {
            'asset_name': feedback_payload.get('title'),
            'sql_kind': feedback_payload.get('sql_kind'),
            'sql_content_preview': feedback_payload.get('sql_preview'),
            'source_tables': attrs.get('source_tables', feedback_payload.get('source_tables')),
            'target_table': attrs.get('target_table', feedback_payload.get('target_table')),
            'tables_referenced': (
                attrs.get('tables_referenced')
                or attrs.get('source_tables')
                or feedback_payload.get('tables_referenced')
            ),
            'columns_mapped': (
                attrs.get('columns_mapped')
                or attrs.get('column_mappings')
                or feedback_payload.get('columns_mapped')
            ),
            'transformations_found': (
                attrs.get('transformations_found')
                or attrs.get('transformations')
                or feedback_payload.get('transformations_found')
            ),
            'join_patterns': attrs.get('join_patterns', feedback_payload.get('join_patterns')),
            'business_rules': attrs.get('business_rules', feedback_payload.get('business_rules')),
            'ctes': attrs.get('ctes', feedback_payload.get('ctes')),
            'parse_warnings': attrs.get('parse_warnings', feedback_payload.get('parse_warnings')),
            'mapping_statistics': attrs.get('stats', feedback_payload.get('stats')),
            'evidence_authority': (
                attrs.get('fir_evidence')
                or feedback_payload.get('evidence_authority')
            ),
            'statement_count': attrs.get('statement_count', feedback_payload.get('statement_count')),
            'upload_format': feedback_payload.get('dialect', 'sql')
        }

    return understanding


def _calculate_inference_confidence(initial_confidence: float, feedback_payload: dict, inference_type: str) -> float:
    """Calculate confidence for the generated inference."""
    confidence = initial_confidence or 0.5

    if inference_type == 'mapping_pattern' and feedback_payload.get('mapping_source') == 'ai':
        ai_confidence = feedback_payload.get('ai_confidence', 0.5)
        confidence = (confidence + ai_confidence) / 2

    if inference_type == 'explicit_feedback':
        rating = feedback_payload.get('rating')
        if rating is not None:
            if rating >= 4:
                confidence = min(1.0, confidence + 0.1)
            elif rating <= 2:
                confidence = max(0.1, confidence - 0.1)

    return round(confidence, 3)


def generate_inferences(session, batch_size: int = 100) -> dict:
    """Main handler to generate inferences from pending FIR records."""
    results = {
        'status': 'success',
        'inferences_by_type': {},
        'total_generated': 0,
        'total_failed': 0,
        'errors': [],
        'processed_at': datetime.utcnow().isoformat()
    }

    try:
        pending_records = session.sql(f"""
            SELECT
                FIR_RECORD_ID,
                FIR_RECORD_KEY,
                SOURCE_TYPE,
                SOURCE_EVENT_TYPE,
                USER_ID,
                SESSION_ID,
                PROJECT_ID,
                STTM_ID,
                SEMANTIC_BUNDLE_ID,
                ENTITY_TYPE,
                ENTITY_IDS,
                FEEDBACK_PAYLOAD,
                INITIAL_CONFIDENCE,
                TARGET_AGENTS
            FROM __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
            WHERE PROCESSING_STAGE = 'pending'
            ORDER BY CREATED_AT
            LIMIT {batch_size}
        """).collect()

        for row in pending_records:
            try:
                feedback_payload = json.loads(row['FEEDBACK_PAYLOAD']) if isinstance(row['FEEDBACK_PAYLOAD'], str) else (row['FEEDBACK_PAYLOAD'] or {})

                inference_type = _determine_inference_type(
                    row['SOURCE_TYPE'],
                    row['SOURCE_EVENT_TYPE'],
                    feedback_payload
                )

                inference_id = str(uuid.uuid4())
                inference_key = f"{inference_type}:{row['FIR_RECORD_KEY']}"

                summary = _generate_inference_summary(inference_type, feedback_payload, row['SOURCE_TYPE'])
                business_understanding = _extract_business_understanding(inference_type, feedback_payload)
                confidence = _calculate_inference_confidence(row['INITIAL_CONFIDENCE'], feedback_payload, inference_type)

                inference_payload = {
                    'inference_id': inference_id,
                    'inference_type': inference_type,
                    'summary': summary,
                    'confidence': confidence,
                    'business_understanding': business_understanding,
                    'source_feedback': {
                        'fir_record_id': row['FIR_RECORD_ID'],
                        'source_type': row['SOURCE_TYPE'],
                        'event_type': row['SOURCE_EVENT_TYPE']
                    }
                }

                session.sql("""
                    MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES target
                    USING (SELECT ? AS INFERENCE_KEY) source
                    ON target.INFERENCE_KEY = source.INFERENCE_KEY
                    WHEN NOT MATCHED THEN INSERT (
                        INFERENCE_ID, INFERENCE_KEY, SOURCE, INFERENCE_TYPE,
                        SUMMARY, CONFIDENCE, ENTITY_TYPE, ENTITY_IDS,
                        ATTRIBUTES, STATUS, USER_ID, CREATED_AT, UPDATED_AT
                    ) VALUES (?, ?, 'fir_system', ?, ?, ?, ?, ?,
                        PARSE_JSON(?), 'active', ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
                    WHEN MATCHED THEN UPDATE SET
                        SUMMARY = ?,
                        CONFIDENCE = ?,
                        ATTRIBUTES = PARSE_JSON(?),
                        UPDATED_AT = CURRENT_TIMESTAMP()
                """, [
                    inference_key,
                    inference_id, inference_key, inference_type,
                    summary, confidence, row['ENTITY_TYPE'], row['ENTITY_IDS'],
                    json.dumps(inference_payload), row['USER_ID'],
                    summary, confidence, json.dumps(inference_payload)
                ]).collect()

                session.sql("""
                    UPDATE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
                    SET INFERENCE_ID = ?,
                        INFERENCE_PAYLOAD = PARSE_JSON(?),
                        PROCESSING_STAGE = 'inference_generated',
                        UPDATED_AT = CURRENT_TIMESTAMP()
                    WHERE FIR_RECORD_ID = ?
                """, [inference_id, json.dumps(inference_payload), row['FIR_RECORD_ID']]).collect()

                results['inferences_by_type'][inference_type] = results['inferences_by_type'].get(inference_type, 0) + 1
                results['total_generated'] += 1

            except Exception as e:
                results['total_failed'] += 1
                results['errors'].append(f"FIR {row['FIR_RECORD_ID']}: {str(e)}")

                session.sql("""
                    UPDATE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
                    SET PROCESSING_STAGE = 'failed',
                        PROCESSING_ERROR = ?,
                        UPDATED_AT = CURRENT_TIMESTAMP()
                    WHERE FIR_RECORD_ID = ?
                """, [str(e)[:1000], row['FIR_RECORD_ID']]).collect()

        if results['total_failed'] > 0 and results['total_generated'] == 0:
            results['status'] = 'failed'
        elif results['total_failed'] > 0:
            results['status'] = 'partial'

    except Exception as e:
        results['status'] = 'failed'
        results['errors'].append(str(e))

    return results
$$;
