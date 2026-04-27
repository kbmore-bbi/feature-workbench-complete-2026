-- =============================================================================
-- SPCS Egress Setup — Network Rule + External Access Integration
-- =============================================================================
-- SPCS containers are network-isolated by default. sttm-builder needs egress
-- to SNOWFLAKE_HOST:443 for two things:
--   1. Snowpark SQL sessions (caller's-rights token auth)
--   2. Cortex Agents REST API  (POST /api/v2/cortex/agent:run)
--
-- Run once per environment as ACCOUNTADMIN (or a role with CREATE INTEGRATION).
-- Update the SET block below for each environment.
-- =============================================================================

-- ── Configure per-environment ─────────────────────────────────────────────────
SET snowflake_host      = 'your_org-your_account.snowflakecomputing.com';
SET target_database     = 'FFP_HDP_CRM_MIG_DB_DEV';
SET target_schema       = 'SCH_STTM_METADATA';
SET integration_name    = 'AI_WORKBENCH_EGRESS_INTEGRATION';
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE NETWORK RULE IDENTIFIER($target_database || '.' || $target_schema || '.AI_WORKBENCH_SNOWFLAKE_EGRESS_RULE')
  TYPE       = HOST_PORT
  MODE       = EGRESS
  VALUE_LIST = ($snowflake_host || ':443');

CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION IDENTIFIER($integration_name)
  ALLOWED_NETWORK_RULES = (IDENTIFIER($target_database || '.' || $target_schema || '.AI_WORKBENCH_SNOWFLAKE_EGRESS_RULE'))
  ENABLED               = TRUE;

-- Verify
SHOW EXTERNAL ACCESS INTEGRATIONS LIKE $integration_name;
