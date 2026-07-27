-- ============================================================
-- SP_FIR_COLLECT_FEEDBACK
-- Collects and normalizes all feedback sources into TBL_AGENT_FIR_360.
-- Processes streams to extract feedback from multiple sources.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_COLLECT_FEEDBACK()
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'collect_feedback'
EXECUTE AS OWNER
AS
$$
import json
import uuid
import hashlib
from datetime import datetime


def _generate_record_key(source_type: str, event_type: str, entity_ids: list, user_id: str, session_id: str) -> str:
    """Generate a deterministic key for deduplication."""
    key_parts = [source_type, event_type, json.dumps(sorted(entity_ids) if entity_ids else []), user_id or '', session_id or '']
    return hashlib.sha256('|'.join(key_parts).encode()).hexdigest()[:32]


def _get_initial_confidence(source_type: str, event_type: str) -> float:
    """Determine initial confidence based on source and event type."""
    confidence_map = {
        ('explicit', 'conversation.feedback'): 0.9,
        ('mapping_feedback', 'mapping.accept'): 0.85,
        ('mapping_feedback', 'mapping.edit'): 0.8,
        ('mapping_feedback', 'mapping.reject'): 0.75,
        ('mapping_feedback', 'sttm.publish'): 0.95,
        ('mapping_feedback', 'sttm.save'): 0.7,
        ('implicit', 'derived_source.create'): 0.6,
        ('implicit', 'derived_source.update'): 0.6,
        ('implicit', 'semantic_view.update'): 0.55,
        ('conversation', 'conversation.turn'): 0.5,
        ('collaborative', 'collaborative.edit'): 0.7,
        ('document_upload', 'document.sql_upload'): 0.96,
        ('document_upload', 'document.excel_upload'): 0.99,
        ('document_upload', 'document.csv_upload'): 0.97,
    }
    return confidence_map.get((source_type, event_type), 0.5)


def _normalize_event_type(event_type: str) -> str:
    aliases = {
        'mapping.accepted': 'mapping.accept',
        'mapping.edited': 'mapping.edit',
        'mapping.rejected': 'mapping.reject',
        'sttm.published': 'sttm.publish',
        'sttm.saved': 'sttm.save',
        'derived_source.created': 'derived_source.create',
        'derived_source.saved': 'derived_source.create',
        'derived_source.updated': 'derived_source.update',
        'signal_evaluate.target_selected': 'target_selected',
        'signal_evaluate.source_set_completed': 'source_set_completed',
        'signal_evaluate.join_completed': 'join_completed',
        'signal_evaluate.derived_source_selected': 'derived_source_selected',
        'signal_evaluate.before_auto_map': 'before_auto_map',
        'signal_evaluate.before_publish': 'before_publish',
    }
    return aliases.get(event_type, event_type)


def _determine_target_agents(source_type: str, event_type: str, entity_type: str) -> list:
    """Determine which agents should receive recommendations from this feedback."""
    agents = []

    if source_type == 'mapping_feedback':
        agents.extend(['AGT_SOURCE_MAPPING', 'AGT_TRANSFORMATION_RULE'])
        if event_type in ('sttm.publish', 'sttm.save'):
            agents.append('AGT_STTM_BUILDER')
    elif source_type == 'implicit' and 'derived_source' in event_type:
        agents.extend(['AGT_STTM_BUILDER', 'AGT_SOURCE_MAPPING'])
    elif source_type == 'conversation':
        agents.append('AGT_WORKBENCH_CONVERSATION')
    elif source_type == 'explicit':
        agents.extend(['AGT_STTM_BUILDER', 'AGT_SOURCE_MAPPING', 'AGT_TRANSFORMATION_RULE'])
    elif source_type == 'document_upload':
        agents.extend(['AGT_STTM_BUILDER', 'AGT_SOURCE_MAPPING', 'AGT_TRANSFORMATION_RULE'])
    elif event_type in {
        'target_selected', 'source_set_completed', 'join_completed',
        'derived_source_selected', 'before_auto_map', 'before_publish'
    }:
        agents.extend(['AGT_STTM_BUILDER', 'AGT_SOURCE_MAPPING', 'APP_USER_NOTIFICATION'])

    return list(set(agents))


