-- ============================================================
-- TBL_FIR_AGENT_RECOMMENDATIONS - Agent-Specific Recommendations
-- Pre-formatted recommendations for each agent with trigger conditions.
-- Enables proactive recommendation injection into agent learning_context.
-- ============================================================

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS (
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
                                CONSTRAINT CHK_TRIGGER_TYPE_FIR2 CHECK (TRIGGER_TYPE IN (
                                    'on_project_create',
                                    'on_source_selection',
                                    'on_target_selection',
                                    'on_mapping_create',
                                    'on_mapping_start',
                                    'on_mapping_execute',
                                    'on_join_creation',
                                    'on_auto_map_review',
                                    'on_transformation_review',
                                    'on_derived_source_select',
                                    'on_derived_source_create',
                                    'on_derived_source_save',
                                    'on_transform_request',
                                    'on_sttm_publish',
                                    'on_publish',
                                    'on_dbt_start',
                                    'on_test_generation',
                                    'on_conversation_start',
                                    'on_semantic_model_request',
                                    'on_user_notification_response',
                                    'on_document_upload',
                                    'project_created',
                                    'project_opened',
                                    'mapping_created',
                                    'schema_browsed',
                                    'selection_changed',
                                    'target_selected',
                                    'source_set_completed',
                                    'join_completed',
                                    'derived_source_planning',
                                    'derived_source_selected',
                                    'derived_source_saved',
                                    'source_query_review',
                                    'mapping_ready',
                                    'before_auto_map',
                                    'on_auto_map_review',
                                    'on_transformation_review',
                                    'before_validation',
                                    'after_validation',
                                    'before_publish',
                                    'sttm_published',
                                    'document_uploaded',
                                    'analyst_answer_review',
                                    'semantic_refresh'
                                )),
    TRIGGER_CONDITION       STRING,

    -- Recommendation content
    RECOMMENDATION_TYPE     STRING          NOT NULL
                                CONSTRAINT CHK_RECOMMENDATION_TYPE_FIR2 CHECK (RECOMMENDATION_TYPE IN (
                                    'pattern_reuse',
                                    'correction_warning',
                                    'similar_mapping',
                                    'derived_source_suggestion',
                                    'transformation_pattern',
                                    'preprocessing_rule',
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
    APPLICABLE_SCHEMAS      VARIANT,
    USER_ID                 STRING,
    PROJECT_ID              STRING,
    STTM_ID                 STRING,
    CHECKPOINT              STRING,
    SCOPE_TYPE              STRING,
    SCOPE_KEY               STRING,
    RECOMMENDATION_CATEGORY STRING,
    ACTION_CONTRACT         VARIANT,
    GROUP_KEY               STRING,
    CONTENT_VERSION         INTEGER         DEFAULT 1,
    SUPERSEDES_RECOMMENDATION_ID STRING,
    EVIDENCE_SUMMARY        VARCHAR,

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
