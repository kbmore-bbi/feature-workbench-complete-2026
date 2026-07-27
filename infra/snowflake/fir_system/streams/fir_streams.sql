-- ============================================================
-- FIR System Streams
-- Change detection streams for triggering batch FIR processing.
-- These streams capture inserts/updates/deletes on source tables.
-- ============================================================

-- Stream on feedback table (explicit user feedback)
CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_WORKBENCH_FEEDBACK
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FEEDBACK
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures explicit user feedback (thumbs up/down, option selection) for FIR processing.';

CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_WORKBENCH_EVENTS
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FIR_EVENTS
APPEND_ONLY = TRUE
COMMENT = 'Captures canonical UI milestones and outcomes for offline FIR processing.';

CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_CONTEXT_EVIDENCE
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_CONTEXT_EVIDENCE
APPEND_ONLY = TRUE
COMMENT = 'Captures enriched context evidence ready for fixed-goal inference.';

CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_RECOMMENDATION_OUTCOMES
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_RECOMMENDATION_OUTCOMES
APPEND_ONLY = TRUE
COMMENT = 'Captures shown, opened, explained, applied, used, accepted, corrected, rejected, validated, and published recommendation outcomes.';

-- Stream on STTM attributes (mapping changes)
CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_STTM_ATTRIBUTES
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM_ATTRIBUTES
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures mapping attribute changes (AI vs user-modified vs manual) for FIR processing.';

-- Stream on derived sources (implicit feedback)
CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_DERIVED_SOURCES
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_DERIVED_SOURCES
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures derived source creation/modification for FIR processing.';

-- Stream on semantic table views (semantic evolution)
CREATE OR REPLACE STREAM __STTM_METADATA_NAMESPACE__.STM_FIR_SEM_TABLE_VIEWS
ON TABLE __SEMANTIC_REGISTRY_NAMESPACE__.SEM_TABLE_VIEWS
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures semantic view changes for FIR semantic evolution tracking.';

-- Stream on conversation turns (conversation feedback)
CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_CONVERSATION_TURNS
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_CONVERSATION_TURNS
APPEND_ONLY = TRUE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures conversation history with agents for FIR conversation learning.';

-- Stream on STTM versions (publish events - high confidence)
CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_STTM_VERSIONS
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_STTM_VERSIONS
APPEND_ONLY = TRUE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures STTM publish events for high-confidence FIR learning.';

-- Stream on client SQL assets (uploaded SQL scripts, Excel mapping imports)
CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_CLIENT_SQL_ASSETS
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_CLIENT_SQL_ASSETS
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures uploaded SQL scripts and Excel mapping imports for FIR document learning.';

-- Stream on inferences table (track inference generation)
CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_INFERENCES
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures inference generation for FIR recommendation triggering.';

-- Stream on FIR 360 table (track processing stage changes)
CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_360_CHANGES
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures FIR 360 record changes for downstream processing.';

-- Stream on column-level semantic views (column semantic evolution)
CREATE OR REPLACE STREAM __STTM_METADATA_NAMESPACE__.STM_FIR_SEM_COLUMN_VIEWS
ON TABLE __SEMANTIC_REGISTRY_NAMESPACE__.SEM_COLUMN_VIEWS
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures column-level semantic view changes for FIR pre-computation triggering.';

-- Stream on semantic view versions (curated version creation triggers re-computation)
CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_SEMANTIC_VERSIONS
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS
APPEND_ONLY = TRUE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures new curated semantic versions to trigger FIR recommendation re-generation.';

-- Dedicated semantic streams prevent the capture task and permutation task
-- from racing to consume the same stream offset.
CREATE OR REPLACE STREAM __STTM_METADATA_NAMESPACE__.STM_FIR_PRECOMPUTE_SEM_TABLE_VIEWS
ON TABLE __SEMANTIC_REGISTRY_NAMESPACE__.SEM_TABLE_VIEWS
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Independent semantic table stream for FIR permutation precomputation.';

CREATE OR REPLACE STREAM __STTM_METADATA_NAMESPACE__.STM_FIR_PRECOMPUTE_SEM_COLUMN_VIEWS
ON TABLE __SEMANTIC_REGISTRY_NAMESPACE__.SEM_COLUMN_VIEWS
APPEND_ONLY = FALSE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Independent semantic column stream for FIR permutation precomputation.';

CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_PRECOMPUTE_SEMANTIC_VERSIONS
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS
APPEND_ONLY = TRUE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Independent curated semantic stream for FIR permutation precomputation.';

-- Stream on recommendations table (delivers APP_USER_NOTIFICATION to signal bus)
CREATE STREAM IF NOT EXISTS __STTM_METADATA_NAMESPACE__.STM_FIR_RECOMMENDATIONS
ON TABLE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
APPEND_ONLY = TRUE
SHOW_INITIAL_ROWS = FALSE
COMMENT = 'Captures new recommendations for notification bridge delivery to users via WebSocket.';