def collect_feedback(session) -> dict:
    """Main handler to collect feedback from all streams."""
    results = {
        'status': 'success',
        'collected_by_source': {},
        'total_collected': 0,
        'errors': [],
        'processed_at': datetime.utcnow().isoformat()
    }

    try:
        # 1. Collect explicit feedback from STM_FIR_WORKBENCH_FEEDBACK
        explicit_count = _collect_explicit_feedback(session, results)
        results['collected_by_source']['explicit'] = explicit_count

        # 2. Collect mapping feedback from STM_FIR_STTM_ATTRIBUTES
        mapping_count = _collect_mapping_feedback(session, results)
        results['collected_by_source']['mapping_feedback'] = mapping_count

        # 3. Collect implicit feedback from STM_FIR_DERIVED_SOURCES
        derived_count = _collect_derived_source_feedback(session, results)
        results['collected_by_source']['implicit_derived'] = derived_count

        # 4. Collect semantic evolution from STM_FIR_SEM_TABLE_VIEWS
        semantic_count = _collect_semantic_feedback(session, results)
        results['collected_by_source']['implicit_semantic'] = semantic_count

        # 5. Collect conversation feedback from STM_FIR_CONVERSATION_TURNS
        conversation_count = _collect_conversation_feedback(session, results)
        results['collected_by_source']['conversation'] = conversation_count

        # 6. Collect publish events from STM_FIR_STTM_VERSIONS (high confidence)
        publish_count = _collect_publish_feedback(session, results)
        results['collected_by_source']['publish'] = publish_count

        # 7. Collect document upload feedback from STM_FIR_CLIENT_SQL_ASSETS
        doc_upload_count = _collect_document_upload_feedback(session, results)
        results['collected_by_source']['document_upload'] = doc_upload_count

        # 8. Collect meaningful canonical UI actions. High-frequency semantic
        # refresh evaluation events are telemetry, not business feedback.
        ui_event_count = _collect_ui_events(session, results)
        results['collected_by_source']['ui_events'] = ui_event_count

        # 9. Recommendation outcomes are evidence only after the user uses,
        # accepts, corrects, rejects, or publishes the exact recommendation.
        outcome_count = _collect_recommendation_outcomes(session, results)
        results['collected_by_source']['recommendation_outcomes'] = outcome_count

        results['total_collected'] = sum(results['collected_by_source'].values())

    except Exception as e:
        results['status'] = 'partial' if results['total_collected'] > 0 else 'failed'
        results['errors'].append(str(e))

    return results


def _collect_explicit_feedback(session, results: dict) -> int:
    """Collect explicit feedback (thumbs up/down, option selection)."""
    count = 0
    try:
        stream_data = session.sql("""
            SELECT
                FEEDBACK_ID,
                REQUEST_ID,
                CONVERSATION_ID,
                SIGNAL_ID,
                FEEDBACK_TYPE,
                CATEGORY,
                OPTION_SELECTED,
                RATING,
                COMMENT,
                ENTITY_TYPE,
                ENTITY_ID,
                SELECTION_CONTEXT,
                USER_ID,
                CREATED_AT
            FROM __STTM_METADATA_NAMESPACE__.STM_FIR_WORKBENCH_FEEDBACK
            WHERE METADATA$ACTION = 'INSERT'
        """).collect()

        for row in stream_data:
            fir_record_id = str(uuid.uuid4())
            entity_ids = [row['ENTITY_ID']] if row['ENTITY_ID'] else []
            record_key = _generate_record_key('explicit', 'conversation.feedback', entity_ids, row['USER_ID'], None)

            feedback_payload = {
                'feedback_id': row['FEEDBACK_ID'],
                'feedback_type': row['FEEDBACK_TYPE'],
                'category': row['CATEGORY'],
                'option_selected': row['OPTION_SELECTED'],
                'rating': row['RATING'],
                'comment': row['COMMENT'],
                'selection_context': row['SELECTION_CONTEXT']
            }

            session.sql("""
                MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 target
                USING (SELECT ? AS FIR_RECORD_KEY) source
                ON target.FIR_RECORD_KEY = source.FIR_RECORD_KEY
                WHEN NOT MATCHED THEN INSERT (
                    FIR_RECORD_ID, FIR_RECORD_KEY, FEEDBACK_ID,
                    SOURCE_TYPE, SOURCE_EVENT_TYPE,
                    USER_ID, ENTITY_TYPE, ENTITY_IDS,
                    PROCESSING_STAGE, FEEDBACK_PAYLOAD,
                    INITIAL_CONFIDENCE, CURRENT_CONFIDENCE, TARGET_AGENTS,
                    CREATED_AT, UPDATED_AT
                ) VALUES (?, ?, ?, 'explicit', 'conversation.feedback', ?, ?, ?, 'pending',
                    PARSE_JSON(?), ?, ?, PARSE_JSON(?), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            """, [
                record_key,
                fir_record_id, record_key, row['FEEDBACK_ID'],
                row['USER_ID'], row['ENTITY_TYPE'], entity_ids,
                json.dumps(feedback_payload),
                _get_initial_confidence('explicit', 'conversation.feedback'),
                _get_initial_confidence('explicit', 'conversation.feedback'),
                json.dumps(_determine_target_agents('explicit', 'conversation.feedback', row['ENTITY_TYPE']))
            ]).collect()
            count += 1

    except Exception as e:
        results['errors'].append(f'explicit_feedback: {str(e)}')

    return count


