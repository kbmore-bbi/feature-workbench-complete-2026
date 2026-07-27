-- ============================================================
-- CLEANUP DEPRECATED TABLES
-- Archive and document deprecated tables
-- ============================================================

-- Database: FFP_HDP_CRM_MIG_DB_DEV
-- Schema: SCH_STTM_METADATA

-- ============================================================
-- STEP 1: Archive deprecated tables before dropping
-- ============================================================

-- Archive TBL_TABLE_STATS (deprecated - superseded by SEM_TABLE_VIEWS)
CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_TABLE_STATS_ARCHIVE AS
SELECT *, CURRENT_TIMESTAMP() AS ARCHIVED_AT
FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_TABLE_STATS;

-- Archive TBL_ATTRIBUTE_STATS (deprecated - superseded by SEM_COLUMN_VIEWS)
CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_ATTRIBUTE_STATS_ARCHIVE AS
SELECT *, CURRENT_TIMESTAMP() AS ARCHIVED_AT
FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_ATTRIBUTE_STATS;

-- ============================================================
-- STEP 2: Verify no active queries depend on deprecated tables
-- Run these queries to check for recent usage
-- ============================================================

-- Check for recent queries on TBL_TABLE_STATS
-- SELECT COUNT(*) as query_count, MAX(START_TIME) as last_used
-- FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
-- WHERE QUERY_TEXT ILIKE '%TBL_TABLE_STATS%'
--   AND START_TIME > DATEADD(day, -30, CURRENT_TIMESTAMP());

-- Check for recent queries on TBL_ATTRIBUTE_STATS
-- SELECT COUNT(*) as query_count, MAX(START_TIME) as last_used
-- FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
-- WHERE QUERY_TEXT ILIKE '%TBL_ATTRIBUTE_STATS%'
--   AND START_TIME > DATEADD(day, -30, CURRENT_TIMESTAMP());

-- ============================================================
-- STEP 3: Drop deprecated tables (ONLY after verification)
-- Uncomment and run these ONLY when you're certain they're not in use
-- ============================================================

-- DROP TABLE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_TABLE_STATS;
-- DROP TABLE IF EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_ATTRIBUTE_STATS;

-- ============================================================
-- DOCUMENTATION: Table Replacements
-- ============================================================

-- TBL_TABLE_STATS
-- Reason: Raw source schema metadata without FK to project tables
-- Replacement: SEM_TABLE_VIEWS (versioned semantic views with full context)
-- Migration: Table-level metadata now lives in the semantic registry

-- TBL_ATTRIBUTE_STATS
-- Reason: Column-level profiling stats superseded by semantic model layer
-- Replacement: SEM_COLUMN_VIEWS (versioned column semantic views)
-- Migration: Column stats integrated into semantic attribute models

-- ============================================================
-- NOTE: TBL_WORKBENCH_SEMANTIC_LEARNINGS vs TBL_AGENT_LEARNINGS
-- ============================================================
-- These tables serve DIFFERENT purposes and should both be kept:
--
-- TBL_WORKBENCH_SEMANTIC_LEARNINGS:
--   - Curated semantic knowledge (column disambiguation, domain vocabulary)
--   - Used by AGT_SEMANTIC_MODEL for enriching semantic views
--   - Source: Manual curation, approved feedback
--
-- TBL_AGENT_LEARNINGS:
--   - Operational patterns for specific agents (SOURCE_MAPPING, TRANSFORMATION_RULE, etc.)
--   - Used by agents for improving suggestions
--   - Source: Automatic recording of accepted/corrected mappings
--
-- RECOMMENDATION: Keep both, consider renaming for clarity:
--   TBL_WORKBENCH_SEMANTIC_LEARNINGS -> TBL_SEMANTIC_KNOWLEDGE (future)
