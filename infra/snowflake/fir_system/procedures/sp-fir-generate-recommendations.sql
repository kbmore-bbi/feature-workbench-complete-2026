-- ============================================================
-- SP_FIR_GENERATE_RECOMMENDATIONS
-- Generates agent-specific recommendations from inferences.
-- Creates pre-formatted payloads for each target agent.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_GENERATE_RECOMMENDATIONS(
    "BATCH_SIZE" INTEGER DEFAULT 100
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'generate_recommendations'
EXECUTE AS OWNER
AS
$$
import json
import uuid
from datetime import datetime
from typing import Any, List, Dict


def _determine_trigger_type(source_type: str, event_type: str, inference_type: str) -> str:
    """Determine when this recommendation should be triggered."""
    trigger_map = {
        ('mapping_feedback', 'mapping.accept', 'mapping_pattern'): 'before_auto_map',
        ('mapping_feedback', 'mapping.edit', 'mapping_correction'): 'on_auto_map_review',
        ('mapping_feedback', 'sttm.publish', 'mapping_pattern'): 'before_auto_map',
        ('implicit', 'derived_source.create', 'derived_source_pattern'): 'derived_source_planning',
        ('implicit', 'derived_source.update', 'derived_source_pattern'): 'derived_source_selected',
        ('implicit', 'semantic_view.update', 'semantic_evolution'): 'selection_changed',
        ('explicit', 'conversation.feedback', 'explicit_feedback'): 'analyst_answer_review',
        ('conversation', 'conversation.turn', 'conversation_pattern'): 'analyst_answer_review',
        ('document_upload', 'document.sql_upload', 'document_sql_pattern'): 'before_auto_map',
        ('document_upload', 'document.excel_upload', 'document_mapping_pattern'): 'before_auto_map',
        ('document_upload', 'document.csv_upload', 'document_pattern'): 'before_auto_map',
    }

    return trigger_map.get((source_type, event_type, inference_type), 'mapping_ready')


def _determine_recommendation_type(inference_type: str, business_understanding: dict) -> str:
    """Determine the type of recommendation to generate."""
    if inference_type == 'mapping_pattern':
        if business_understanding.get('ai_suggestion_accepted'):
            return 'pattern_reuse'
        return 'similar_mapping'
    elif inference_type == 'mapping_correction':
        return 'correction_warning'
    elif inference_type == 'derived_source_pattern':
        return 'derived_source_suggestion'
    elif inference_type == 'semantic_evolution':
        return 'relationship_hint'
    elif inference_type == 'explicit_feedback':
        return 'business_rule'
    elif inference_type in ('document_sql_pattern', 'document_mapping_pattern', 'document_pattern'):
        return 'historical_mapping_pattern'
    else:
        return 'column_mapping_hint'


def _determine_recommendation_category(recommendation_type: str) -> str:
    """Map storage recommendation types to proactive UI/runtime categories."""
    category_map = {
        'pattern_reuse': 'column_mapping',
        'correction_warning': 'validation',
        'similar_mapping': 'column_mapping',
        'derived_source_suggestion': 'derived_source',
        'transformation_pattern': 'transformation',
        'preprocessing_rule': 'transformation',
        'relationship_hint': 'relationship',
        'business_rule': 'query_shaping',
        'column_mapping_hint': 'column_mapping',
        'project_context': 'target_context',
        'historical_mapping_pattern': 'column_mapping',
        'feedback_question': 'analysis',
        'table_suggestion': 'source_discovery',
        'mapping_insight': 'column_mapping',
        'semantic_qa': 'analysis',
        'context_enrichment': 'analysis',
    }
    return category_map.get(recommendation_type, 'analysis')


def _determine_scope(trigger_type: str, project_id: Any, entity_ids: Any) -> tuple:
    """Return a deterministic scope type and key for exact precomputed lookup."""
    if trigger_type in ('project_created', 'project_opened'):
        scope_type = 'project'
    elif trigger_type == 'schema_browsed':
        scope_type = 'schema'
    elif trigger_type.startswith('derived_source'):
        scope_type = 'derived_source'
    elif trigger_type == 'target_selected':
        scope_type = 'target'
    elif trigger_type in (
        'mapping_created', 'mapping_ready', 'before_auto_map',
        'on_auto_map_review', 'on_transformation_review',
        'before_validation', 'after_validation',
        'before_publish', 'sttm_published'
    ):
        scope_type = 'mapping'
    else:
        scope_type = 'table_set'

    normalized_entities = entity_ids
    if isinstance(normalized_entities, str):
        try:
            normalized_entities = json.loads(normalized_entities)
        except Exception:
            normalized_entities = [normalized_entities]
    if not isinstance(normalized_entities, list):
        normalized_entities = []

    scope_material = '|'.join([
        str(project_id or ''),
        trigger_type,
        *sorted(str(value) for value in normalized_entities if value),
    ])
    return scope_type, str(uuid.uuid5(uuid.NAMESPACE_URL, scope_material))


def _build_action_contract(rec_id: str, recommendation_type: str) -> dict:
    """Create a stable action contract instead of relying on button-label parsing."""
    action = 'open_assistant_explanation'
    label = 'Explain this recommendation'
    if recommendation_type == 'table_suggestion':
        action, label = 'select_table', 'Review suggested table'
    elif recommendation_type in ('relationship_hint',):
        action, label = 'preview_join', 'Preview recommended join'
    elif recommendation_type == 'derived_source_suggestion':
        action, label = 'draft_derived_source', 'Draft derived source'
    elif recommendation_type == 'business_rule':
        action, label = 'preview_filter', 'Review query shaping'
    elif recommendation_type in ('pattern_reuse', 'similar_mapping', 'historical_mapping_pattern'):
        action, label = 'open_mapping_precedent', 'Open mapping precedent'

    return {
        'id': f'{action}_{rec_id}',
        'label': label,
        'action': action,
        'payload': {'recommendation_id': rec_id},
        'requires_confirmation': action in {
            'select_table', 'preview_join', 'draft_derived_source', 'preview_filter'
        },
        'requires_comment': False,
    }


def _calculate_priority(inference_confidence: float, recommendation_type: str, source_type: str) -> int:
    """Calculate recommendation priority (1-100)."""
    base_priority = int(inference_confidence * 50)

    type_boost = {
        'correction_warning': 30,
        'pattern_reuse': 20,
        'similar_mapping': 15,
        'derived_source_suggestion': 10,
        'relationship_hint': 10,
        'business_rule': 25,
        'column_mapping_hint': 5,
        'historical_mapping_pattern': 25,
    }

    source_boost = {
        'mapping_feedback': 10,
        'explicit': 15,
        'implicit': 5,
        'conversation': 5,
        'collaborative': 20,
        'document_upload': 20,
    }

    priority = base_priority + type_boost.get(recommendation_type, 0) + source_boost.get(source_type, 0)
    return max(1, min(100, priority))


def _format_for_sttm_builder(inference_payload: dict, business_understanding: dict) -> dict:
    """Format recommendation payload for AGT_STTM_BUILDER."""
    payload = {
        'recommendation_source': 'fir_system',
        'inference_summary': inference_payload.get('summary', ''),
        'confidence': inference_payload.get('confidence', 0.5),
    }

    if 'derived_source' in business_understanding:
        ds = business_understanding['derived_source']
        payload['suggested_derived_source'] = {
            'name': ds.get('name'),
            'purpose': ds.get('purpose'),
            'source_tables': ds.get('source_tables'),
            'business_context': ds.get('business_description')
        }

    if 'column_relationship' in business_understanding:
        rel = business_understanding['column_relationship']
        payload['mapping_hint'] = {
            'source_column': rel.get('source'),
            'target_column': rel.get('target'),
            'rationale': rel.get('rationale')
        }

    if 'document_upload' in business_understanding:
        doc = business_understanding['document_upload']
        payload['historical_mapping'] = {
            'asset_name': doc.get('asset_name'),
            'sql_kind': doc.get('sql_kind'),
            'tables_referenced': doc.get('tables_referenced'),
            'columns_mapped': doc.get('columns_mapped'),
            'transformations_found': doc.get('transformations_found'),
            'join_patterns': doc.get('join_patterns'),
            'business_rules': doc.get('business_rules')
        }

    return payload


def _format_for_source_mapping(inference_payload: dict, business_understanding: dict) -> dict:
    """Format recommendation payload for AGT_SOURCE_MAPPING."""
    payload = {
        'recommendation_source': 'fir_system',
        'inference_type': inference_payload.get('inference_type', ''),
        'confidence': inference_payload.get('confidence', 0.5),
    }

    if 'column_relationship' in business_understanding:
        rel = business_understanding['column_relationship']
        payload['mapping_pattern'] = {
            'source_column': rel.get('source'),
            'target_column': rel.get('target'),
            'processing_rule': rel.get('rule'),
            'transformation': rel.get('transformation'),
            'rationale': rel.get('rationale'),
            'ai_confidence': business_understanding.get('ai_confidence')
        }

        if inference_payload.get('inference_type') == 'mapping_correction':
            payload['is_correction'] = True
            payload['warning'] = f"User corrected AI suggestion for {rel.get('source')} → {rel.get('target')}"

    if 'document_upload' in business_understanding:
        doc = business_understanding['document_upload']
        payload['historical_mapping'] = {
            'asset_name': doc.get('asset_name'),
            'sql_kind': doc.get('sql_kind'),
            'tables_referenced': doc.get('tables_referenced'),
            'columns_mapped': doc.get('columns_mapped'),
            'transformations_found': doc.get('transformations_found'),
            'join_patterns': doc.get('join_patterns')
        }

    return payload


def _format_for_transformation_rule(inference_payload: dict, business_understanding: dict) -> dict:
    """Format recommendation payload for AGT_TRANSFORMATION_RULE."""
    payload = {
        'recommendation_source': 'fir_system',
        'confidence': inference_payload.get('confidence', 0.5),
    }

    if 'column_relationship' in business_understanding:
        rel = business_understanding['column_relationship']
        if rel.get('transformation'):
            payload['transformation_pattern'] = {
                'expression': rel.get('transformation'),
                'rule_type': rel.get('rule'),
                'rationale': rel.get('rationale'),
                'source_column': rel.get('source'),
                'target_column': rel.get('target')
            }

    if 'document_upload' in business_understanding:
        doc = business_understanding['document_upload']
        if doc.get('transformations_found'):
            payload['historical_transformations'] = doc['transformations_found']
        if doc.get('business_rules'):
            payload['historical_business_rules'] = doc['business_rules']

    return payload


def _get_applicable_filters(inference_payload: dict, business_understanding: dict) -> dict:
    """Determine filtering criteria for the recommendation."""
    filters = {
        'applicable_projects': None,
        'applicable_tables': None,
        'applicable_columns': None
    }

    if 'column_relationship' in business_understanding:
        rel = business_understanding['column_relationship']
        if rel.get('source'):
            filters['applicable_columns'] = [rel.get('source')]
        if rel.get('target'):
            if filters['applicable_columns']:
                filters['applicable_columns'].append(rel.get('target'))
            else:
                filters['applicable_columns'] = [rel.get('target')]

    if 'derived_source' in business_understanding:
        ds = business_understanding['derived_source']
        if ds.get('source_tables'):
            tables = ds['source_tables']
            if isinstance(tables, list):
                filters['applicable_tables'] = tables

    return filters


def generate_recommendations(session, batch_size: int = 100) -> dict:
    """Main handler to generate recommendations from inferences."""
    results = {
        'status': 'success',
        'recommendations_by_agent': {},
        'recommendations_by_type': {},
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
                INFERENCE_ID,
                INFERENCE_PAYLOAD,
                SOURCE_TYPE,
                SOURCE_EVENT_TYPE,
                PROJECT_ID,
                STTM_ID,
                ENTITY_TYPE,
                ENTITY_IDS,
                INITIAL_CONFIDENCE,
                TARGET_AGENTS
            FROM __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
            WHERE PROCESSING_STAGE = 'inference_generated'
              AND INFERENCE_PAYLOAD IS NOT NULL
            ORDER BY CREATED_AT
            LIMIT {batch_size}
        """).collect()

        for row in pending_records:
            try:
                inference_payload = json.loads(row['INFERENCE_PAYLOAD']) if isinstance(row['INFERENCE_PAYLOAD'], str) else (row['INFERENCE_PAYLOAD'] or {})
                target_agents = json.loads(row['TARGET_AGENTS']) if isinstance(row['TARGET_AGENTS'], str) else (row['TARGET_AGENTS'] or [])
                business_understanding = inference_payload.get('business_understanding', {})
                inference_type = inference_payload.get('inference_type', 'general_pattern')

                trigger_type = _determine_trigger_type(row['SOURCE_TYPE'], row['SOURCE_EVENT_TYPE'], inference_type)
                recommendation_type = _determine_recommendation_type(inference_type, business_understanding)
                recommendation_category = _determine_recommendation_category(recommendation_type)
                filters = _get_applicable_filters(inference_payload, business_understanding)
                scope_type, scope_key = _determine_scope(
                    trigger_type,
                    row['PROJECT_ID'],
                    row['ENTITY_IDS'],
                )
                evidence_summary = (
                    inference_payload.get('summary')
                    or business_understanding.get('summary')
                    or f'FIR inference {row["INFERENCE_ID"] or row["FIR_RECORD_ID"]}'
                )

                recommendation_ids = []

                for agent in target_agents:
                    if agent == 'AGT_STTM_BUILDER':
                        agent_payload = _format_for_sttm_builder(inference_payload, business_understanding)
                    elif agent == 'AGT_SOURCE_MAPPING':
                        agent_payload = _format_for_source_mapping(inference_payload, business_understanding)
                    elif agent == 'AGT_TRANSFORMATION_RULE':
                        agent_payload = _format_for_transformation_rule(inference_payload, business_understanding)
                    else:
                        agent_payload = {
                            'recommendation_source': 'fir_system',
                            'inference_summary': inference_payload.get('summary', ''),
                            'confidence': inference_payload.get('confidence', 0.5),
                            'business_understanding': business_understanding
                        }

                    priority = _calculate_priority(
                        row['INITIAL_CONFIDENCE'] or 0.5,
                        recommendation_type,
                        row['SOURCE_TYPE']
                    )

                    rec_id = str(uuid.uuid4())
                    action_contract = _build_action_contract(rec_id, recommendation_type)
                    group_key = str(uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        '|'.join([
                            agent,
                            trigger_type,
                            recommendation_type,
                            scope_key,
                        ]),
                    ))

                    session.sql("""
                        INSERT INTO __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS (
                            AGENT_RECOMMENDATION_ID, FIR_RECORD_ID, TARGET_AGENT,
                            TRIGGER_TYPE, RECOMMENDATION_TYPE, RECOMMENDATION_PRIORITY,
                            AGENT_PAYLOAD,
                            APPLICABLE_PROJECTS, APPLICABLE_TABLES, APPLICABLE_COLUMNS,
                            MILESTONE, SCOPE_TYPE, SCOPE_KEY, RECOMMENDATION_CATEGORY,
                            ACTION_CONTRACT, GROUP_KEY, CONTENT_VERSION, EVIDENCE_SUMMARY,
                            CONFIDENCE, STATUS,
                            CREATED_AT, UPDATED_AT
                        )
                        SELECT
                            ?, ?, ?,
                            ?, ?, ?,
                            PARSE_JSON(?),
                            PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?),
                            ?, ?, ?, ?,
                            PARSE_JSON(?), ?, 1, ?,
                            ?, 'active',
                            CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
                    """, [
                        rec_id, row['FIR_RECORD_ID'], agent,
                        trigger_type, recommendation_type, priority,
                        json.dumps(agent_payload),
                        json.dumps([row['PROJECT_ID']]) if row['PROJECT_ID'] else None,
                        json.dumps(filters['applicable_tables']),
                        json.dumps(filters['applicable_columns']),
                        trigger_type,
                        scope_type,
                        scope_key,
                        recommendation_category,
                        json.dumps(action_contract),
                        group_key,
                        str(evidence_summary)[:4000],
                        row['INITIAL_CONFIDENCE'] or 0.5
                    ]).collect()

                    recommendation_ids.append(rec_id)

                    results['recommendations_by_agent'][agent] = results['recommendations_by_agent'].get(agent, 0) + 1

                results['recommendations_by_type'][recommendation_type] = results['recommendations_by_type'].get(recommendation_type, 0) + 1

                first_rec_id = recommendation_ids[0] if recommendation_ids else None
                session.sql("""
                    UPDATE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
                    SET RECOMMENDATION_ID = ?,
                        RECOMMENDATION_PAYLOAD = PARSE_JSON(?),
                        PROCESSING_STAGE = 'completed',
                        UPDATED_AT = CURRENT_TIMESTAMP()
                    WHERE FIR_RECORD_ID = ?
                """, [
                    first_rec_id,
                    json.dumps({'recommendation_ids': recommendation_ids, 'trigger_type': trigger_type, 'type': recommendation_type}),
                    row['FIR_RECORD_ID']
                ]).collect()

                results['total_generated'] += len(recommendation_ids)

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