def _collect_ui_events(session, results: dict) -> int:
    count = 0
    try:
        rows = session.sql("""
            SELECT EVENT_ID, EVENT_TYPE, USER_ID, SESSION_ID, REQUEST_ID,
                   PAGE, SURFACE, ENTITY_TYPE, ENTITY_IDS, EVENT_PAYLOAD,
                   CONTEXT_KEY, SNAPSHOT_ID, MILESTONE, CREATED_AT
            FROM __STTM_METADATA_NAMESPACE__.STM_FIR_WORKBENCH_EVENTS
            WHERE METADATA$ACTION = 'INSERT'
              AND EVENT_TYPE NOT IN (
                  'signal_evaluate.semantic_context_refreshed',
                  'signal_evaluate.selection_changed',
                  'signal_evaluate.mapping_context_changed'
              )
        """).collect()

        for row in rows:
            raw_type = str(row['EVENT_TYPE'] or '')
            event_type = _normalize_event_type(raw_type)
            payload = row['EVENT_PAYLOAD'] or {}
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except Exception:
                    payload = {'raw_payload': payload}
            entity_ids = row['ENTITY_IDS'] or []
            if isinstance(entity_ids, str):
                try:
                    entity_ids = json.loads(entity_ids)
                except Exception:
                    entity_ids = [entity_ids]

            if event_type.startswith('document.'):
                source_type = 'document_upload'
            elif event_type.startswith('mapping.') or event_type.startswith('sttm.'):
                source_type = 'mapping_feedback'
            elif event_type.startswith('derived_source.') or event_type.startswith('relationship.'):
                source_type = 'implicit'
            elif event_type.startswith('signal_response.'):
                source_type = 'explicit'
            elif event_type.startswith('project.') or event_type.startswith('mapping_intent.'):
                source_type = 'collaborative'
            else:
                source_type = 'implicit'

            feedback_payload = {
                **payload,
                'event_id': row['EVENT_ID'],
                'original_event_type': raw_type,
                'context_key': row['CONTEXT_KEY'],
                'snapshot_id': row['SNAPSHOT_ID'],
                'milestone': row['MILESTONE'],
                'page': row['PAGE'],
                'surface': row['SURFACE'],
            }
            project_id = payload.get('project_id') if isinstance(payload, dict) else None
            sttm_id = payload.get('sttm_id') if isinstance(payload, dict) else None
            record_key = hashlib.sha256(f"ui_event|{row['EVENT_ID']}".encode()).hexdigest()[:32]
            confidence = _get_initial_confidence(source_type, event_type)
            fir_record_id = str(uuid.uuid4())

            session.sql("""
                MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 target
                USING (SELECT ? AS FIR_RECORD_KEY) source
                ON target.FIR_RECORD_KEY = source.FIR_RECORD_KEY
                WHEN NOT MATCHED THEN INSERT (
                    FIR_RECORD_ID, FIR_RECORD_KEY, SOURCE_TYPE, SOURCE_EVENT_TYPE,
                    USER_ID, SESSION_ID, PROJECT_ID, STTM_ID, ENTITY_TYPE, ENTITY_IDS,
                    PROCESSING_STAGE, FEEDBACK_PAYLOAD, INITIAL_CONFIDENCE,
                    CURRENT_CONFIDENCE, TARGET_AGENTS, CONTEXT_KEY, SNAPSHOT_ID,
                    MILESTONE, CREATED_AT, UPDATED_AT
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', PARSE_JSON(?),
                    ?, ?, PARSE_JSON(?), ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            """, [
                record_key, fir_record_id, record_key, source_type, event_type,
                row['USER_ID'], row['SESSION_ID'], project_id, sttm_id,
                row['ENTITY_TYPE'], entity_ids, json.dumps(feedback_payload),
                confidence, confidence,
                json.dumps(_determine_target_agents(source_type, event_type, row['ENTITY_TYPE'])),
                row['CONTEXT_KEY'], row['SNAPSHOT_ID'], row['MILESTONE']
            ]).collect()
            count += 1
    except Exception as exc:
        results['errors'].append(f'ui_events: {str(exc)}')
    return count


def _collect_recommendation_outcomes(session, results: dict) -> int:
    count = 0
    try:
        rows = session.sql("""
            SELECT OUTCOME_ID, AGENT_RECOMMENDATION_ID, CONTEXT_KEY, SNAPSHOT_ID,
                   REQUEST_ID, ARTIFACT_ID, USER_ID, OUTCOME_TYPE, OUTCOME_PAYLOAD, CREATED_AT
            FROM __STTM_METADATA_NAMESPACE__.STM_FIR_RECOMMENDATION_OUTCOMES
            WHERE METADATA$ACTION = 'INSERT'
        """).collect()
        for row in rows:
            outcome_type = str(row['OUTCOME_TYPE'] or '').lower()
            if outcome_type not in ('used', 'accepted', 'corrected', 'rejected', 'validated', 'published'):
                continue
            payload = row['OUTCOME_PAYLOAD'] or {}
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except Exception:
                    payload = {'raw_payload': payload}
            source_type = 'explicit' if outcome_type in ('accepted', 'corrected', 'rejected') else 'mapping_feedback'
            event_type = f'recommendation.{outcome_type}'
            confidence = {
                'published': 0.98,
                'accepted': 0.95,
                'corrected': 0.95,
                'rejected': 0.9,
                'validated': 0.97,
                'used': 0.75,
            }[outcome_type]
            record_key = hashlib.sha256(f"recommendation_outcome|{row['OUTCOME_ID']}".encode()).hexdigest()[:32]
            feedback_payload = {
                **payload,
                'outcome_id': row['OUTCOME_ID'],
                'recommendation_id': row['AGENT_RECOMMENDATION_ID'],
                'outcome_type': outcome_type,
                'request_id': row['REQUEST_ID'],
                'artifact_id': row['ARTIFACT_ID'],
                'context_key': row['CONTEXT_KEY'],
                'snapshot_id': row['SNAPSHOT_ID'],
            }
            session.sql("""
                MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 target
                USING (SELECT ? AS FIR_RECORD_KEY) source
                ON target.FIR_RECORD_KEY = source.FIR_RECORD_KEY
                WHEN NOT MATCHED THEN INSERT (
                    FIR_RECORD_ID, FIR_RECORD_KEY, RECOMMENDATION_ID,
                    SOURCE_TYPE, SOURCE_EVENT_TYPE, USER_ID, PROJECT_ID, STTM_ID,
                    ENTITY_TYPE, ENTITY_IDS, PROCESSING_STAGE, FEEDBACK_PAYLOAD,
                    INITIAL_CONFIDENCE, CURRENT_CONFIDENCE, TARGET_AGENTS,
                    CONTEXT_KEY, SNAPSHOT_ID, MILESTONE, CREATED_AT, UPDATED_AT
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recommendation', PARSE_JSON(?),
                    'pending', PARSE_JSON(?), ?, ?, PARSE_JSON(?), ?, ?, ?,
                    CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            """, [
                record_key, str(uuid.uuid4()), record_key, row['AGENT_RECOMMENDATION_ID'],
                source_type, event_type, row['USER_ID'], payload.get('project_id'), payload.get('sttm_id'),
                json.dumps([row['AGENT_RECOMMENDATION_ID']]), json.dumps(feedback_payload),
                confidence, confidence,
                json.dumps(['AGT_STTM_BUILDER', 'AGT_SOURCE_MAPPING', 'AGT_TRANSFORMATION_RULE']),
                row['CONTEXT_KEY'], row['SNAPSHOT_ID'], event_type,
            ]).collect()
            if outcome_type in ('accepted', 'corrected', 'validated', 'published'):
                _promote_recommendation_learning(
                    session, row, payload, outcome_type, confidence
                )
            count += 1
    except Exception as exc:
        results['errors'].append(f'recommendation_outcomes: {str(exc)}')
    return count


