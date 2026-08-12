-- =============================================================================
-- SPCS Caller's Rights Grants
-- =============================================================================
-- Required for executeAsCaller to work. Without these, Snowflake rejects the
-- combined SPCS OAuth token with:
--   "Client is unauthorized to use Snowpark Container Services OAuth token"
--
-- Run as ACCOUNTADMIN. Fill in the SET block for your environment.
-- =============================================================================

-- ── Configure per-environment ─────────────────────────────────────────────────
SET service_owner_role  = 'FOCUS_DEVELOPER';   -- role that created the SPCS services
SET target_database     = 'FFP_HDP_CRM_MIG_DB_DEV';
SET target_schema       = 'SCH_STTM_METADATA';
SET target_warehouse    = 'FFP_HDP_CRM_MIG_WH_DEV';             -- warehouse used by the service
SET sttm_service        = 'STTM_BUILDER_DEV';
SET target_schema_fq    = $target_database || '.' || $target_schema;
SET semantic_bundles    = $target_schema_fq || '.TBL_SEMANTIC_BUNDLES';
SET workspace_snapshots = $target_schema_fq || '.TBL_WORKSPACE_SNAPSHOTS';
SET agent_artifacts     = $target_schema_fq || '.TBL_AGENT_ARTIFACTS';
SET artifact_stage      = $target_schema_fq || '.AI_WORKBENCH_ARTIFACTS';
-- ─────────────────────────────────────────────────────────────────────────────

-- Allows the service owner role to bind public endpoints and use SPCS OAuth tokens.
-- This is the primary gate that unlocks the combined token mechanism.
GRANT BIND SERVICE ENDPOINT ON ACCOUNT TO ROLE IDENTIFIER($service_owner_role);

-- Caller grants: let the service execute SQL on behalf of the calling user.
-- These govern what the *user's identity* can access when routed through the service.
GRANT CALLER USAGE ON DATABASE  IDENTIFIER($target_database)  TO ROLE IDENTIFIER($service_owner_role);
GRANT CALLER USAGE ON SCHEMA    IDENTIFIER($target_schema_fq) TO ROLE IDENTIFIER($service_owner_role);
GRANT CALLER USAGE ON WAREHOUSE IDENTIFIER($target_warehouse) TO ROLE IDENTIFIER($service_owner_role);

-- Durable semantic/autosave/artifact access used by execute-as-caller services.
GRANT CALLER SELECT, INSERT, UPDATE, DELETE ON TABLE IDENTIFIER($semantic_bundles) TO ROLE IDENTIFIER($service_owner_role);
GRANT CALLER SELECT, INSERT, UPDATE, DELETE ON TABLE IDENTIFIER($workspace_snapshots) TO ROLE IDENTIFIER($service_owner_role);
GRANT CALLER SELECT, INSERT, UPDATE, DELETE ON TABLE IDENTIFIER($agent_artifacts) TO ROLE IDENTIFIER($service_owner_role);
GRANT CALLER READ, WRITE ON STAGE IDENTIFIER($artifact_stage) TO ROLE IDENTIFIER($service_owner_role);

-- Enables AI_COMPLETE and its legacy Cortex compatibility function.
GRANT DATABASE ROLE SNOWFLAKE.AI_FUNCTIONS_USER TO ROLE IDENTIFIER($service_owner_role);
GRANT USE AI FUNCTION AI_COMPLETE ON ACCOUNT TO ROLE IDENTIFIER($service_owner_role);

-- Verify
SHOW GRANTS TO ROLE IDENTIFIER($service_owner_role);
