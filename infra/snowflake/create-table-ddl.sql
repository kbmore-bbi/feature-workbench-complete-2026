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
    CREATED_BY              NUMBER          REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
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
    LAST_MODIFIED_BY        NUMBER          REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
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
    PUBLISHED_BY        NUMBER          REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
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
    LAST_MODIFIED_BY        NUMBER          REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
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
    LAST_MODIFIED_BY        NUMBER          REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
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
    PUBLISHED_BY        NUMBER          REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
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
    LAST_MODIFIED_BY        NUMBER          REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
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
    CREATED_BY          NUMBER          REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID)  COMMENT 'NULL if system-initiated'
)
COMMENT = 'Cortex Agent conversation threads. One STTM/DBT conversion may span multiple threads. Only one ACTIVE per parent at a time';