def _promote_recommendation_learning(
    session,
    row,
    payload: dict,
    outcome_type: str,
    confidence: float,
) -> None:
    """Promote strong recommendation outcomes into reusable per-agent learnings."""
    rec_rows = session.sql("""
        SELECT TARGET_AGENT, RECOMMENDATION_TYPE, RECOMMENDATION_CATEGORY,
               DISPLAY_MESSAGE, EVIDENCE_SUMMARY, AGENT_PAYLOAD,
               APPLICABLE_TABLES, APPLICABLE_COLUMNS, TARGET_FQN,
               SOURCE_SET_HASH, DERIVED_SET_HASH, MILESTONE, QUESTION_ID,
               CONTENT_VERSION
        FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
        WHERE AGENT_RECOMMENDATION_ID = ?
        LIMIT 1
    """, [row['AGENT_RECOMMENDATION_ID']]).collect()
    if not rec_rows:
        return

    rec = rec_rows[0]
    target_agent = str(rec['TARGET_AGENT'] or '').replace('AGT_', '')
    category = str(
        rec['RECOMMENDATION_CATEGORY']
        or rec['RECOMMENDATION_TYPE']
        or 'pattern'
    )
    if target_agent in ('', 'APP_USER_NOTIFICATION'):
        target_agents = {
            'column_mapping': ['SOURCE_MAPPING', 'STTM_BUILDER'],
            'transformation': ['TRANSFORMATION_RULE', 'STTM_BUILDER'],
            'validation': ['TRANSFORMATION_RULE', 'STTM_BUILDER'],
            'relationship': ['SOURCE_MAPPING', 'STTM_BUILDER'],
            'derived_source': ['SOURCE_MAPPING', 'STTM_BUILDER'],
        }.get(category, ['STTM_BUILDER'])
    else:
        target_agents = [target_agent]

    correction = payload.get('correction') or payload.get('comment') or payload.get('answer')
    base_summary = str(
        rec['DISPLAY_MESSAGE']
        or rec['EVIDENCE_SUMMARY']
        or category
    )
    summary = (
        f"User correction: {correction}. Supersedes recommendation "
        f"{row['AGENT_RECOMMENDATION_ID']}."
        if outcome_type == 'corrected' and correction
        else f"{outcome_type.title()} FIR precedent: {base_summary}"
    )
    attributes = {
        'recommendation_id': row['AGENT_RECOMMENDATION_ID'],
        'outcome_id': row['OUTCOME_ID'],
        'outcome_type': outcome_type,
        'context_key': row['CONTEXT_KEY'],
        'snapshot_id': row['SNAPSHOT_ID'],
        'request_id': row['REQUEST_ID'],
        'artifact_id': row['ARTIFACT_ID'],
        'recommendation_category': category,
        'recommendation_type': rec['RECOMMENDATION_TYPE'],
        'checkpoint': rec['MILESTONE'],
        'question_id': rec['QUESTION_ID'],
        'target_table': rec['TARGET_FQN'],
        'source_set_hash': rec['SOURCE_SET_HASH'],
        'derived_set_hash': rec['DERIVED_SET_HASH'],
        'applicable_tables': rec['APPLICABLE_TABLES'],
        'applicable_columns': rec['APPLICABLE_COLUMNS'],
        'agent_payload': rec['AGENT_PAYLOAD'],
        'outcome_payload': payload,
        'content_version': rec['CONTENT_VERSION'],
    }
    entity_ids = {
        'project_id': payload.get('project_id'),
        'sttm_id': payload.get('sttm_id'),
        'recommendation_id': row['AGENT_RECOMMENDATION_ID'],
    }

    for agent_type in target_agents:
        learning_key = hashlib.sha256(
            (
                f"{agent_type}|{row['AGENT_RECOMMENDATION_ID']}|"
                f"{outcome_type}|{rec['CONTENT_VERSION']}"
            ).encode()
        ).hexdigest()
        learning_id = f"learning_{learning_key[:32]}"
        session.sql("""
            MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_AGENT_LEARNINGS target
            USING (
                SELECT ? AS LEARNING_ID, ? AS LEARNING_KEY, ? AS AGENT_TYPE,
                       ? AS LEARNING_TYPE, ? AS SUMMARY, ? AS CONFIDENCE,
                       PARSE_JSON(?) AS ENTITY_IDS, PARSE_JSON(?) AS ATTRIBUTES,
                       ARRAY_CONSTRUCT(?, ?, ?) AS TAGS, ? AS CREATED_BY
            ) source
            ON target.LEARNING_KEY = source.LEARNING_KEY
            WHEN MATCHED THEN UPDATE SET
                SUMMARY = source.SUMMARY,
                CONFIDENCE = GREATEST(target.CONFIDENCE, source.CONFIDENCE),
                ENTITY_IDS = source.ENTITY_IDS,
                ATTRIBUTES = source.ATTRIBUTES,
                TAGS = source.TAGS,
                SUCCESS_COUNT = COALESCE(target.SUCCESS_COUNT, 0) + 1,
                STATUS = 'active'
            WHEN NOT MATCHED THEN INSERT (
                LEARNING_ID, AGENT_TYPE, LEARNING_TYPE, LEARNING_KEY, SUMMARY,
                CONFIDENCE, ENTITY_TYPE, ENTITY_IDS, ATTRIBUTES, TAGS,
                USAGE_COUNT, SUCCESS_COUNT, CREATED_BY, STATUS
            ) VALUES (
                source.LEARNING_ID, source.AGENT_TYPE, source.LEARNING_TYPE,
                source.LEARNING_KEY, source.SUMMARY, source.CONFIDENCE,
                'fir_recommendation', source.ENTITY_IDS, source.ATTRIBUTES,
                source.TAGS, 0, 1, source.CREATED_BY, 'active'
            )
        """, [
            learning_id,
            learning_key,
            agent_type,
            f"fir_{category}_{outcome_type}",
            summary,
            confidence,
            json.dumps(entity_ids),
            json.dumps(attributes, default=str),
            f"category:{category}",
            f"outcome:{outcome_type}",
            f"checkpoint:{rec['MILESTONE'] or 'unknown'}",
            row['USER_ID'],
        ]).collect()


