-- ==============================================================================
-- FIR SYSTEM COMBINED DEPLOYMENT SQL
-- Database: FFP_HDP_DLAB_DB_DEV
-- Schema:   SCH_STTM_METADATA
-- Generated: 2026-07-08 20:11
--
-- Run this entire file in a Snowflake worksheet.
-- NOTE: Warehouse placeholder set to FFP_HDP_DLAB_WH_DEV — change if yours differs.
-- NOTE: Grants section excluded (requires __SERVICE_OWNER_ROLE__ — run separately).
-- NOTE: Tasks are created SUSPENDED. Resume them manually after verifying.
-- ==============================================================================

USE DATABASE FFP_HDP_DLAB_DB_DEV;
USE SCHEMA SCH_STTM_METADATA;


-- ============================================================
-- TBL_AGENT_FIR_360 - Core FIR Lineage Table
-- End-to-end lineage linking feedback → inference → recommendation
-- with full metadata and confidence decay.
-- ============================================================

CREATE OR REPLACE TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360 (
    -- Primary identification
    FIR_RECORD_ID           STRING          NOT NULL,
    FIR_RECORD_KEY          STRING          NOT NULL,

    -- Lineage references (FKs to existing FIR tables)
    FEEDBACK_ID             STRING,
    INFERENCE_ID            STRING,
    RECOMMENDATION_ID       STRING,

    -- Source classification
    SOURCE_TYPE             STRING          NOT NULL
                                CHECK (SOURCE_TYPE IN (
                                    'mapping_feedback', 'conversation',
                                    'explicit', 'implicit', 'collaborative',
                                    'document_upload'
                                )),
    SOURCE_EVENT_TYPE       STRING          NOT NULL,

    -- Entity context
    USER_ID                 STRING,
    SESSION_ID              STRING,
    PROJECT_ID              STRING,
    STTM_ID                 STRING,
    SEMANTIC_BUNDLE_ID      STRING,
    ENTITY_TYPE             STRING,
    ENTITY_IDS              VARIANT,

    -- Processing state machine
    PROCESSING_STAGE        STRING          NOT NULL DEFAULT 'pending'
                                CHECK (PROCESSING_STAGE IN (
                                    'pending', 'feedback_collected',
                                    'inference_generated', 'recommendation_created',
                                    'completed', 'failed'
                                )),
    PROCESSING_VERSION      STRING          DEFAULT '1.0',

    -- Payload snapshots (denormalized for query performance)
    FEEDBACK_PAYLOAD        VARIANT,
    INFERENCE_PAYLOAD       VARIANT,
    RECOMMENDATION_PAYLOAD  VARIANT,

    -- Confidence with temporal decay
    INITIAL_CONFIDENCE      FLOAT           CHECK (INITIAL_CONFIDENCE IS NULL OR (INITIAL_CONFIDENCE >= 0 AND INITIAL_CONFIDENCE <= 1)),
    CURRENT_CONFIDENCE      FLOAT           CHECK (CURRENT_CONFIDENCE IS NULL OR (CURRENT_CONFIDENCE >= 0 AND CURRENT_CONFIDENCE <= 1)),
    DECAY_FACTOR            FLOAT           DEFAULT 0.95 CHECK (DECAY_FACTOR > 0 AND DECAY_FACTOR <= 1),
    LAST_DECAY_AT           TIMESTAMP_NTZ,

    -- Agent targeting
    TARGET_AGENTS           VARIANT,

    -- Agent reasoning (populated by AGT_FIR_SYSTEM LLM, not procedures)
    AGENT_NOTES             VARCHAR,
    AGENT_REASONING_PAYLOAD VARIANT,

    -- Audit fields
    CREATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    PROCESSED_BY            STRING,
    PROCESSING_ERROR        STRING,

    CONSTRAINT PK_TBL_AGENT_FIR_360 PRIMARY KEY (FIR_RECORD_ID)
)
COMMENT = 'End-to-end FIR lineage linking feedback → inference → recommendation with full metadata and confidence decay.';
-- ============================================================
-- TBL_FIR_AGENT_RECOMMENDATIONS - Agent-Specific Recommendations
-- Pre-formatted recommendations for each agent with trigger conditions.
-- Enables proactive recommendation injection into agent learning_context.
-- ============================================================

CREATE OR REPLACE TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS (
    -- Identification
    AGENT_RECOMMENDATION_ID STRING          NOT NULL,
    FIR_RECORD_ID           STRING          NOT NULL,

    -- Target agent (includes APP_USER_NOTIFICATION for user-facing recommendations)
    TARGET_AGENT            STRING          NOT NULL
                                CHECK (TARGET_AGENT IN (
                                    'AGT_STTM_BUILDER',
                                    'AGT_SOURCE_MAPPING',
                                    'AGT_TRANSFORMATION_RULE',
                                    'AGT_SEMANTIC_MODEL',
                                    'AGT_DBT_CONVERSION',
                                    'AGT_DBT_TEST_GENERATION',
                                    'AGT_WORKBENCH_CONVERSATION',
                                    'APP_USER_NOTIFICATION'
                                )),

    -- Trigger context
    TRIGGER_TYPE            STRING          NOT NULL
                                CHECK (TRIGGER_TYPE IN (
                                    'on_project_create',
                                    'on_source_selection',
                                    'on_target_selection',
                                    'on_mapping_start',
                                    'on_mapping_execute',
                                    'on_derived_source_select',
                                    'on_derived_source_create',
                                    'on_transform_request',
                                    'on_sttm_publish',
                                    'on_dbt_start',
                                    'on_test_generation',
                                    'on_conversation_start',
                                    'on_semantic_model_request',
                                    'on_user_notification_response',
                                    'on_document_upload'
                                )),
    TRIGGER_CONDITION       STRING,

    -- Recommendation content
    RECOMMENDATION_TYPE     STRING          NOT NULL
                                CHECK (RECOMMENDATION_TYPE IN (
                                    'pattern_reuse',
                                    'correction_warning',
                                    'similar_mapping',
                                    'derived_source_suggestion',
                                    'transformation_pattern',
                                    'relationship_hint',
                                    'business_rule',
                                    'column_mapping_hint',
                                    'project_context',
                                    'historical_mapping_pattern',
                                    'feedback_question',
                                    'table_suggestion',
                                    'mapping_insight',
                                    'semantic_qa',
                                    'context_enrichment'
                                )),
    RECOMMENDATION_PRIORITY INTEGER         DEFAULT 50
                                CHECK (RECOMMENDATION_PRIORITY >= 1 AND RECOMMENDATION_PRIORITY <= 100),

    -- Formatted payload for agent consumption
    AGENT_PAYLOAD           VARIANT         NOT NULL,

    -- Filtering criteria (NULL = applies to all)
    APPLICABLE_PROJECTS     VARIANT,
    APPLICABLE_TABLES       VARIANT,
    APPLICABLE_COLUMNS      VARIANT,

    -- Agent reasoning and user-facing display
    AGENT_NOTES             VARCHAR,
    DISPLAY_MESSAGE         VARCHAR,
    DISPLAY_OPTIONS         VARIANT,
    NOTIFICATION_LAYER      VARCHAR         CHECK (NOTIFICATION_LAYER IS NULL OR NOTIFICATION_LAYER IN (
                                                'inline', 'notification', 'toast', 'panel'
                                            )),

    -- Confidence and usage tracking
    CONFIDENCE              FLOAT           DEFAULT 0.7 CHECK (CONFIDENCE >= 0 AND CONFIDENCE <= 1),
    USAGE_COUNT             INTEGER         DEFAULT 0 CHECK (USAGE_COUNT >= 0),
    SUCCESS_COUNT           INTEGER         DEFAULT 0 CHECK (SUCCESS_COUNT >= 0),
    LAST_USED_AT            TIMESTAMP_NTZ,

    -- Audit fields
    CREATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    STATUS                  STRING          DEFAULT 'active'
                                CHECK (STATUS IN ('active', 'inactive', 'archived')),

    CONSTRAINT PK_TBL_FIR_AGENT_RECOMMENDATIONS PRIMARY KEY (AGENT_RECOMMENDATION_ID)
)
COMMENT = 'Agent-specific recommendations formatted for direct injection into learning_context with trigger conditions.';
-- ============================================================
-- TBL_SEMANTIC_VIEW_VERSIONS - Curated Semantic View Versioning
-- Tracks semantic view evolution: RAW → CURATED_V1 → CURATED_V2 → ...
-- Stores business understanding extracted from user feedback and mappings.
-- ============================================================

CREATE OR REPLACE TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS (
    -- Version identification
    VERSION_ID              STRING          NOT NULL,
    SEMANTIC_VIEW_FQN       STRING          NOT NULL,
    VERSION_NUMBER          INTEGER         NOT NULL CHECK (VERSION_NUMBER >= 0),
    VERSION_LABEL           STRING          NOT NULL
                                CHECK (VERSION_LABEL = 'RAW' OR VERSION_LABEL LIKE 'CURATED_V%'),

    -- Lineage
    PARENT_VERSION_ID       STRING,
    PROMOTION_REASON        STRING,

    -- Semantic content (VARIANT for flexible schema)
    BUSINESS_GLOSSARY       VARIANT,
    RELATIONSHIP_RULES      VARIANT,
    TRANSFORMATION_PATTERNS VARIANT,
    COLUMN_SEMANTICS        VARIANT,
    DERIVED_SOURCE_PATTERNS VARIANT,

    -- Question and answer pairs from feedback/inference cycles
    QA_PAIRS                VARIANT,
    AGENT_NOTES             VARCHAR,

    -- Learning sources (traceability)
    LEARNING_SOURCES        VARIANT,
    MAPPING_EXECUTION_IDS   VARIANT,
    PROCESSING_RULE_IDS     VARIANT,

    -- Confidence and validation
    CONFIDENCE              FLOAT           DEFAULT 0.5 CHECK (CONFIDENCE >= 0 AND CONFIDENCE <= 1),
    VALIDATION_STATUS       STRING          DEFAULT 'pending'
                                CHECK (VALIDATION_STATUS IN ('pending', 'validated', 'rejected')),

    -- Context
    SEMANTIC_BUNDLE_ID      STRING,
    PROJECT_IDS             VARIANT,

    -- Audit fields
    CREATED_BY              STRING,
    CREATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    STATUS                  STRING          DEFAULT 'active'
                                CHECK (STATUS IN ('active', 'superseded', 'archived')),

    CONSTRAINT PK_TBL_SEMANTIC_VIEW_VERSIONS PRIMARY KEY (VERSION_ID),
    CONSTRAINT UQ_SEMANTIC_VERSION UNIQUE (SEMANTIC_VIEW_FQN, VERSION_NUMBER)
)
COMMENT = 'Versioned curated semantic views tracking business understanding evolution: RAW → CURATED_V1 → CURATED_V2 → ...';
-- ============================================================
-- FIR System Streams
-- Change detection streams for triggering batch FIR processing.
-- These streams capture inserts/updates/deletes on source tables.
-- ============================================================

-- Stream on feedback table (explicit user feedback)
CREATE OR REPLACE STREAM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_WORKBENCH_FEEDBACK
ON TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_FEEDBACK
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures explicit user feedback (thumbs up/down, option selection) for FIR processing.';

-- Stream on STTM attributes (mapping changes)
CREATE OR REPLACE STREAM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_STTM_ATTRIBUTES
ON TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_STTM_ATTRIBUTES
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures mapping attribute changes (AI vs user-modified vs manual) for FIR processing.';

-- Stream on derived sources (implicit feedback)
CREATE OR REPLACE STREAM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_DERIVED_SOURCES
ON TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_DERIVED_SOURCES
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures derived source creation/modification for FIR processing.';

-- Stream on semantic table views (semantic evolution)
CREATE OR REPLACE STREAM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_SEM_TABLE_VIEWS
ON TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures semantic view changes for FIR semantic evolution tracking.';

-- Stream on conversation turns (conversation feedback)
CREATE OR REPLACE STREAM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_CONVERSATION_TURNS
ON TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_CONVERSATION_TURNS
APPEND_ONLY = TRUE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures conversation history with agents for FIR conversation learning.';

-- Stream on STTM versions (publish events - high confidence)
CREATE OR REPLACE STREAM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_STTM_VERSIONS
ON TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_STTM_VERSIONS
APPEND_ONLY = TRUE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures STTM publish events for high-confidence FIR learning.';

-- Stream on client SQL assets (uploaded SQL scripts, Excel mapping imports)
CREATE OR REPLACE STREAM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_CLIENT_SQL_ASSETS
ON TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_CLIENT_SQL_ASSETS
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures uploaded SQL scripts and Excel mapping imports for FIR document learning.';

-- Stream on inferences table (track inference generation)
CREATE OR REPLACE STREAM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_INFERENCES
ON TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_INFERENCES
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures inference generation for FIR recommendation triggering.';

-- Stream on FIR 360 table (track processing stage changes)
CREATE OR REPLACE STREAM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_360_CHANGES
ON TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures FIR 360 record changes for downstream processing.';

-- Stream on column-level semantic views (column semantic evolution)
CREATE OR REPLACE STREAM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_SEM_COLUMN_VIEWS
ON TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SEM_COLUMN_VIEWS
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures column-level semantic view changes for FIR pre-computation triggering.';

-- Stream on semantic view versions (curated version creation triggers re-computation)
CREATE OR REPLACE STREAM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_SEMANTIC_VERSIONS
ON TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS
APPEND_ONLY = TRUE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures new curated semantic versions to trigger FIR recommendation re-generation.';

