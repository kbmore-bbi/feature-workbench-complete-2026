-- ============================================================
-- FIR System Snowflake Tasks
-- Automated batch processing triggered by data changes.
-- ============================================================

-- ============================================================
-- TSK_FIR_CAPTURE - Root task: consume streams into canonical FIR-360 rows.
-- ============================================================
CREATE OR REPLACE TASK __STTM_METADATA_NAMESPACE__.TSK_FIR_CAPTURE
    WAREHOUSE = __WAREHOUSE_NAME__
    SCHEDULE = '5 MINUTES'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    TASK_AUTO_RETRY_ATTEMPTS = 2
    USER_TASK_TIMEOUT_MS = 3600000
    COMMENT = 'Root FIR task: every five minutes consumes changed streams and drains any ready FIR backlog; downstream agent invocation has a no-work guard.'
AS
CALL __STTM_METADATA_NAMESPACE__.SP_FIR_COLLECT_FEEDBACK();


-- Deterministic enrichment runs before the agent and assembles semantic,
-- column, document, derived, profile, freshness, and prior FIR evidence.
CREATE OR REPLACE TASK __STTM_METADATA_NAMESPACE__.TSK_FIR_ENRICH_CONTEXT
    WAREHOUSE = __WAREHOUSE_NAME__
    USER_TASK_TIMEOUT_MS = 3600000
    COMMENT = 'FIR graph child: builds TBL_FIR_CONTEXT_EVIDENCE for pending FIR-360 rows.'
    AFTER __STTM_METADATA_NAMESPACE__.TSK_FIR_CAPTURE
AS
CALL __STTM_METADATA_NAMESPACE__.SP_FIR_ENRICH_CONTEXT(100);


-- Agent reasoning remains offline and only sees enriched, fixed-goal evidence.
CREATE OR REPLACE TASK __STTM_METADATA_NAMESPACE__.TSK_FIR_PROCESS_BATCH
    WAREHOUSE = __WAREHOUSE_NAME__
    USER_TASK_TIMEOUT_MS = 3600000
    COMMENT = 'FIR graph child: invokes AGT_FIR_SYSTEM over enriched fixed-goal evidence.'
    AFTER __STTM_METADATA_NAMESPACE__.TSK_FIR_ENRICH_CONTEXT
AS
CALL __STTM_METADATA_NAMESPACE__.SP_FIR_INVOKE_AGENT(
    OBJECT_CONSTRUCT(
        'task_type', 'stream_triggered',
        'batch_size', 100,
        'processing_options', OBJECT_CONSTRUCT(
            'collect_feedback', FALSE,
            'generate_inferences', TRUE,
            'create_semantic_versions', TRUE,
            'generate_recommendations', TRUE,
            'apply_decay', FALSE,
            'parse_documents', TRUE
        )
    )
);


CREATE OR REPLACE TASK __STTM_METADATA_NAMESPACE__.TSK_FIR_PROMOTE_INDEX
    WAREHOUSE = __WAREHOUSE_NAME__
    USER_TASK_TIMEOUT_MS = 1800000
    COMMENT = 'FIR graph child: scores recommendations after inference; Cortex Search indexes active rows asynchronously.'
    AFTER __STTM_METADATA_NAMESPACE__.TSK_FIR_PROCESS_BATCH
AS
CALL __STTM_METADATA_NAMESPACE__.SP_FIR_SCORE_RECOMMENDATIONS();


CREATE OR REPLACE TASK __STTM_METADATA_NAMESPACE__.TSK_FIR_FRESHNESS_FEATURES
    WAREHOUSE = __WAREHOUSE_NAME__
    SCHEDULE = '60 MINUTES'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    USER_TASK_TIMEOUT_MS = 3600000
    COMMENT = 'Hourly deterministic freshness features; the procedure skips Tier 2/3 rows refreshed within 24 hours.'
AS
CALL __STTM_METADATA_NAMESPACE__.SP_FIR_REFRESH_FEATURES('freshness');


CREATE OR REPLACE TASK __STTM_METADATA_NAMESPACE__.TSK_FIR_PROFILE_FEATURES
    WAREHOUSE = __WAREHOUSE_NAME__
    SCHEDULE = 'USING CRON 0 3 * * 0 America/New_York'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    USER_TASK_TIMEOUT_MS = 7200000
    COMMENT = 'Weekly bounded profiling samples; semantic registry changes also trigger semantic precomputation.'