def _collect_mapping_feedback(session, results: dict) -> int:
    """Collect mapping feedback from STTM attributes changes."""
    count = 0
    try:
        stream_data = session.sql("""
            SELECT
                ATTRIBUTE_ID,
                STTM_ID,
                ATTRIBUTE_NAME,
                SOURCE_COLUMN,
                TRANSFORMATION_LOGIC,
                DESCRIPTION,
                CALCULATION,
                LAST_MODIFIED_BY,
                CREATED_DATETIME,
                LAST_MODIFIED_DATETIME,
                METADATA$ACTION,
                METADATA$ISUPDATE
            FROM __STTM_METADATA_NAMESPACE__.STM_FIR_STTM_ATTRIBUTES
        """).collect()

        for row in stream_data:
            is_update = row['METADATA$ISUPDATE']
            event_type = 'mapping.edit' if is_update else 'mapping.accept'

            fir_record_id = str(uuid.uuid4())
            entity_ids = [row['ATTRIBUTE_ID'], row['STTM_ID']]
            user_id = row['LAST_MODIFIED_BY']
            record_key = _generate_record_key('mapping_feedback', event_type, entity_ids, user_id, None)

            feedback_payload = {
                'attribute_id': row['ATTRIBUTE_ID'],
                'sttm_id': row['STTM_ID'],
                'target_column': row['ATTRIBUTE_NAME'],
                'source_column': row['SOURCE_COLUMN'],
                'transformation_logic': row['TRANSFORMATION_LOGIC'],
                'mapping_rationale': row['DESCRIPTION'],
                'calculation': row['CALCULATION'],
            }

            session.sql("""
                MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 target
                USING (SELECT ? AS FIR_RECORD_KEY) source
                ON target.FIR_RECORD_KEY = source.FIR_RECORD_KEY
                WHEN NOT MATCHED THEN INSERT (
                    FIR_RECORD_ID, FIR_RECORD_KEY,
                    SOURCE_TYPE, SOURCE_EVENT_TYPE,
                    USER_ID, STTM_ID, ENTITY_TYPE, ENTITY_IDS,
                    PROCESSING_STAGE, FEEDBACK_PAYLOAD,
                    INITIAL_CONFIDENCE, CURRENT_CONFIDENCE, TARGET_AGENTS,
                    CREATED_AT, UPDATED_AT
                ) VALUES (?, ?, 'mapping_feedback', ?, ?, ?, 'mapping_attribute', ?, 'pending',
                    PARSE_JSON(?), ?, ?, PARSE_JSON(?), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            """, [
                record_key,
                fir_record_id, record_key,
                event_type, user_id, row['STTM_ID'], entity_ids,
                json.dumps(feedback_payload),
                _get_initial_confidence('mapping_feedback', event_type),
                _get_initial_confidence('mapping_feedback', event_type),
                json.dumps(_determine_target_agents('mapping_feedback', event_type, 'mapping_attribute'))
            ]).collect()
            count += 1

    except Exception as e:
        results['errors'].append(f'mapping_feedback: {str(e)}')

    return count


