-- Seed template for client-specific business notes and historical SQL assets.
-- Replace the placeholder values and run in the client metadata schema.

INSERT INTO FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_CLIENT_NOTES (
    NOTE_ID,
    PROJECT_ID,
    ENTITY_TYPE,
    ENTITY_IDS,
    TITLE,
    NOTE_TEXT,
    SOURCE_LABEL,
    AUTHOR_NAME,
    TAGS,
    ATTRIBUTES,
    STATUS
)
SELECT
    'note_customer_orders_001',
    'project_customer_orders',
    'table_pair',
    PARSE_JSON('["SRC_DB.SRC_SCHEMA.CUSTOMERS","SRC_DB.SRC_SCHEMA.ORDERS"]'),
    'Customers to orders business meaning',
    'Orders should link to customers through CUSTOMER_ID. Business users treat guest checkout rows as unmatched and handle them separately.',
    'client_workshop_notes',
    'business_analyst',
    PARSE_JSON('["customers","orders","join-validation"]'),
    PARSE_JSON('{"priority":"high","domain":"sales"}'),
    'active'
;

INSERT INTO FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_CLIENT_SQL_ASSETS (
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
    STATUS
)
SELECT
    'sql_customer_order_mapping_001',
    'project_customer_orders',
    'table_pair',
    PARSE_JSON('["SRC_DB.SRC_SCHEMA.CUSTOMERS","SRC_DB.SRC_SCHEMA.ORDERS","TGT_DB.TGT_SCHEMA.ORDER_FACT"]'),
    'Historical customer order mapping SQL',
    $$SELECT
        o.ORDER_ID,
        c.CUSTOMER_ID,
        c.CUSTOMER_NAME,
        o.ORDER_TOTAL
      FROM SRC_DB.SRC_SCHEMA.ORDERS o
      JOIN SRC_DB.SRC_SCHEMA.CUSTOMERS c
        ON o.CUSTOMER_ID = c.CUSTOMER_ID$$,
    'historical_mapping',
    'snowflake',
    'Previously approved handcrafted mapping SQL that can be cited by the assistant.',
    'legacy_mapping_repo',
    'data_engineering',
    PARSE_JSON('["historical-sql","orders","customers"]'),
    PARSE_JSON('{"approved":true,"version":"v1"}'),
    'active'
;

-- After loading notes/SQL assets, rebuild the workbench RAG index so Cortex Search can use them:
--   POST /api/v1/workbench/conversation/index/sync
-- with:
--   {
--     "contract_version": "1.0",
--     "operation": "conversation.index.sync",
--     "data": {
--       "rebuild_search_service": false,
--       "include_client_knowledge_docs": true
--     }
--   }
