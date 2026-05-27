-- ============================================================
-- PROFILING LAYER (DEPRECATED)
-- Raw source schema metadata. No FK to project tables.
-- ============================================================

-- DEPRECATED
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_TABLE_STATS (
    DB_NAME               VARCHAR       NOT NULL,
    SCHEMA_NAME           VARCHAR       NOT NULL,
    TABLE_NAME            VARCHAR       NOT NULL,
    STAT_TYPE             VARCHAR       NOT NULL   COMMENT 'TABLE_STATS | DDL | LIST_ATTRIBUTES',
    PAYLOAD               VARIANT,
    ROW_COUNT             NUMBER,
    TABLE_LAST_ALTERED    TIMESTAMP_NTZ,
    CAPTURED_DATETIME     TIMESTAMP_NTZ NOT NULL,
    IS_STALE              BOOLEAN       DEFAULT FALSE,
    CONSTRAINT PK_TBL_TABLE_STATS PRIMARY KEY (DB_NAME, SCHEMA_NAME, TABLE_NAME, STAT_TYPE)
)
COMMENT = 'Catalogue-level table stats captured during STTM profiling';

-- DEPRECATED
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_ATTRIBUTE_STATS (
    DB_NAME               VARCHAR       NOT NULL,
    SCHEMA_NAME           VARCHAR       NOT NULL,
    TABLE_NAME            VARCHAR       NOT NULL,
    ATTRIBUTE_NAME        VARCHAR       NOT NULL,
    PAYLOAD               VARIANT,
    ROW_COUNT             NUMBER,
    CAPTURED_DATETIME     TIMESTAMP_NTZ NOT NULL,
    IS_STALE              BOOLEAN       DEFAULT FALSE,
    CONSTRAINT PK_TBL_ATTRIBUTE_STATS PRIMARY KEY (DB_NAME, SCHEMA_NAME, TABLE_NAME, ATTRIBUTE_NAME)
)
COMMENT = 'Column-level profiling stats captured during STTM profiling';


-- ============================================================
-- SEMANTIC MODELING LAYER
-- Natural key: (SCOPE, DB_NAME, SCHEMA_NAME, TABLE_NAME, ATTRIBUTE_NAME)
-- TABLE_NAME = '' for SCHEMA scope; ATTRIBUTE_NAME = '' for SCHEMA and TABLE scopes.
-- DDL_HASH detects structural staleness — compare stored vs current before trusting the model.
-- ============================================================


CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_MODELS (
    SCOPE            VARCHAR(20)   NOT NULL,   -- 'SCHEMA' | 'TABLE' | 'ATTRIBUTE'
    DB_NAME          VARCHAR(255)  NOT NULL,
    SCHEMA_NAME      VARCHAR(255)  NOT NULL,
    TABLE_NAME       VARCHAR(255)  NOT NULL,   -- '' for SCHEMA scope
    ATTRIBUTE_NAME   VARCHAR(255)  NOT NULL,   -- '' for SCHEMA and TABLE scope
    SEMANTIC_MODEL   VARIANT       NOT NULL,
    DDL_HASH         VARCHAR(32)   NOT NULL,
    GENERATED_AT     TIMESTAMP_NTZ NOT NULL,
    UPDATED_AT       TIMESTAMP_NTZ NOT NULL,

    CONSTRAINT CHK_SM_SCOPE CHECK (SCOPE IN ('SCHEMA', 'TABLE', 'ATTRIBUTE')),
    CONSTRAINT CHK_SM_KEYS CHECK (
        (SCOPE = 'SCHEMA'    AND TABLE_NAME = ''     AND ATTRIBUTE_NAME = '') OR
        (SCOPE = 'TABLE'     AND TABLE_NAME != ''    AND ATTRIBUTE_NAME = '') OR
        (SCOPE = 'ATTRIBUTE' AND TABLE_NAME != ''    AND ATTRIBUTE_NAME != '')
    )
);

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_BUNDLES (
    SEMANTIC_BUNDLE_ID  VARCHAR(255)  NOT NULL,
    BUNDLE_HASH         VARCHAR(64)   NOT NULL,
    BUNDLE_LABEL        VARCHAR(512),
    TARGET_TABLE        VARIANT,
    SOURCE_TABLES       VARIANT       NOT NULL,
    DERIVED_SOURCE_IDS  VARIANT       NOT NULL,
    RELATIONSHIPS       VARIANT       NOT NULL,
    SEMANTIC_LEVEL      VARCHAR(32)   NOT NULL,
    SEMANTIC_VIEW_NAME  VARCHAR(255),
    ANALYST_TOOL_NAME   VARCHAR(255),
    STATUS              VARCHAR(32)   NOT NULL,
    STALE_REASON        STRING,
    DATAHUB_CONTEXT     VARIANT,
    LAST_GENERATED_AT   TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    LAST_PROMOTED_AT    TIMESTAMP_NTZ,
    UPDATED_AT          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Bundle-level semantic working set registry for selected raw and derived assets.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_OVERRIDES (
    OVERRIDE_ID         VARCHAR(255)  NOT NULL,
    SEMANTIC_BUNDLE_ID  VARCHAR(255)  NOT NULL,
    OBJECT_SCOPE        VARCHAR(32)   NOT NULL,
    OBJECT_KEY          VARCHAR(512)  NOT NULL,
    OVERRIDE_TYPE       VARCHAR(64)   NOT NULL,
    OVERRIDE_VALUE      VARIANT       NOT NULL,
    CREATED_AT          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'User-authored semantic corrections and refinements applied on top of generated bundle semantics.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_DERIVED_SOURCES (
    DERIVED_SOURCE_ID STRING,
    DERIVED_SOURCE_NAME STRING,
    SQL_TEXT STRING,
    DRIVING_TABLE STRING,
    SOURCE_TABLES VARIANT,
    PARENT_DERIVED_SOURCE_IDS VARIANT,
    BASE_SOURCE_TABLES VARIANT,
    RELATIONSHIPS VARIANT,
    FILTERS VARIANT,
    SELECTED_COLUMNS_BY_TABLE VARIANT,
    PREVIEW_COLUMNS VARIANT,
    LINEAGE_DEPTH NUMBER,
    SEMANTIC_BUNDLE_ID STRING,
    SEMANTIC_VIEW_NAME STRING,
    SEMANTIC_LEVEL STRING,
    UPSTREAM_HASH STRING,
    PHYSICAL_VIEW_NAME STRING,
    CREATED_BY STRING,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    IS_ACTIVE BOOLEAN DEFAULT TRUE
)
COMMENT = 'Saved derived-source definitions with recursive lineage and semantic asset metadata.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_SCHEMA_VIEWS (
    VIEW_ID            STRING          NOT NULL,
    DATABASE_NAME      STRING          NOT NULL,
    SCHEMA_NAME        STRING          NOT NULL,
    FQN                STRING          NOT NULL,
    GENERATED_BY       STRING,
    STATUS             STRING          NOT NULL DEFAULT 'ACTIVE',
    VERSION            STRING          NOT NULL,
    TABLE_COUNT        NUMBER,
    COLUMN_SET_HASH    STRING,
    LAST_ALTERED_TS    TIMESTAMP_NTZ,
    SEMANTIC_VIEW      VARIANT         NOT NULL,
    GENERATED_AT       TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT         TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Canonical versioned schema-level semantic views. One ACTIVE row per database and schema.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS (
    VIEW_ID            STRING          NOT NULL,
    DATABASE_NAME      STRING          NOT NULL,
    SCHEMA_NAME        STRING          NOT NULL,
    TABLE_NAME         STRING          NOT NULL,
    FQN                STRING          NOT NULL,
    GENERATED_BY       STRING,
    STATUS             STRING          NOT NULL DEFAULT 'ACTIVE',
    VERSION            STRING          NOT NULL,
    ROW_COUNT          NUMBER,
    COLUMN_COUNT       NUMBER,
    COLUMN_SET_HASH    STRING,
    LAST_ALTERED_TS    TIMESTAMP_NTZ,
    SEMANTIC_LEVEL     STRING,
    SEMANTIC_VIEW      VARIANT         NOT NULL,
    GENERATED_AT       TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT         TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Canonical versioned table-level semantic views. One ACTIVE row per database, schema, and table.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_COLUMN_VIEWS (
    VIEW_ID            STRING          NOT NULL,
    DATABASE_NAME      STRING          NOT NULL,
    SCHEMA_NAME        STRING          NOT NULL,
    TABLE_NAME         STRING          NOT NULL,
    COLUMN_NAME        STRING          NOT NULL,
    FQN                STRING          NOT NULL,
    TABLE_VIEW_ID      STRING          NOT NULL,
    GENERATED_BY       STRING,
    STATUS             STRING          NOT NULL DEFAULT 'ACTIVE',
    DATA_TYPE          STRING,
    COLUMN_HASH        STRING,
    ATTRIBUTE_VIEW     VARIANT         NOT NULL,
    GENERATED_AT       TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT         TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Canonical versioned column-level semantic views. One ACTIVE row per database, schema, table, and column.';


-- ============================================================
-- 1. TBL_USERS
--    Internal users only. Auth via Okta SSO — no passwords.
--    User records are provisioned from Okta (SCIM or manual
--    sync); Snowflake RBAC mapped via External OAuth Security
--    Integration. This table mirrors the identity for
--    application-level audit and role display only.
-- ============================================================
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS (
    USER_ID                 VARCHAR(128)    NOT NULL PRIMARY KEY,   -- OKTA subject (sub claim) — immutable
    EMAIL                   VARCHAR(255)    NOT NULL UNIQUE,
    DISPLAY_NAME            VARCHAR(255),
    ROLE                    VARCHAR(50)     DEFAULT 'VIEWER'  COMMENT 'ADMIN | PUBLISHER | VIEWER',
    IS_ACTIVE               BOOLEAN         DEFAULT TRUE,
    CREATED_DATETIME        TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    LAST_MODIFIED_DATETIME  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'App-level user mirror. Provisioned from Okta — not self-registered. Auth via Okta SSO + Snowflake External OAuth';


-- ============================================================
-- 2. TBL_PROJECTS
--    Top-level anchor. Links STTM and DBT Conversion together.
-- ============================================================
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_PROJECTS (
    PROJECT_ID              NUMBER          AUTOINCREMENT   NOT NULL PRIMARY KEY,
    PROJECT_NAME            VARCHAR(255)    NOT NULL,
    DESCRIPTION             TEXT,
    STATUS                  VARCHAR(50)     DEFAULT 'ACTIVE'  COMMENT 'ACTIVE | ARCHIVED',
    CREATED_BY              VARCHAR(128)    REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
    CREATED_DATETIME        TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    LAST_MODIFIED_DATETIME  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Top-level anchor linking STTM and DBT Conversion workstreams';


-- ============================================================
-- 3. TBL_STTM
--    One record per STTM within a project. Multiple allowed
--    (revisions, failed attempts). Only one ACTIVE at a time.
--
--    Versioning:
--      CURRENT_VERSION         — latest published version number (0 = never published)
--      HAS_UNPUBLISHED_DRAFT   — TRUE when unsaved edits exist since last publish
--      STATUS                  — lifecycle state of this STTM record
-- ============================================================
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_STTM (
    STTM_ID                 NUMBER          AUTOINCREMENT   NOT NULL PRIMARY KEY,
    PROJECT_ID              NUMBER          NOT NULL REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_PROJECTS(PROJECT_ID),
    CURRENT_VERSION         INT             DEFAULT 0         COMMENT '0 = never published; increments on each publish',
    HAS_UNPUBLISHED_DRAFT   BOOLEAN         DEFAULT FALSE     COMMENT 'TRUE when unsaved edits exist since last publish; drives UI badge',
    STATUS                  VARCHAR(50)     DEFAULT 'DRAFT'   COMMENT 'DRAFT | IN_PROGRESS | COMPLETE | SUPERSEDED',
    LAST_MODIFIED_BY        VARCHAR(128)    REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
    CREATED_DATETIME        TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    LAST_MODIFIED_DATETIME  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'One record per STTM. Multiple per project allowed (revisions, failed attempts). Only one ACTIVE at a time';


-- ============================================================
-- 4. TBL_STTM_VERSIONS
--    Ledger of every published snapshot of an STTM.
--    One row minted per publish action. Immutable after insert.
-- ============================================================
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_STTM_VERSIONS (
    VERSION_ID          NUMBER          AUTOINCREMENT   NOT NULL PRIMARY KEY,
    STTM_ID             NUMBER          NOT NULL REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_STTM(STTM_ID),
    VERSION_NUMBER      INT             NOT NULL         COMMENT 'Monotonically increasing per STTM; starts at 1',
    REVISION_NOTE       TEXT,
    PUBLISHED_BY        VARCHAR(128)    REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
    PUBLISHED_DATETIME  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT UQ_TBL_STTM_VERSION UNIQUE (STTM_ID, VERSION_NUMBER)
)
COMMENT = 'Immutable publish ledger for STTM. One row minted per publish action';


-- ============================================================
-- 5. TBL_STTM_SOURCES
--    One row per source table referenced in the STTM.
--    Versioned alongside TBL_STTM_ATTRIBUTES using same
--    EFFECTIVE_FROM / EFFECTIVE_THROUGH pattern.
-- ============================================================
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_STTM_SOURCES (
    SOURCE_ID               NUMBER          AUTOINCREMENT   NOT NULL PRIMARY KEY,
    STTM_ID                 NUMBER          NOT NULL REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_STTM(STTM_ID),
    SOURCE_NAME             VARCHAR(255)    NOT NULL         COMMENT 'Alias used in STTM (e.g. orders)',
    DATABASE_NAME           VARCHAR(255),
    SCHEMA_NAME             VARCHAR(255),
    TABLE_NAME              VARCHAR(255),
    DESCRIPTION             TEXT,
    IS_DRAFT                BOOLEAN         DEFAULT FALSE,
    EFFECTIVE_FROM_VERSION  INT              COMMENT 'NULL until first publish',
    EFFECTIVE_THROUGH_VERSION INT            COMMENT 'NULL = row still live',
    LAST_MODIFIED_BY        VARCHAR(128)    REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
    CREATED_DATETIME        TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    LAST_MODIFIED_DATETIME  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Source tables referenced in an STTM. SCD2-versioned alongside attributes';


-- ============================================================
-- 6. TBL_STTM_ATTRIBUTES
--    One row per attribute (raw or transformed).
--
--    Versioning (SCD Type 2):
--      Each edit creates a NEW row (draft). On publish:
--        - New row:      IS_DRAFT=FALSE, EFFECTIVE_FROM = new version
--        - Old row:      EFFECTIVE_THROUGH_VERSION = previous version (closed)
--      Unchanged rows automatically cover the new version
--      because their EFFECTIVE_THROUGH_VERSION remains NULL.
--
--    Reconstruct any version V:
--      WHERE IS_DRAFT = FALSE
--        AND EFFECTIVE_FROM_VERSION <= V
--        AND (EFFECTIVE_THROUGH_VERSION IS NULL OR EFFECTIVE_THROUGH_VERSION >= V)
-- ============================================================
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_STTM_ATTRIBUTES (
    ATTRIBUTE_ID            NUMBER          AUTOINCREMENT   NOT NULL PRIMARY KEY,
    STTM_ID                 NUMBER          NOT NULL REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_STTM(STTM_ID),
    SOURCE_ID               NUMBER          REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_STTM_SOURCES(SOURCE_ID)  COMMENT 'NULL for TRANSFORMED attributes with no single source',
    ATTRIBUTE_NAME          VARCHAR(255)    NOT NULL,
    ATTRIBUTE_TYPE          VARCHAR(50)     NOT NULL         COMMENT 'RAW | TRANSFORMED',
    SOURCE_COLUMN           VARCHAR(255)                     COMMENT 'Original column name; RAW only',
    DATA_TYPE               VARCHAR(100),
    TRANSFORMATION_LOGIC    TEXT,
    DESCRIPTION             TEXT,
    CONDITION               VARIANT,
    CALCULATION             VARIANT,
    MEASURE                 VARIANT,
    AGGREGATION             VARIANT,
    IS_NULLABLE             BOOLEAN         DEFAULT TRUE,
    IS_PK                   BOOLEAN         DEFAULT FALSE,
    IS_FK                   BOOLEAN         DEFAULT FALSE,
    IS_DRAFT                BOOLEAN         DEFAULT FALSE,
    EFFECTIVE_FROM_VERSION  INT              COMMENT 'NULL until first publish',
    EFFECTIVE_THROUGH_VERSION INT            COMMENT 'NULL = row still live',
    LAST_MODIFIED_BY        VARCHAR(128)    REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
    CREATED_DATETIME        TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    LAST_MODIFIED_DATETIME  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'STTM attributes (raw + transformed). SCD2-versioned — never update rows, always insert new draft';


-- ============================================================
-- 7. TBL_DBT_CONVERSION
--    One record per conversion attempt within a project.
--    Multiple allowed (failed attempts, revisions).
--    Always tied to a specific STTM.
--
--    Versioning mirrors STTM pattern:
--      CURRENT_VERSION         — latest published version (0 = never published)
--      HAS_UNPUBLISHED_DRAFT   — TRUE when file edits exist since last publish
-- ============================================================
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_DBT_CONVERSION (
    CONVERSION_ID           NUMBER          AUTOINCREMENT   NOT NULL PRIMARY KEY,
    PROJECT_ID              NUMBER          NOT NULL REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_PROJECTS(PROJECT_ID),
    STTM_ID                 NUMBER          NOT NULL REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_STTM(STTM_ID),
    CURRENT_VERSION         INT             DEFAULT 0         COMMENT '0 = never published',
    HAS_UNPUBLISHED_DRAFT   BOOLEAN         DEFAULT FALSE     COMMENT 'TRUE when file edits exist since last publish; drives UI badge',
    STATUS                  VARCHAR(50)     DEFAULT 'IN_PROGRESS'  COMMENT 'IN_PROGRESS | COMPLETE | FAILED',
    CREATED_DATETIME        TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    LAST_MODIFIED_DATETIME  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'One record per DBT conversion attempt. Multiple per project allowed. Always tied to a specific STTM';


-- ============================================================
-- 8. TBL_DBT_VERSIONS
--    Ledger of every published snapshot of a DBT Conversion.
--    One row minted per publish action. Immutable after insert.
-- ============================================================
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_DBT_VERSIONS (
    VERSION_ID          NUMBER          AUTOINCREMENT   NOT NULL PRIMARY KEY,
    CONVERSION_ID       NUMBER          NOT NULL REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_DBT_CONVERSION(CONVERSION_ID),
    VERSION_NUMBER      INT             NOT NULL         COMMENT 'Monotonically increasing per conversion; starts at 1',
    REVISION_NOTE       TEXT,
    PUBLISHED_BY        VARCHAR(128)    REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
    PUBLISHED_DATETIME  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT UQ_TBL_DBT_VERSION UNIQUE (CONVERSION_ID, VERSION_NUMBER)
)
COMMENT = 'Immutable publish ledger for DBT Conversion. One row minted per publish action';


-- ============================================================
-- 9. TBL_DBT_FILES
--    One row per generated DBT file.
--
--    Versioning (SCD Type 2) — same pattern as TBL_STTM_ATTRIBUTES:
--      Each edit creates a NEW row (draft). On publish:
--        - New row:  IS_DRAFT=FALSE, EFFECTIVE_FROM = new version
--        - Old row:  EFFECTIVE_THROUGH_VERSION = previous version (closed)
--
--    Reconstruct any version V:
--      WHERE IS_DRAFT = FALSE
--        AND EFFECTIVE_FROM_VERSION <= V
--        AND (EFFECTIVE_THROUGH_VERSION IS NULL OR EFFECTIVE_THROUGH_VERSION >= V)
-- ============================================================
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_DBT_FILES (
    FILE_ID                 NUMBER          AUTOINCREMENT   NOT NULL PRIMARY KEY,
    CONVERSION_ID           NUMBER          NOT NULL REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_DBT_CONVERSION(CONVERSION_ID),
    FILE_NAME               VARCHAR(500)    NOT NULL,
    FILE_TYPE               VARCHAR(100)                     COMMENT 'MODEL | SOURCE | SCHEMA | SNAPSHOT | MACRO | TEST',
    FILE_PATH               TEXT,
    FILE_CONTENT            TEXT            NOT NULL,
    IS_DRAFT                BOOLEAN         DEFAULT FALSE,
    EFFECTIVE_FROM_VERSION  INT              COMMENT 'NULL until first publish',
    EFFECTIVE_THROUGH_VERSION INT            COMMENT 'NULL = row still live',
    LAST_MODIFIED_BY        VARCHAR(128)    REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
    CREATED_DATETIME        TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    LAST_MODIFIED_DATETIME  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Generated DBT files per conversion. SCD2-versioned — never update rows, always insert new draft';


-- ============================================================
-- 10. TBL_CONVERSATIONS
--     One row per Cortex Agent thread.
--     A single STTM or DBT Conversion may span multiple threads
--     (context spillover, user reset, error recovery).
--
--     PARENT_TYPE  — 'STTM' | 'DBT'
--     PARENT_ID    — STTM_ID or CONVERSION_ID (no FK enforced)
--     STATUS       — 'ACTIVE' | 'CLOSED' | 'ABANDONED'
--
--     Thread order is derived from STARTED_DATETIME.
--     Only one thread per parent should be ACTIVE at a time.
-- ============================================================
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_CONVERSATIONS (
    CONVERSATION_ID     NUMBER          AUTOINCREMENT   NOT NULL PRIMARY KEY,
    PARENT_TYPE         VARCHAR(10)     NOT NULL         COMMENT 'STTM | DBT',
    PARENT_ID           NUMBER          NOT NULL         COMMENT 'STTM_ID or CONVERSION_ID; no FK — polymorphic ref',
    AGENT_CONV_ID       VARCHAR(1000)   NOT NULL         COMMENT 'Cortex Agent external thread ID',
    STATUS              VARCHAR(20)     DEFAULT 'ACTIVE' COMMENT 'ACTIVE | CLOSED | ABANDONED',
    STARTED_DATETIME    TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CLOSED_DATETIME     TIMESTAMP_NTZ,
    CREATED_BY          VARCHAR(128)    REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID)  COMMENT 'NULL if system-initiated'
)
COMMENT = 'Cortex Agent conversation threads. One STTM/DBT conversion may span multiple threads. Only one ACTIVE per parent at a time';


-- ============================================================
-- 11. Structured workbench conversation and RAG metadata
-- ============================================================
CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_CONVERSATION_TURNS (
    TURN_ID             STRING          NOT NULL,
    CONVERSATION_ID     STRING          NOT NULL,
    REQUEST_ID          STRING,
    TRACE_ID            STRING,
    ROLE                STRING          NOT NULL,
    ROUTE               STRING          NOT NULL,
    INTENT_CLASS        STRING          NOT NULL,
    MESSAGE             STRING,
    CITATIONS           VARIANT,
    GUARDRAILS_META     VARIANT,
    USER_ID             STRING,
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Structured user and assistant turns for the governed conversation workflow.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_FEEDBACK (
    FEEDBACK_ID         STRING          NOT NULL,
    REQUEST_ID          STRING,
    TARGET_REQUEST_ID   STRING,
    CONVERSATION_ID     STRING          NOT NULL,
    CATEGORY            STRING          NOT NULL,
    RATING              NUMBER,
    COMMENT             STRING,
    USER_ID             STRING,
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Structured user feedback captured from the conversation workflow.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_RECOMMENDATIONS (
    RECOMMENDATION_ID   STRING          NOT NULL,
    REQUEST_ID          STRING,
    CONVERSATION_ID     STRING          NOT NULL,
    MESSAGE             STRING,
    CITATIONS           VARIANT,
    APPROVAL_REQUIRED   BOOLEAN         DEFAULT FALSE,
    STATUS              STRING          NOT NULL,
    USER_ID             STRING,
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Structured recommendation records emitted by the conversation workflow.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_RELATIONSHIP_FACTS (
    RELATIONSHIP_DOC_ID STRING          NOT NULL,
    SEMANTIC_BUNDLE_ID  STRING,
    SOURCE_KIND         STRING          NOT NULL,
    SOURCE_ENTITY_ID    STRING          NOT NULL,
    SEMANTIC_VIEW_NAME  STRING,
    LEFT_TABLE          STRING,
    RIGHT_TABLE         STRING,
    JOIN_TYPE           STRING,
    CONSTRAINT_NAME     STRING,
    SOURCE_HASH         STRING,
    RELATIONSHIP_TEXT   STRING,
    UPDATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Flattened relationship facts extracted from semantic bundles and derived sources for RAG and auditability.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_RAG_DOCUMENTS (
    DOC_ID              STRING          NOT NULL,
    DOC_FOLDER          STRING          NOT NULL,
    DOC_TYPE            STRING          NOT NULL,
    ENTITY_ID           STRING,
    TITLE               STRING,
    SEARCH_TEXT         STRING          NOT NULL,
    SEMANTIC_BUNDLE_ID  STRING,
    SEMANTIC_VIEW_NAME  STRING,
    REQUEST_ID          STRING,
    CONVERSATION_ID     STRING,
    SOURCE_HASH         STRING,
    ATTRIBUTES          VARIANT,
    UPDATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Canonical structured RAG document table indexed by Cortex Search for semantic, relationship, feedback, recommendation, and conversation retrieval.';