def _collect_derived_source_feedback(session, results: dict) -> int:
    """Collect implicit feedback from derived source changes."""
    count = 0
    try:
        stream_data = session.sql("""
            SELECT
                DERIVED_SOURCE_ID,
                DERIVED_SOURCE_NAME,
                SQL_TEXT,
                DRIVING_TABLE,
                SOURCE_TABLES,
                RELATIONSHIPS,
                SEMANTIC_BUNDLE_ID,
                SEMANTIC_VIEW_NAME,
                SEMANTIC_LEVEL,
                CREATED_BY,
                CREATED_AT,
                METADATA$ACTION,
                METADATA$ISUPDATE
            FROM __STTM_METADATA_NAMESPACE__.STM_FIR_DERIVED_SOURCES
            WHERE IS_ACTIVE = TRUE
        """).collect()

        for row in stream_data:
            is_update = row['METADATA$ISUPDATE']
            event_type = 'derived_source.update' if is_update else 'derived_source.create'

            fir_record_id = str(uuid.uuid4())
            entity_ids = [row['DERIVED_SOURCE_ID']]
            record_key = _generate_record_key('implicit', event_type, entity_ids, row['CREATED_BY'], None)

            feedback_payload = {
                'derived_source_id': row['DERIVED_SOURCE_ID'],
                'derived_source_name': row['DERIVED_SOURCE_NAME'],
                'sql_text': row['SQL_TEXT'],
                'driving_table': row['DRIVING_TABLE'],
                'source_tables': row['SOURCE_TABLES'],
                'relationships': row['RELATIONSHIPS'],
                'semantic_view_name': row['SEMANTIC_VIEW_NAME'],
                'semantic_level': row['SEMANTIC_LEVEL'],
            }

            session.sql("""
                MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 target
                USING (SELECT ? AS FIR_RECORD_KEY) source
                ON target.FIR_RECORD_KEY = source.FIR_RECORD_KEY
                WHEN NOT MATCHED THEN INSERT (
                    FIR_RECORD_ID, FIR_RECORD_KEY,
                    SOURCE_TYPE, SOURCE_EVENT_TYPE,
                    USER_ID, SEMANTIC_BUNDLE_ID, ENTITY_TYPE, ENTITY_IDS,
                    PROCESSING_STAGE, FEEDBACK_PAYLOAD,
                    INITIAL_CONFIDENCE, CURRENT_CONFIDENCE, TARGET_AGENTS,
                    CREATED_AT, UPDATED_AT
                ) VALUES (?, ?, 'implicit', ?, ?, ?, 'derived_source', ?, 'pending',
                    PARSE_JSON(?), ?, ?, PARSE_JSON(?), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            """, [
                record_key,
                fir_record_id, record_key,
                event_type, row['CREATED_BY'], row['SEMANTIC_BUNDLE_ID'], entity_ids,
                json.dumps(feedback_payload),
                _get_initial_confidence('implicit', event_type),
                _get_initial_confidence('implicit', event_type),
                json.dumps(_determine_target_agents('implicit', event_type, 'derived_source'))
            ]).collect()
            count += 1

    except Exception as e:
        results['errors'].append(f'derived_source_feedback: {str(e)}')

    return count


def _collect_semantic_feedback(session, results: dict) -> int:
    """Collect implicit feedback from semantic view changes."""
    count = 0
    try:
        stream_data = session.sql("""
            SELECT
                VIEW_ID,
                DATABASE_NAME,
                SCHEMA_NAME,
                TABLE_NAME,
                FQN,
                VERSION,
                SEMANTIC_LEVEL,
                CHANGE_REASON,
                PRODUCER_AGENT,
                REQUEST_ID,
                PARENT_VIEW_ID,
                GENERATED_AT,
                METADATA$ACTION
            FROM __STTM_METADATA_NAMESPACE__.STM_FIR_SEM_TABLE_VIEWS
            WHERE STATUS = 'ACTIVE'
        """).collect()

        for row in stream_data:
            event_type = 'semantic_view.update'

            fir_record_id = str(uuid.uuid4())
            entity_ids = [row['VIEW_ID'], row['FQN']]
            record_key = _generate_record_key('implicit', event_type, entity_ids, None, row['REQUEST_ID'])

            feedback_payload = {
                'view_id': row['VIEW_ID'],
                'fqn': row['FQN'],
                'version': row['VERSION'],
                'semantic_level': row['SEMANTIC_LEVEL'],
                'change_reason': row['CHANGE_REASON'],
                'producer_agent': row['PRODUCER_AGENT'],
                'parent_view_id': row['PARENT_VIEW_ID']
            }

            session.sql("""
                MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 target
                USING (SELECT ? AS FIR_RECORD_KEY) source
                ON target.FIR_RECORD_KEY = source.FIR_RECORD_KEY
                WHEN NOT MATCHED THEN INSERT (
                    FIR_RECORD_ID, FIR_RECORD_KEY,
                    SOURCE_TYPE, SOURCE_EVENT_TYPE,
                    SESSION_ID, ENTITY_TYPE, ENTITY_IDS,
                    PROCESSING_STAGE, FEEDBACK_PAYLOAD,
                    INITIAL_CONFIDENCE, CURRENT_CONFIDENCE, TARGET_AGENTS,
                    CREATED_AT, UPDATED_AT
                ) VALUES (?, ?, 'implicit', ?, ?, 'semantic_view', ?, 'pending',
                    PARSE_JSON(?), ?, ?, PARSE_JSON(?), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            """, [
                record_key,
                fir_record_id, record_key,
                event_type, row['REQUEST_ID'], entity_ids,
                json.dumps(feedback_payload),
                _get_initial_confidence('implicit', event_type),
                _get_initial_confidence('implicit', event_type),
                json.dumps(['AGT_SEMANTIC_MODEL', 'AGT_STTM_BUILDER'])
            ]).collect()
            count += 1

    except Exception as e:
        results['errors'].append(f'semantic_feedback: {str(e)}')

    return count


