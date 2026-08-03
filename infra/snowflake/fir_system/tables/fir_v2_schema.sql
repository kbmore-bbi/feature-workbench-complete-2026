-- FIR 2.0 additive schema migration.
-- This file is intentionally idempotent so it can reconcile older deployments.

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_WORKSPACE_SNAPSHOTS (
    SNAPSHOT_ID STRING NOT NULL,
    SESSION_ID STRING,
    THREAD_ID STRING,
    CONTEXT_VERSION STRING NOT NULL DEFAULT '2.0',
    CONTEXT_HASH STRING NOT NULL,
    CONTEXT_KEY STRING,
    ACTION STRING,
    MILESTONE STRING,
    PAGE STRING,
    SURFACE STRING,
    PROJECT_ID STRING,
    STTM_ID STRING,
    SEMANTIC_BUNDLE_ID STRING,
    SEMANTIC_BUNDLE_HASH STRING,
    MAPPING_VERSION STRING,
    SNAPSHOT_PAYLOAD VARIANT NOT NULL,
    USER_ID STRING,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT PK_TBL_WORKSPACE_SNAPSHOTS PRIMARY KEY (SNAPSHOT_ID)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_AGENT_ARTIFACTS (
    ARTIFACT_ID STRING NOT NULL,
    REQUEST_ID STRING,
    SESSION_ID STRING,
    THREAD_ID STRING,
    AGENT_NAME STRING NOT NULL,
    ARTIFACT_TYPE STRING NOT NULL,
    ARTIFACT_STATUS STRING DEFAULT 'draft',
    ENTITY_TYPE STRING,
    ENTITY_IDS VARIANT,
    CONTEXT_KEY STRING,
    SNAPSHOT_ID STRING,
    SEMANTIC_BUNDLE_ID STRING,
    SEMANTIC_BUNDLE_HASH STRING,
    RETRIEVED_INFERENCE_IDS VARIANT,
    RETRIEVED_RECOMMENDATION_IDS VARIANT,
    USED_INFERENCE_IDS VARIANT,
    USED_RECOMMENDATION_IDS VARIANT,
    PAYLOAD VARIANT NOT NULL,
    SUMMARY STRING,
    CREATED_BY STRING,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT PK_TBL_AGENT_ARTIFACTS PRIMARY KEY (ARTIFACT_ID)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_CHECKPOINT_DEFINITIONS (
    CHECKPOINT_ID STRING NOT NULL,
    WORKFLOW_PHASE STRING NOT NULL,
    ELIGIBLE_GOALS VARIANT NOT NULL,
    RECOMMENDATION_CATEGORIES VARIANT NOT NULL,
    REQUIRED_CONTEXT_FIELDS VARIANT,
    RETRIEVAL_SCOPES VARIANT NOT NULL,
    MAX_INLINE_ITEMS INTEGER DEFAULT 5,
    MAX_INTERRUPTIVE_QUESTIONS INTEGER DEFAULT 1,
    DISPLAY_SURFACES VARIANT NOT NULL,
    VERSION INTEGER DEFAULT 1,
    STATUS STRING DEFAULT 'active',
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT PK_TBL_FIR_CHECKPOINT_DEFINITIONS PRIMARY KEY (CHECKPOINT_ID)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_EVIDENCE_ITEMS (
    EVIDENCE_ID STRING NOT NULL,
    SOURCE_TYPE STRING NOT NULL,
    SOURCE_TABLE STRING,
    SOURCE_RECORD_ID STRING,
    TITLE STRING NOT NULL,
    SUMMARY STRING NOT NULL,
    REDACTED_EXCERPT STRING,
    STRUCTURED_PAYLOAD VARIANT,
    DOCUMENT_LOCATION STRING,
    PROJECT_ID STRING,
    STTM_ID STRING,
    SNAPSHOT_ID STRING,
    CONTEXT_KEY STRING,
    POLARITY STRING DEFAULT 'supporting',
    EVIDENCE_WEIGHT FLOAT DEFAULT 0.5,
    SOURCE_HASH STRING,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT PK_TBL_FIR_EVIDENCE_ITEMS PRIMARY KEY (EVIDENCE_ID)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_AGENT_LEARNINGS (
    LEARNING_ID STRING NOT NULL,
    AGENT_TYPE STRING NOT NULL,
    LEARNING_TYPE STRING NOT NULL,
    LEARNING_KEY STRING,
    SUMMARY STRING NOT NULL,
    CONFIDENCE FLOAT DEFAULT 0.5,
    ENTITY_TYPE STRING,
    ENTITY_IDS VARIANT,
    ATTRIBUTES VARIANT NOT NULL,
    TAGS ARRAY,
    USAGE_COUNT INTEGER DEFAULT 0,
    SUCCESS_COUNT INTEGER DEFAULT 0,
    LAST_USED_AT TIMESTAMP_NTZ,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CREATED_BY STRING,
    STATUS STRING DEFAULT 'active',
    SUPERSEDED_BY STRING,
    CONSTRAINT PK_TBL_AGENT_LEARNINGS PRIMARY KEY (LEARNING_ID)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_ASSET_TABLE_REFERENCES (
    REFERENCE_ID STRING NOT NULL,
    SQL_ASSET_ID STRING NOT NULL,
    PROJECT_ID STRING,
    RAW_IDENTIFIER STRING NOT NULL,
    REFERENCE_ROLE STRING NOT NULL,
    RESOLUTION_STATUS STRING NOT NULL,
    RESOLVED_FQN STRING,
    CANDIDATE_FQNS VARIANT,
    SEMANTIC_TABLE_VIEW_ID STRING,
    SEMANTIC_STATUS STRING,
    RESOLUTION_METHOD STRING,
    RESOLUTION_CONFIDENCE FLOAT,
    ATTRIBUTES VARIANT,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT PK_TBL_FIR_ASSET_TABLE_REFERENCES PRIMARY KEY (REFERENCE_ID)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_CONTEXT_EVIDENCE (
    EVIDENCE_CONTEXT_ID STRING NOT NULL,
    CONTEXT_KEY STRING NOT NULL,
    PROJECT_ID STRING,
    STTM_ID STRING,
    SNAPSHOT_ID STRING,
    SOURCE_TABLES VARIANT,
    TARGET_TABLE STRING,
    DERIVED_SOURCE_IDS VARIANT,
    SELECTED_COLUMNS VARIANT,
    MILESTONE STRING,
    SEMANTIC_BUNDLE_ID STRING,
    SEMANTIC_HASH STRING,
    EVIDENCE_PAYLOAD VARIANT NOT NULL,
    EVIDENCE_STATUS STRING DEFAULT 'ready',
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT PK_TBL_FIR_CONTEXT_EVIDENCE PRIMARY KEY (EVIDENCE_CONTEXT_ID)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_INFERENCE_EVIDENCE (
    INFERENCE_EVIDENCE_ID STRING NOT NULL,
    INFERENCE_ID STRING NOT NULL,
    EVIDENCE_ID STRING NOT NULL,
    EVIDENCE_TYPE STRING NOT NULL,
    POLARITY STRING NOT NULL,
    WEIGHT FLOAT DEFAULT 0.5,
    EVIDENCE_PAYLOAD VARIANT,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT PK_TBL_FIR_INFERENCE_EVIDENCE PRIMARY KEY (INFERENCE_EVIDENCE_ID)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_INFERENCE_GOALS (
    INFERENCE_GOAL_ID STRING NOT NULL,
    VERSION STRING NOT NULL,
    NAME STRING NOT NULL,
    SUBJECT_TYPE STRING NOT NULL,
    TRIGGER_MILESTONES VARIANT NOT NULL,
    ANSWER_SCHEMA VARIANT NOT NULL,
    QUESTION_TEMPLATE STRING NOT NULL,
    PROMPT_GUIDANCE STRING NOT NULL,
    GOAL_OWNER STRING DEFAULT 'inference',
    CATEGORY STRING,
    RESPONSE_STORAGE STRING,
    OUTPUT_TARGETS VARIANT,
    CHECKPOINT_POLICY VARIANT,
    STATUS STRING DEFAULT 'active',
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT PK_TBL_FIR_INFERENCE_GOALS PRIMARY KEY (INFERENCE_GOAL_ID, VERSION)
);

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_INFERENCE_GOALS ADD COLUMN IF NOT EXISTS GOAL_OWNER STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_INFERENCE_GOALS ADD COLUMN IF NOT EXISTS CATEGORY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_INFERENCE_GOALS ADD COLUMN IF NOT EXISTS RESPONSE_STORAGE STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_INFERENCE_GOALS ADD COLUMN IF NOT EXISTS OUTPUT_TARGETS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_INFERENCE_GOALS ADD COLUMN IF NOT EXISTS CHECKPOINT_POLICY VARIANT;

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_RECOMMENDATION_OUTCOMES (
    OUTCOME_ID STRING NOT NULL,
    AGENT_RECOMMENDATION_ID STRING NOT NULL,
    CONTEXT_KEY STRING,
    SNAPSHOT_ID STRING,
    REQUEST_ID STRING,
    ARTIFACT_ID STRING,
    USER_ID STRING,
    OUTCOME_TYPE STRING NOT NULL,
    OUTCOME_PAYLOAD VARIANT,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT PK_TBL_FIR_RECOMMENDATION_OUTCOMES PRIMARY KEY (OUTCOME_ID)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_FRESHNESS_FEATURES (
    TABLE_FQN STRING NOT NULL,
    TIER STRING DEFAULT 'tier_3',
    DECLARED_FREQUENCY STRING,
    MAXIMUM_STALENESS_MINUTES INTEGER,
    FRESHNESS_COLUMN STRING,
    OBSERVED_LAST_CHANGE_AT TIMESTAMP_NTZ,
    OBSERVED_LAG_MINUTES INTEGER,
    QUERY_COUNT_7D INTEGER DEFAULT 0,
    LAST_QUERIED_AT TIMESTAMP_NTZ,
    FEATURE_PAYLOAD VARIANT,
    REFRESHED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT PK_TBL_FIR_FRESHNESS_FEATURES PRIMARY KEY (TABLE_FQN)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_PROFILE_FEATURES (
    TABLE_FQN STRING NOT NULL,
    SCHEMA_HASH STRING,
    ROW_COUNT NUMBER,
    COLUMN_PROFILES VARIANT,
    OVERLAP_SAMPLES VARIANT,
    PROFILE_STATUS STRING DEFAULT 'ready',
    PROFILED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT PK_TBL_FIR_PROFILE_FEATURES PRIMARY KEY (TABLE_FQN)
);

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS INFERENCE_GOAL_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS SUBJECT_KEY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS CONTEXT_KEY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS STRUCTURED_ANSWER VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS CONFIDENCE_BAND STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS SUPPORT_COUNT INTEGER;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS CONTRADICTION_COUNT INTEGER;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS VALIDATION_STATUS STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS SUPERSEDES_INFERENCE_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS AGENT_NOTES STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS PROJECT_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS STTM_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS EVIDENCE_IDS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS CONTRADICTIONS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES ADD COLUMN IF NOT EXISTS PROVENANCE VARIANT;

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKSPACE_SNAPSHOTS ADD COLUMN IF NOT EXISTS CONTEXT_KEY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKSPACE_SNAPSHOTS ADD COLUMN IF NOT EXISTS ACTION STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKSPACE_SNAPSHOTS ADD COLUMN IF NOT EXISTS MILESTONE STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_AGENT_ARTIFACTS ADD COLUMN IF NOT EXISTS CONTEXT_KEY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_AGENT_ARTIFACTS ADD COLUMN IF NOT EXISTS SNAPSHOT_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_AGENT_ARTIFACTS ADD COLUMN IF NOT EXISTS USED_INFERENCE_IDS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_AGENT_ARTIFACTS ADD COLUMN IF NOT EXISTS USED_RECOMMENDATION_IDS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_AGENT_ARTIFACTS ADD COLUMN IF NOT EXISTS RETRIEVED_INFERENCE_IDS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_AGENT_ARTIFACTS ADD COLUMN IF NOT EXISTS RETRIEVED_RECOMMENDATION_IDS VARIANT;

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FEEDBACK ADD COLUMN IF NOT EXISTS CONTEXT_KEY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FEEDBACK ADD COLUMN IF NOT EXISTS QUESTION_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FEEDBACK ADD COLUMN IF NOT EXISTS INFERENCE_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FEEDBACK ADD COLUMN IF NOT EXISTS AGENT_RECOMMENDATION_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FEEDBACK ADD COLUMN IF NOT EXISTS SNAPSHOT_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FEEDBACK ADD COLUMN IF NOT EXISTS CORRECTION_PAYLOAD VARIANT;

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FIR_EVENTS ADD COLUMN IF NOT EXISTS CONTEXT_KEY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FIR_EVENTS ADD COLUMN IF NOT EXISTS SNAPSHOT_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FIR_EVENTS ADD COLUMN IF NOT EXISTS MILESTONE STRING;

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 ADD COLUMN IF NOT EXISTS CONTEXT_KEY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 ADD COLUMN IF NOT EXISTS SNAPSHOT_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 ADD COLUMN IF NOT EXISTS MILESTONE STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 ADD COLUMN IF NOT EXISTS EVIDENCE_CONTEXT_ID STRING;

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS CONTEXT_KEY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS CONTEXT_VERSION STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS SOURCE_SET_HASH STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS TARGET_FQN STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS DERIVED_SET_HASH STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS MILESTONE STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS QUESTION_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS EVIDENCE_IDS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS VALIDATION_STATUS STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS APPLICABLE_SCHEMAS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS SCOPE_TYPE STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS SCOPE_KEY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS RECOMMENDATION_CATEGORY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS ACTION_CONTRACT VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS GROUP_KEY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS CONTENT_VERSION INTEGER;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS SUPERSEDES_RECOMMENDATION_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS ADD COLUMN IF NOT EXISTS EVIDENCE_SUMMARY STRING;

-- Older deployments created unnamed CHECK constraints, which Snowflake stores
-- as SYS_CONSTRAINT_* names. Drop only the legacy trigger/recommendation checks
-- by inspecting their clauses before installing the FIR 2.0 named constraints.
EXECUTE IMMEDIATE
$$
DECLARE
    drop_sql STRING;
    legacy_checks CURSOR FOR
        SELECT tc.CONSTRAINT_NAME
        FROM __DATABASE__.INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        INNER JOIN __DATABASE__.INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
            ON cc.CONSTRAINT_CATALOG = tc.CONSTRAINT_CATALOG
           AND cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
           AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        WHERE UPPER(tc.TABLE_SCHEMA) =
              UPPER(SPLIT_PART('__STTM_METADATA_NAMESPACE__', '.', 2))
          AND UPPER(tc.TABLE_NAME) = 'TBL_FIR_AGENT_RECOMMENDATIONS'
          AND UPPER(tc.CONSTRAINT_TYPE) = 'CHECK'
          AND (
              UPPER(cc.CHECK_CLAUSE) LIKE '%TRIGGER_TYPE%'
              OR UPPER(cc.CHECK_CLAUSE) LIKE '%RECOMMENDATION_TYPE%'
          );
BEGIN
    FOR constraint_row IN legacy_checks DO
        drop_sql := 'ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS '
            || 'DROP CONSTRAINT "' || REPLACE(constraint_row.CONSTRAINT_NAME, '"', '""') || '"';
        EXECUTE IMMEDIATE :drop_sql;
    END FOR;
END;
$$;

EXECUTE IMMEDIATE
$$
BEGIN
    ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
        DROP CONSTRAINT CHK_TRIGGER_TYPE;
EXCEPTION
    WHEN STATEMENT_ERROR THEN
        NULL;
END;
$$;

EXECUTE IMMEDIATE
$$
BEGIN
    ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
        DROP CONSTRAINT CHK_TRIGGER_TYPE_FIR2;
EXCEPTION
    WHEN STATEMENT_ERROR THEN
        NULL;
END;
$$;

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
    ADD CONSTRAINT CHK_TRIGGER_TYPE_FIR2 CHECK (TRIGGER_TYPE IN (
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
    )) ENABLE NOVALIDATE;

EXECUTE IMMEDIATE
$$
BEGIN
    ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
        DROP CONSTRAINT CHK_RECOMMENDATION_TYPE_V2;
EXCEPTION
    WHEN STATEMENT_ERROR THEN
        NULL;
END;
$$;

EXECUTE IMMEDIATE
$$
BEGIN
    ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
        DROP CONSTRAINT CHK_RECOMMENDATION_TYPE_FIR2;
EXCEPTION
    WHEN STATEMENT_ERROR THEN
        NULL;
END;
$$;

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
    ADD CONSTRAINT CHK_RECOMMENDATION_TYPE_FIR2 CHECK (RECOMMENDATION_TYPE IN (
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
    )) ENABLE NOVALIDATE;

UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
SET CONTENT_VERSION = 1
WHERE CONTENT_VERSION IS NULL;

UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
SET QUESTION_ID = NULL
WHERE LOWER(TRIM(COALESCE(QUESTION_ID, ''))) IN ('none', 'null', 'undefined', 'n/a');

UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
SET MILESTONE = CASE LOWER(TRIM(COALESCE(MILESTONE, TRIGGER_TYPE)))
        WHEN 'on_project_create' THEN 'project_created'
        WHEN 'on_mapping_create' THEN 'mapping_created'
        WHEN 'on_source_selection' THEN 'selection_changed'
        WHEN 'on_target_selection' THEN 'target_selected'
        WHEN 'on_join_creation' THEN 'join_completed'
        WHEN 'on_derived_source_create' THEN 'derived_source_planning'
        WHEN 'on_derived_source_select' THEN 'derived_source_selected'
        WHEN 'on_derived_source_save' THEN 'derived_source_saved'
        WHEN 'on_mapping_start' THEN 'before_auto_map'
        WHEN 'on_mapping_execute' THEN 'mapping_ready'
        WHEN 'auto_map_review' THEN 'on_auto_map_review'
        WHEN 'on_transform_request' THEN 'on_transformation_review'
        WHEN 'transformation_review' THEN 'on_transformation_review'
        WHEN 'on_sttm_publish' THEN 'sttm_published'
        WHEN 'on_publish' THEN 'sttm_published'
        WHEN 'publish' THEN 'before_publish'
        WHEN 'source_selection' THEN 'selection_changed'
        WHEN 'join_creation' THEN 'join_completed'
        WHEN 'derived_source_creation' THEN 'derived_source_planning'
        WHEN 'derived_source_save' THEN 'derived_source_saved'
        WHEN 'on_document_upload' THEN 'document_uploaded'
        ELSE LOWER(TRIM(COALESCE(MILESTONE, TRIGGER_TYPE)))
    END,
    UPDATED_AT = CURRENT_TIMESTAMP()
WHERE STATUS = 'active';

MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_FIR_CHECKPOINT_DEFINITIONS target
USING (
    SELECT column1 AS checkpoint_id, column2 AS workflow_phase,
           PARSE_JSON(column3) AS goals, PARSE_JSON(column4) AS categories,
           PARSE_JSON(column5) AS required_fields, PARSE_JSON(column6) AS scopes,
           column7 AS max_inline, column8 AS max_questions, PARSE_JSON(column9) AS surfaces
    FROM VALUES
      ('project_created','project','["Q1","Q4","Q10"]','["target_context","analysis"]','["project_id"]','["project"]',5,1,'["inbox","assistant"]'),
      ('project_opened','project','["Q1","Q4","Q10"]','["target_context","analysis"]','["project_id"]','["project"]',8,1,'["inbox","inline"]'),
      ('mapping_created','mapping_setup','["Q1","Q4"]','["target_context","source_discovery"]','["project_id"]','["mapping"]',5,1,'["inbox","assistant"]'),
      ('schema_browsed','mapping_setup','["Q1","Q6","Q9"]','["source_discovery","relationship","target_context"]','["browsing_context.schema"]','["schema","project"]',8,1,'["inline","inbox"]'),
      ('selection_changed','table_selection','["Q1","Q6"]','["source_discovery","relationship"]','["source_tables"]','["table","table_set"]',6,1,'["inline","inbox","assistant"]'),
      ('source_set_completed','table_selection','["Q6","Q9"]','["relationship","query_shaping"]','["source_tables"]','["table_set"]',8,1,'["inline","inbox","assistant"]'),
      ('target_selected','table_selection','["Q1","Q2","Q7"]','["target_context","source_discovery","derived_source"]','["target_table"]','["target","table_set"]',8,1,'["inline","inbox","assistant"]'),
      ('join_completed','source_design','["Q6"]','["relationship","query_shaping"]','["relationships"]','["table_set"]',8,1,'["inline","inbox","assistant","toast"]'),
      ('derived_source_planning','source_design','["Q7","Q9"]','["derived_source","query_shaping"]','["source_tables","target_table"]','["table_set","target"]',8,1,'["inline","inbox"]'),
      ('derived_source_selected','source_design','["Q7"]','["derived_source","relationship"]','["derived_sources"]','["derived_source","table_set"]',8,1,'["inline","inbox","assistant"]'),
      ('derived_source_saved','source_design','["Q7"]','["derived_source","relationship"]','["derived_sources"]','["derived_source","table_set"]',8,1,'["inline","inbox","assistant"]'),
      ('source_query_review','source_design','["Q6","Q7","Q9"]','["query_shaping","relationship"]','["source_tables","target_table"]','["table_set","target"]',8,1,'["inline","inbox"]'),
      ('mapping_ready','mapping','["Q1","Q2","Q6","Q7"]','["column_mapping","relationship","derived_source"]','["source_tables","target_table"]','["mapping","table_set"]',8,1,'["inline","inbox","assistant"]'),
      ('before_auto_map','mapping','["Q1","Q2","Q6","Q7"]','["column_mapping","relationship","transformation"]','["source_tables","target_table"]','["mapping","table_set"]',8,1,'["inline","inbox","assistant"]'),
      ('on_auto_map_review','mapping','["Q2","Q6","Q7","Q9"]','["column_mapping","transformation","query_shaping"]','["mapping_rows"]','["mapping","column"]',10,1,'["inline","inbox","assistant"]'),
      ('on_transformation_review','mapping','["Q2","Q7"]','["transformation","validation"]','["mapping_rows"]','["mapping","column"]',8,1,'["inline","inbox","assistant"]'),
      ('before_validation','validation','["Q2","Q6","Q7"]','["validation","relationship","transformation"]','["mapping_sql"]','["mapping"]',8,1,'["inline","inbox","toast"]'),
      ('after_validation','validation','["Q2","Q6","Q7","Q9"]','["validation","transformation","query_shaping"]','["validation_history"]','["mapping"]',8,1,'["inline","inbox","assistant"]'),
      ('before_publish','publication','["Q3","Q4","Q5","Q6","Q7","Q8","Q10"]','["publish","validation","relationship"]','["mapping_rows","validation_history"]','["mapping","project"]',10,1,'["inline","inbox","assistant","toast"]'),
      ('sttm_published','publication','["Q8","Q9","Q10"]','["publish","analysis","query_shaping"]','["sttm_id"]','["mapping","project"]',10,1,'["inbox","assistant"]'),
      ('document_uploaded','evidence','["Q1","Q2","Q3","Q5","Q6","Q7","Q8","Q9"]','["source_discovery","relationship","derived_source","transformation","query_shaping"]','["project_id"]','["project","table_set"]',10,1,'["inbox"]'),
      ('analyst_answer_review','evidence','["Q9","Q10"]','["analysis","query_shaping"]','["mapping_sql"]','["mapping","table_set"]',8,1,'["inbox","assistant"]')
) source
ON target.CHECKPOINT_ID = source.checkpoint_id
WHEN MATCHED THEN UPDATE SET
    WORKFLOW_PHASE = source.workflow_phase,
    ELIGIBLE_GOALS = source.goals,
    RECOMMENDATION_CATEGORIES = source.categories,
    REQUIRED_CONTEXT_FIELDS = source.required_fields,
    RETRIEVAL_SCOPES = source.scopes,
    MAX_INLINE_ITEMS = source.max_inline,
    MAX_INTERRUPTIVE_QUESTIONS = source.max_questions,
    DISPLAY_SURFACES = source.surfaces,
    UPDATED_AT = CURRENT_TIMESTAMP(),
    STATUS = 'active'
WHEN NOT MATCHED THEN INSERT (
    CHECKPOINT_ID, WORKFLOW_PHASE, ELIGIBLE_GOALS, RECOMMENDATION_CATEGORIES,
    REQUIRED_CONTEXT_FIELDS, RETRIEVAL_SCOPES, MAX_INLINE_ITEMS,
    MAX_INTERRUPTIVE_QUESTIONS, DISPLAY_SURFACES
) VALUES (
    source.checkpoint_id, source.workflow_phase, source.goals, source.categories,
    source.required_fields, source.scopes, source.max_inline,
    source.max_questions, source.surfaces
);

UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS r
SET TRIGGER_TYPE = r.MILESTONE,
    RECOMMENDATION_CATEGORY = COALESCE(
        r.RECOMMENDATION_CATEGORY,
        CASE LOWER(COALESCE(r.RECOMMENDATION_TYPE, ''))
            WHEN 'table_suggestion' THEN 'source_discovery'
            WHEN 'relationship_hint' THEN 'relationship'
            WHEN 'derived_source_suggestion' THEN 'derived_source'
            WHEN 'column_mapping_hint' THEN 'column_mapping'
            WHEN 'historical_mapping_pattern' THEN 'column_mapping'
            WHEN 'similar_mapping' THEN 'column_mapping'
            WHEN 'mapping_insight' THEN 'column_mapping'
            WHEN 'transformation_pattern' THEN 'transformation'
            WHEN 'preprocessing_rule' THEN 'transformation'
            WHEN 'correction_warning' THEN 'validation'
            WHEN 'business_rule' THEN 'query_shaping'
            WHEN 'semantic_qa' THEN 'analysis'
            WHEN 'feedback_question' THEN 'analysis'
            WHEN 'project_context' THEN 'target_context'
            WHEN 'context_enrichment' THEN 'analysis'
            ELSE 'analysis'
        END
    ),
    SCOPE_TYPE = COALESCE(
        r.SCOPE_TYPE,
        CASE
            WHEN r.MILESTONE = 'schema_browsed' THEN 'schema'
            WHEN r.MILESTONE LIKE 'derived_source%' THEN 'derived_source'
            WHEN r.MILESTONE = 'target_selected' THEN 'target'
            WHEN r.MILESTONE IN (
                'mapping_created', 'mapping_ready', 'before_auto_map',
                'on_auto_map_review', 'on_transformation_review',
                'before_validation', 'after_validation',
                'before_publish', 'sttm_published'
            ) THEN 'mapping'
            WHEN r.MILESTONE IN ('project_created', 'project_opened') THEN 'project'
            ELSE 'table_set'
        END
    ),
    SCOPE_KEY = COALESCE(
        r.SCOPE_KEY,
        'scope_' || SUBSTR(SHA2(CONCAT_WS(
            '|',
            COALESCE(r.CONTEXT_KEY, ''),
            COALESCE(r.SOURCE_SET_HASH, ''),
            COALESCE(r.TARGET_FQN, ''),
            COALESCE(r.DERIVED_SET_HASH, ''),
            COALESCE(r.MILESTONE, '')
        ), 256), 1, 40)
    ),
    GROUP_KEY = COALESCE(
        r.GROUP_KEY,
        SHA2(CONCAT_WS(
            '|',
            COALESCE(r.TARGET_AGENT, ''),
            COALESCE(r.MILESTONE, ''),
            COALESCE(r.RECOMMENDATION_TYPE, ''),
            COALESCE(r.CONTEXT_KEY, r.SOURCE_SET_HASH, r.TARGET_FQN, '')
        ), 256)
    ),
    ACTION_CONTRACT = COALESCE(
        r.ACTION_CONTRACT,
        IFF(
            r.TARGET_AGENT = 'APP_USER_NOTIFICATION',
            IFF(
                r.QUESTION_ID IS NOT NULL
                    AND UPPER(r.QUESTION_ID) NOT IN ('Q8', 'Q9'),
                ARRAY_CONSTRUCT(
                    OBJECT_CONSTRUCT(
                        'id', 'confirm',
                        'label', 'Yes, that is correct',
                        'action', 'confirm',
                        'payload', OBJECT_CONSTRUCT(
                            'recommendation_id', r.AGENT_RECOMMENDATION_ID
                        ),
                        'requires_confirmation', FALSE,
                        'requires_comment', FALSE
                    ),
                    OBJECT_CONSTRUCT(
                        'id', 'correct',
                        'label', 'Needs correction',
                        'action', 'correct',
                        'payload', OBJECT_CONSTRUCT(
                            'recommendation_id', r.AGENT_RECOMMENDATION_ID
                        ),
                        'requires_confirmation', FALSE,
                        'requires_comment', TRUE
                    ),
                    OBJECT_CONSTRUCT(
                        'id', 'explain',
                        'label', 'Explain first',
                        'action', 'open_assistant_explanation',
                        'payload', OBJECT_CONSTRUCT(
                            'recommendation_id', r.AGENT_RECOMMENDATION_ID
                        ),
                        'requires_confirmation', FALSE,
                        'requires_comment', FALSE
                    )
                ),
                ARRAY_CONSTRUCT(
                    OBJECT_CONSTRUCT(
                        'id', 'explain',
                        'label', 'Explain',
                        'action', 'open_assistant_explanation',
                        'payload', OBJECT_CONSTRUCT(
                            'recommendation_id', r.AGENT_RECOMMENDATION_ID
                        ),
                        'requires_confirmation', FALSE,
                        'requires_comment', FALSE
                    ),
                    OBJECT_CONSTRUCT(
                        'id', 'dismiss',
                        'label', 'Dismiss',
                        'action', 'dismiss',
                        'payload', OBJECT_CONSTRUCT(
                            'recommendation_id', r.AGENT_RECOMMENDATION_ID
                        ),
                        'requires_confirmation', FALSE,
                        'requires_comment', FALSE
                    )
                )
            ),
            ARRAY_CONSTRUCT()
        )
    ),
    EVIDENCE_SUMMARY = COALESCE(
        NULLIF(TRIM(r.EVIDENCE_SUMMARY), ''),
        NULLIF(TRIM(r.AGENT_NOTES), ''),
        'Semantic-only guidance; readable supporting evidence has not yet been materialized.'
    ),
    CONTENT_VERSION = COALESCE(r.CONTENT_VERSION, 1),
    QUESTION_ID = IFF(UPPER(COALESCE(r.QUESTION_ID, '')) IN ('Q8', 'Q9'), NULL, r.QUESTION_ID),
    UPDATED_AT = CURRENT_TIMESTAMP()
WHERE r.STATUS = 'active'
  AND EXISTS (
      SELECT 1
      FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_CHECKPOINT_DEFINITIONS c
      WHERE c.CHECKPOINT_ID = r.MILESTONE
        AND c.STATUS = 'active'
  );

-- Checkpoint ownership also determines the user-facing category. Older FIR
-- recommendations often labeled Q6 relationship guidance as "validation" or
-- "analysis", which caused the checkpoint policy to hide otherwise relevant
-- NOTE and join recommendations.
UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
SET RECOMMENDATION_CATEGORY = CASE
        WHEN LOWER(MILESTONE) IN ('schema_browsed', 'selection_changed')
             AND UPPER(COALESCE(QUESTION_ID, 'Q1')) = 'Q6'
            THEN 'relationship'
        WHEN LOWER(MILESTONE) IN ('schema_browsed', 'selection_changed')
            THEN 'source_discovery'
        WHEN LOWER(MILESTONE) IN ('source_set_completed', 'join_completed')
             AND UPPER(COALESCE(QUESTION_ID, 'Q6')) = 'Q9'
            THEN 'query_shaping'
        WHEN LOWER(MILESTONE) IN ('source_set_completed', 'join_completed')
            THEN 'relationship'
        WHEN LOWER(MILESTONE) = 'target_selected'
             AND UPPER(COALESCE(QUESTION_ID, 'Q1')) = 'Q7'
            THEN 'derived_source'
        WHEN LOWER(MILESTONE) = 'target_selected'
            THEN 'target_context'
        WHEN LOWER(MILESTONE) LIKE 'derived_source%'
             AND UPPER(COALESCE(QUESTION_ID, 'Q7')) = 'Q9'
            THEN 'query_shaping'
        WHEN LOWER(MILESTONE) LIKE 'derived_source%'
            THEN 'derived_source'
        WHEN LOWER(MILESTONE) = 'source_query_review'
             AND UPPER(COALESCE(QUESTION_ID, 'Q9')) = 'Q6'
            THEN 'relationship'
        WHEN LOWER(MILESTONE) = 'source_query_review'
            THEN 'query_shaping'
        WHEN LOWER(MILESTONE) IN ('mapping_ready', 'before_auto_map')
             AND UPPER(COALESCE(QUESTION_ID, 'Q2')) = 'Q6'
            THEN 'relationship'
        WHEN LOWER(MILESTONE) IN ('mapping_ready', 'before_auto_map')
             AND UPPER(COALESCE(QUESTION_ID, 'Q2')) = 'Q7'
            THEN 'derived_source'
        WHEN LOWER(MILESTONE) IN ('mapping_ready', 'before_auto_map', 'on_auto_map_review')
            THEN 'column_mapping'
        WHEN LOWER(MILESTONE) = 'on_transformation_review'
            THEN 'transformation'
        WHEN LOWER(MILESTONE) IN ('before_validation', 'after_validation')
             AND UPPER(COALESCE(QUESTION_ID, '')) = 'Q6'
            THEN 'relationship'
        WHEN LOWER(MILESTONE) IN ('before_validation', 'after_validation')
             AND UPPER(COALESCE(QUESTION_ID, '')) = 'Q9'
            THEN 'query_shaping'
        WHEN LOWER(MILESTONE) IN ('before_validation', 'after_validation')
            THEN 'validation'
        WHEN LOWER(MILESTONE) = 'before_publish'
             AND UPPER(COALESCE(QUESTION_ID, '')) = 'Q6'
            THEN 'relationship'
        WHEN LOWER(MILESTONE) = 'before_publish'
            THEN 'publish'
        WHEN LOWER(MILESTONE) = 'sttm_published'
             AND UPPER(COALESCE(QUESTION_ID, '')) = 'Q9'
            THEN 'query_shaping'
        WHEN LOWER(MILESTONE) = 'sttm_published'
            THEN 'publish'
        ELSE RECOMMENDATION_CATEGORY
    END,
    UPDATED_AT = CURRENT_TIMESTAMP()
WHERE STATUS = 'active'
  AND TARGET_AGENT = 'APP_USER_NOTIFICATION';

UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS r
SET STATUS = 'archived',
    UPDATED_AT = CURRENT_TIMESTAMP()
WHERE r.STATUS = 'active'
  AND r.TARGET_AGENT = 'APP_USER_NOTIFICATION'
  AND NOT EXISTS (
      SELECT 1
      FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_CHECKPOINT_DEFINITIONS c
      WHERE c.CHECKPOINT_ID = r.MILESTONE
        AND c.STATUS = 'active'
  );

CREATE OR REPLACE VIEW __STTM_METADATA_NAMESPACE__.VW_FIR_RECOMMENDATION_EVIDENCE AS
SELECT
    r.AGENT_RECOMMENDATION_ID,
    r.CONTEXT_KEY,
    r.SCOPE_KEY,
    r.MILESTONE AS CHECKPOINT,
    r.TARGET_AGENT,
    r.RECOMMENDATION_TYPE,
    r.RECOMMENDATION_CATEGORY,
    r.DISPLAY_MESSAGE,
    r.CONFIDENCE,
    e.EVIDENCE_ID,
    e.SOURCE_TYPE,
    e.TITLE,
    e.TITLE AS EVIDENCE_TITLE,
    e.SUMMARY,
    e.SUMMARY AS EVIDENCE_SUMMARY,
    e.REDACTED_EXCERPT,
    e.DOCUMENT_LOCATION,
    e.POLARITY,
    e.EVIDENCE_WEIGHT,
    e.CREATED_AT,
    e.CREATED_AT AS EVIDENCE_CREATED_AT,
    e.UPDATED_AT AS EVIDENCE_UPDATED_AT
FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS r
     , LATERAL FLATTEN(INPUT => COALESCE(r.EVIDENCE_IDS, ARRAY_CONSTRUCT())) ids
     , __STTM_METADATA_NAMESPACE__.TBL_FIR_EVIDENCE_ITEMS e
WHERE e.EVIDENCE_ID = ids.VALUE::STRING;

-- Retry recommendations that failed only because the FIR 1.x procedure
-- serialized Python None as invalid JSON. The FIR 2.0 store procedure uses
-- safe parsing and can resume directly from the generated inference.
UPDATE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
SET PROCESSING_STAGE = 'inference_generated',
    PROCESSING_ERROR = NULL,
    UPDATED_AT = CURRENT_TIMESTAMP()
WHERE PROCESSING_STAGE = 'failed'
  AND INFERENCE_PAYLOAD IS NOT NULL
  AND PROCESSING_ERROR ILIKE '%unknown keyword "None"%';

-- Repair active notifications created before checkpoint ownership was
-- enforced by SP_FIR_STORE_RECOMMENDATION.
UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
SET QUESTION_ID = CASE
        WHEN LOWER(MILESTONE) IN ('selection_changed', 'target_selected') THEN 'Q1'
        WHEN LOWER(MILESTONE) IN ('source_set_completed', 'join_completed') THEN 'Q6'
        WHEN LOWER(MILESTONE) IN ('derived_source_selected', 'derived_source_saved') THEN 'Q7'
        WHEN LOWER(MILESTONE) = 'on_auto_map_review' THEN 'Q2'
        WHEN LOWER(MILESTONE) = 'on_transformation_review' THEN 'Q7'
        ELSE QUESTION_ID
    END,
    UPDATED_AT = CURRENT_TIMESTAMP()
WHERE STATUS = 'active'
  AND TARGET_AGENT = 'APP_USER_NOTIFICATION'
  AND LOWER(MILESTONE) IN (
      'selection_changed', 'target_selected', 'source_set_completed',
      'join_completed', 'derived_source_selected', 'derived_source_saved',
      'on_auto_map_review', 'on_transformation_review'
  )
  AND COALESCE(QUESTION_ID, '') <> CASE
        WHEN LOWER(MILESTONE) IN ('selection_changed', 'target_selected') THEN 'Q1'
        WHEN LOWER(MILESTONE) IN ('source_set_completed', 'join_completed') THEN 'Q6'
        WHEN LOWER(MILESTONE) IN ('derived_source_selected', 'derived_source_saved') THEN 'Q7'
        WHEN LOWER(MILESTONE) = 'on_auto_map_review' THEN 'Q2'
        WHEN LOWER(MILESTONE) = 'on_transformation_review' THEN 'Q7'
        ELSE COALESCE(QUESTION_ID, '')
    END;

-- Reconcile semantic version tables created before FIR question/answer learning
-- was added. CREATE TABLE IF NOT EXISTS does not add these columns to an
-- existing deployment, while precompute and QA storage procedures require them.
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS ADD COLUMN IF NOT EXISTS QA_PAIRS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS ADD COLUMN IF NOT EXISTS AGENT_NOTES VARCHAR;

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_DERIVED_SOURCES ADD COLUMN IF NOT EXISTS PURPOSE STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_DERIVED_SOURCES ADD COLUMN IF NOT EXISTS BUSINESS_DESCRIPTION STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_DERIVED_SOURCES ADD COLUMN IF NOT EXISTS OUTPUT_COLUMNS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_DERIVED_SOURCES ADD COLUMN IF NOT EXISTS COLUMN_SEMANTICS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_DERIVED_SOURCES ADD COLUMN IF NOT EXISTS SEMANTIC_PROJECTION VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_DERIVED_SOURCES ADD COLUMN IF NOT EXISTS SOURCE_DEPENDENCY_HASH STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_DERIVED_SOURCES ADD COLUMN IF NOT EXISTS GENERATED_BY_REQUEST_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_DERIVED_SOURCES ADD COLUMN IF NOT EXISTS PHYSICAL_VIEW_NAME STRING;

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_PROJECTS ADD COLUMN IF NOT EXISTS PROJECT_METADATA VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_PROJECTS ADD COLUMN IF NOT EXISTS CREATED_BY_NAME STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM ADD COLUMN IF NOT EXISTS STTM_NAME STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM ADD COLUMN IF NOT EXISTS DESCRIPTION STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM ADD COLUMN IF NOT EXISTS TARGET_TABLE STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM ADD COLUMN IF NOT EXISTS DRAFT_PAYLOAD VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM ADD COLUMN IF NOT EXISTS SEMANTIC_BUNDLE_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM ADD COLUMN IF NOT EXISTS SEMANTIC_BUNDLE_HASH STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM ADD COLUMN IF NOT EXISTS LAST_SNAPSHOT_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM ADD COLUMN IF NOT EXISTS STTM_METADATA VARIANT;
-- Legacy client schemas define LAST_MODIFIED_BY as NUMBER. Preserve that column
-- and store the canonical OAuth/Snowflake string identity here.
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM ADD COLUMN IF NOT EXISTS ACTOR_USER_ID VARCHAR(128);

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM_VERSIONS ADD COLUMN IF NOT EXISTS SNAPSHOT_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM_VERSIONS ADD COLUMN IF NOT EXISTS VERSION_PAYLOAD VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM_VERSIONS ADD COLUMN IF NOT EXISTS SEMANTIC_BUNDLE_ID STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM_VERSIONS ADD COLUMN IF NOT EXISTS SEMANTIC_BUNDLE_HASH STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM_VERSIONS ADD COLUMN IF NOT EXISTS MAPPING_VERSION STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM_VERSIONS ADD COLUMN IF NOT EXISTS AGENT_ARTIFACT_IDS VARIANT;

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_BUNDLES ADD COLUMN IF NOT EXISTS SELECTION_KEY STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_BUNDLES ADD COLUMN IF NOT EXISTS BUNDLE_LABEL STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_BUNDLES ADD COLUMN IF NOT EXISTS ANALYST_TOOL_NAME STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_BUNDLES ADD COLUMN IF NOT EXISTS SEMANTIC_MODEL_YAML STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_BUNDLES ADD COLUMN IF NOT EXISTS REGISTRY_VERSION STRING;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_BUNDLES ADD COLUMN IF NOT EXISTS RAW_ASSETS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_BUNDLES ADD COLUMN IF NOT EXISTS DERIVED_SEMANTICS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_BUNDLES ADD COLUMN IF NOT EXISTS EXCLUDED_RELATIONSHIPS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_BUNDLES ADD COLUMN IF NOT EXISTS COMPOSITION_DIAGNOSTICS VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_BUNDLES ADD COLUMN IF NOT EXISTS BUNDLE_ARTIFACT VARIANT;
ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_PROJECTIONS ADD COLUMN IF NOT EXISTS BUNDLE_HASH STRING;

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_PREPARED_LEARNING_CONTEXTS (
    CONTEXT_KEY STRING NOT NULL,
    ACCESS_FINGERPRINT STRING NOT NULL,
    LEARNING_CONTEXT_ID STRING,
    LEARNING_CONTEXT_HASH STRING,
    CONTEXT_PAYLOAD VARIANT NOT NULL,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Access-isolated durable cache of prepared FIR and precedent context.';

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_PREPARED_WORKSPACE_CONTEXTS (
    WORKSPACE_CONTEXT_ID STRING NOT NULL,
    WORKSPACE_CONTEXT_HASH STRING NOT NULL,
    ACCESS_FINGERPRINT STRING NOT NULL,
    STATUS STRING NOT NULL,
    CONTEXT_PAYLOAD VARIANT NOT NULL,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    LAST_ACCESSED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Dependency-versioned composite handles for semantic, FIR, precedent, and artifact context.';

-- Fixed FIR goal set from the FIR Inference System Template workbook.
-- Q1/Q2/Q3/Q5/Q6/Q7 are inferred assertions. Q4/Q10 are explicit feedback
-- questions. Q8/Q9 are recommendations computed from the inferred graph.
MERGE INTO __STTM_METADATA_NAMESPACE__.TBL_FIR_INFERENCE_GOALS target
USING (
    SELECT column1 AS goal_id, column2 AS name, column3 AS subject_type,
           PARSE_JSON(column4) AS milestones, PARSE_JSON(column5) AS answer_schema,
           column6 AS question_template, column7 AS guidance, column8 AS owner_kind,
           column9 AS goal_category, column10 AS storage_target,
           PARSE_JSON(column11) AS goal_outputs, PARSE_JSON(column12) AS checkpoint_rules
    FROM VALUES
      ('Q1', 'Entity identity', 'table', '["target_selected","before_publish"]',
       '{"entity_name":"string","business_definition":"string","grain":"string","identifiers":["string"],"domain":"string"}',
       'Our current understanding is that {subject} represents {business_definition} at {grain} grain. Is that correct?',
       'Identify what the table represents, its grain, identifiers, domain, and exclusions. Do not infer attribute meaning here.',
       'inference', 'Identity', 'TBL_WORKBENCH_INFERENCES',
       '["APP_USER_NOTIFICATION","AGT_STTM_BUILDER","AGT_SOURCE_MAPPING"]',
       '{"max_questions":1,"blocking":false,"ask_when":"identity is missing, contradictory, or below confidence threshold"}'),
      ('Q2', 'Attribute business meaning', 'column', '["auto_map_review","before_publish"]',
       '{"business_meaning":"string","role":"dimension|time_dimension|fact|identifier","synonyms":["string"],"allowed_usage":"string","default_aggregation":"string|null"}',
       'We understand {subject} to mean {business_meaning} and to be used as {role}. Is that correct?',
       'Explain one consequential column, its business role, terminology, aggregation behavior, and usage restrictions.',
       'inference', 'Identity', 'TBL_WORKBENCH_INFERENCES',
       '["APP_USER_NOTIFICATION","AGT_SOURCE_MAPPING","AGT_TRANSFORMATION_RULE"]',
       '{"max_questions":1,"blocking":false,"ask_when":"a consequential mapping was corrected or remains low confidence"}'),
      ('Q3', 'Business criticality', 'table_or_column', '["before_publish"]',
       '{"criticality":"tier_1|tier_2|tier_3|unknown","business_impact":"string","owners":["string"],"quality_expectations":["string"]}',
       'We currently classify {subject} as {criticality} because {business_impact}. Should we keep that classification?',
       'Determine operational importance, owners, quality expectations, and impact of stale or incorrect data.',
       'inference', 'Criticality', 'TBL_WORKBENCH_INFERENCES',
       '["APP_USER_NOTIFICATION","AGT_STTM_BUILDER","AGT_SEMANTIC_MODEL"]',
       '{"max_questions":1,"blocking":false,"ask_when":"criticality affects validation or publication and is unresolved"}'),
      ('Q4', 'Dependent business processes', 'table_or_mapping', '["before_publish","sttm_published"]',
       '{"business_processes":["string"],"consumers":["string"],"decisions_supported":["string"],"impact_if_wrong":"string"}',
       'We currently understand that {subject} supports {business_processes}. Which important process or consumer have we missed?',
       'Ask the user for dependent processes, consumers, decisions, and operational impact. Do not invent an inference when the evidence is absent.',
       'feedback', 'Criticality', 'TBL_WORKBENCH_FEEDBACK',
       '["APP_USER_NOTIFICATION","AGT_STTM_BUILDER","AGT_SEMANTIC_MODEL"]',
       '{"max_questions":1,"blocking":false,"ask_when":"the mapping is publishable but downstream business use is incomplete"}'),
      ('Q5', 'Freshness expectation', 'table', '["before_publish","semantic_refresh"]',
       '{"expected_frequency":"string","maximum_staleness":"string","freshness_column":"string|null","timezone":"string|null","tier":"string"}',
       'We expect {subject} to refresh {expected_frequency}, with maximum staleness of {maximum_staleness}. Is that correct?',
       'Infer declared freshness separately from observed freshness and record both when evidence is available.',
       'inference', 'Criticality', 'TBL_WORKBENCH_INFERENCES',
       '["APP_USER_NOTIFICATION","AGT_STTM_BUILDER","AGT_SEMANTIC_MODEL"]',
       '{"max_questions":1,"blocking":false,"ask_when":"declared and observed freshness disagree or the SLA is unknown"}'),
      ('Q6', 'Join path and purpose', 'relationship', '["join_completed","before_auto_map","before_publish"]',
       '{"left_table":"string","right_table":"string","join_type":"string","conditions":["string"],"cardinality":"string","business_purpose":"string","safety_notes":["string"]}',
       'We understand this as a {join_type} join between {left_table} and {right_table} for {business_purpose}. Is that correct?',
       'Explain why the join exists, its condition, cardinality, expected coverage, and duplicate or fan-out risk.',
       'inference', 'Relationships', 'TBL_WORKBENCH_INFERENCES',
       '["APP_USER_NOTIFICATION","AGT_STTM_BUILDER","AGT_SOURCE_MAPPING","AGT_TRANSFORMATION_RULE"]',
       '{"max_questions":1,"blocking":"unsafe_or_ambiguous_join","ask_when":"a new join is complete and its purpose or safety is uncertain"}'),
      ('Q7', 'Lineage and derivation', 'derived_source_or_mapping', '["derived_source_saved","transformation_review","before_publish"]',
       '{"inputs":["string"],"outputs":["string"],"transformations":["string"],"filters":["string"],"grain_change":"string","business_purpose":"string"}',
       'We understand {subject} is derived from {inputs} using {transformations} for {business_purpose}. Is that complete?',
       'Capture source-to-output lineage, transformations, filters, grain changes, and the business reason for the derivation.',
       'inference', 'Relationships', 'TBL_WORKBENCH_INFERENCES',
       '["APP_USER_NOTIFICATION","AGT_STTM_BUILDER","AGT_SOURCE_MAPPING","AGT_TRANSFORMATION_RULE","AGT_SEMANTIC_MODEL"]',
       '{"max_questions":1,"blocking":false,"ask_when":"a derived source or material transformation has incomplete business lineage"}'),
      ('Q8', 'Blast-radius recommendation', 'table_or_mapping', '["before_publish","sttm_published"]',
       '{"affected_tables":["string"],"affected_mappings":["string"],"affected_processes":["string"],"risk_level":"string","recommended_checks":["string"]}',
       'Based on the current lineage, changes to {subject} may affect {affected_processes}. Review these checks before continuing: {recommended_checks}.',
       'Generate a concrete impact recommendation from confirmed lineage, dependencies, published STTMs, and Q4 business-process feedback.',
       'recommendation', 'Relationships', 'TBL_FIR_AGENT_RECOMMENDATIONS',
       '["APP_USER_NOTIFICATION","AGT_STTM_BUILDER","AGT_TRANSFORMATION_RULE","AGT_SEMANTIC_MODEL"]',
       '{"max_questions":0,"blocking":false,"ask_when":"never; display as a recommendation when supported by attributed evidence"}'),
      ('Q9', 'Common query patterns', 'table_set', '["auto_map_review","sttm_published","analyst_answer_review"]',
       '{"questions":["string"],"query_patterns":["string"],"metrics":["string"],"filters":["string"],"verified_query_candidates":[{"question":"string","sql":"string"}]}',
       'For {subject}, the strongest reusable analytical patterns are {query_patterns}. Would you like to apply one?',
       'Recommend common questions, joins, metrics, and filters from query history, validated Analyst SQL, and published mappings.',
       'recommendation', 'Usage', 'TBL_FIR_AGENT_RECOMMENDATIONS',
       '["APP_USER_NOTIFICATION","AGT_STTM_BUILDER","AGT_SOURCE_MAPPING","AGT_WORKBENCH_CONVERSATION","CORTEX_ANALYST"]',
       '{"max_questions":0,"blocking":false,"ask_when":"never; show only an exact-context recommendation with validated support"}'),
      ('Q10', 'Untapped questions and blind spots', 'project_or_mapping', '["sttm_published","analyst_answer_review"]',
       '{"missing_questions":["string"],"unserved_consumers":["string"],"known_blind_spots":["string"],"next_learning_priority":"string"}',
       'Our current understanding covers {subject}, but we may still be missing {known_blind_spots}. What important question should this data answer next?',
       'Ask the user for missing questions, consumers, and blind spots after meaningful work exists. Store the response as explicit feedback.',
       'feedback', 'Usage', 'TBL_WORKBENCH_FEEDBACK',
       '["APP_USER_NOTIFICATION","AGT_WORKBENCH_CONVERSATION","AGT_SEMANTIC_MODEL"]',
       '{"max_questions":1,"blocking":false,"ask_when":"after publication or a rated Analyst answer, never during table selection"}')
) source
ON target.INFERENCE_GOAL_ID = source.goal_id AND target.VERSION = '2.1'
WHEN MATCHED THEN UPDATE SET
    NAME = source.name, SUBJECT_TYPE = source.subject_type,
    TRIGGER_MILESTONES = source.milestones, ANSWER_SCHEMA = source.answer_schema,
    QUESTION_TEMPLATE = source.question_template, PROMPT_GUIDANCE = source.guidance,
    GOAL_OWNER = source.owner_kind, CATEGORY = source.goal_category,
    RESPONSE_STORAGE = source.storage_target, OUTPUT_TARGETS = source.goal_outputs,
    CHECKPOINT_POLICY = source.checkpoint_rules,
    STATUS = 'active', UPDATED_AT = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (
    INFERENCE_GOAL_ID, VERSION, NAME, SUBJECT_TYPE, TRIGGER_MILESTONES,
    ANSWER_SCHEMA, QUESTION_TEMPLATE, PROMPT_GUIDANCE, GOAL_OWNER, CATEGORY,
    RESPONSE_STORAGE, OUTPUT_TARGETS, CHECKPOINT_POLICY, STATUS
) VALUES (
    source.goal_id, '2.1', source.name, source.subject_type, source.milestones,
    source.answer_schema, source.question_template, source.guidance, source.owner_kind,
    source.goal_category, source.storage_target, source.goal_outputs,
    source.checkpoint_rules, 'active'
);

UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_INFERENCE_GOALS
SET STATUS = 'superseded', UPDATED_AT = CURRENT_TIMESTAMP()
WHERE INFERENCE_GOAL_ID IN ('Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8','Q9','Q10')
  AND VERSION <> '2.1'
  AND STATUS = 'active';

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_TARGET_MAPPING_PATTERNS (
    PATTERN_ID             STRING          NOT NULL,
    CONTENT_HASH           STRING          NOT NULL,
    SCOPE                  STRING          DEFAULT 'client',
    PROJECT_ID             STRING,
    STTM_ID                STRING,
    TARGET_TABLE           STRING          NOT NULL,
    TARGET_COLUMN          STRING          NOT NULL,
    PATTERN_PAYLOAD        VARIANT         NOT NULL,
    CONFIDENCE             FLOAT           DEFAULT 0.5,
    SUPPORT_COUNT          NUMBER          DEFAULT 1,
    CONTRADICTION_COUNT    NUMBER          DEFAULT 0,
    VALIDATION_STATUS      STRING          DEFAULT 'extracted',
    STATUS                 STRING          DEFAULT 'active',
    SUPERSEDED_BY          STRING,
    CREATED_AT             TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT             TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT UQ_FIR_TARGET_PATTERN_CONTENT UNIQUE (CONTENT_HASH)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_LEARNING_JOBS (
    LEARNING_JOB_ID          STRING          NOT NULL,
    ASSET_ID                 STRING,
    PROJECT_ID               STRING,
    STATUS                   STRING          NOT NULL,
    STAGE                    STRING,
    DISCOVERED_PATTERN_COUNT NUMBER          DEFAULT 0,
    COMPLETED_PATTERN_COUNT  NUMBER          DEFAULT 0,
    FAILED_PATTERN_COUNT     NUMBER          DEFAULT 0,
    CHECKPOINT               VARIANT,
    ERROR                    VARIANT,
    CREATED_AT               TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT               TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    COMPLETED_AT             TIMESTAMP_NTZ
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_LEARNING_WORK_ITEMS (
    WORK_ITEM_ID         STRING          NOT NULL,
    LEARNING_JOB_ID      STRING          NOT NULL,
    WORK_ITEM_TYPE       STRING          NOT NULL,
    IDEMPOTENCY_KEY      STRING          NOT NULL,
    PAYLOAD              VARIANT         NOT NULL,
    STATUS               STRING          DEFAULT 'pending',
    ATTEMPT_COUNT        NUMBER          DEFAULT 0,
    LEASE_OWNER          STRING,
    LEASE_EXPIRES_AT     TIMESTAMP_NTZ,
    RESULT               VARIANT,
    ERROR                VARIANT,
    CREATED_AT           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    COMPLETED_AT         TIMESTAMP_NTZ,
    CONSTRAINT UQ_FIR_WORK_ITEM_IDEMPOTENCY UNIQUE (IDEMPOTENCY_KEY)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_BUDGET_LEDGER (
    RUN_ID              STRING          NOT NULL,
    RUN_DATE            DATE            NOT NULL DEFAULT CURRENT_DATE(),
    TRIGGER_REASON      STRING,
    ASSET_ID            STRING,
    STATUS              STRING          NOT NULL,
    REQUEST_COUNT       NUMBER          DEFAULT 0,
    INPUT_TOKENS        NUMBER          DEFAULT 0,
    OUTPUT_TOKENS       NUMBER          DEFAULT 0,
    TOTAL_TOKENS        NUMBER          DEFAULT 0,
    STARTED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    COMPLETED_AT        TIMESTAMP_NTZ,
    METADATA            VARIANT,
    CONSTRAINT UQ_FIR_AGENT_BUDGET_RUN UNIQUE (RUN_ID)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_RECOMMENDATION_ACTION_HISTORY (
    ACTION_HISTORY_ID       STRING          NOT NULL,
    RECOMMENDATION_ID       STRING          NOT NULL,
    RECOMMENDATION_VERSION  NUMBER          DEFAULT 1,
    PROJECT_ID              STRING,
    STTM_ID                 STRING          NOT NULL,
    ACTOR_ID                STRING,
    IDEMPOTENCY_KEY         STRING          NOT NULL,
    ACTION_KIND             STRING          NOT NULL,
    STATUS                  STRING          NOT NULL,
    EXPECTED_WORKSPACE_HASH STRING          NOT NULL,
    BEFORE_WORKSPACE_HASH   STRING          NOT NULL,
    AFTER_WORKSPACE_HASH    STRING          NOT NULL,
    WORKSPACE_DIFF          VARIANT,
    BEFORE_SNAPSHOT         VARIANT,
    AFTER_SNAPSHOT          VARIANT,
    RESULT                  VARIANT,
    CREATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UNDONE_AT               TIMESTAMP_NTZ,
    CONSTRAINT UQ_FIR_RECOMMENDATION_ACTION_IDEMPOTENCY UNIQUE (IDEMPOTENCY_KEY)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_FIR_RUN_OBSERVABILITY (
    RUN_ID                    STRING          NOT NULL,
    RUN_DATE                  DATE            DEFAULT CURRENT_DATE(),
    TRIGGER_REASON            STRING,
    USER_ID                   STRING,
    PROJECT_ID                STRING,
    ASSET_ID                  STRING,
    TARGET_TABLE              STRING,
    TARGET_COLUMN             STRING,
    AGENT_NAME                STRING,
    TOOL_NAME                 STRING,
    STATUS                    STRING,
    ASSET_COUNT               NUMBER          DEFAULT 0,
    TARGET_ROW_COUNT          NUMBER          DEFAULT 0,
    DUPLICATE_WORK_SKIPPED    NUMBER          DEFAULT 0,
    PATTERNS_EXTRACTED        NUMBER          DEFAULT 0,
    PATTERNS_ENRICHED         NUMBER          DEFAULT 0,
    PATTERNS_REJECTED         NUMBER          DEFAULT 0,
    PATTERNS_PROMOTED         NUMBER          DEFAULT 0,
    AGENT_REQUEST_COUNT       NUMBER          DEFAULT 0,
    INPUT_TOKENS              NUMBER          DEFAULT 0,
    OUTPUT_TOKENS             NUMBER          DEFAULT 0,
    TOTAL_TOKENS              NUMBER          DEFAULT 0,
    TOOL_CALL_COUNT           NUMBER          DEFAULT 0,
    DURATION_MS               NUMBER,
    RETRY_COUNT               NUMBER          DEFAULT 0,
    CIRCUIT_BREAKER_STATUS    STRING,
    ESTIMATED_COST            NUMBER(18, 6),
    QUERY_TAG                 STRING,
    RESULT_VALIDATION_STATUS  STRING,
    STARTED_AT                TIMESTAMP_NTZ,
    COMPLETED_AT              TIMESTAMP_NTZ,
    UPDATED_AT                TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    METADATA                  VARIANT,
    CONSTRAINT UQ_FIR_RUN_OBSERVABILITY UNIQUE (RUN_ID)
);

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_BUNDLE_VERSIONS (
    BUNDLE_VERSION_ID        STRING          NOT NULL,
    SEMANTIC_BUNDLE_ID       STRING,
    BASE_BUNDLE_HASH         STRING,
    VERSION_NUMBER           NUMBER          NOT NULL DEFAULT 1,
    SQL_ASSET_ID             STRING,
    PROJECT_ID               STRING,
    STTM_ID                  STRING,
    WORKSPACE_CONTEXT_KEY    STRING,
    WORKSPACE_CONTEXT_HASH   STRING,
    KNOWLEDGE_GRAPH          VARIANT,
    MAPPING_SEMANTICS        VARIANT,
    FINDINGS                 VARIANT,
    EVIDENCE_IDS             VARIANT,
    VALIDATION_SUMMARY       VARIANT,
    STATUS                   STRING          NOT NULL DEFAULT 'draft'
        CHECK (STATUS IN ('draft', 'active', 'superseded', 'rejected')),
    CREATED_BY               STRING,
    CREATED_AT               TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT               TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    PROMOTED_AT              TIMESTAMP_NTZ,
    CONSTRAINT PK_SEMANTIC_BUNDLE_VERSION PRIMARY KEY (BUNDLE_VERSION_ID)
);

ALTER TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
    ADD COLUMN IF NOT EXISTS BUNDLE_VERSION_ID STRING;

CREATE OR REPLACE VIEW __STTM_METADATA_NAMESPACE__.VW_FIR_RUN_OPERATIONS AS
SELECT
    RUN_DATE,
    USER_ID,
    PROJECT_ID,
    TRIGGER_REASON,
    AGENT_NAME,
    TOOL_NAME,
    ASSET_ID,
    TARGET_TABLE,
    TARGET_COLUMN,
    STATUS,
    COUNT(*) AS RUN_COUNT,
    SUM(ASSET_COUNT) AS ASSET_COUNT,
    SUM(TARGET_ROW_COUNT) AS TARGET_ROW_COUNT,
    SUM(DUPLICATE_WORK_SKIPPED) AS DUPLICATE_WORK_SKIPPED,
    SUM(PATTERNS_EXTRACTED) AS PATTERNS_EXTRACTED,
    SUM(PATTERNS_ENRICHED) AS PATTERNS_ENRICHED,
    SUM(PATTERNS_REJECTED) AS PATTERNS_REJECTED,
    SUM(PATTERNS_PROMOTED) AS PATTERNS_PROMOTED,
    SUM(AGENT_REQUEST_COUNT) AS AGENT_REQUEST_COUNT,
    SUM(INPUT_TOKENS) AS INPUT_TOKENS,
    SUM(OUTPUT_TOKENS) AS OUTPUT_TOKENS,
    SUM(TOTAL_TOKENS) AS TOTAL_TOKENS,
    SUM(TOOL_CALL_COUNT) AS TOOL_CALL_COUNT,
    SUM(DURATION_MS) AS DURATION_MS,
    SUM(RETRY_COUNT) AS RETRY_COUNT,
    SUM(ESTIMATED_COST) AS ESTIMATED_COST,
    MAX(CIRCUIT_BREAKER_STATUS) AS CIRCUIT_BREAKER_STATUS,
    MAX(RESULT_VALIDATION_STATUS) AS RESULT_VALIDATION_STATUS
FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_RUN_OBSERVABILITY
GROUP BY
    RUN_DATE, USER_ID, PROJECT_ID, TRIGGER_REASON, AGENT_NAME, TOOL_NAME,
    ASSET_ID, TARGET_TABLE, TARGET_COLUMN, STATUS;

CREATE OR REPLACE VIEW __STTM_METADATA_NAMESPACE__.VW_FIR_OPERATIONAL_ALERTS AS
SELECT
    'idle_agent_call' AS ALERT_TYPE,
    'warning' AS SEVERITY,
    RUN_ID AS ENTITY_ID,
    'Agent was invoked without an asset, target row, or pending record.' AS DETAIL,
    COALESCE(COMPLETED_AT, STARTED_AT) AS DETECTED_AT
FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_RUN_OBSERVABILITY
WHERE AGENT_REQUEST_COUNT > 0
  AND ASSET_COUNT = 0
  AND TARGET_ROW_COUNT = 0
  AND COALESCE(METADATA:pending_record_count::NUMBER, 0) = 0
UNION ALL
SELECT
    'duplicate_asset_processing',
    'warning',
    ASSET_ID,
    'The same asset received more than one successful agent request on one date.',
    MAX(COALESCE(COMPLETED_AT, STARTED_AT))
FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_RUN_OBSERVABILITY
WHERE ASSET_ID IS NOT NULL
  AND ASSET_ID <> ''
  AND AGENT_REQUEST_COUNT > 0
GROUP BY RUN_DATE, ASSET_ID
HAVING COUNT_IF(STATUS IN ('success', 'partial')) > 1
UNION ALL
SELECT
    'daily_budget_threshold',
    'warning',
    TO_VARCHAR(RUN_DATE),
    'Daily FIR request or token consumption is at least 80 percent of its limit.',
    MAX(COALESCE(COMPLETED_AT, STARTED_AT))
FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_RUN_OBSERVABILITY
GROUP BY RUN_DATE
HAVING
    SUM(AGENT_REQUEST_COUNT) >=
        0.8 * MAX(COALESCE(METADATA:daily_request_limit::NUMBER, 50))
    OR SUM(TOTAL_TOKENS) >=
        0.8 * MAX(COALESCE(METADATA:daily_token_limit::NUMBER, 20000000))
UNION ALL
SELECT
    'stuck_work',
    'critical',
    LEARNING_JOB_ID,
    'Durable FIR work has remained active beyond two catch-up windows.',
    CURRENT_TIMESTAMP()
FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_LEARNING_JOBS
WHERE STATUS IN ('running', 'paused')
  AND UPDATED_AT < DATEADD('hour', -24, CURRENT_TIMESTAMP())
UNION ALL
SELECT
    'repeated_timeout',
    'critical',
    COALESCE(ASSET_ID, PROJECT_ID, RUN_ID),
    'FIR processing timed out repeatedly within two days.',
    MAX(COALESCE(COMPLETED_AT, STARTED_AT))
FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_RUN_OBSERVABILITY
WHERE STARTED_AT >= DATEADD('day', -2, CURRENT_TIMESTAMP())
  AND (
      LOWER(STATUS) LIKE '%timeout%'
      OR LOWER(COALESCE(METADATA:error_summary::STRING, '')) LIKE '%timeout%'
  )
GROUP BY COALESCE(ASSET_ID, PROJECT_ID, RUN_ID)
HAVING COUNT(*) >= 2;