-- Stream on recommendations table (delivers APP_USER_NOTIFICATION to signal bus)
CREATE OR REPLACE STREAM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_RECOMMENDATIONS
ON TABLE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS
APPEND_ONLY = TRUE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures new recommendations for notification bridge delivery to users via WebSocket.';
-- ============================================================
-- SP_FIR_COLLECT_FEEDBACK
-- Collects and normalizes all feedback sources into TBL_AGENT_FIR_360.
-- Processes streams to extract feedback from multiple sources.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_COLLECT_FEEDBACK()
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
        ('document_upload', 'document.sql_upload'): 0.88,
        ('document_upload', 'document.excel_upload'): 0.88,
        ('document_upload', 'document.csv_upload'): 0.85,
    }
    return confidence_map.get((source_type, event_type), 0.5)


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
            FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_WORKBENCH_FEEDBACK
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
                MERGE INTO FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360 target
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
            FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_STTM_ATTRIBUTES
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
                MERGE INTO FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360 target
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
            FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_DERIVED_SOURCES
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
                MERGE INTO FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360 target
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
            FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_SEM_TABLE_VIEWS
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
                MERGE INTO FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360 target
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
            FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_CONVERSATION_TURNS
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
                MERGE INTO FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360 target
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
            FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_STTM_VERSIONS
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
                MERGE INTO FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360 target
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
            FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_CLIENT_SQL_ASSETS
            WHERE STATUS = 'active'
        """).collect()

        for row in stream_data:
            sql_kind = row['SQL_KIND'] or 'historical_mapping'

            if sql_kind in ('historical_mapping', 'etl_script', 'transformation'):
                event_type = 'document.sql_upload'
            elif sql_kind in ('excel_import', 'csv_import'):
                event_type = 'document.excel_upload'
            else:
                event_type = 'document.sql_upload'

            fir_record_id = str(uuid.uuid4())
            entity_ids_raw = row['ENTITY_IDS']
            entity_ids_list = entity_ids_raw if isinstance(entity_ids_raw, list) else [row['SQL_ASSET_ID']]
            record_key = _generate_record_key('document_upload', event_type, entity_ids_list, row['AUTHOR_NAME'], None)

            sql_text = row['SQL_TEXT'] or ''
            sql_preview = sql_text[:2000] if len(sql_text) > 2000 else sql_text

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
                'attributes': row['ATTRIBUTES'],
            }

            confidence = _get_initial_confidence('document_upload', event_type)

            session.sql("""
                MERGE INTO FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360 target
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
-- ============================================================
-- SP_FIR_GENERATE_INFERENCES
-- Generates inferences from collected feedback in TBL_AGENT_FIR_360.
-- Creates typed inferences with full lineage.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_GENERATE_INFERENCES(
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
            'tables_referenced': attrs.get('tables_referenced', feedback_payload.get('tables_referenced')),
            'columns_mapped': attrs.get('columns_mapped', feedback_payload.get('columns_mapped')),
            'transformations_found': attrs.get('transformations_found', feedback_payload.get('transformations_found')),
            'join_patterns': attrs.get('join_patterns', feedback_payload.get('join_patterns')),
            'business_rules': attrs.get('business_rules', feedback_payload.get('business_rules')),
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
            FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
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
                    MERGE INTO FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_INFERENCES target
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
                    UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
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
                    UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
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
-- ============================================================
-- SP_FIR_GENERATE_RECOMMENDATIONS
-- Generates agent-specific recommendations from inferences.
-- Creates pre-formatted payloads for each target agent.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_GENERATE_RECOMMENDATIONS(
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
        ('mapping_feedback', 'mapping.accept', 'mapping_pattern'): 'on_mapping_start',
        ('mapping_feedback', 'mapping.edit', 'mapping_correction'): 'on_mapping_start',
        ('mapping_feedback', 'sttm.publish', 'mapping_pattern'): 'on_project_create',
        ('implicit', 'derived_source.create', 'derived_source_pattern'): 'on_derived_source_select',
        ('implicit', 'derived_source.update', 'derived_source_pattern'): 'on_derived_source_select',
        ('implicit', 'semantic_view.update', 'semantic_evolution'): 'on_source_selection',
        ('explicit', 'conversation.feedback', 'explicit_feedback'): 'on_conversation_start',
        ('conversation', 'conversation.turn', 'conversation_pattern'): 'on_conversation_start',
        ('document_upload', 'document.sql_upload', 'document_sql_pattern'): 'on_mapping_start',
        ('document_upload', 'document.excel_upload', 'document_mapping_pattern'): 'on_mapping_start',
        ('document_upload', 'document.csv_upload', 'document_pattern'): 'on_mapping_start',
    }

    return trigger_map.get((source_type, event_type, inference_type), 'on_mapping_execute')


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
            FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
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
                filters = _get_applicable_filters(inference_payload, business_understanding)

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

                    session.sql("""
                        INSERT INTO FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS (
                            AGENT_RECOMMENDATION_ID, FIR_RECORD_ID, TARGET_AGENT,
                            TRIGGER_TYPE, RECOMMENDATION_TYPE, RECOMMENDATION_PRIORITY,
                            AGENT_PAYLOAD,
                            APPLICABLE_PROJECTS, APPLICABLE_TABLES, APPLICABLE_COLUMNS,
                            CONFIDENCE, STATUS,
                            CREATED_AT, UPDATED_AT
                        )
                        SELECT
                            ?, ?, ?,
                            ?, ?, ?,
                            PARSE_JSON(?),
                            PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?),
                            ?, 'active',
                            CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
                    """, [
                        rec_id, row['FIR_RECORD_ID'], agent,
                        trigger_type, recommendation_type, priority,
                        json.dumps(agent_payload),
                        json.dumps([row['PROJECT_ID']]) if row['PROJECT_ID'] else None,
                        json.dumps(filters['applicable_tables']),
                        json.dumps(filters['applicable_columns']),
                        row['INITIAL_CONFIDENCE'] or 0.5
                    ]).collect()

                    recommendation_ids.append(rec_id)

                    results['recommendations_by_agent'][agent] = results['recommendations_by_agent'].get(agent, 0) + 1

                results['recommendations_by_type'][recommendation_type] = results['recommendations_by_type'].get(recommendation_type, 0) + 1

                first_rec_id = recommendation_ids[0] if recommendation_ids else None
                session.sql("""
                    UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
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
                    UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
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
-- ============================================================
-- SP_FIR_GET_AGENT_RECOMMENDATIONS
-- Retrieves formatted recommendations for a specific agent and trigger.
-- Called by other agents to get FIR recommendations for learning_context.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_GET_AGENT_RECOMMENDATIONS(
    "AGENT_NAME" VARCHAR,
    "TRIGGER_TYPE" VARCHAR,
    "CONTEXT" VARIANT
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'get_recommendations'
EXECUTE AS CALLER
AS
$$
import json
from datetime import datetime
from typing import Any, List, Dict, Optional


def _extract_context_filters(context: dict) -> dict:
    """Extract filtering criteria from the provided context."""
    return {
        'project_id': context.get('project_id'),
        'table_names': context.get('table_names', []),
        'column_names': context.get('column_names', []),
        'sttm_id': context.get('sttm_id'),
        'semantic_bundle_id': context.get('semantic_bundle_id'),
        'max_results': context.get('max_results', 10),
        'min_confidence': context.get('min_confidence', 0.3),
        'include_archived': context.get('include_archived', False)
    }


def _build_query(agent_name: str, trigger_type: str, filters: dict) -> str:
    """Build the SQL query with live scoring: confidence * usage_factor * recency * ML boost."""
    base_query = """
        SELECT
            r.AGENT_RECOMMENDATION_ID,
            r.FIR_RECORD_ID,
            r.TARGET_AGENT,
            r.TRIGGER_TYPE,
            r.RECOMMENDATION_TYPE,
            r.RECOMMENDATION_PRIORITY,
            r.AGENT_PAYLOAD,
            r.APPLICABLE_PROJECTS,
            r.APPLICABLE_TABLES,
            r.APPLICABLE_COLUMNS,
            r.CONFIDENCE,
            r.USAGE_COUNT,
            r.SUCCESS_COUNT,
            r.CREATED_AT,
            LEAST(100, GREATEST(1, ROUND(
                (COALESCE(r.CONFIDENCE, 0.5) * 100)
                * (1.0 + LN(1 + COALESCE(r.SUCCESS_COUNT, 0)) / LN(1 + GREATEST(COALESCE(r.USAGE_COUNT, 0), 1)))
                * POWER(0.95, DATEDIFF('day', r.CREATED_AT, CURRENT_TIMESTAMP()) / 30.0)
                * (0.5 + 0.5 * COALESCE(m.RECOMMENDATION_HELPFULNESS_PROBABILITY, 0.5))
            ))) AS COMPUTED_SCORE
        FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS r
        LEFT JOIN FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_FIR_MODEL_SCORES m
            ON r.AGENT_RECOMMENDATION_ID = m.ENTITY_ID
            AND m.ENTITY_TYPE = 'recommendation'
            AND m.UPDATED_AT > DATEADD('day', -7, CURRENT_TIMESTAMP())
        WHERE r.TARGET_AGENT = '{agent_name}'
          AND r.TRIGGER_TYPE = '{trigger_type}'
          AND r.CONFIDENCE >= {min_confidence}
    """.format(
        agent_name=agent_name,
        trigger_type=trigger_type,
        min_confidence=filters['min_confidence']
    )

    if not filters['include_archived']:
        base_query += " AND r.STATUS = 'active'"

    if filters.get('table_names'):
        tables_array = "ARRAY_CONSTRUCT(" + ",".join(
            f"'{t}'" for t in filters['table_names']
        ) + ")"
        base_query += f" AND ARRAYS_OVERLAP(r.APPLICABLE_TABLES, {tables_array})"

    base_query += """
        ORDER BY COMPUTED_SCORE DESC, r.RECOMMENDATION_PRIORITY DESC, r.CREATED_AT DESC
        LIMIT {max_results}
    """.format(max_results=filters['max_results'])

    return base_query


def _filter_by_applicability(recommendations: list, filters: dict) -> list:
    """Filter recommendations based on project, table, and column applicability."""
    filtered = []

    for rec in recommendations:
        applicable_projects = rec.get('applicable_projects')
        applicable_tables = rec.get('applicable_tables')
        applicable_columns = rec.get('applicable_columns')

        project_match = True
        if applicable_projects and filters['project_id']:
            project_match = filters['project_id'] in applicable_projects

        table_match = True
        if applicable_tables and filters['table_names']:
            table_match = any(t in applicable_tables for t in filters['table_names'])

        column_match = True
        if applicable_columns and filters['column_names']:
            column_match = any(c in applicable_columns for c in filters['column_names'])

        if project_match and table_match and column_match:
            filtered.append(rec)

    return filtered


def _format_for_learning_context(recommendations: list) -> list:
    """Format recommendations for injection into agent learning_context."""
    formatted = []

    for rec in recommendations:
        payload = rec.get('agent_payload', {})
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except:
                payload = {}

        formatted.append({
            'source': 'fir_system',
            'recommendation_id': rec.get('agent_recommendation_id'),
            'type': rec.get('recommendation_type'),
            'priority': rec.get('recommendation_priority'),
            'score': rec.get('computed_score', rec.get('recommendation_priority')),
            'confidence': rec.get('confidence'),
            'payload': payload,
            'usage_stats': {
                'used': rec.get('usage_count', 0),
                'successful': rec.get('success_count', 0)
            }
        })

    return formatted


def _record_usage(session, recommendation_ids: list) -> None:
    """Record that recommendations were retrieved (for usage tracking)."""
    if not recommendation_ids:
        return

    ids_str = ','.join([f"'{rid}'" for rid in recommendation_ids])
    session.sql(f"""
        UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS
        SET USAGE_COUNT = USAGE_COUNT + 1,
            LAST_USED_AT = CURRENT_TIMESTAMP(),
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE AGENT_RECOMMENDATION_ID IN ({ids_str})
    """).collect()


def get_recommendations(session, agent_name: str, trigger_type: str, context: Any) -> dict:
    """Main handler to get recommendations for an agent."""
    results = {
        'status': 'success',
        'agent': agent_name,
        'trigger': trigger_type,
        'recommendations': [],
        'total_found': 0,
        'total_returned': 0,
        'errors': [],
        'retrieved_at': datetime.utcnow().isoformat()
    }

    try:
        if isinstance(context, str):
            context = json.loads(context)
        elif context is None:
            context = {}

        filters = _extract_context_filters(context)

        query = _build_query(agent_name, trigger_type, filters)
        raw_results = session.sql(query).collect()

        recommendations = []
        for row in raw_results:
            rec = {
                'agent_recommendation_id': row['AGENT_RECOMMENDATION_ID'],
                'fir_record_id': row['FIR_RECORD_ID'],
                'target_agent': row['TARGET_AGENT'],
                'trigger_type': row['TRIGGER_TYPE'],
                'recommendation_type': row['RECOMMENDATION_TYPE'],
                'recommendation_priority': row['RECOMMENDATION_PRIORITY'],
                'computed_score': row['COMPUTED_SCORE'],
                'agent_payload': json.loads(row['AGENT_PAYLOAD']) if isinstance(row['AGENT_PAYLOAD'], str) else (row['AGENT_PAYLOAD'] or {}),
                'applicable_projects': json.loads(row['APPLICABLE_PROJECTS']) if isinstance(row['APPLICABLE_PROJECTS'], str) else (row['APPLICABLE_PROJECTS'] or []),
                'applicable_tables': json.loads(row['APPLICABLE_TABLES']) if isinstance(row['APPLICABLE_TABLES'], str) else (row['APPLICABLE_TABLES'] or []),
                'applicable_columns': json.loads(row['APPLICABLE_COLUMNS']) if isinstance(row['APPLICABLE_COLUMNS'], str) else (row['APPLICABLE_COLUMNS'] or []),
                'confidence': row['CONFIDENCE'],
                'usage_count': row['USAGE_COUNT'],
                'success_count': row['SUCCESS_COUNT'],
                'created_at': str(row['CREATED_AT']) if row['CREATED_AT'] else None
            }
            recommendations.append(rec)

        results['total_found'] = len(recommendations)

        filtered = _filter_by_applicability(recommendations, filters)

        formatted = _format_for_learning_context(filtered)

        _record_usage(session, [r['agent_recommendation_id'] for r in filtered])

        results['recommendations'] = formatted
        results['total_returned'] = len(formatted)

    except Exception as e:
        results['status'] = 'failed'
        results['errors'].append(str(e))

    return results
$$;


-- ============================================================
-- SP_FIR_RECORD_RECOMMENDATION_SUCCESS
-- Records that a recommendation was successfully used.
-- Called after an agent uses a recommendation and user accepts.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_RECORD_RECOMMENDATION_SUCCESS(
    "RECOMMENDATION_ID" VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
BEGIN
    UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS
    SET SUCCESS_COUNT = SUCCESS_COUNT + 1,
        UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE AGENT_RECOMMENDATION_ID = :RECOMMENDATION_ID;

    RETURN OBJECT_CONSTRUCT(
        'status', 'success',
        'recommendation_id', :RECOMMENDATION_ID,
        'updated_at', CURRENT_TIMESTAMP()::STRING
    );
END;
$$;
-- ============================================================
-- SP_FIR_INVOKE_AGENT
-- Bridge procedure called by Snowflake Tasks to invoke AGT_FIR_SYSTEM.
-- Gathers stream state, builds context, and calls the agent.
-- The agent then uses its tools (procedures + cortex search) to
-- intelligently process feedback, parse documents, generate inferences,
-- and create recommendations.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_INVOKE_AGENT(
    "TASK_PAYLOAD" VARIANT DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'invoke_agent'
EXECUTE AS CALLER
AS
$$
import json
import _snowflake
from datetime import datetime


def _current_namespace(session):
    row = session.sql("SELECT CURRENT_DATABASE() AS DB, CURRENT_SCHEMA() AS SCH").collect()[0]
    return str(row["DB"]), str(row["SCH"])


def _check_streams(session, namespace):
    """Check which streams have data to build context for the agent."""
    streams = [
        'STM_FIR_WORKBENCH_FEEDBACK',
        'STM_FIR_STTM_ATTRIBUTES',
        'STM_FIR_DERIVED_SOURCES',
        'STM_FIR_SEM_TABLE_VIEWS',
        'STM_FIR_CONVERSATION_TURNS',
        'STM_FIR_STTM_VERSIONS',
        'STM_FIR_CLIENT_SQL_ASSETS',
    ]
    streams_with_data = []
    for stream_name in streams:
        try:
            result = session.sql(
                f"SELECT SYSTEM$STREAM_HAS_DATA('{namespace}.{stream_name}') AS HAS_DATA"
            ).collect()
            if result and str(result[0]['HAS_DATA']).lower() == 'true':
                streams_with_data.append(stream_name)
        except Exception:
            pass
    return streams_with_data


def _get_pending_counts(session, namespace):
    """Get counts of pending records at each processing stage."""
    counts = {}
    try:
        rows = session.sql(f"""
            SELECT PROCESSING_STAGE, COUNT(*) AS CNT
            FROM {namespace}.TBL_AGENT_FIR_360
            WHERE PROCESSING_STAGE IN ('pending', 'feedback_collected', 'inference_generated')
            GROUP BY PROCESSING_STAGE
        """).collect()
        for row in rows:
            counts[row['PROCESSING_STAGE']] = row['CNT']
    except Exception:
        pass
    return counts


def _get_unprocessed_documents(session, namespace):
    """Check for documents that haven't been processed by the FIR agent yet."""
    try:
        rows = session.sql(f"""
            SELECT
                a.SQL_ASSET_ID,
                a.TITLE,
                a.SQL_KIND,
                a.DIALECT,
                LENGTH(a.SQL_TEXT) AS SQL_LENGTH,
                a.DESCRIPTION,
                a.CREATED_AT
            FROM {namespace}.TBL_WORKBENCH_CLIENT_SQL_ASSETS a
            LEFT JOIN {namespace}.TBL_AGENT_FIR_360 f
                ON f.SOURCE_TYPE = 'document_upload'
                AND f.FEEDBACK_PAYLOAD:sql_asset_id::STRING = a.SQL_ASSET_ID
            WHERE f.FIR_RECORD_ID IS NULL
              AND a.STATUS = 'active'
            ORDER BY a.CREATED_AT DESC
            LIMIT 20
        """).collect()
        return [
            {
                'sql_asset_id': row['SQL_ASSET_ID'],
                'title': row['TITLE'],
                'sql_kind': row['SQL_KIND'],
                'dialect': row['DIALECT'],
                'sql_length': row['SQL_LENGTH'],
                'description': row['DESCRIPTION'],
                'created_at': str(row['CREATED_AT']) if row['CREATED_AT'] else None
            }
            for row in rows
        ]
    except Exception:
        return []


def _get_recent_activity_summary(session, namespace):
    """Get summary of recent FIR activity for agent context."""
    summary = {}
    try:
        rows = session.sql(f"""
            SELECT SOURCE_TYPE, COUNT(*) AS CNT
            FROM {namespace}.TBL_AGENT_FIR_360
            WHERE CREATED_AT > DATEADD('hour', -24, CURRENT_TIMESTAMP())
            GROUP BY SOURCE_TYPE
        """).collect()
        summary['last_24h_by_source'] = {row['SOURCE_TYPE']: row['CNT'] for row in rows}
    except Exception:
        pass

    try:
        rows = session.sql(f"""
            SELECT COUNT(*) AS CNT
            FROM {namespace}.TBL_FIR_AGENT_RECOMMENDATIONS
            WHERE STATUS = 'active'
        """).collect()
        summary['active_recommendations'] = rows[0]['CNT'] if rows else 0
    except Exception:
        pass

    return summary


def invoke_agent(session, task_payload=None) -> dict:
    """Main handler: builds context and invokes AGT_FIR_SYSTEM."""
    current_database, current_schema = _current_namespace(session)
    namespace = f"{current_database}.{current_schema}"

    result = {
        'status': 'success',
        'agent_invoked': False,
        'agent_response': None,
        'context_built': {},
        'started_at': datetime.utcnow().isoformat(),
        'errors': []
    }

    try:
        # Build context for the agent
        streams_with_data = _check_streams(session, namespace)
        pending_counts = _get_pending_counts(session, namespace)
        unprocessed_docs = _get_unprocessed_documents(session, namespace)
        activity_summary = _get_recent_activity_summary(session, namespace)

        # Parse task payload
        payload_opts = {}
        if task_payload:
            if isinstance(task_payload, str):
                try:
                    payload_opts = json.loads(task_payload)
                except Exception:
                    pass
            else:
                payload_opts = dict(task_payload) if task_payload else {}

        # Determine what work needs to be done
        task_type = payload_opts.get('task_type', 'stream_triggered')
        has_stream_data = len(streams_with_data) > 0
        has_pending_records = sum(pending_counts.values()) > 0
        has_unprocessed_docs = len(unprocessed_docs) > 0

        # Manual, document_learning, and semantic_precomputation tasks always proceed
        force_run = task_type in ('manual', 'document_learning', 'semantic_precomputation')

        if not force_run and not has_stream_data and not has_pending_records and not has_unprocessed_docs:
            result['status'] = 'no_work'
            result['context_built'] = {
                'streams_checked': 7,
                'streams_with_data': 0,
                'pending_records': 0,
                'unprocessed_documents': 0
            }
            return result

        # Build the agent message with full context
        processing_options = payload_opts.get('processing_options', {
            'collect_feedback': True,
            'generate_inferences': True,
            'create_semantic_versions': True,
            'generate_recommendations': True,
            'apply_decay': False,
            'parse_documents': has_unprocessed_docs
        })

        base_instructions = (
            'Process the FIR pipeline based on the context provided. '
            'Streams with data indicate new user activity to collect. '
            'Pending records need inference generation and recommendation creation. '
            'Unprocessed documents need to be read with ReadDocuments, '
            'analyzed for mapping patterns, transformations, join logic, '
            'and business rules, then fed into the pipeline as document_upload feedback. '
            'Use SearchFIRInferences to check for duplicates before creating new inferences. '
            'Use SearchFIRRecommendations to avoid duplicate recommendations. '
            'For each document, deeply parse the SQL to extract: '
            '1. Tables referenced (source and target) '
            '2. Column mappings (which source columns map to which target columns) '
            '3. Transformation patterns (CASE, CAST, CONCAT, date functions, etc.) '
            '4. Join patterns (how tables are related) '
            '5. Business rules (WHERE clauses, CASE logic that encodes business meaning) '
            '6. Data quality patterns (TRIM, UPPER, COALESCE for nulls) '
            'Store all extracted knowledge as rich inferences that other agents can use.'
        )

        if task_type == 'document_learning':
            base_instructions += (
                ' PRIORITY: This is a document_learning run triggered by user uploading a file '
                'and choosing "Use as Highest-Priority Learning". Process ALL unprocessed documents '
                'immediately. Generate comprehensive recommendations for ALL agents covering every '
                'pattern found. Also run Phase 2.5 (Semantic Pre-computation) for tables mentioned '
                'in the document. The user is waiting for this to complete — be thorough but efficient.'
            )
            priority_asset = processing_options.get('priority_asset_id')
            if priority_asset:
                base_instructions += f' Priority asset ID: {priority_asset}.'

        agent_message = {
            'task_type': task_type,
            'streams_with_data': streams_with_data,
            'pending_counts': pending_counts,
            'unprocessed_documents': unprocessed_docs,
            'activity_summary': activity_summary,
            'batch_size': payload_opts.get('batch_size', 100),
            'processing_options': processing_options,
            'instructions': base_instructions,
        }

        if payload_opts.get('precomputation_context'):
            agent_message['precomputation_context'] = payload_opts['precomputation_context']

        result['context_built'] = {
            'streams_with_data': streams_with_data,
            'pending_counts': pending_counts,
            'unprocessed_document_count': len(unprocessed_docs),
            'activity_summary': activity_summary
        }

        # Invoke the agent
        agent_payload = {
            'models': {'orchestration': 'claude-sonnet-4-6'},
            'messages': [
                {
                    'role': 'user',
                    'content': [{'type': 'text', 'text': json.dumps(agent_message)}]
                }
            ],
            'stream': False
        }

        response = _snowflake.send_snow_api_request(
            'POST',
            f'/api/v2/databases/{current_database}/schemas/{current_schema}/agents/AGT_FIR_SYSTEM:run',
            {},
            {},
            agent_payload,
            None,
            300000  # 5 minute timeout for batch processing
        )

        result['agent_invoked'] = True

        if response is None:
            result['status'] = 'agent_error'
            result['errors'].append('Null response from Cortex Agent API')
            return result

        status_code = response.get('status', 0)
        body_raw = response.get('content', '{}')
        body = body_raw if isinstance(body_raw, dict) else json.loads(body_raw)

        if status_code not in (200, 201):
            result['status'] = 'agent_error'
            result['errors'].append(f'Agent HTTP {status_code}: {json.dumps(body)[:500]}')
            return result

        # Extract agent response text
        agent_text = ''
        content_blocks = body.get('content', [])
        for block in content_blocks:
            if isinstance(block, dict) and block.get('type') == 'text':
                agent_text = block.get('text', '')
                break

        # Try to parse as JSON (agent should return structured response)
        try:
            result['agent_response'] = json.loads(agent_text)
        except Exception:
            result['agent_response'] = {'raw_text': agent_text[:2000]}

        result['completed_at'] = datetime.utcnow().isoformat()

    except Exception as e:
        result['status'] = 'failed'
        result['errors'].append(str(e))

    return result
$$;
-- ============================================================
-- SP_FIR_ORCHESTRATE_BATCH
-- Main orchestration procedure called by Snowflake Task.
-- Coordinates the full FIR processing pipeline.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_ORCHESTRATE_BATCH(
    "TASK_PAYLOAD" VARIANT
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'orchestrate_batch'
EXECUTE AS OWNER
AS
$$
import json
from datetime import datetime
from typing import Any, Dict


def orchestrate_batch(session, task_payload: Any) -> dict:
    """Main orchestration handler for FIR batch processing."""

    if isinstance(task_payload, str):
        task_payload = json.loads(task_payload)
    elif task_payload is None:
        task_payload = {}

    task_type = task_payload.get('task_type', 'scheduled_batch')
    batch_size = task_payload.get('batch_size', 100)
    processing_options = task_payload.get('processing_options', {})

    collect_feedback = processing_options.get('collect_feedback', True)
    generate_inferences = processing_options.get('generate_inferences', True)
    create_semantic_versions = processing_options.get('create_semantic_versions', True)
    generate_recommendations = processing_options.get('generate_recommendations', True)
    apply_decay = processing_options.get('apply_decay', False)

    results = {
        'task_type': task_type,
        'status': 'completed',
        'processing_summary': {
            'feedback_collected': 0,
            'inferences_generated': 0,
            'semantic_versions_created': 0,
            'recommendations_generated': 0,
            'decay_applied': False
        },
        'phase_details': {
            'collect_feedback': {'processed': 0, 'errors': []},
            'generate_inferences': {'processed': 0, 'errors': []},
            'create_semantic_versions': {'created': [], 'errors': []},
            'generate_recommendations': {'processed': 0, 'by_agent': {}, 'errors': []},
            'apply_decay': {'records_updated': 0, 'errors': []}
        },
        'next_run_hints': {
            'pending_feedback_count': 0,
            'suggested_batch_size': batch_size
        },
        'errors': [],
        'warnings': [],
        'started_at': datetime.utcnow().isoformat(),
        'completed_at': None
    }

    try:
        # Phase 1: Collect Feedback
        if collect_feedback:
            try:
                feedback_result = session.call('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_COLLECT_FEEDBACK')
                if isinstance(feedback_result, str):
                    feedback_result = json.loads(feedback_result)

                results['phase_details']['collect_feedback']['processed'] = feedback_result.get('total_collected', 0)
                results['phase_details']['collect_feedback']['errors'] = feedback_result.get('errors', [])
                results['processing_summary']['feedback_collected'] = feedback_result.get('total_collected', 0)

                if feedback_result.get('errors'):
                    results['warnings'].extend([f"Feedback: {e}" for e in feedback_result['errors']])

            except Exception as e:
                results['phase_details']['collect_feedback']['errors'].append(str(e))
                results['warnings'].append(f"Feedback collection failed: {str(e)}")

        # Phase 2: Generate Inferences
        if generate_inferences:
            try:
                inference_result = session.call('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_GENERATE_INFERENCES', batch_size)
                if isinstance(inference_result, str):
                    inference_result = json.loads(inference_result)

                results['phase_details']['generate_inferences']['processed'] = inference_result.get('total_generated', 0)
                results['phase_details']['generate_inferences']['errors'] = inference_result.get('errors', [])
                results['processing_summary']['inferences_generated'] = inference_result.get('total_generated', 0)

                if inference_result.get('errors'):
                    results['warnings'].extend([f"Inference: {e}" for e in inference_result['errors']])

            except Exception as e:
                results['phase_details']['generate_inferences']['errors'].append(str(e))
                results['warnings'].append(f"Inference generation failed: {str(e)}")

        # Phase 3: Create Semantic Versions (for tables with significant new inferences)
        if create_semantic_versions:
            try:
                tables_with_inferences = session.sql("""
                    SELECT DISTINCT
                        inf.INFERENCE_PAYLOAD:business_understanding:semantic_change:view_fqn::STRING AS view_fqn
                    FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360 fir
                    JOIN FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_INFERENCES inf
                        ON fir.INFERENCE_ID = inf.INFERENCE_ID
                    WHERE fir.PROCESSING_STAGE IN ('inference_generated', 'completed')
                      AND inf.INFERENCE_TYPE = 'semantic_evolution'
                      AND fir.CREATED_AT > DATEADD('hour', -24, CURRENT_TIMESTAMP())
                      AND inf.INFERENCE_PAYLOAD:business_understanding:semantic_change:view_fqn IS NOT NULL
                    LIMIT 10
                """).collect()

                for row in tables_with_inferences:
                    view_fqn = row['VIEW_FQN']
                    if view_fqn:
                        try:
                            version_result = session.call(
                                'FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_CREATE_SEMANTIC_VERSION',
                                view_fqn,
                                None
                            )
                            if isinstance(version_result, str):
                                version_result = json.loads(version_result)

                            if version_result.get('status') == 'success':
                                results['phase_details']['create_semantic_versions']['created'].append({
                                    'view_fqn': view_fqn,
                                    'version_id': version_result.get('version_id'),
                                    'version_label': version_result.get('version_label')
                                })
                                results['processing_summary']['semantic_versions_created'] += 1
                        except Exception as e:
                            results['phase_details']['create_semantic_versions']['errors'].append(f"{view_fqn}: {str(e)}")

            except Exception as e:
                results['phase_details']['create_semantic_versions']['errors'].append(str(e))
                results['warnings'].append(f"Semantic version creation failed: {str(e)}")

        # Phase 4: Generate Recommendations
        if generate_recommendations:
            try:
                rec_result = session.call('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_GENERATE_RECOMMENDATIONS', batch_size)
                if isinstance(rec_result, str):
                    rec_result = json.loads(rec_result)

                results['phase_details']['generate_recommendations']['processed'] = rec_result.get('total_generated', 0)
                results['phase_details']['generate_recommendations']['by_agent'] = rec_result.get('recommendations_by_agent', {})
                results['phase_details']['generate_recommendations']['errors'] = rec_result.get('errors', [])
                results['processing_summary']['recommendations_generated'] = rec_result.get('total_generated', 0)

                if rec_result.get('errors'):
                    results['warnings'].extend([f"Recommendation: {e}" for e in rec_result['errors']])

            except Exception as e:
                results['phase_details']['generate_recommendations']['errors'].append(str(e))
                results['warnings'].append(f"Recommendation generation failed: {str(e)}")

        # Phase 5: Apply Confidence Decay (optional, usually done by separate daily task)
        if apply_decay:
            try:
                decay_result = session.call('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_APPLY_CONFIDENCE_DECAY')
                if isinstance(decay_result, str):
                    decay_result = json.loads(decay_result)

                results['phase_details']['apply_decay']['records_updated'] = (
                    decay_result.get('fir_360_records_updated', 0) +
                    decay_result.get('recommendations_updated', 0)
                )
                results['processing_summary']['decay_applied'] = True

            except Exception as e:
                results['phase_details']['apply_decay']['errors'].append(str(e))
                results['warnings'].append(f"Confidence decay failed: {str(e)}")

        # Calculate next run hints
        pending_count_result = session.sql("""
            SELECT COUNT(*) AS cnt
            FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
            WHERE PROCESSING_STAGE = 'pending'
        """).collect()

        results['next_run_hints']['pending_feedback_count'] = pending_count_result[0]['CNT'] if pending_count_result else 0

        if results['next_run_hints']['pending_feedback_count'] > batch_size * 2:
            results['next_run_hints']['suggested_batch_size'] = min(500, batch_size * 2)

        # Determine overall status
        all_errors = []
        for phase, details in results['phase_details'].items():
            if details.get('errors'):
                all_errors.extend(details['errors'])

        if all_errors:
            results['errors'] = all_errors
            total_processed = (
                results['processing_summary']['feedback_collected'] +
                results['processing_summary']['inferences_generated'] +
                results['processing_summary']['recommendations_generated']
            )
            if total_processed == 0:
                results['status'] = 'failed'
            else:
                results['status'] = 'partial'

    except Exception as e:
        results['status'] = 'failed'
        results['errors'].append(str(e))

    results['completed_at'] = datetime.utcnow().isoformat()

    return results
$$;
-- ============================================================
-- SP_FIR_STORE_INFERENCE
-- Thin CRUD tool for AGT_FIR_SYSTEM: stores the agent's inference analysis.
-- The agent provides ALL content (type, summary, understanding, reasoning).
-- This procedure just writes to the database.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_STORE_INFERENCE(
    "FIR_RECORD_ID" VARCHAR,
    "INFERENCE_TYPE" VARCHAR,
    "SUMMARY" VARCHAR,
    "BUSINESS_UNDERSTANDING" VARCHAR,
    "CONFIDENCE" FLOAT,
    "AGENT_NOTES" VARCHAR,
    "AGENT_REASONING_PAYLOAD" VARCHAR DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'store_inference'
EXECUTE AS OWNER
AS
$$
import json
import uuid
from datetime import datetime


def store_inference(
    session,
    fir_record_id: str,
    inference_type: str,
    summary: str,
    business_understanding: str,
    confidence: float,
    agent_notes: str,
    agent_reasoning_payload: str = None
) -> dict:
    """Store the agent's inference analysis into TBL_AGENT_FIR_360 and TBL_WORKBENCH_INFERENCES."""

    inference_id = str(uuid.uuid4())

    # Parse the business_understanding JSON string
    try:
        bu_parsed = json.loads(business_understanding) if business_understanding else {}
    except (json.JSONDecodeError, TypeError):
        bu_parsed = {'raw': business_understanding}

    # Parse agent_reasoning_payload if provided
    try:
        reasoning_parsed = json.loads(agent_reasoning_payload) if agent_reasoning_payload else None
    except (json.JSONDecodeError, TypeError):
        reasoning_parsed = {'raw': agent_reasoning_payload}

    inference_payload = {
        'inference_id': inference_id,
        'inference_type': inference_type,
        'summary': summary,
        'confidence': confidence,
        'business_understanding': bu_parsed,
        'generated_by': 'AGT_FIR_SYSTEM',
        'generated_at': datetime.utcnow().isoformat()
    }

    # Update TBL_AGENT_FIR_360 with inference data
    reasoning_json = json.dumps(reasoning_parsed) if reasoning_parsed else '{}'
    session.sql("""
        UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
        SET INFERENCE_ID = ?,
            INFERENCE_PAYLOAD = PARSE_JSON(?),
            PROCESSING_STAGE = 'inference_generated',
            CURRENT_CONFIDENCE = ?,
            AGENT_NOTES = ?,
            AGENT_REASONING_PAYLOAD = PARSE_JSON(?),
            PROCESSED_BY = 'AGT_FIR_SYSTEM',
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE FIR_RECORD_ID = ?
    """, [
        inference_id,
        json.dumps(inference_payload),
        confidence,
        agent_notes,
        reasoning_json,
        fir_record_id
    ]).collect()

    # Also store in TBL_WORKBENCH_INFERENCES for Cortex Search indexing
    session.sql("""
        INSERT INTO FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_INFERENCES (
            INFERENCE_ID, INFERENCE_KEY, REQUEST_ID, SOURCE,
            INFERENCE_TYPE, SUMMARY, CONFIDENCE,
            ENTITY_TYPE, ATTRIBUTES,
            AGENT_NOTES, STATUS, CREATED_AT, UPDATED_AT
        )
        SELECT ?, ?, ?, 'AGT_FIR_SYSTEM',
               ?, ?, ?,
               ?, PARSE_JSON(?),
               ?, 'active', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
        WHERE NOT EXISTS (
            SELECT 1 FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_INFERENCES
            WHERE INFERENCE_ID = ?
        )
    """, [
        inference_id, f"fir_{fir_record_id}", fir_record_id,
        inference_type, summary, confidence,
        inference_type, json.dumps(bu_parsed),
        agent_notes,
        inference_id
    ]).collect()

    return {
        'status': 'success',
        'inference_id': inference_id,
        'fir_record_id': fir_record_id,
        'inference_type': inference_type,
        'confidence': confidence
    }
$$;
-- ============================================================
-- SP_FIR_STORE_QA_PAIR
-- Stores a question-and-answer pair from user notification responses into
-- the semantic view's QA_HISTORY and the active curated version.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_STORE_QA_PAIR(
    "SEMANTIC_VIEW_FQN" VARCHAR,
    "QUESTION" VARCHAR,
    "ANSWER" VARCHAR,
    "CONFIDENCE" FLOAT,
    "SOURCE_FIR_RECORD_ID" VARCHAR DEFAULT NULL,
    "AGENT_NOTES" VARCHAR DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'store_qa_pair'
EXECUTE AS OWNER
AS
$$
import json
import uuid
from datetime import datetime


def store_qa_pair(
    session,
    semantic_view_fqn: str,
    question: str,
    answer: str,
    confidence: float,
    source_fir_record_id: str = None,
    agent_notes: str = None
) -> dict:
    """Store a question-and-answer pair in QA_HISTORY and the active curated version."""

    qa_id = str(uuid.uuid4())
    qa_pair = {
        'qa_id': qa_id,
        'question': question,
        'answer': answer,
        'confidence': confidence,
        'source_fir_record_id': source_fir_record_id,
        'agent_notes': agent_notes,
        'created_at': datetime.utcnow().isoformat()
    }

    # Update SEM_TABLE_VIEWS.QA_HISTORY (append to array)
    session.sql("""
        UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
        SET QA_HISTORY = ARRAY_APPEND(COALESCE(QA_HISTORY, ARRAY_CONSTRUCT()), PARSE_JSON(?)),
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE TABLE_FQN = ?
    """, [json.dumps(qa_pair), semantic_view_fqn]).collect()

    # Update active curated version's QA_PAIRS
    session.sql("""
        UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS
        SET QA_PAIRS = ARRAY_APPEND(COALESCE(QA_PAIRS, ARRAY_CONSTRUCT()), PARSE_JSON(?)),
            AGENT_NOTES = COALESCE(AGENT_NOTES, '') || '\n[QA] ' || ?,
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE SEMANTIC_VIEW_FQN = ?
          AND STATUS = 'active'
          AND VERSION_LABEL LIKE 'CURATED_%'
    """, [json.dumps(qa_pair), question[:100], semantic_view_fqn]).collect()

    return {
        'status': 'success',
        'qa_id': qa_id,
        'semantic_view_fqn': semantic_view_fqn,
        'question': question[:100],
        'answer': answer[:100]
    }
$$;
-- ============================================================
-- SP_FIR_STORE_RECOMMENDATION
-- Thin CRUD tool for AGT_FIR_SYSTEM: stores the agent's recommendation.
-- The agent provides ALL content (target, trigger, type, payload, display).
-- This procedure just writes to the database.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_STORE_RECOMMENDATION(
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
    "APPLICABLE_COLUMNS" VARCHAR DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'store_recommendation'
EXECUTE AS OWNER
AS
$$
import json
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
    applicable_columns: str = None
) -> dict:
    """Store the agent's crafted recommendation."""

    recommendation_id = str(uuid.uuid4())

    # Parse JSON string parameters
    def _parse_json_safe(val):
        if not val:
            return None
        try:
            return json.loads(val)
        except (json.JSONDecodeError, TypeError):
            return None

    payload_parsed = _parse_json_safe(agent_payload) or {}
    options_parsed = _parse_json_safe(display_options)
    projects_parsed = _parse_json_safe(applicable_projects)
    tables_parsed = _parse_json_safe(applicable_tables)
    columns_parsed = _parse_json_safe(applicable_columns)

    # INSERT into TBL_FIR_AGENT_RECOMMENDATIONS (explicit column list to match table order)
    options_json = json.dumps(options_parsed) if options_parsed else ''
    projects_json = json.dumps(projects_parsed) if projects_parsed else ''
    tables_json = json.dumps(tables_parsed) if tables_parsed else ''
    columns_json = json.dumps(columns_parsed) if columns_parsed else ''

    session.sql("""
        INSERT INTO FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS (
            AGENT_RECOMMENDATION_ID, FIR_RECORD_ID, TARGET_AGENT, TRIGGER_TYPE,
            TRIGGER_CONDITION, RECOMMENDATION_TYPE, RECOMMENDATION_PRIORITY,
            AGENT_PAYLOAD, APPLICABLE_PROJECTS, APPLICABLE_TABLES, APPLICABLE_COLUMNS,
            CONFIDENCE, USAGE_COUNT, SUCCESS_COUNT, LAST_USED_AT,
            CREATED_AT, UPDATED_AT, STATUS,
            AGENT_NOTES, DISPLAY_MESSAGE, DISPLAY_OPTIONS, NOTIFICATION_LAYER
        )
        SELECT
            ?, ?, ?, ?,
            NULL, ?, ?,
            PARSE_JSON(?), TRY_PARSE_JSON(?), TRY_PARSE_JSON(?), TRY_PARSE_JSON(?),
            ?, 0, 0, NULL,
            CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), 'active',
            ?, ?, TRY_PARSE_JSON(?), ?
    """, [
        recommendation_id, fir_record_id, target_agent, trigger_type,
        recommendation_type, priority,
        json.dumps(payload_parsed), projects_json, tables_json, columns_json,
        confidence,
        agent_notes, display_message, options_json, notification_layer
    ]).collect()

    # Update FIR_360 processing stage
    session.sql("""
        UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
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
    }
$$;
-- ============================================================
-- SP_FIR_APPLY_CONFIDENCE_DECAY
-- Applies temporal decay to confidence scores in FIR tables.
-- Decay formula: CURRENT = INITIAL * POWER(DECAY_FACTOR, days/30)
-- Default DECAY_FACTOR = 0.95 (5% decay per 30 days)
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_APPLY_CONFIDENCE_DECAY()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
    fir_360_updated INTEGER DEFAULT 0;
    recommendations_updated INTEGER DEFAULT 0;
    result VARIANT;
BEGIN
    -- Update confidence in TBL_AGENT_FIR_360
    UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
    SET
        CURRENT_CONFIDENCE = INITIAL_CONFIDENCE * POWER(DECAY_FACTOR, DATEDIFF('day', CREATED_AT, CURRENT_TIMESTAMP()) / 30.0),
        LAST_DECAY_AT = CURRENT_TIMESTAMP(),
        UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE PROCESSING_STAGE = 'completed'
      AND INITIAL_CONFIDENCE IS NOT NULL
      AND (
          LAST_DECAY_AT IS NULL
          OR DATEDIFF('day', LAST_DECAY_AT, CURRENT_TIMESTAMP()) >= 1
      );

    fir_360_updated := SQLROWCOUNT;

    -- Update confidence in TBL_FIR_AGENT_RECOMMENDATIONS
    -- Also factor in usage success rate for boosting
    UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS
    SET
        CONFIDENCE = LEAST(1.0,
            -- Base temporal decay
            (CONFIDENCE * POWER(0.95, DATEDIFF('day', CREATED_AT, CURRENT_TIMESTAMP()) / 30.0))
            -- Usage-based boost: +0.05 per successful use (max 0.2 boost)
            + CASE
                WHEN USAGE_COUNT > 0 THEN LEAST(0.2, 0.05 * (SUCCESS_COUNT / USAGE_COUNT) * USAGE_COUNT)
                ELSE 0
              END
        ),
        UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE STATUS = 'active'
      AND DATEDIFF('day', UPDATED_AT, CURRENT_TIMESTAMP()) >= 1;

    recommendations_updated := SQLROWCOUNT;

    -- Archive very old, low-confidence recommendations
    UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS
    SET STATUS = 'archived',
        UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE STATUS = 'active'
      AND CONFIDENCE < 0.1
      AND DATEDIFF('day', CREATED_AT, CURRENT_TIMESTAMP()) > 180;

    -- Build result
    result := OBJECT_CONSTRUCT(
        'status', 'success',
        'fir_360_records_updated', fir_360_updated,
        'recommendations_updated', recommendations_updated,
        'processed_at', CURRENT_TIMESTAMP()::STRING
    );

    RETURN result;
END;
$$;
-- ============================================================
-- SP_FIR_READ_DOCUMENTS
-- Tool for AGT_FIR_SYSTEM to read raw uploaded document content
-- from TBL_WORKBENCH_CLIENT_SQL_ASSETS for intelligent parsing.
-- Returns full SQL text, metadata, and attributes for LLM analysis.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_READ_DOCUMENTS(
    "LIMIT_COUNT" INTEGER DEFAULT 10,
    "STATUS_FILTER" VARCHAR DEFAULT 'active',
    "ASSET_ID" VARCHAR DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'read_documents'
EXECUTE AS OWNER
AS
$$
import json
from datetime import datetime


def read_documents(session, limit_count: int = 10, status_filter: str = 'active', asset_id: str = None) -> dict:
    """Read uploaded documents for the FIR agent to parse and understand."""
    results = {
        'status': 'success',
        'documents': [],
        'total_found': 0,
        'read_at': datetime.utcnow().isoformat()
    }

    try:
        if asset_id:
            rows = session.sql("""
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
                    UPDATED_AT
                FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_CLIENT_SQL_ASSETS
                WHERE SQL_ASSET_ID = ?
            """, [asset_id]).collect()
        else:
            rows = session.sql(f"""
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
                    UPDATED_AT
                FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_CLIENT_SQL_ASSETS
                WHERE STATUS = ?
                ORDER BY CREATED_AT DESC
                LIMIT {limit_count}
            """, [status_filter]).collect()

        results['total_found'] = len(rows)

        for row in rows:
            entity_ids = row['ENTITY_IDS']
            if isinstance(entity_ids, str):
                try:
                    entity_ids = json.loads(entity_ids)
                except Exception:
                    pass

            tags = row['TAGS']
            if isinstance(tags, str):
                try:
                    tags = json.loads(tags)
                except Exception:
                    pass

            attributes = row['ATTRIBUTES']
            if isinstance(attributes, str):
                try:
                    attributes = json.loads(attributes)
                except Exception:
                    pass

            doc = {
                'sql_asset_id': row['SQL_ASSET_ID'],
                'project_id': row['PROJECT_ID'],
                'entity_type': row['ENTITY_TYPE'],
                'entity_ids': entity_ids,
                'title': row['TITLE'],
                'sql_text': row['SQL_TEXT'],
                'sql_kind': row['SQL_KIND'],
                'dialect': row['DIALECT'],
                'description': row['DESCRIPTION'],
                'source_label': row['SOURCE_LABEL'],
                'author_name': row['AUTHOR_NAME'],
                'tags': tags,
                'attributes': attributes,
                'status': row['STATUS'],
                'created_at': str(row['CREATED_AT']) if row['CREATED_AT'] else None,
                'updated_at': str(row['UPDATED_AT']) if row['UPDATED_AT'] else None
            }
            results['documents'].append(doc)

    except Exception as e:
        results['status'] = 'failed'
        results['error'] = str(e)

    return results
$$;
-- ============================================================
-- SP_FIR_READ_PENDING_RECORDS
-- Thin CRUD tool for AGT_FIR_SYSTEM: reads raw pending records.
-- The agent does ALL reasoning; this procedure just fetches data.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_READ_PENDING_RECORDS(
    "BATCH_SIZE" INTEGER DEFAULT 50,
    "PROCESSING_STAGE" VARCHAR DEFAULT 'pending'
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

def read_pending_records(session, batch_size: int = 50, processing_stage: str = 'pending') -> dict:
    """Read raw pending records from TBL_AGENT_FIR_360 for agent processing."""
    results = session.sql("""
        SELECT
            FIR_RECORD_ID,
            FIR_RECORD_KEY,
            FEEDBACK_ID,
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
            CURRENT_CONFIDENCE,
            TARGET_AGENTS,
            CREATED_AT
        FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
        WHERE PROCESSING_STAGE = ?
        ORDER BY CREATED_AT ASC
        LIMIT ?
    """, [processing_stage, batch_size]).collect()

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
            'created_at': str(row['CREATED_AT']) if row['CREATED_AT'] else None
        }
        records.append(record)

    return {
        'status': 'success',
        'record_count': len(records),
        'processing_stage': processing_stage,
        'records': records
    }
$$;
-- ============================================================
-- SP_FIR_SCORE_RECOMMENDATIONS
-- Calculates and updates recommendation scores using:
--   base_confidence * usage_factor * recency_factor * feedback_factor
-- Runs as part of the confidence decay task or on-demand.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_SCORE_RECOMMENDATIONS()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    updated_count INTEGER DEFAULT 0;
BEGIN
    -- Update RECOMMENDATION_PRIORITY based on scoring formula:
    -- base_confidence * (1 + ln(1 + success_count) / ln(1 + greatest(usage_count, 1)))
    --   * pow(0.95, datediff('day', created_at, current_timestamp()) / 30)
    --   * feedback_factor (boost from user confirmations)
    UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS
    SET RECOMMENDATION_PRIORITY = LEAST(100, GREATEST(1, ROUND(
        (COALESCE(CONFIDENCE, 0.5) * 100)
        * (1.0 + LN(1 + COALESCE(SUCCESS_COUNT, 0)) / LN(1 + GREATEST(COALESCE(USAGE_COUNT, 0), 1)))
        * POWER(0.95, DATEDIFF('day', CREATED_AT, CURRENT_TIMESTAMP()) / 30.0)
    ))),
    UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE STATUS = 'active'
      AND CREATED_AT < CURRENT_TIMESTAMP();

    updated_count := SQLROWCOUNT;

    -- Also integrate ML model scores if available
    UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS r
    SET RECOMMENDATION_PRIORITY = LEAST(100, GREATEST(1, ROUND(
        r.RECOMMENDATION_PRIORITY * (0.5 + 0.5 * COALESCE(m.RECOMMENDATION_HELPFULNESS_PROBABILITY, 0.5))
    )))
    FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_FIR_MODEL_SCORES m
    WHERE r.AGENT_RECOMMENDATION_ID = m.ENTITY_ID
      AND m.ENTITY_TYPE = 'recommendation'
      AND m.UPDATED_AT > DATEADD('day', -7, CURRENT_TIMESTAMP())
      AND r.STATUS = 'active';

    RETURN OBJECT_CONSTRUCT(
        'status', 'success',
        'recommendations_scored', :updated_count,
        'scored_at', CURRENT_TIMESTAMP()::STRING
    );
END;
$$;
-- ============================================================
-- SP_FIR_PRECOMPUTE_FROM_SEMANTIC_VIEW
-- Given a semantic view FQN, reads its VARIANT content from SEM_TABLE_VIEWS,
-- extracts tables/columns/relationships, and builds a structured payload
-- for AGT_FIR_SYSTEM to generate proactive recommendations.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_PRECOMPUTE_FROM_SEMANTIC_VIEW(
    "VIEW_FQN" VARCHAR DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'precompute_from_view'
EXECUTE AS CALLER
AS
$$
import json
from datetime import datetime


def _current_namespace(session):
    row = session.sql("SELECT CURRENT_DATABASE() AS DB, CURRENT_SCHEMA() AS SCH").collect()[0]
    return f"{row['DB']}.{row['SCH']}"


def _get_semantic_view(session, namespace, view_fqn):
    """Fetch the semantic view content for a specific table FQN."""
    rows = session.sql(f"""
        SELECT
            VIEW_ID,
            DATABASE_NAME,
            SCHEMA_NAME,
            TABLE_NAME,
            FQN,
            SEMANTIC_LEVEL,
            SEMANTIC_VIEW,
            ROW_COUNT,
            COLUMN_COUNT,
            GENERATED_AT
        FROM {namespace}.SEM_TABLE_VIEWS
        WHERE FQN = ?
          AND STATUS = 'ACTIVE'
        ORDER BY GENERATED_AT DESC
        LIMIT 1
    """, [view_fqn]).collect()
    if not rows:
        return None
    row = rows[0]
    return {
        'view_id': row['VIEW_ID'],
        'database_name': row['DATABASE_NAME'],
        'schema_name': row['SCHEMA_NAME'],
        'table_name': row['TABLE_NAME'],
        'fqn': row['FQN'],
        'semantic_level': row['SEMANTIC_LEVEL'],
        'semantic_view': json.loads(row['SEMANTIC_VIEW']) if isinstance(row['SEMANTIC_VIEW'], str) else row['SEMANTIC_VIEW'],
        'row_count': row['ROW_COUNT'],
        'column_count': row['COLUMN_COUNT'],
        'generated_at': str(row['GENERATED_AT']) if row['GENERATED_AT'] else None,
    }


def _get_related_tables(session, namespace, schema_name, table_fqn):
    """Find tables in the same schema that have semantic views and potential relationships."""
    rows = session.sql(f"""
        SELECT
            FQN,
            TABLE_NAME,
            SEMANTIC_LEVEL,
            SEMANTIC_VIEW:relationships AS RELATIONSHIPS,
            COLUMN_COUNT
        FROM {namespace}.SEM_TABLE_VIEWS
        WHERE SCHEMA_NAME = ?
          AND STATUS = 'ACTIVE'
          AND FQN != ?
          AND SEMANTIC_LEVEL IN ('L2_ANALYST_READY', 'L3_MAPPING_ENRICHED')
        ORDER BY GENERATED_AT DESC
    """, [schema_name, table_fqn]).collect()
    results = []
    for row in rows:
        rels = row['RELATIONSHIPS']
        if isinstance(rels, str):
            try:
                rels = json.loads(rels)
            except Exception:
                rels = None
        results.append({
            'fqn': row['FQN'],
            'table_name': row['TABLE_NAME'],
            'semantic_level': row['SEMANTIC_LEVEL'],
            'relationships': rels,
            'column_count': row['COLUMN_COUNT'],
        })
    return results


def _find_meaningful_pairs(primary_view, related_tables):
    """Find table pairs with actual relationships (not blind permutation)."""
    pairs = []
    primary_fqn = primary_view['fqn']
    sv = primary_view.get('semantic_view') or {}
    primary_relationships = sv.get('relationships', [])

    for rel in primary_relationships:
        related_table = rel.get('related_table') or rel.get('right_table') or ''
        confidence = rel.get('confidence', 'LOW')
        if confidence in ('HIGH', 'MEDIUM') or rel.get('relationship_type') == 'FORMAL':
            for rt in related_tables:
                if related_table and (related_table in rt['fqn'] or related_table == rt['table_name']):
                    pairs.append({
                        'table_a': primary_fqn,
                        'table_b': rt['fqn'],
                        'relationship': rel,
                        'confidence': confidence,
                    })
                    break

    for rt in related_tables:
        rt_rels = rt.get('relationships') or []
        if isinstance(rt_rels, list):
            for rel in rt_rels:
                related_table = rel.get('related_table') or rel.get('right_table') or ''
                confidence = rel.get('confidence', 'LOW')
                if confidence in ('HIGH', 'MEDIUM'):
                    if related_table and (related_table in primary_fqn or related_table == primary_view.get('table_name', '')):
                        already = any(p['table_b'] == rt['fqn'] or p['table_a'] == rt['fqn'] for p in pairs)
                        if not already:
                            pairs.append({
                                'table_a': rt['fqn'],
                                'table_b': primary_fqn,
                                'relationship': rel,
                                'confidence': confidence,
                            })

    return pairs


def _get_column_views(session, namespace, table_fqn):
    """Fetch column-level semantic views for a table."""
    rows = session.sql(f"""
        SELECT
            COLUMN_NAME,
            DATA_TYPE,
            ATTRIBUTE_VIEW
        FROM {namespace}.SEM_COLUMN_VIEWS
        WHERE FQN LIKE ? || '.%'
          AND STATUS = 'ACTIVE'
        LIMIT 50
    """, [table_fqn]).collect()
    results = []
    for row in rows:
        av = row['ATTRIBUTE_VIEW']
        if isinstance(av, str):
            try:
                av = json.loads(av)
            except Exception:
                av = {}
        results.append({
            'column_name': row['COLUMN_NAME'],
            'data_type': row['DATA_TYPE'],
            'attribute_view': av,
        })
    return results


def precompute_from_view(session, view_fqn=None):
    """Build pre-computation context for a given semantic view FQN."""
    namespace = _current_namespace(session)
    result = {
        'status': 'success',
        'view_fqn': view_fqn,
        'started_at': datetime.utcnow().isoformat(),
        'tables_analyzed': 0,
        'pairs_found': 0,
        'precomputation_payload': None,
    }

    if not view_fqn:
        result['status'] = 'no_input'
        return result

    primary_view = _get_semantic_view(session, namespace, view_fqn)
    if not primary_view:
        result['status'] = 'view_not_found'
        return result

    schema_name = primary_view['schema_name']
    related_tables = _get_related_tables(session, namespace, schema_name, view_fqn)
    meaningful_pairs = _find_meaningful_pairs(primary_view, related_tables)
    column_views = _get_column_views(session, namespace, view_fqn)

    result['tables_analyzed'] = 1 + len(related_tables)
    result['pairs_found'] = len(meaningful_pairs)

    result['precomputation_payload'] = {
        'primary_table': {
            'fqn': primary_view['fqn'],
            'table_name': primary_view['table_name'],
            'semantic_level': primary_view['semantic_level'],
            'semantic_view_content': primary_view['semantic_view'],
            'column_count': primary_view['column_count'],
            'row_count': primary_view['row_count'],
            'column_views': column_views,
        },
        'related_tables': [
            {
                'fqn': rt['fqn'],
                'table_name': rt['table_name'],
                'semantic_level': rt['semantic_level'],
                'column_count': rt['column_count'],
            }
            for rt in related_tables
        ],
        'meaningful_pairs': meaningful_pairs,
        'schema_name': schema_name,
    }

    result['completed_at'] = datetime.utcnow().isoformat()
    return result
$$;
-- ============================================================
-- SP_FIR_PRECOMPUTE_PERMUTATIONS
-- Discovers all meaningful table combinations from semantic views
-- and invokes AGT_FIR_SYSTEM for proactive recommendation generation.
-- Only generates permutations for tables with actual relationships
-- at MEDIUM+ confidence — NOT blind N² enumeration.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_PRECOMPUTE_PERMUTATIONS(
    "OPTIONS" VARIANT DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'precompute_permutations'
EXECUTE AS CALLER
AS
$$
import json
import _snowflake
from datetime import datetime


def _current_namespace(session):
    row = session.sql("SELECT CURRENT_DATABASE() AS DB, CURRENT_SCHEMA() AS SCH").collect()[0]
    return str(row['DB']), str(row['SCH'])


def _get_all_semantic_views_with_relationships(session, namespace):
    """Get all tables with active semantic views and extract FK relationships
    from semantic_model.attributes[].constraints (the actual data structure)."""
    rows = session.sql(f"""
        SELECT
            FQN,
            TABLE_NAME,
            SCHEMA_NAME,
            DATABASE_NAME,
            COALESCE(SEMANTIC_VIEW:semantic_level::STRING, 'L1_CONTEXT') AS SEMANTIC_LEVEL,
            SEMANTIC_VIEW:semantic_model:attributes AS ATTRIBUTES,
            SEMANTIC_VIEW:relationships AS TOP_RELATIONSHIPS,
            COLUMN_COUNT,
            ROW_COUNT
        FROM {namespace}.SEM_TABLE_VIEWS
        WHERE STATUS = 'ACTIVE'
        ORDER BY SCHEMA_NAME, TABLE_NAME
    """).collect()
    results = []
    for row in rows:
        # Extract FK relationships from attributes constraints
        rels = []
        attrs = row['ATTRIBUTES']
        if isinstance(attrs, str):
            try:
                attrs = json.loads(attrs)
            except Exception:
                attrs = []
        if isinstance(attrs, list):
            for attr in attrs:
                constraints = attr.get('constraints', []) if isinstance(attr, dict) else []
                for c in constraints:
                    if isinstance(c, dict) and c.get('type') == 'FOREIGN_KEY':
                        confidence = c.get('confidence', 'LOW')
                        refs = c.get('references', {})
                        if refs.get('table'):
                            rels.append({
                                'related_table': refs['table'],
                                'related_column': refs.get('column'),
                                'source_column': attr.get('name'),
                                'confidence': confidence,
                            })

        # Also check top-level relationships if present
        top_rels = row['TOP_RELATIONSHIPS']
        if isinstance(top_rels, str):
            try:
                top_rels = json.loads(top_rels)
            except Exception:
                top_rels = []
        if isinstance(top_rels, list):
            rels.extend(top_rels)

        results.append({
            'fqn': row['FQN'],
            'table_name': row['TABLE_NAME'],
            'schema_name': row['SCHEMA_NAME'],
            'database_name': row['DATABASE_NAME'],
            'semantic_level': row['SEMANTIC_LEVEL'],
            'relationships': rels,
            'column_count': row['COLUMN_COUNT'],
            'row_count': row['ROW_COUNT'],
        })
    return results


def _get_document_table_learnings(session, namespace):
    """Query TBL_WORKBENCH_CLIENT_SQL_ASSETS for active documents and extract
    table references, join patterns, CTE patterns, and transformations from
    the ATTRIBUTES JSON column."""
    rows = session.sql(f"""
        SELECT
            SQL_ASSET_ID,
            TITLE,
            ATTRIBUTES
        FROM {namespace}.TBL_WORKBENCH_CLIENT_SQL_ASSETS
        WHERE STATUS = 'active'
          AND ATTRIBUTES IS NOT NULL
        ORDER BY UPDATED_AT DESC
        LIMIT 50
    """).collect()

    learnings = []
    for row in rows:
        attrs = row['ATTRIBUTES']
        if isinstance(attrs, str):
            try:
                attrs = json.loads(attrs)
            except Exception:
                continue
        if not isinstance(attrs, dict):
            continue

        source_tables = attrs.get('source_tables', [])
        join_patterns = attrs.get('join_patterns', [])
        cte_patterns = attrs.get('ctes', [])
        transformations = attrs.get('transformations', [])

        if not source_tables and not join_patterns:
            continue

        learnings.append({
            'asset_id': row['SQL_ASSET_ID'],
            'filename': row['TITLE'],
            'tables': source_tables if isinstance(source_tables, list) else [],
            'join_patterns': join_patterns if isinstance(join_patterns, list) else [],
            'ctes': cte_patterns if isinstance(cte_patterns, list) else [],
            'transformations': transformations if isinstance(transformations, list) else [],
        })

    return learnings


def _extract_meaningful_combinations(tables):
    """Find all meaningful table combinations based on FK relationships.

    Relationships come from semantic_model.attributes[].constraints FK references.
    The related_table is just a table name (not FQN), so we match by table_name
    within the same schema/database.
    """
    table_map = {t['fqn']: t for t in tables}
    # Build name lookup: table_name -> list of FQNs (same schema preferred)
    name_to_fqns = {}
    for t in tables:
        name_to_fqns.setdefault(t['table_name'].upper(), []).append(t)

    pairs = set()

    for table in tables:
        for rel in table.get('relationships', []):
            related_name = (rel.get('related_table') or rel.get('right_table') or '').upper()
            confidence = (rel.get('confidence') or 'LOW').upper()
            if confidence not in ('HIGH', 'MEDIUM'):
                continue
            if not related_name:
                continue

            # Find matching table by name (prefer same schema)
            candidates = name_to_fqns.get(related_name, [])
            matched = None
            for c in candidates:
                if c['fqn'] == table['fqn']:
                    continue
                if c['schema_name'] == table['schema_name'] and c['database_name'] == table['database_name']:
                    matched = c
                    break
            if not matched and candidates:
                matched = next((c for c in candidates if c['fqn'] != table['fqn']), None)

            if matched:
                pair_key = tuple(sorted([table['fqn'], matched['fqn']]))
                pairs.add(pair_key)

    pair_list = [
        {'table_a': p[0], 'table_b': p[1]}
        for p in pairs
    ]

    # Build adjacency graph for multi-table groups
    adjacency = {}
    for p in pairs:
        adjacency.setdefault(p[0], set()).add(p[1])
        adjacency.setdefault(p[1], set()).add(p[0])

    groups = []
    for table_fqn, neighbors in adjacency.items():
        if len(neighbors) >= 2:
            group_tables = sorted([table_fqn] + list(neighbors))
            if len(group_tables) <= 5:
                groups.append(group_tables)

    seen_groups = set()
    unique_groups = []
    for g in groups:
        key = tuple(g)
        if key not in seen_groups:
            seen_groups.add(key)
            unique_groups.append(g)

    return pair_list, unique_groups


def _check_existing_recommendations(session, namespace, table_fqns):
    """Check if recommendations already exist for these tables to avoid duplicates."""
    fqn_array = "ARRAY_CONSTRUCT(" + ",".join(f"'{fqn}'" for fqn in table_fqns) + ")"
    rows = session.sql(f"""
        SELECT COUNT(*) AS CNT
        FROM {namespace}.TBL_FIR_AGENT_RECOMMENDATIONS
        WHERE STATUS = 'active'
          AND ARRAYS_OVERLAP(APPLICABLE_TABLES, {fqn_array})
          AND CREATED_AT > DATEADD('day', -7, CURRENT_TIMESTAMP())
    """).collect()
    return rows[0]['CNT'] if rows else 0


def _invoke_fir_agent_for_precomputation(session, db, schema, precompute_payload):
    """Invoke AGT_FIR_SYSTEM with pre-computation context."""
    agent_message = {
        'task_type': 'semantic_precomputation',
        'streams_with_data': ['STM_FIR_SEM_TABLE_VIEWS'],
        'pending_counts': {},
        'unprocessed_documents': [],
        'activity_summary': {},
        'batch_size': 50,
        'processing_options': {
            'collect_feedback': False,
            'generate_inferences': True,
            'create_semantic_versions': False,
            'generate_recommendations': True,
            'apply_decay': False,
            'parse_documents': False,
            'precompute_recommendations': True,
        },
        'precomputation_context': precompute_payload,
        'instructions': (
            'This is a SEMANTIC PRE-COMPUTATION run. Your job is to generate proactive '
            'recommendations for the table combinations provided. For each table pair or group, '
            'generate recommendations covering: '
            '1. Single table selected: table meaning, related tables, possible targets, business context '
            '2. Table pairs with relationships: explain relationship, confidence, join patterns '
            '3. Multi-table groups: derived source suggestions with business meaning '
            '4. Source-to-target combinations: automapping hints, preprocessing rules '
            '5. Question and answer pairs: common questions users would ask about these tables '
            'Use SearchFIRRecommendations to avoid duplicates. '
            'Set APPLICABLE_TABLES on each recommendation so it triggers at the right time. '
            'CRITICAL: For every APP_USER_NOTIFICATION recommendation, you MUST provide a '
            'display_message that is clear, conversational, and actionable. Never pass None. '
            'Example: "FACT_SALES joins to ORDER_DIM via ORDER_KEY. This is the primary '
            'fact-dimension link in this star schema — consider adding ORDER_DIM for date/shipping context." '
            'Also provide display_options with at least: '
            '[{"id":"useful","label":"Looks useful"},{"id":"dismiss","label":"Not relevant"}] '
            'The precomputation_context includes document_context from uploaded SQL scripts. '
            'Use these to connect document learnings with table relationships: '
            '- If a document shows TABLE_A JOIN TABLE_B, create recommendations for that pair '
            '- If a document has CTEs combining multiple tables, create derived_source_suggestion recs '
            '- Set applicable_tables to the FULL FQNs so they connect when users select those tables '
            'CRITICAL: Every APP_USER_NOTIFICATION must have a non-empty display_message. '
        ),
    }

    agent_payload = {
        'models': {'orchestration': 'claude-sonnet-4-6'},
        'messages': [
            {
                'role': 'user',
                'content': [{'type': 'text', 'text': json.dumps(agent_message)}]
            }
        ],
        'stream': False
    }

    response = _snowflake.send_snow_api_request(
        'POST',
        f'/api/v2/databases/{db}/schemas/{schema}/agents/AGT_FIR_SYSTEM:run',
        {},
        {},
        agent_payload,
        None,
        600000  # 10 minute timeout for comprehensive pre-computation
    )
    return response


def precompute_permutations(session, options=None):
    """Discover meaningful table combinations and invoke FIR for pre-computation."""
    db, schema = _current_namespace(session)
    namespace = f"{db}.{schema}"

    result = {
        'status': 'success',
        'started_at': datetime.utcnow().isoformat(),
        'tables_with_views': 0,
        'meaningful_pairs': 0,
        'table_groups': 0,
        'recommendations_skipped': 0,
        'agent_invocations': 0,
        'errors': [],
    }

    opts = {}
    if options:
        if isinstance(options, str):
            try:
                opts = json.loads(options)
            except Exception:
                pass
        else:
            opts = dict(options) if options else {}

    max_pairs_per_batch = opts.get('max_pairs_per_batch', 10)
    skip_if_recent = opts.get('skip_if_recent_days', 7)

    # Allow overriding where to read semantic views from
    sem_views_ns = opts.get('semantic_views_namespace', namespace)
    tables = _get_all_semantic_views_with_relationships(session, sem_views_ns)
    result['tables_with_views'] = len(tables)

    if not tables:
        result['status'] = 'no_semantic_views'
        return result

    # Merge document learnings from TBL_WORKBENCH_CLIENT_SQL_ASSETS
    document_learnings = _get_document_table_learnings(session, namespace)
    result['document_learnings_count'] = len(document_learnings)

    # Build a set of existing table FQNs and names for lookup
    existing_fqns = {t['fqn'].upper() for t in tables}
    existing_names = {t['table_name'].upper() for t in tables}

    for doc in document_learnings:
        # Add tables mentioned in documents but NOT in semantic views
        for tbl_ref in doc.get('tables', []):
            tbl_name = tbl_ref.upper() if isinstance(tbl_ref, str) else ''
            if not tbl_name:
                continue
            # Check if this table (by name or FQN) is already known
            if tbl_name not in existing_fqns and tbl_name.split('.')[-1] not in existing_names:
                # Determine if it looks like an FQN (has dots)
                parts = tbl_name.split('.')
                if len(parts) == 3:
                    db_part, sch_part, tbl_part = parts
                else:
                    tbl_part = parts[-1]
                    sch_part = ''
                    db_part = ''
                tables.append({
                    'fqn': tbl_name if len(parts) == 3 else tbl_name,
                    'table_name': tbl_part,
                    'schema_name': sch_part,
                    'database_name': db_part,
                    'semantic_level': 'DOCUMENT_REFERENCED',
                    'relationships': [],
                    'column_count': None,
                    'row_count': None,
                })
                existing_fqns.add(tbl_name)
                existing_names.add(tbl_part)

        # For join patterns in documents, add as relationships (pairs)
        for jp in doc.get('join_patterns', []):
            if isinstance(jp, dict):
                left = (jp.get('left_table') or jp.get('table_a') or '').upper()
                right = (jp.get('right_table') or jp.get('table_b') or '').upper()
                if left and right:
                    # Find or create entries for these tables and add relationship
                    for t in tables:
                        if t['fqn'].upper() == left or t['table_name'].upper() == left.split('.')[-1]:
                            t['relationships'].append({
                                'related_table': right.split('.')[-1],
                                'related_column': jp.get('join_column'),
                                'source_column': jp.get('source_column'),
                                'confidence': 'MEDIUM',
                            })
                            break

    pairs, groups = _extract_meaningful_combinations(tables)
    result['meaningful_pairs'] = len(pairs)
    result['table_groups'] = len(groups)

    if not pairs and not groups:
        result['status'] = 'no_relationships_found'
        return result

    batch_payload = {
        'tables': [
            {
                'fqn': t['fqn'],
                'table_name': t['table_name'],
                'schema_name': t['schema_name'],
                'semantic_level': t['semantic_level'],
                'column_count': t['column_count'],
            }
            for t in tables
        ],
        'pairs': [],
        'groups': groups[:5],
        'document_context': [
            {
                'filename': doc['filename'],
                'tables': doc['tables'],
                'join_patterns': doc['join_patterns'],
                'ctes': doc['ctes'],
            }
            for doc in document_learnings[:10]
        ],
    }

    for pair in pairs[:max_pairs_per_batch]:
        table_fqns = [pair['table_a'], pair['table_b']]
        existing = _check_existing_recommendations(session, namespace, table_fqns)
        if existing > 3:
            result['recommendations_skipped'] += 1
            continue
        batch_payload['pairs'].append(pair)

    if not batch_payload['pairs'] and not batch_payload['groups']:
        result['status'] = 'all_skipped_recent_exists'
        return result

    try:
        response = _invoke_fir_agent_for_precomputation(session, db, schema, batch_payload)
        result['agent_invocations'] = 1
        if response:
            status_code = response.get('status', 0)
            if status_code not in (200, 201):
                result['errors'].append(f'Agent HTTP {status_code}')
    except Exception as e:
        result['errors'].append(str(e))
        result['status'] = 'partial'

    result['completed_at'] = datetime.utcnow().isoformat()
    return result
$$;
-- ============================================================
-- SP_FIR_CONSOLIDATE_SEMANTIC_VERSIONS
-- Weekly consolidation and cleanup of semantic view versions.
-- Archives old versions, merges learnings across projects.
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_CONSOLIDATE_SEMANTIC_VERSIONS()
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'consolidate_versions'
EXECUTE AS OWNER
AS
$$
import json
from datetime import datetime
from typing import Any, Dict, List


def _archive_old_versions(session) -> int:
    """Archive superseded versions older than 90 days."""
    session.sql("""
        UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS
        SET STATUS = 'archived',
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE STATUS = 'superseded'
          AND DATEDIFF('day', UPDATED_AT, CURRENT_TIMESTAMP()) > 90
    """).collect()

    count_result = session.sql("""
        SELECT COUNT(*) AS CNT
        FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS
        WHERE STATUS = 'archived'
          AND DATEDIFF('day', UPDATED_AT, CURRENT_TIMESTAMP()) < 1
    """).collect()
    return count_result[0]['CNT'] if count_result else 0


def _find_cross_project_patterns(session) -> List[Dict]:
    """Find common patterns across projects that could be consolidated."""
    patterns = session.sql("""
        SELECT
            v.SEMANTIC_VIEW_FQN,
            COUNT(DISTINCT p.value) AS project_count,
            AVG(v.CONFIDENCE) AS avg_confidence,
            MAX(v.VERSION_NUMBER) AS max_version
        FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS v,
             LATERAL FLATTEN(input => v.PROJECT_IDS, OUTER => TRUE) p
        WHERE v.STATUS = 'active'
          AND v.VERSION_NUMBER > 0
        GROUP BY v.SEMANTIC_VIEW_FQN
        HAVING COUNT(DISTINCT p.value) > 1
        ORDER BY project_count DESC, avg_confidence DESC
        LIMIT 20
    """).collect()

    return [
        {
            'semantic_view_fqn': row['SEMANTIC_VIEW_FQN'],
            'project_count': row['PROJECT_COUNT'],
            'avg_confidence': row['AVG_CONFIDENCE'],
            'max_version': row['MAX_VERSION']
        }
        for row in patterns
    ]


def _validate_pending_versions(session) -> int:
    """Auto-validate versions with high confidence and multiple sources."""
    session.sql("""
        UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS
        SET VALIDATION_STATUS = 'validated',
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE VALIDATION_STATUS = 'pending'
          AND STATUS = 'active'
          AND CONFIDENCE >= 0.75
          AND ARRAY_SIZE(LEARNING_SOURCES) >= 5
    """).collect()

    count_result = session.sql("""
        SELECT COUNT(*) AS CNT
        FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS
        WHERE VALIDATION_STATUS = 'validated'
          AND STATUS = 'active'
          AND DATEDIFF('day', UPDATED_AT, CURRENT_TIMESTAMP()) < 1
    """).collect()
    return count_result[0]['CNT'] if count_result else 0


def _cleanup_orphaned_records(session) -> Dict[str, int]:
    """Clean up orphaned records in FIR tables."""
    cleanup_stats = {
        'orphaned_recommendations': 0,
        'stale_pending_records': 0
    }

    session.sql("""
        UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS
        SET STATUS = 'archived',
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE STATUS = 'active'
          AND FIR_RECORD_ID NOT IN (
              SELECT FIR_RECORD_ID FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
          )
    """).collect()

    count_result = session.sql("""
        SELECT COUNT(*) AS CNT
        FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS
        WHERE STATUS = 'archived'
          AND DATEDIFF('day', UPDATED_AT, CURRENT_TIMESTAMP()) < 1
    """).collect()
    cleanup_stats['orphaned_recommendations'] = count_result[0]['CNT'] if count_result else 0

    session.sql("""
        UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
        SET PROCESSING_STAGE = 'failed',
            PROCESSING_ERROR = 'Stale: pending for more than 7 days',
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE PROCESSING_STAGE = 'pending'
          AND DATEDIFF('day', CREATED_AT, CURRENT_TIMESTAMP()) > 7
    """).collect()

    count_result = session.sql("""
        SELECT COUNT(*) AS CNT
        FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
        WHERE PROCESSING_STAGE = 'failed'
          AND PROCESSING_ERROR = 'Stale: pending for more than 7 days'
          AND DATEDIFF('day', UPDATED_AT, CURRENT_TIMESTAMP()) < 1
    """).collect()
    cleanup_stats['stale_pending_records'] = count_result[0]['CNT'] if count_result else 0

    return cleanup_stats


def _compute_version_statistics(session) -> Dict[str, Any]:
    """Compute statistics about semantic versions."""
    stats = session.sql("""
        SELECT
            COUNT(*) AS total_versions,
            COUNT(CASE WHEN STATUS = 'active' THEN 1 END) AS active_versions,
            COUNT(CASE WHEN STATUS = 'superseded' THEN 1 END) AS superseded_versions,
            COUNT(CASE WHEN STATUS = 'archived' THEN 1 END) AS archived_versions,
            COUNT(CASE WHEN VALIDATION_STATUS = 'validated' THEN 1 END) AS validated_versions,
            AVG(CONFIDENCE) AS avg_confidence,
            COUNT(DISTINCT SEMANTIC_VIEW_FQN) AS unique_views
        FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS
    """).collect()

    if stats:
        row = stats[0]
        return {
            'total_versions': row['TOTAL_VERSIONS'],
            'active_versions': row['ACTIVE_VERSIONS'],
            'superseded_versions': row['SUPERSEDED_VERSIONS'],
            'archived_versions': row['ARCHIVED_VERSIONS'],
            'validated_versions': row['VALIDATED_VERSIONS'],
            'avg_confidence': float(row['AVG_CONFIDENCE']) if row['AVG_CONFIDENCE'] else 0,
            'unique_views': row['UNIQUE_VIEWS']
        }

    return {}


def consolidate_versions(session) -> dict:
    """Main handler for weekly semantic version consolidation."""
    results = {
        'status': 'success',
        'archived_count': 0,
        'validated_count': 0,
        'cross_project_patterns': [],
        'cleanup_stats': {},
        'version_statistics': {},
        'errors': [],
        'processed_at': datetime.utcnow().isoformat()
    }

    try:
        results['archived_count'] = _archive_old_versions(session)

        results['validated_count'] = _validate_pending_versions(session)

        results['cross_project_patterns'] = _find_cross_project_patterns(session)

        results['cleanup_stats'] = _cleanup_orphaned_records(session)

        results['version_statistics'] = _compute_version_statistics(session)

    except Exception as e:
        results['status'] = 'partial' if results['archived_count'] > 0 else 'failed'
        results['errors'].append(str(e))

    return results
$$;
-- ============================================================
-- SP_FIR_CREATE_SEMANTIC_VERSION
-- Creates a new curated semantic view version from accumulated inferences.
-- Tracks evolution: RAW → CURATED_V1 → CURATED_V2 → ...
-- ============================================================

CREATE OR REPLACE PROCEDURE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_CREATE_SEMANTIC_VERSION(
    "SEMANTIC_VIEW_FQN" VARCHAR,
    "PARENT_VERSION_ID" VARCHAR DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'create_semantic_version'
EXECUTE AS OWNER
AS
$$
import json
import uuid
from datetime import datetime
from typing import Any, Optional


def _get_current_version(session, semantic_view_fqn: str) -> Optional[dict]:
    """Get the current active version for a semantic view."""
    result = session.sql("""
        SELECT
            VERSION_ID,
            VERSION_NUMBER,
            VERSION_LABEL,
            BUSINESS_GLOSSARY,
            RELATIONSHIP_RULES,
            TRANSFORMATION_PATTERNS,
            COLUMN_SEMANTICS,
            DERIVED_SOURCE_PATTERNS,
            CONFIDENCE
        FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS
        WHERE SEMANTIC_VIEW_FQN = ?
          AND STATUS = 'active'
        ORDER BY VERSION_NUMBER DESC
        LIMIT 1
    """, [semantic_view_fqn]).collect()

    if result:
        row = result[0]
        return {
            'version_id': row['VERSION_ID'],
            'version_number': row['VERSION_NUMBER'],
            'version_label': row['VERSION_LABEL'],
            'business_glossary': json.loads(row['BUSINESS_GLOSSARY']) if row['BUSINESS_GLOSSARY'] else {},
            'relationship_rules': json.loads(row['RELATIONSHIP_RULES']) if row['RELATIONSHIP_RULES'] else [],
            'transformation_patterns': json.loads(row['TRANSFORMATION_PATTERNS']) if row['TRANSFORMATION_PATTERNS'] else [],
            'column_semantics': json.loads(row['COLUMN_SEMANTICS']) if row['COLUMN_SEMANTICS'] else {},
            'derived_source_patterns': json.loads(row['DERIVED_SOURCE_PATTERNS']) if row['DERIVED_SOURCE_PATTERNS'] else [],
            'confidence': row['CONFIDENCE'] or 0.5
        }
    return None


def _get_applicable_inferences(session, semantic_view_fqn: str) -> list:
    """Get inferences that should contribute to this semantic version."""
    results = session.sql("""
        SELECT
            fir.FIR_RECORD_ID,
            fir.INFERENCE_ID,
            fir.INFERENCE_PAYLOAD,
            fir.INITIAL_CONFIDENCE,
            fir.SOURCE_TYPE,
            fir.SOURCE_EVENT_TYPE,
            fir.STTM_ID,
            fir.PROJECT_ID
        FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360 fir
        WHERE fir.PROCESSING_STAGE = 'inference_generated'
          AND fir.INFERENCE_PAYLOAD IS NOT NULL
          AND (
              fir.INFERENCE_PAYLOAD:business_understanding:semantic_change:view_fqn::STRING = ?
              OR fir.SOURCE_TYPE IN ('mapping_feedback', 'implicit')
          )
        ORDER BY fir.CREATED_AT
        LIMIT 500
    """, [semantic_view_fqn]).collect()

    inferences = []
    for row in results:
        payload = json.loads(row['INFERENCE_PAYLOAD']) if isinstance(row['INFERENCE_PAYLOAD'], str) else (row['INFERENCE_PAYLOAD'] or {})
        inferences.append({
            'fir_record_id': row['FIR_RECORD_ID'],
            'inference_id': row['INFERENCE_ID'],
            'payload': payload,
            'confidence': row['INITIAL_CONFIDENCE'] or 0.5,
            'source_type': row['SOURCE_TYPE'],
            'event_type': row['SOURCE_EVENT_TYPE'],
            'sttm_id': row['STTM_ID'],
            'project_id': row['PROJECT_ID']
        })

    return inferences


def _extract_business_glossary(inferences: list, existing: dict) -> dict:
    """Extract business glossary terms from inferences."""
    glossary = dict(existing) if existing else {}

    for inf in inferences:
        bu = inf['payload'].get('business_understanding', {})

        if 'column_relationship' in bu:
            rel = bu['column_relationship']
            if rel.get('rationale'):
                source_col = rel.get('source')
                target_col = rel.get('target')
                if source_col:
                    glossary[source_col] = glossary.get(source_col, {})
                    glossary[source_col]['rationale'] = rel.get('rationale')
                    glossary[source_col]['maps_to'] = target_col
                    glossary[source_col]['confidence'] = inf['confidence']

        if 'derived_source' in bu:
            ds = bu['derived_source']
            if ds.get('name') and ds.get('business_description'):
                glossary[ds['name']] = {
                    'type': 'derived_source',
                    'description': ds['business_description'],
                    'purpose': ds.get('purpose'),
                    'confidence': inf['confidence']
                }

    return glossary


def _extract_relationship_rules(inferences: list, existing: list) -> list:
    """Extract relationship rules from inferences."""
    rules = list(existing) if existing else []
    seen_keys = {f"{r.get('source_table')}|{r.get('target_table')}|{r.get('join_type')}" for r in rules}

    for inf in inferences:
        bu = inf['payload'].get('business_understanding', {})

        if 'derived_source' in bu:
            ds = bu['derived_source']
            relationships = ds.get('relationships', [])
            if isinstance(relationships, list):
                for rel in relationships:
                    if isinstance(rel, dict):
                        key = f"{rel.get('left_table')}|{rel.get('right_table')}|{rel.get('join_type')}"
                        if key not in seen_keys:
                            rules.append({
                                'source_table': rel.get('left_table'),
                                'target_table': rel.get('right_table'),
                                'join_type': rel.get('join_type'),
                                'join_columns': rel.get('on_columns'),
                                'business_context': ds.get('purpose'),
                                'confidence': inf['confidence'],
                                'source_inference': inf['inference_id']
                            })
                            seen_keys.add(key)

    return rules


def _extract_transformation_patterns(inferences: list, existing: list) -> list:
    """Extract transformation patterns from inferences."""
    patterns = list(existing) if existing else []
    seen_transformations = {p.get('pattern') for p in patterns if p.get('pattern')}

    for inf in inferences:
        bu = inf['payload'].get('business_understanding', {})

        if 'column_relationship' in bu:
            rel = bu['column_relationship']
            transformation = rel.get('transformation')
            rule = rel.get('rule')

            if transformation and transformation not in seen_transformations:
                patterns.append({
                    'pattern': transformation,
                    'rule_type': rule,
                    'source_column': rel.get('source'),
                    'target_column': rel.get('target'),
                    'rationale': rel.get('rationale'),
                    'confidence': inf['confidence'],
                    'source_inference': inf['inference_id']
                })
                seen_transformations.add(transformation)

    return patterns


def _extract_column_semantics(inferences: list, existing: dict) -> dict:
    """Extract column semantics from inferences."""
    semantics = dict(existing) if existing else {}

    for inf in inferences:
        bu = inf['payload'].get('business_understanding', {})

        if 'column_relationship' in bu:
            rel = bu['column_relationship']
            source_col = rel.get('source')
            target_col = rel.get('target')

            if source_col:
                if source_col not in semantics:
                    semantics[source_col] = {'mappings': [], 'confidence': 0}

                semantics[source_col]['mappings'].append({
                    'target': target_col,
                    'rule': rel.get('rule'),
                    'rationale': rel.get('rationale'),
                    'ai_accepted': bu.get('ai_suggestion_accepted', False)
                })
                semantics[source_col]['confidence'] = max(
                    semantics[source_col]['confidence'],
                    inf['confidence']
                )

    return semantics


def _extract_derived_source_patterns(inferences: list, existing: list) -> list:
    """Extract derived source patterns from inferences."""
    patterns = list(existing) if existing else []
    seen_names = {p.get('name') for p in patterns if p.get('name')}

    for inf in inferences:
        bu = inf['payload'].get('business_understanding', {})

        if 'derived_source' in bu:
            ds = bu['derived_source']
            name = ds.get('name')

            if name and name not in seen_names:
                patterns.append({
                    'name': name,
                    'purpose': ds.get('purpose'),
                    'business_description': ds.get('business_description'),
                    'source_tables': ds.get('source_tables'),
                    'confidence': inf['confidence'],
                    'source_inference': inf['inference_id']
                })
                seen_names.add(name)

    return patterns


def _calculate_version_confidence(inferences: list, existing_confidence: float) -> float:
    """Calculate confidence for the new version."""
    if not inferences:
        return existing_confidence

    avg_inference_confidence = sum(i['confidence'] for i in inferences) / len(inferences)

    high_confidence_count = sum(1 for i in inferences if i['confidence'] >= 0.8)
    high_confidence_ratio = high_confidence_count / len(inferences) if inferences else 0

    new_confidence = (existing_confidence * 0.3) + (avg_inference_confidence * 0.5) + (high_confidence_ratio * 0.2)
    return round(min(1.0, new_confidence), 3)


def create_semantic_version(session, semantic_view_fqn: str, parent_version_id: str = None) -> dict:
    """Main handler to create a new curated semantic view version."""
    results = {
        'status': 'success',
        'version_id': None,
        'version_number': None,
        'version_label': None,
        'inferences_used': 0,
        'enhancements': {},
        'errors': [],
        'created_at': datetime.utcnow().isoformat()
    }

    try:
        current_version = None
        if parent_version_id:
            parent_result = session.sql("""
                SELECT * FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS
                WHERE VERSION_ID = ?
            """, [parent_version_id]).collect()
            if parent_result:
                row = parent_result[0]
                current_version = {
                    'version_id': row['VERSION_ID'],
                    'version_number': row['VERSION_NUMBER'],
                    'business_glossary': json.loads(row['BUSINESS_GLOSSARY']) if row['BUSINESS_GLOSSARY'] else {},
                    'relationship_rules': json.loads(row['RELATIONSHIP_RULES']) if row['RELATIONSHIP_RULES'] else [],
                    'transformation_patterns': json.loads(row['TRANSFORMATION_PATTERNS']) if row['TRANSFORMATION_PATTERNS'] else [],
                    'column_semantics': json.loads(row['COLUMN_SEMANTICS']) if row['COLUMN_SEMANTICS'] else {},
                    'derived_source_patterns': json.loads(row['DERIVED_SOURCE_PATTERNS']) if row['DERIVED_SOURCE_PATTERNS'] else [],
                    'confidence': row['CONFIDENCE'] or 0.5
                }
        else:
            current_version = _get_current_version(session, semantic_view_fqn)

        inferences = _get_applicable_inferences(session, semantic_view_fqn)

        if not inferences and not current_version:
            results['status'] = 'skipped'
            results['errors'].append('No inferences available and no existing version')
            return results

        existing = current_version or {
            'version_number': -1,
            'business_glossary': {},
            'relationship_rules': [],
            'transformation_patterns': [],
            'column_semantics': {},
            'derived_source_patterns': [],
            'confidence': 0.5
        }

        new_glossary = _extract_business_glossary(inferences, existing['business_glossary'])
        new_rules = _extract_relationship_rules(inferences, existing['relationship_rules'])
        new_patterns = _extract_transformation_patterns(inferences, existing['transformation_patterns'])
        new_semantics = _extract_column_semantics(inferences, existing['column_semantics'])
        new_derived = _extract_derived_source_patterns(inferences, existing['derived_source_patterns'])

        new_version_number = existing['version_number'] + 1
        new_version_label = 'RAW' if new_version_number == 0 else f'CURATED_V{new_version_number}'

        new_confidence = _calculate_version_confidence(inferences, existing['confidence'])

        version_id = str(uuid.uuid4())
        parent_id = current_version['version_id'] if current_version else None

        learning_sources = [i['fir_record_id'] for i in inferences]
        mapping_ids = list(set(i['sttm_id'] for i in inferences if i.get('sttm_id')))
        project_ids = list(set(i['project_id'] for i in inferences if i.get('project_id')))

        if current_version:
            session.sql("""
                UPDATE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS
                SET STATUS = 'superseded',
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE SEMANTIC_VIEW_FQN = ?
                  AND STATUS = 'active'
            """, [semantic_view_fqn]).collect()

        session.sql("""
            INSERT INTO FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS (
                VERSION_ID, SEMANTIC_VIEW_FQN, VERSION_NUMBER, VERSION_LABEL,
                PARENT_VERSION_ID, PROMOTION_REASON,
                BUSINESS_GLOSSARY, RELATIONSHIP_RULES, TRANSFORMATION_PATTERNS,
                COLUMN_SEMANTICS, DERIVED_SOURCE_PATTERNS,
                LEARNING_SOURCES, MAPPING_EXECUTION_IDS, PROJECT_IDS,
                CONFIDENCE, VALIDATION_STATUS, STATUS,
                CREATED_AT, UPDATED_AT
            ) VALUES (
                ?, ?, ?, ?,
                ?, ?,
                PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?),
                PARSE_JSON(?), PARSE_JSON(?),
                PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?),
                ?, 'pending', 'active',
                CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
            )
        """, [
            version_id, semantic_view_fqn, new_version_number, new_version_label,
            parent_id, f'Created from {len(inferences)} inferences',
            json.dumps(new_glossary), json.dumps(new_rules), json.dumps(new_patterns),
            json.dumps(new_semantics), json.dumps(new_derived),
            json.dumps(learning_sources), json.dumps(mapping_ids), json.dumps(project_ids),
            new_confidence
        ]).collect()

        results['version_id'] = version_id
        results['version_number'] = new_version_number
        results['version_label'] = new_version_label
        results['inferences_used'] = len(inferences)
        results['enhancements'] = {
            'glossary_terms': len(new_glossary),
            'relationship_rules': len(new_rules),
            'transformation_patterns': len(new_patterns),
            'column_semantics': len(new_semantics),
            'derived_source_patterns': len(new_derived)
        }
        results['confidence'] = new_confidence

    except Exception as e:
        results['status'] = 'failed'
        results['errors'].append(str(e))

    return results
$$;
-- ============================================================
-- FIR Cortex Search Services
-- Enables semantic search over FIR inferences, recommendations,
-- and curated semantic view versions.
-- ============================================================

-- ============================================================
-- View for FIR 360 Inferences Search
-- ============================================================
CREATE OR REPLACE VIEW FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.VW_FIR_INFERENCES_SEARCH AS
SELECT
    FIR_RECORD_ID,
    INFERENCE_ID,
    SOURCE_TYPE,
    SOURCE_EVENT_TYPE,
    ENTITY_TYPE,
    PROJECT_ID,
    STTM_ID,
    SEMANTIC_BUNDLE_ID,
    CURRENT_CONFIDENCE,
    TARGET_AGENTS,
    PROCESSING_STAGE,
    CREATED_AT,
    -- Composite search text for semantic matching
    COALESCE(INFERENCE_PAYLOAD:summary::STRING, '') || ' ' ||
    COALESCE(INFERENCE_PAYLOAD:inference_type::STRING, '') || ' ' ||
    COALESCE(SOURCE_EVENT_TYPE, '') || ' ' ||
    COALESCE(ENTITY_TYPE, '') || ' ' ||
    COALESCE(INFERENCE_PAYLOAD:business_understanding:column_relationship:source::STRING, '') || ' ' ||
    COALESCE(INFERENCE_PAYLOAD:business_understanding:column_relationship:target::STRING, '') || ' ' ||
    COALESCE(INFERENCE_PAYLOAD:business_understanding:column_relationship:rationale::STRING, '') || ' ' ||
    COALESCE(INFERENCE_PAYLOAD:business_understanding:derived_source:name::STRING, '') || ' ' ||
    COALESCE(INFERENCE_PAYLOAD:business_understanding:derived_source:purpose::STRING, '') || ' ' ||
    COALESCE(INFERENCE_PAYLOAD:business_understanding:derived_source:business_description::STRING, '')
    AS SEARCH_TEXT
FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_FIR_360
WHERE PROCESSING_STAGE = 'completed'
  AND INFERENCE_ID IS NOT NULL;

-- ============================================================
-- CSS_FIR_INFERENCES_360 - FIR Inferences Search Service
-- ============================================================
CREATE OR REPLACE CORTEX SEARCH SERVICE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.CSS_FIR_INFERENCES_360
ON SEARCH_TEXT
ATTRIBUTES
    FIR_RECORD_ID,
    INFERENCE_ID,
    SOURCE_TYPE,
    SOURCE_EVENT_TYPE,
    ENTITY_TYPE,
    PROJECT_ID,
    CURRENT_CONFIDENCE,
    CREATED_AT
WAREHOUSE = FFP_HDP_DLAB_WH_DEV
TARGET_LAG = '1 hour'
AS (
    SELECT * FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.VW_FIR_INFERENCES_SEARCH
);


-- ============================================================
-- View for Agent Recommendations Search
-- ============================================================
CREATE OR REPLACE VIEW FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.VW_FIR_RECOMMENDATIONS_SEARCH AS
SELECT
    AGENT_RECOMMENDATION_ID,
    FIR_RECORD_ID,
    TARGET_AGENT,
    TRIGGER_TYPE,
    RECOMMENDATION_TYPE,
    RECOMMENDATION_PRIORITY,
    CONFIDENCE,
    USAGE_COUNT,
    SUCCESS_COUNT,
    STATUS,
    CREATED_AT,
    -- Composite search text
    COALESCE(RECOMMENDATION_TYPE, '') || ' ' ||
    COALESCE(TARGET_AGENT, '') || ' ' ||
    COALESCE(TRIGGER_TYPE, '') || ' ' ||
    COALESCE(AGENT_PAYLOAD:inference_summary::STRING, '') || ' ' ||
    COALESCE(AGENT_PAYLOAD:mapping_pattern:source_column::STRING, '') || ' ' ||
    COALESCE(AGENT_PAYLOAD:mapping_pattern:target_column::STRING, '') || ' ' ||
    COALESCE(AGENT_PAYLOAD:mapping_pattern:rationale::STRING, '') || ' ' ||
    COALESCE(AGENT_PAYLOAD:suggested_derived_source:name::STRING, '') || ' ' ||
    COALESCE(AGENT_PAYLOAD:suggested_derived_source:purpose::STRING, '') || ' ' ||
    COALESCE(AGENT_PAYLOAD:transformation_pattern:expression::STRING, '')
    AS SEARCH_TEXT
FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS
WHERE STATUS = 'active';

-- ============================================================
-- CSS_FIR_AGENT_RECOMMENDATIONS - Recommendations Search Service
-- ============================================================
CREATE OR REPLACE CORTEX SEARCH SERVICE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.CSS_FIR_AGENT_RECOMMENDATIONS
ON SEARCH_TEXT
ATTRIBUTES
    AGENT_RECOMMENDATION_ID,
    TARGET_AGENT,
    TRIGGER_TYPE,
    RECOMMENDATION_TYPE,
    RECOMMENDATION_PRIORITY,
    CONFIDENCE,
    USAGE_COUNT,
    SUCCESS_COUNT,
    CREATED_AT
WAREHOUSE = FFP_HDP_DLAB_WH_DEV
TARGET_LAG = '1 hour'
AS (
    SELECT * FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.VW_FIR_RECOMMENDATIONS_SEARCH
);


-- ============================================================
-- View for Semantic View Versions Search
-- ============================================================
CREATE OR REPLACE VIEW FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.VW_FIR_SEMANTIC_VERSIONS_SEARCH AS
SELECT
    VERSION_ID,
    SEMANTIC_VIEW_FQN,
    VERSION_NUMBER,
    VERSION_LABEL,
    PARENT_VERSION_ID,
    CONFIDENCE,
    VALIDATION_STATUS,
    STATUS,
    CREATED_AT,
    -- Composite search text from semantic content.
    -- Subquery expressions with change tracking are unsupported; cast VARIANT to STRING instead.
    COALESCE(SEMANTIC_VIEW_FQN, '') || ' ' ||
    COALESCE(VERSION_LABEL, '') || ' ' ||
    COALESCE(PROMOTION_REASON, '') || ' ' ||
    COALESCE(BUSINESS_GLOSSARY::STRING, '') || ' ' ||
    COALESCE(COLUMN_SEMANTICS::STRING, '') || ' ' ||
    COALESCE(TRANSFORMATION_PATTERNS::STRING, '') || ' ' ||
    COALESCE(RELATIONSHIP_RULES::STRING, '') || ' ' ||
    COALESCE(DERIVED_SOURCE_PATTERNS::STRING, '')
    AS SEARCH_TEXT
FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_VIEW_VERSIONS
WHERE STATUS = 'active';

-- ============================================================
-- CSS_FIR_SEMANTIC_VERSIONS - Semantic Versions Search Service
-- ============================================================
CREATE OR REPLACE CORTEX SEARCH SERVICE FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.CSS_FIR_SEMANTIC_VERSIONS
ON SEARCH_TEXT
ATTRIBUTES
    VERSION_ID,
    SEMANTIC_VIEW_FQN,
    VERSION_NUMBER,
    VERSION_LABEL,
    CONFIDENCE,
    VALIDATION_STATUS,
    CREATED_AT
WAREHOUSE = FFP_HDP_DLAB_WH_DEV
TARGET_LAG = '1 hour'
AS (
    SELECT * FROM FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.VW_FIR_SEMANTIC_VERSIONS_SEARCH
);
-- ============================================================
-- FIR System Snowflake Tasks
-- Automated batch processing triggered by data changes.
-- ============================================================

-- ============================================================
-- TSK_FIR_PROCESS_BATCH - Main FIR Processing Task
-- Runs every 5 minutes when any FIR stream has changes.
-- ============================================================
CREATE OR REPLACE TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_PROCESS_BATCH
    WAREHOUSE = FFP_HDP_DLAB_WH_DEV
    SCHEDULE = '5 MINUTES'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    TASK_AUTO_RETRY_ATTEMPTS = 2
    USER_TASK_TIMEOUT_MS = 3600000
    COMMENT = 'Main FIR batch processing task triggered by stream changes. Collects feedback, generates inferences, and creates recommendations.'
WHEN
    SYSTEM$STREAM_HAS_DATA('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_WORKBENCH_FEEDBACK') OR
    SYSTEM$STREAM_HAS_DATA('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_STTM_ATTRIBUTES') OR
    SYSTEM$STREAM_HAS_DATA('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_DERIVED_SOURCES') OR
    SYSTEM$STREAM_HAS_DATA('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_SEM_TABLE_VIEWS') OR
    SYSTEM$STREAM_HAS_DATA('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_CONVERSATION_TURNS') OR
    SYSTEM$STREAM_HAS_DATA('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_STTM_VERSIONS') OR
    SYSTEM$STREAM_HAS_DATA('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_CLIENT_SQL_ASSETS')
AS
CALL FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_INVOKE_AGENT(
    OBJECT_CONSTRUCT(
        'task_type', 'stream_triggered',
        'batch_size', 100,
        'processing_options', OBJECT_CONSTRUCT(
            'collect_feedback', TRUE,
            'generate_inferences', TRUE,
            'create_semantic_versions', TRUE,
            'generate_recommendations', TRUE,
            'apply_decay', FALSE,
            'parse_documents', TRUE
        )
    )
);


-- ============================================================
-- TSK_FIR_CONFIDENCE_DECAY - Daily Confidence Decay Task
-- Runs daily at 2 AM to apply temporal decay to confidence scores.
-- ============================================================
CREATE OR REPLACE TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_CONFIDENCE_DECAY
    WAREHOUSE = FFP_HDP_DLAB_WH_DEV
    SCHEDULE = 'USING CRON 0 2 * * * America/New_York'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    USER_TASK_TIMEOUT_MS = 1800000
    COMMENT = 'Daily task to apply temporal decay to FIR confidence scores. Runs at 2 AM EST.'
AS
CALL FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_APPLY_CONFIDENCE_DECAY();


-- ============================================================
-- TSK_FIR_SEMANTIC_CONSOLIDATION - Weekly Consolidation Task
-- Runs weekly on Sundays at 4 AM to consolidate semantic versions.
-- ============================================================
CREATE OR REPLACE TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_SEMANTIC_CONSOLIDATION
    WAREHOUSE = FFP_HDP_DLAB_WH_DEV
    SCHEDULE = 'USING CRON 0 4 * * 0 America/New_York'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    USER_TASK_TIMEOUT_MS = 3600000
    COMMENT = 'Weekly task to consolidate semantic versions, archive old versions, and validate high-confidence versions. Runs Sunday 4 AM EST.'
AS
CALL FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_CONSOLIDATE_SEMANTIC_VERSIONS();


-- ============================================================
-- TSK_FIR_SEMANTIC_PRECOMPUTE - Semantic Pre-computation Task
-- Triggered when semantic views or curated versions change.
-- Discovers meaningful table combinations and generates
-- proactive recommendations for all downstream agents.
-- ============================================================
CREATE OR REPLACE TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_SEMANTIC_PRECOMPUTE
    WAREHOUSE = FFP_HDP_DLAB_WH_DEV
    SCHEDULE = '10 MINUTES'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    TASK_AUTO_RETRY_ATTEMPTS = 1
    USER_TASK_TIMEOUT_MS = 7200000
    COMMENT = 'Semantic pre-computation task. Triggered when semantic views change. Generates proactive FIR recommendations for all meaningful table permutations.'
WHEN
    SYSTEM$STREAM_HAS_DATA('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_SEM_TABLE_VIEWS') OR
    SYSTEM$STREAM_HAS_DATA('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_SEM_COLUMN_VIEWS') OR
    SYSTEM$STREAM_HAS_DATA('FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.STM_FIR_SEMANTIC_VERSIONS')
AS
CALL FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_PRECOMPUTE_PERMUTATIONS(
    OBJECT_CONSTRUCT(
        'max_pairs_per_batch', 10,
        'skip_if_recent_days', 7
    )
);


-- ============================================================
-- TSK_FIR_RECOMMENDATION_SCORING - Periodic Scoring Task
-- Runs daily after confidence decay to re-score all active
-- recommendations based on usage, recency, and ML scores.
-- ============================================================
CREATE OR REPLACE TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_RECOMMENDATION_SCORING
    WAREHOUSE = FFP_HDP_DLAB_WH_DEV
    SCHEDULE = 'USING CRON 30 2 * * * America/New_York'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    USER_TASK_TIMEOUT_MS = 900000
    COMMENT = 'Daily recommendation scoring task. Runs at 2:30 AM EST after confidence decay. Updates RECOMMENDATION_PRIORITY based on usage, recency, feedback, and ML scores.'
AS
CALL FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.SP_FIR_SCORE_RECOMMENDATIONS();


-- ============================================================
-- Task Management Commands (run manually after deployment)
-- ============================================================

-- Resume tasks after creation
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_PROCESS_BATCH RESUME;
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_CONFIDENCE_DECAY RESUME;
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_SEMANTIC_CONSOLIDATION RESUME;
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_SEMANTIC_PRECOMPUTE RESUME;
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_RECOMMENDATION_SCORING RESUME;

-- Suspend tasks for maintenance
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_PROCESS_BATCH SUSPEND;
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_CONFIDENCE_DECAY SUSPEND;
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_SEMANTIC_CONSOLIDATION SUSPEND;
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_SEMANTIC_PRECOMPUTE SUSPEND;
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_RECOMMENDATION_SCORING SUSPEND;

-- Check task status
-- SHOW TASKS LIKE 'TSK_FIR_%' IN SCHEMA FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA;

-- View task history
-- SELECT *
-- FROM TABLE(INFORMATION_SCHEMA.TASK_HISTORY(
--     TASK_NAME => 'TSK_FIR_PROCESS_BATCH',
--     SCHEDULED_TIME_RANGE_START => DATEADD('hour', -24, CURRENT_TIMESTAMP())
-- ))
-- ORDER BY SCHEDULED_TIME DESC;

-- Manually trigger task for testing
-- EXECUTE TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_PROCESS_BATCH;


-- ==============================================================================
-- POST-DEPLOYMENT: Resume Tasks (run manually after verifying everything works)
-- ==============================================================================
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_PROCESS_BATCH RESUME;
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_CONFIDENCE_DECAY RESUME;
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_SEMANTIC_CONSOLIDATION RESUME;
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_SEMANTIC_PRECOMPUTE RESUME;
-- ALTER TASK FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA.TSK_FIR_RECOMMENDATION_SCORING RESUME;

-- ==============================================================================
-- VERIFICATION QUERIES
-- ==============================================================================
-- SHOW TABLES LIKE 'TBL_%FIR%' IN SCHEMA FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA;
-- SHOW TABLES LIKE 'TBL_SEMANTIC_VIEW_VERSIONS' IN SCHEMA FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA;
-- SHOW PROCEDURES LIKE 'SP_FIR_%' IN SCHEMA FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA;
-- SHOW STREAMS LIKE 'STM_FIR_%' IN SCHEMA FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA;
-- SHOW TASKS LIKE 'TSK_FIR_%' IN SCHEMA FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA;
-- SHOW CORTEX SEARCH SERVICES IN SCHEMA FFP_HDP_DLAB_DB_DEV.SCH_STTM_METADATA;