def _collect_conversation_feedback(session, results: dict) -> int:
    """Collect conversation feedback from conversation turns."""
    count = 0
    try:
        stream_data = session.sql("""
            SELECT
                TURN_ID,
                CONVERSATION_ID,
                REQUEST_ID,
                ROLE,
                ROUTE,
                MESSAGE,
                USER_ID,
                CREATED_AT
            FROM __STTM_METADATA_NAMESPACE__.STM_FIR_CONVERSATION_TURNS
            WHERE ROLE = 'assistant'
        """).collect()

        for row in stream_data:
            event_type = 'conversation.turn'

            fir_record_id = str(uuid.uuid4())
            entity_ids = [row['TURN_ID'], row['CONVERSATION_ID']]
            record_key = _generate_record_key('conversation', event_type, entity_ids, row['USER_ID'], None)

            feedback_payload = {
                'turn_id': row['TURN_ID'],
                'conversation_id': row['CONVERSATION_ID'],
                'request_id': row['REQUEST_ID'],
                'role': row['ROLE'],
                'agent_route': row['ROUTE'],
                'content_length': len(row['MESSAGE']) if row['MESSAGE'] else 0
            }

            session.sql("""
                MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 target
                USING (SELECT ? AS FIR_RECORD_KEY) source
                ON target.FIR_RECORD_KEY = source.FIR_RECORD_KEY
                WHEN NOT MATCHED THEN INSERT (
                    FIR_RECORD_ID, FIR_RECORD_KEY,
                    SOURCE_TYPE, SOURCE_EVENT_TYPE,
                    USER_ID, ENTITY_TYPE, ENTITY_IDS,
                    PROCESSING_STAGE, FEEDBACK_PAYLOAD,
                    INITIAL_CONFIDENCE, CURRENT_CONFIDENCE, TARGET_AGENTS,
                    CREATED_AT, UPDATED_AT
                ) VALUES (?, ?, 'conversation', ?, ?, 'conversation_turn', ?, 'pending',
                    PARSE_JSON(?), ?, ?, PARSE_JSON(?), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            """, [
                record_key,
                fir_record_id, record_key,
                event_type, row['USER_ID'], entity_ids,
                json.dumps(feedback_payload),
                _get_initial_confidence('conversation', event_type),
                _get_initial_confidence('conversation', event_type),
                json.dumps(['AGT_WORKBENCH_CONVERSATION'])
            ]).collect()
            count += 1

    except Exception as e:
        results['errors'].append(f'conversation_feedback: {str(e)}')

    return count


def _collect_publish_feedback(session, results: dict) -> int:
    """Collect high-confidence feedback from STTM publish events."""
    count = 0
    try:
        stream_data = session.sql("""
            SELECT
                VERSION_ID,
                STTM_ID,
                VERSION_NUMBER,
                REVISION_NOTE,
                PUBLISHED_BY,
                PUBLISHED_DATETIME
            FROM __STTM_METADATA_NAMESPACE__.STM_FIR_STTM_VERSIONS
        """).collect()

        for row in stream_data:
            event_type = 'sttm.publish'

            fir_record_id = str(uuid.uuid4())
            entity_ids = [row['VERSION_ID'], row['STTM_ID']]
            record_key = _generate_record_key('mapping_feedback', event_type, entity_ids, row['PUBLISHED_BY'], None)

            feedback_payload = {
                'version_id': row['VERSION_ID'],
                'sttm_id': row['STTM_ID'],
                'version_number': row['VERSION_NUMBER'],
                'revision_note': row['REVISION_NOTE'],
                'published_at': str(row['PUBLISHED_DATETIME']) if row['PUBLISHED_DATETIME'] else None,
            }

            session.sql("""
                MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 target
                USING (SELECT ? AS FIR_RECORD_KEY) source
                ON target.FIR_RECORD_KEY = source.FIR_RECORD_KEY
                WHEN NOT MATCHED THEN INSERT (
                    FIR_RECORD_ID, FIR_RECORD_KEY,
                    SOURCE_TYPE, SOURCE_EVENT_TYPE,
                    USER_ID, STTM_ID, ENTITY_TYPE, ENTITY_IDS,
                    PROCESSING_STAGE, FEEDBACK_PAYLOAD,
                    INITIAL_CONFIDENCE, CURRENT_CONFIDENCE, TARGET_AGENTS,
                    CREATED_AT, UPDATED_AT
                ) VALUES (?, ?, 'mapping_feedback', ?, ?, ?, 'sttm_version', ?, 'pending',
                    PARSE_JSON(?), ?, ?, PARSE_JSON(?), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            """, [
                record_key,
                fir_record_id, record_key,
                event_type, row['PUBLISHED_BY'], row['STTM_ID'], entity_ids,
                json.dumps(feedback_payload),
                _get_initial_confidence('mapping_feedback', event_type),
                _get_initial_confidence('mapping_feedback', event_type),
                json.dumps(['AGT_STTM_BUILDER', 'AGT_SOURCE_MAPPING', 'AGT_TRANSFORMATION_RULE'])
            ]).collect()
            count += 1

    except Exception as e:
        results['errors'].append(f'publish_feedback: {str(e)}')

    return count