AS
CALL __STTM_METADATA_NAMESPACE__.SP_FIR_REFRESH_FEATURES('profile');


-- ============================================================
-- TSK_FIR_CONFIDENCE_DECAY - Daily Confidence Decay Task
-- Runs daily at 2 AM to apply temporal decay to confidence scores.
-- ============================================================
CREATE OR REPLACE TASK __STTM_METADATA_NAMESPACE__.TSK_FIR_CONFIDENCE_DECAY
    WAREHOUSE = __WAREHOUSE_NAME__
    SCHEDULE = 'USING CRON 0 2 * * * America/New_York'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    USER_TASK_TIMEOUT_MS = 1800000
    COMMENT = 'Daily task to apply temporal decay to FIR confidence scores. Runs at 2 AM EST.'
AS
CALL __STTM_METADATA_NAMESPACE__.SP_FIR_APPLY_CONFIDENCE_DECAY();


-- ============================================================
-- TSK_FIR_SEMANTIC_CONSOLIDATION - Weekly Consolidation Task
-- Runs weekly on Sundays at 4 AM to consolidate semantic versions.
-- ============================================================
CREATE OR REPLACE TASK __STTM_METADATA_NAMESPACE__.TSK_FIR_SEMANTIC_CONSOLIDATION
    WAREHOUSE = __WAREHOUSE_NAME__
    SCHEDULE = 'USING CRON 0 4 * * 0 America/New_York'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    USER_TASK_TIMEOUT_MS = 3600000
    COMMENT = 'Weekly task to consolidate semantic versions, archive old versions, and validate high-confidence versions. Runs Sunday 4 AM EST.'
AS
CALL __STTM_METADATA_NAMESPACE__.SP_FIR_CONSOLIDATE_SEMANTIC_VERSIONS();


-- ============================================================
-- TSK_FIR_SEMANTIC_PRECOMPUTE - Semantic Pre-computation Task
-- Triggered when semantic views or curated versions change.
-- Discovers meaningful table combinations and generates
-- proactive recommendations for all downstream agents.
-- ============================================================
CREATE OR REPLACE TASK __STTM_METADATA_NAMESPACE__.TSK_FIR_SEMANTIC_PRECOMPUTE
    WAREHOUSE = __WAREHOUSE_NAME__
    SCHEDULE = '10 MINUTES'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    TASK_AUTO_RETRY_ATTEMPTS = 1
    USER_TASK_TIMEOUT_MS = 7200000
    COMMENT = 'Semantic pre-computation task. Triggered when semantic views change. Generates proactive FIR recommendations for all meaningful table permutations.'
WHEN
    SYSTEM$STREAM_HAS_DATA('__STTM_METADATA_NAMESPACE__.STM_FIR_PRECOMPUTE_SEM_TABLE_VIEWS') OR
    SYSTEM$STREAM_HAS_DATA('__STTM_METADATA_NAMESPACE__.STM_FIR_PRECOMPUTE_SEM_COLUMN_VIEWS') OR
    SYSTEM$STREAM_HAS_DATA('__STTM_METADATA_NAMESPACE__.STM_FIR_PRECOMPUTE_SEMANTIC_VERSIONS')
AS
CALL __STTM_METADATA_NAMESPACE__.SP_FIR_PRECOMPUTE_PERMUTATIONS(
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
CREATE OR REPLACE TASK __STTM_METADATA_NAMESPACE__.TSK_FIR_RECOMMENDATION_SCORING
    WAREHOUSE = __WAREHOUSE_NAME__
    SCHEDULE = 'USING CRON 30 2 * * * America/New_York'
    ALLOW_OVERLAPPING_EXECUTION = FALSE
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    USER_TASK_TIMEOUT_MS = 900000
    COMMENT = 'Daily recommendation scoring task. Runs at 2:30 AM EST after confidence decay. Updates RECOMMENDATION_PRIORITY based on usage, recency, feedback, and ML scores.'
AS
CALL __STTM_METADATA_NAMESPACE__.SP_FIR_SCORE_RECOMMENDATIONS();