def _collect_document_upload_feedback(session, results: dict) -> int:
    """Collect feedback from uploaded SQL scripts and Excel mapping imports.

    This handles previously-created mapping documents that users upload
    (SQL scripts, Excel files, CSVs) so the FIR agent can learn from
    historical mapping patterns not created through our system.
    """
    count = 0
    try:
        stream_data = session.sql("""
            SELECT
                SQL_ASSET_ID,
                PROJECT_ID,
                ENTITY_TYPE,
                ENTITY_IDS,
                TITLE,
                SQL_TEXT,
                SQL_KIND,
                DIALECT,
                DESCRIPTION,
                SOURCE_LABEL,
                AUTHOR_NAME,
                TAGS,
                ATTRIBUTES,
                STATUS,
                CREATED_AT,
                METADATA$ACTION,
                METADATA$ISUPDATE
            FROM __STTM_METADATA_NAMESPACE__.STM_FIR_CLIENT_SQL_ASSETS
            WHERE STATUS = 'active'
        """).collect()

        for row in stream_data:
            sql_kind = row['SQL_KIND'] or 'historical_mapping'

            dialect = str(row['DIALECT'] or '').lower()
            if sql_kind.lower() == 'csv_import' or dialect == 'csv':
                event_type = 'document.csv_upload'
            elif sql_kind.lower() in ('excel_import', 'mapping') or dialect == 'excel':
                event_type = 'document.excel_upload'
            elif sql_kind in ('historical_mapping', 'etl_script', 'transformation', 'SELECT'):
                event_type = 'document.sql_upload'
            else:
                event_type = 'document.sql_upload'

            fir_record_id = str(uuid.uuid4())
            entity_ids_raw = row['ENTITY_IDS']
            entity_ids_list = entity_ids_raw if isinstance(entity_ids_raw, list) else [row['SQL_ASSET_ID']]
            record_key = _generate_record_key('document_upload', event_type, entity_ids_list, row['AUTHOR_NAME'], None)

            sql_text = row['SQL_TEXT'] or ''
            sql_preview = sql_text[:2000] if len(sql_text) > 2000 else sql_text

            attributes = row['ATTRIBUTES']
            if isinstance(attributes, str):
                try:
                    attributes = json.loads(attributes)
                except Exception:
                    attributes = {}
            if not isinstance(attributes, dict):
                attributes = {}
            evidence_authority = attributes.get('fir_evidence') or {}
            if not isinstance(evidence_authority, dict):
                evidence_authority = {}

            feedback_payload = {
                'sql_asset_id': row['SQL_ASSET_ID'],
                'project_id': row['PROJECT_ID'],
                'title': row['TITLE'],
                'sql_kind': sql_kind,
                'dialect': row['DIALECT'],
                'description': row['DESCRIPTION'],
                'source_label': row['SOURCE_LABEL'],
                'author_name': row['AUTHOR_NAME'],
                'tags': row['TAGS'],
                'entity_type': row['ENTITY_TYPE'],
                'sql_preview': sql_preview,
                'sql_length': len(sql_text),
                'attributes': attributes,
                'evidence_authority': evidence_authority,
            }

            confidence = float(
                evidence_authority.get('base_confidence')
                or _get_initial_confidence('document_upload', event_type)
            )
            confidence = max(0.0, min(1.0, confidence))

            session.sql("""
                MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 target
                USING (SELECT ? AS FIR_RECORD_KEY) source
                ON target.FIR_RECORD_KEY = source.FIR_RECORD_KEY
                WHEN NOT MATCHED THEN INSERT (
                    FIR_RECORD_ID, FIR_RECORD_KEY,
                    SOURCE_TYPE, SOURCE_EVENT_TYPE,
                    USER_ID, PROJECT_ID, ENTITY_TYPE, ENTITY_IDS,
                    PROCESSING_STAGE, FEEDBACK_PAYLOAD,
                    INITIAL_CONFIDENCE, CURRENT_CONFIDENCE, TARGET_AGENTS,
                    CREATED_AT, UPDATED_AT
                ) VALUES (?, ?, 'document_upload', ?, ?, ?, ?, ?, 'pending',
                    PARSE_JSON(?), ?, ?, PARSE_JSON(?), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            """, [
                record_key,
                fir_record_id, record_key,
                event_type, row['AUTHOR_NAME'], row['PROJECT_ID'],
                row['ENTITY_TYPE'], entity_ids_list,
                json.dumps(feedback_payload),
                confidence,
                confidence,
                json.dumps(_determine_target_agents('document_upload', event_type, row['ENTITY_TYPE'] or 'sql_asset'))
            ]).collect()
            count += 1

    except Exception as e:
        results['errors'].append(f'document_upload_feedback: {str(e)}')

    return count
$$;
