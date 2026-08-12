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
    SELECTION_KEY       STRING,
    BUNDLE_LABEL        VARCHAR(512),
    TARGET_TABLE        VARIANT,
    SOURCE_TABLES       VARIANT       NOT NULL,
    DERIVED_SOURCE_IDS  VARIANT       NOT NULL,
    RELATIONSHIPS       VARIANT       NOT NULL,
    SEMANTIC_LEVEL      VARCHAR(32)   NOT NULL,
    SEMANTIC_VIEW_NAME  VARCHAR(255),
    SEMANTIC_MODEL_YAML STRING,
    REGISTRY_VERSION    STRING,
    RAW_ASSETS          VARIANT,
    DERIVED_SEMANTICS   VARIANT,
    EXCLUDED_RELATIONSHIPS VARIANT,
    COMPOSITION_DIAGNOSTICS VARIANT,
    BUNDLE_ARTIFACT      VARIANT,
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

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_PREPARED_LEARNING_CONTEXTS (
    CONTEXT_KEY             VARCHAR(64)  NOT NULL,
    ACCESS_FINGERPRINT      VARCHAR(64)  NOT NULL,
    LEARNING_CONTEXT_ID     VARCHAR(255),
    LEARNING_CONTEXT_HASH   VARCHAR(64),
    CONTEXT_PAYLOAD         VARIANT      NOT NULL,
    CREATED_AT              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Access-isolated durable cache of prepared FIR and precedent context.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_PREPARED_WORKSPACE_CONTEXTS (
    WORKSPACE_CONTEXT_ID    VARCHAR(255) NOT NULL,
    WORKSPACE_CONTEXT_HASH  VARCHAR(64)  NOT NULL,
    ACCESS_FINGERPRINT      VARCHAR(64)  NOT NULL,
    STATUS                  VARCHAR(32)  NOT NULL,
    CONTEXT_PAYLOAD         VARIANT      NOT NULL,
    CREATED_AT              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    LAST_ACCESSED_AT        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT              TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Dependency-versioned composite handles for semantic, FIR, precedent, and artifact context.';

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
    PURPOSE STRING,
    BUSINESS_DESCRIPTION STRING,
    OUTPUT_COLUMNS VARIANT,
    COLUMN_SEMANTICS VARIANT,
    SEMANTIC_PROJECTION VARIANT,
    LINEAGE_DEPTH NUMBER,
    SEMANTIC_BUNDLE_ID STRING,
    SEMANTIC_VIEW_NAME STRING,
    SEMANTIC_LEVEL STRING,
    UPSTREAM_HASH STRING,
    SOURCE_DEPENDENCY_HASH STRING,
    GENERATED_BY_REQUEST_ID STRING,
    PHYSICAL_VIEW_NAME STRING,
    CREATED_BY STRING,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    IS_ACTIVE BOOLEAN DEFAULT TRUE
)
COMMENT = 'Saved derived-source definitions with recursive lineage and semantic asset metadata.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_PROJECTIONS (
    PROJECTION_ID       STRING          NOT NULL,
    PROJECTION_KEY      STRING          NOT NULL,
    PROJECTION_PROFILE  STRING          NOT NULL,
    SOURCE_VIEW_ID      STRING,
    SOURCE_FQN          STRING,
    SEMANTIC_BUNDLE_ID  STRING,
    BUNDLE_HASH         STRING,
    ASSET_VERSION       STRING,
    PROJECTION_HASH     STRING,
    PROJECTION_PAYLOAD  VARIANT         NOT NULL,
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Compact, role-specific projections derived from rich V2 semantic assets for chat, mapping, transformation, Analyst, and admin contexts.';

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
    PHYSICAL_VIEW_NAME STRING,
    YAML_HASH          STRING,
    PRODUCER_AGENT     STRING,
    REQUEST_ID         STRING,
    PARENT_VIEW_ID     STRING,
    CHANGE_REASON      STRING,
    SEMANTIC_VIEW      VARIANT         NOT NULL,
    GENERATED_AT       TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT         TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Canonical versioned table-level semantic views. One ACTIVE row per database, schema, and table.';

ALTER TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
    ADD COLUMN IF NOT EXISTS PHYSICAL_VIEW_NAME STRING;
ALTER TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
    ADD COLUMN IF NOT EXISTS YAML_HASH STRING;
ALTER TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
    ADD COLUMN IF NOT EXISTS PRODUCER_AGENT STRING;
ALTER TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
    ADD COLUMN IF NOT EXISTS REQUEST_ID STRING;
ALTER TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
    ADD COLUMN IF NOT EXISTS PARENT_VIEW_ID STRING;
ALTER TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
    ADD COLUMN IF NOT EXISTS CHANGE_REASON STRING;
ALTER TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
    ADD COLUMN IF NOT EXISTS QA_HISTORY VARIANT;

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


CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_OAUTH_SESSIONS (
    SESSION_ID                 VARCHAR(128)    NOT NULL PRIMARY KEY,
    SNOWFLAKE_USER             VARCHAR(255)    NOT NULL,
    SNOWFLAKE_ROLE             VARCHAR(255),
    EMAIL                      VARCHAR(255)    NOT NULL,
    DISPLAY_NAME               VARCHAR(255),
    APP_USER_ID                VARCHAR(255)    NOT NULL,
    ACCESS_TOKEN_ENCRYPTED     STRING          NOT NULL,
    REFRESH_TOKEN_ENCRYPTED    STRING,
    ACCESS_TOKEN_EXPIRES_AT    TIMESTAMP_NTZ   NOT NULL,
    REFRESH_TOKEN_EXPIRES_AT   TIMESTAMP_NTZ,
    CREATED_AT                 TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    LAST_ACCESSED_AT           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    LAST_REFRESHED_AT          TIMESTAMP_NTZ,
    IS_ACTIVE                  BOOLEAN         DEFAULT TRUE
)
COMMENT = 'Server-side encrypted Snowflake OAuth sessions for backend-managed app auth.';


-- ============================================================
-- 2. TBL_PROJECTS
--    Top-level anchor. Links STTM and DBT Conversion together.
-- ============================================================
CREATE TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_PROJECTS (
    PROJECT_ID              NUMBER          AUTOINCREMENT   NOT NULL PRIMARY KEY,
    PROJECT_NAME            VARCHAR(255)    NOT NULL,
    DESCRIPTION             TEXT,
    STATUS                  VARCHAR(50)     DEFAULT 'ACTIVE'  COMMENT 'ACTIVE | ARCHIVED',
    RUNTIME_SUPPRESSED      BOOLEAN         DEFAULT FALSE,
    ARCHIVED_AT             TIMESTAMP_NTZ,
    CREATED_BY              VARCHAR(128)    REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
    PROJECT_METADATA        VARIANT,
    CREATED_DATETIME        TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    LAST_MODIFIED_DATETIME  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Top-level anchor linking STTM and DBT Conversion workstreams';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_PROJECT_ATTRIBUTES (
    ATTRIBUTE_ID            STRING          NOT NULL PRIMARY KEY,
    PROJECT_ID              STRING          NOT NULL,
    ATTRIBUTE_NAME          VARCHAR(255)    NOT NULL,
    ATTRIBUTE_TYPE          VARCHAR(50)     NOT NULL,
    ATTRIBUTE_VALUE         TEXT,
    SOURCE_PROJECT_ID       STRING,
    SOURCE_ATTRIBUTE_ID     STRING,
    STATUS                  VARCHAR(20)     DEFAULT 'ACTIVE',
    CREATED_BY              VARCHAR(128),
    UPDATED_BY              VARCHAR(128),
    CREATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Project-scoped named values available to mappings as governed value bindings';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_ARTIFACT_JOBS (
    JOB_ID STRING NOT NULL PRIMARY KEY,
    JOB_TYPE VARCHAR(64) NOT NULL,
    REQUEST_ID STRING,
    REQUESTED_BY STRING,
    PROJECT_ID STRING,
    STTM_ID STRING,
    CONTEXT_HASH STRING,
    STATUS VARCHAR(32) NOT NULL DEFAULT 'queued',
    STAGE VARCHAR(64) NOT NULL DEFAULT 'queued',
    REQUEST_PAYLOAD VARIANT,
    RESULT_PAYLOAD VARIANT,
    ERROR_MESSAGE TEXT,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    STARTED_AT TIMESTAMP_NTZ,
    COMPLETED_AT TIMESTAMP_NTZ,
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Durable UI job lifecycle for DBT conversion and generated test-case artifacts';


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
    STTM_NAME               VARCHAR(255),
    DESCRIPTION             TEXT,
    TARGET_TABLE            STRING,
    CURRENT_VERSION         INT             DEFAULT 0         COMMENT '0 = never published; increments on each publish',
    HAS_UNPUBLISHED_DRAFT   BOOLEAN         DEFAULT FALSE     COMMENT 'TRUE when unsaved edits exist since last publish; drives UI badge',
    STATUS                  VARCHAR(50)     DEFAULT 'DRAFT'   COMMENT 'DRAFT | IMPORTING | IMPORT_FAILED | IN_PROGRESS | COMPLETE | SUPERSEDED',
    IMPORT_KEY              STRING,
    IMPORT_STATE            VARCHAR(50),
    RUNTIME_SUPPRESSED      BOOLEAN         DEFAULT FALSE,
    SUPERSEDED_BY           STRING,
    RAW_MAPPING_SQL         TEXT,
    PARSED_MAPPING_MODEL    VARIANT,
    DRAFT_PAYLOAD           VARIANT,
    SEMANTIC_BUNDLE_ID      STRING,
    SEMANTIC_BUNDLE_HASH    STRING,
    LAST_SNAPSHOT_ID        STRING,
    STTM_METADATA           VARIANT,
    LAST_MODIFIED_BY        VARCHAR(128)    REFERENCES FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_USERS(USER_ID),
    ACTOR_USER_ID           VARCHAR(128)    COMMENT 'Canonical string identity for OAuth and Snowflake users',
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
    SNAPSHOT_ID         STRING,
    VERSION_PAYLOAD     VARIANT,
    RAW_MAPPING_SQL      TEXT,
    PARSED_MAPPING_MODEL VARIANT,
    SEMANTIC_BUNDLE_ID  STRING,
    SEMANTIC_BUNDLE_HASH STRING,
    MAPPING_VERSION     STRING,
    AGENT_ARTIFACT_IDS  VARIANT,
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

-- NOTE:
-- Current UI mapping-row state is intentionally stored in the existing
-- TBL_STTM_ATTRIBUTES.CONDITION VARIANT column. Do not create a separate
-- mapping-row table; it causes deployments to depend on an extra metadata
-- object that is not part of the canonical STTM registry.


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

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKSPACE_SNAPSHOTS (
    SNAPSHOT_ID          STRING          NOT NULL,
    SESSION_ID           STRING,
    THREAD_ID            STRING,
    CONTEXT_VERSION      STRING          DEFAULT '1.0',
    CONTEXT_HASH         STRING          NOT NULL,
    PAGE                 STRING,
    SURFACE              STRING,
    PROJECT_ID           STRING,
    STTM_ID              STRING,
    SEMANTIC_BUNDLE_ID   STRING,
    SEMANTIC_BUNDLE_HASH STRING,
    MAPPING_VERSION      STRING,
    SNAPSHOT_PAYLOAD     VARIANT         NOT NULL,
    RAW_MAPPING_SQL      TEXT,
    PARSED_MAPPING_MODEL VARIANT,
    RUNTIME_SUPPRESSED   BOOLEAN         DEFAULT FALSE,
    USER_ID              STRING,
    CREATED_AT           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Versioned WorkbenchContextSnapshotV1 records used to restore assistant, Auto-map, validation, and CoCo context.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_AGENT_ARTIFACTS (
    ARTIFACT_ID          STRING          NOT NULL,
    REQUEST_ID           STRING,
    SESSION_ID           STRING,
    THREAD_ID            STRING,
    AGENT_NAME           STRING          NOT NULL,
    ARTIFACT_TYPE        STRING          NOT NULL,
    ARTIFACT_STATUS      STRING          DEFAULT 'draft',
    ENTITY_TYPE          STRING,
    ENTITY_IDS           VARIANT,
    CONTEXT_KEY          STRING,
    SNAPSHOT_ID          STRING,
    SEMANTIC_BUNDLE_ID   STRING,
    SEMANTIC_BUNDLE_HASH STRING,
    RETRIEVED_INFERENCE_IDS VARIANT,
    RETRIEVED_RECOMMENDATION_IDS VARIANT,
    USED_INFERENCE_IDS   VARIANT,
    USED_RECOMMENDATION_IDS VARIANT,
    PAYLOAD              VARIANT         NOT NULL,
    SUMMARY              STRING,
    CREATED_BY           STRING,
    LOGICAL_CONVERSATION_ID STRING,
    THREAD_SEGMENT       NUMBER,
    PROJECT_ID           STRING,
    MAPPING_ID           STRING,
    MIME_TYPE            STRING          DEFAULT 'application/json',
    CONTENT_HASH         STRING,
    STAGE_PATH           STRING,
    ORIGINAL_SIZE_BYTES  NUMBER,
    COMPRESSED_SIZE_BYTES NUMBER,
    SOURCE_ARTIFACT_IDS  VARIANT,
    ACCESS_FINGERPRINT   STRING,
    SEARCH_KEYWORDS      VARIANT,
    RETENTION_UNTIL      TIMESTAMP_NTZ,
    CREATED_AT           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Structured artifacts produced by agents: derived-source drafts, mapping proposals, rule suggestions, validation reports, dbt files, and test cases.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_CONVERSATION_SEGMENTS (
    SEGMENT_ID                  STRING          NOT NULL,
    LOGICAL_CONVERSATION_ID     STRING          NOT NULL,
    PHYSICAL_THREAD_ID          STRING,
    SEGMENT_NUMBER              NUMBER          NOT NULL,
    PREVIOUS_SEGMENT_ID         STRING,
    NEXT_SEGMENT_ID             STRING,
    ROLLOVER_REASON             STRING,
    ESTIMATED_CONTEXT_TOKENS    NUMBER          DEFAULT 0,
    TURN_COUNT                  NUMBER          DEFAULT 0,
    CHECKPOINT_ARTIFACT_ID      STRING,
    SEMANTIC_BUNDLE_HASH        STRING,
    LEARNING_CONTEXT_HASH       STRING,
    STATUS                      STRING          DEFAULT 'ACTIVE',
    USER_ID                     STRING,
    CREATED_AT                  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT                  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CLOSED_AT                   TIMESTAMP_NTZ
)
COMMENT = 'Durable physical Cortex thread segments that form one logical Workbench conversation.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_FEEDBACK (
    FEEDBACK_ID         STRING          NOT NULL,
    REQUEST_ID          STRING,
    TARGET_REQUEST_ID   STRING,
    CONVERSATION_ID     STRING          NOT NULL,
    SIGNAL_ID           STRING,
    FEEDBACK_TYPE       STRING          DEFAULT 'agent_quality',
    CATEGORY            STRING          NOT NULL,
    OPTION_SELECTED     STRING,
    RATING              NUMBER,
    COMMENT             STRING,
    ENTITY_TYPE         STRING,
    ENTITY_ID           STRING,
    SELECTION_CONTEXT   VARIANT,
    USER_ID             STRING,
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Structured user feedback captured from the conversation workflow.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_RECOMMENDATIONS (
    RECOMMENDATION_ID   STRING          NOT NULL,
    REQUEST_ID          STRING,
    CONVERSATION_ID     STRING          NOT NULL,
    SIGNAL_ID           STRING,
    RECOMMENDATION_TYPE STRING          DEFAULT 'conversation',
    MESSAGE             STRING,
    CITATIONS           VARIANT,
    ENTITY_TYPE         STRING,
    ENTITY_IDS          VARIANT,
    CONFIDENCE          FLOAT,
    ATTRIBUTES          VARIANT,
    APPROVAL_REQUIRED   BOOLEAN         DEFAULT FALSE,
    STATUS              STRING          NOT NULL,
    REVIEW_RATING       NUMBER,
    REVIEW_COMMENT      STRING,
    REVIEW_STATUS       STRING,
    USER_ID             STRING,
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Structured recommendation records emitted by the conversation workflow.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_INFERENCES (
    INFERENCE_ID        STRING          NOT NULL,
    INFERENCE_KEY       STRING          NOT NULL,
    REQUEST_ID          STRING,
    CONVERSATION_ID     STRING,
    SOURCE              STRING          NOT NULL,
    INFERENCE_TYPE      STRING          NOT NULL,
    SUMMARY             STRING          NOT NULL,
    CONFIDENCE          FLOAT,
    ENTITY_TYPE         STRING,
    ENTITY_IDS          VARIANT,
    ATTRIBUTES          VARIANT,
    STATUS              STRING          NOT NULL,
    USER_ID             STRING,
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Structured inference layer bridging activity, feedback, and recommendation generation for the governed assistant.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_ASSISTANT_SIGNALS (
    SIGNAL_ID           STRING          NOT NULL,
    SIGNAL_KEY          STRING          NOT NULL,
    REQUEST_ID          STRING,
    CONVERSATION_ID     STRING,
    INFERENCE_ID        STRING,
    SIGNAL_TYPE         STRING          NOT NULL,
    LAYER               STRING          NOT NULL,
    SOURCE              STRING          NOT NULL,
    STATUS              STRING          NOT NULL,
    TITLE               STRING          NOT NULL,
    MESSAGE             STRING          NOT NULL,
    OPTIONS             VARIANT,
    ALLOW_FREE_TEXT     BOOLEAN         DEFAULT FALSE,
    REQUIRES_RESPONSE   BOOLEAN         DEFAULT FALSE,
    ENTITY_TYPE         STRING,
    ENTITY_IDS          VARIANT,
    CONFIDENCE          FLOAT,
    ATTRIBUTES          VARIANT,
    USER_ID             STRING,
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    RESPONDED_AT        TIMESTAMP_NTZ,
    DISMISSED_AT        TIMESTAMP_NTZ
)
COMMENT = 'Live feedback and recommendation notifications surfaced above the AI assistant and linked to user activity or agent uncertainty.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_ASSISTANT_SETTINGS (
    USER_ID                     STRING          NOT NULL,
    FEEDBACK_ENABLED            BOOLEAN         DEFAULT TRUE,
    RECOMMENDATIONS_ENABLED     BOOLEAN         DEFAULT TRUE,
    UPDATED_AT                  TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Per-user toggles controlling live feedback and recommendation prompts in the workbench UI.';

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

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_CLIENT_NOTES (
    NOTE_ID              STRING          NOT NULL,
    PROJECT_ID           STRING,
    ENTITY_TYPE          STRING,
    ENTITY_IDS           VARIANT,
    TITLE                STRING,
    NOTE_TEXT            STRING          NOT NULL,
    SOURCE_LABEL         STRING,
    AUTHOR_NAME          STRING,
    TAGS                 VARIANT,
    ATTRIBUTES           VARIANT,
    STATUS               STRING          DEFAULT 'active',
    UPDATED_AT           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CREATED_AT           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Client-provided business notes, usage guidance, and mapping context that can be indexed for assistant retrieval in client environments.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_CLIENT_SQL_ASSETS (
    SQL_ASSET_ID         STRING          NOT NULL,
    PROJECT_ID           STRING,
    ENTITY_TYPE          STRING,
    ENTITY_IDS           VARIANT,
    TITLE                STRING,
    SQL_TEXT             STRING          NOT NULL,
    SQL_KIND             STRING          DEFAULT 'historical_mapping',
    DIALECT              STRING          DEFAULT 'snowflake',
    DESCRIPTION          STRING,
    SOURCE_LABEL         STRING,
    AUTHOR_NAME          STRING,
    TAGS                 VARIANT,
    ATTRIBUTES           VARIANT,
    STATUS               STRING          DEFAULT 'active',
    UPDATED_AT           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CREATED_AT           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Client-provided historical SQL, mapping SQL, and handcrafted query assets that can be indexed and cited by the assistant.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_FIR_EVENTS (
    EVENT_ID            STRING          NOT NULL,
    EVENT_TYPE          STRING          NOT NULL,
    USER_ID             STRING,
    SESSION_ID          STRING,
    REQUEST_ID          STRING,
    PAGE                STRING,
    SURFACE             STRING,
    ENTITY_TYPE         STRING,
    ENTITY_IDS          VARIANT,
    EVENT_PAYLOAD       VARIANT,
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Canonical event stream for live Feedback, Inference, and Recommendation evaluation.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_FIR_TEMPLATES (
    TEMPLATE_ID          STRING          NOT NULL,
    TEMPLATE_TYPE        STRING          NOT NULL,
    SOURCE_EVENT_TYPE    STRING          NOT NULL,
    ENTITY_TYPE          STRING,
    NAME                 STRING          NOT NULL,
    DESCRIPTION          STRING,
    EXTRACTION_SCHEMA    VARIANT         NOT NULL,
    PROMPT_GUIDANCE      STRING,
    RECOMMENDATION_RULES VARIANT,
    STATUS               STRING          DEFAULT 'active',
    VERSION              STRING          DEFAULT '1.0',
    CREATED_AT           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Templates that define what to infer from each feedback source: chat feedback, accepted mappings, historical STTM documents, SQL assets, and user corrections.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_FIR_FEATURES (
    FEATURE_KEY         STRING          NOT NULL,
    USER_ID             STRING,
    SESSION_ID          STRING,
    PAGE                STRING,
    SURFACE             STRING,
    ENTITY_TYPE         STRING,
    ENTITY_IDS          VARIANT,
    FEATURES            VARIANT,
    MODEL_TARGETS       VARIANT,
    UPDATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Online FIR feature snapshots and lightweight model scores used for low-latency recommendation and feedback decisions.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_MAPPING_INTENTS (
    INTENT_ID           STRING          NOT NULL,
    CONTEXT_KEY         STRING          NOT NULL,
    USER_ID             STRING,
    SESSION_ID          STRING,
    TARGET_TABLE        STRING,
    SOURCE_TABLES       VARIANT,
    BUSINESS_GOAL       STRING,
    LIFECYCLE           STRING          DEFAULT 'unknown',
    TARGET_OUTCOME      STRING,
    DOMAIN_HINTS        VARIANT,
    SOURCE              STRING          DEFAULT 'user',
    CONFIDENCE          FLOAT,
    ATTRIBUTES          VARIANT,
    UPDATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Business-first mapping intent captured for a source/target context and reused by FIR, automap, and semantic guidance.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_SEMANTIC_LEARNINGS (
    LEARNING_ID         STRING          NOT NULL,
    LEARNING_KEY        STRING          NOT NULL,
    USER_ID             STRING,
    ENTITY_TYPE         STRING,
    ENTITY_IDS          VARIANT,
    LEARNING_TYPE       STRING          NOT NULL,
    SUMMARY             STRING          NOT NULL,
    CONFIDENCE          FLOAT,
    SOURCE              STRING          NOT NULL,
    ATTRIBUTES          VARIANT,
    UPDATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CREATED_AT          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Curated semantic learnings distilled from feedback, inferences, and accepted recommendations for semantic reuse and automap improvement.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_FIR_MODEL_SCORES (
    SCORE_ID                              STRING          NOT NULL,
    MODEL_NAME                            STRING          NOT NULL,
    MODEL_VERSION                         STRING          NOT NULL,
    CONTEXT_KEY                           STRING          NOT NULL,
    ENTITY_TYPE                           STRING,
    ENTITY_ID                             STRING,
    PAGE                                  STRING,
    SURFACE                               STRING,
    FEEDBACK_NEEDED_PROBABILITY           FLOAT,
    RECOMMENDATION_HELPFULNESS_PROBABILITY FLOAT,
    RECOMMENDATION_TYPE                   STRING,
    RECOMMENDATION_PRIORITY               FLOAT,
    SCORE_PAYLOAD                         VARIANT,
    UPDATED_AT                            TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CREATED_AT                            TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP()
)
COMMENT = 'Latest FIR model predictions per live context, used to bias recommendation and feedback decisions without forcing retrieval on every click.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_AUTO_MAP_JOBS (
    JOB_ID                       STRING          NOT NULL,
    REQUEST_ID                   STRING,
    OWNER_ID                     STRING          NOT NULL,
    STATUS                       STRING          NOT NULL,
    STAGE                        STRING,
    CONTEXT_HASH                 STRING,
    SEMANTIC_BUNDLE_ID           STRING,
    AGENT_SPEC_HASHES            VARIANT,
    LEASE_OWNER                  STRING,
    LEASE_EXPIRES_AT             TIMESTAMP_TZ,
    ATTEMPT_COUNT                NUMBER          DEFAULT 0,
    JOB_STATE                    VARIANT         NOT NULL,
    CREATED_AT                   TIMESTAMP_TZ    DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT                   TIMESTAMP_TZ    DEFAULT CURRENT_TIMESTAMP(),
    EXPIRES_AT                   TIMESTAMP_TZ    DEFAULT DATEADD('day', 7, CURRENT_TIMESTAMP()),
    CONSTRAINT PK_AUTO_MAP_JOBS PRIMARY KEY (JOB_ID)
)
COMMENT = 'Durable adaptive Auto-map job state, partial results, diagnostics, retries, and replica-safe polling.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_TARGET_MAPPING_PATTERNS (
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
)
COMMENT = 'Versioned, content-addressed per-target-column mapping recipes with provenance and guarded cross-source transfer metadata.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_LEARNING_JOBS (
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
)
COMMENT = 'Durable FIR document and target-column learning jobs that survive request, thread, service, and replica interruption.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_LEARNING_WORK_ITEMS (
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
)
COMMENT = 'Bounded idempotent FIR parse, enrichment, conflict, recommendation, and search-promotion work items.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_BUDGET_LEDGER (
    RUN_ID STRING NOT NULL,
    RUN_DATE DATE NOT NULL DEFAULT CURRENT_DATE(),
    TRIGGER_REASON STRING,
    ASSET_ID STRING,
    STATUS STRING NOT NULL,
    REQUEST_COUNT NUMBER DEFAULT 0,
    INPUT_TOKENS NUMBER DEFAULT 0,
    OUTPUT_TOKENS NUMBER DEFAULT 0,
    TOTAL_TOKENS NUMBER DEFAULT 0,
    STARTED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    COMPLETED_AT TIMESTAMP_NTZ,
    METADATA VARIANT,
    CONSTRAINT UQ_FIR_AGENT_BUDGET_RUN UNIQUE (RUN_ID)
)
COMMENT = 'Daily FIR agent request and token reservations used to stop processing safely at configured budgets.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_RECOMMENDATION_ACTION_HISTORY (
    ACTION_HISTORY_ID STRING NOT NULL,
    RECOMMENDATION_ID STRING NOT NULL,
    RECOMMENDATION_VERSION NUMBER DEFAULT 1,
    PROJECT_ID STRING,
    STTM_ID STRING NOT NULL,
    ACTOR_ID STRING,
    IDEMPOTENCY_KEY STRING NOT NULL,
    ACTION_KIND STRING NOT NULL,
    STATUS STRING NOT NULL,
    EXPECTED_WORKSPACE_HASH STRING NOT NULL,
    BEFORE_WORKSPACE_HASH STRING NOT NULL,
    AFTER_WORKSPACE_HASH STRING NOT NULL,
    WORKSPACE_DIFF VARIANT,
    BEFORE_SNAPSHOT VARIANT,
    AFTER_SNAPSHOT VARIANT,
    RESULT VARIANT,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UNDONE_AT TIMESTAMP_NTZ,
    CONSTRAINT UQ_FIR_RECOMMENDATION_ACTION_IDEMPOTENCY UNIQUE (IDEMPOTENCY_KEY)
)
COMMENT = 'Idempotent preview/apply/undo history for FIR recommendation workspace mutations.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_RUN_OBSERVABILITY (
    RUN_ID STRING NOT NULL,
    RUN_DATE DATE DEFAULT CURRENT_DATE(),
    TRIGGER_REASON STRING,
    USER_ID STRING,
    PROJECT_ID STRING,
    ASSET_ID STRING,
    TARGET_TABLE STRING,
    TARGET_COLUMN STRING,
    AGENT_NAME STRING,
    TOOL_NAME STRING,
    STATUS STRING,
    ASSET_COUNT NUMBER DEFAULT 0,
    TARGET_ROW_COUNT NUMBER DEFAULT 0,
    DUPLICATE_WORK_SKIPPED NUMBER DEFAULT 0,
    PATTERNS_EXTRACTED NUMBER DEFAULT 0,
    PATTERNS_ENRICHED NUMBER DEFAULT 0,
    PATTERNS_REJECTED NUMBER DEFAULT 0,
    PATTERNS_PROMOTED NUMBER DEFAULT 0,
    AGENT_REQUEST_COUNT NUMBER DEFAULT 0,
    INPUT_TOKENS NUMBER DEFAULT 0,
    OUTPUT_TOKENS NUMBER DEFAULT 0,
    TOTAL_TOKENS NUMBER DEFAULT 0,
    TOOL_CALL_COUNT NUMBER DEFAULT 0,
    DURATION_MS NUMBER,
    RETRY_COUNT NUMBER DEFAULT 0,
    CIRCUIT_BREAKER_STATUS STRING,
    ESTIMATED_COST NUMBER(18, 6),
    QUERY_TAG STRING,
    RESULT_VALIDATION_STATUS STRING,
    STARTED_AT TIMESTAMP_NTZ,
    COMPLETED_AT TIMESTAMP_NTZ,
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    METADATA VARIANT,
    CONSTRAINT UQ_FIR_RUN_OBSERVABILITY UNIQUE (RUN_ID)
)
COMMENT = 'Per-run FIR cost, quality, scope, tool, retry, and validation telemetry.';

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_BUNDLE_VERSIONS (
    BUNDLE_VERSION_ID STRING NOT NULL,
    SEMANTIC_BUNDLE_ID STRING,
    BASE_BUNDLE_HASH STRING,
    VERSION_NUMBER NUMBER NOT NULL DEFAULT 1,
    SQL_ASSET_ID STRING,
    PROJECT_ID STRING,
    STTM_ID STRING,
    WORKSPACE_CONTEXT_KEY STRING,
    WORKSPACE_CONTEXT_HASH STRING,
    KNOWLEDGE_GRAPH VARIANT,
    MAPPING_SEMANTICS VARIANT,
    FINDINGS VARIANT,
    EVIDENCE_IDS VARIANT,
    VALIDATION_SUMMARY VARIANT,
    STATUS STRING NOT NULL DEFAULT 'draft',
    CREATED_BY STRING,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    PROMOTED_AT TIMESTAMP_NTZ,
    CONSTRAINT PK_SEMANTIC_BUNDLE_VERSION PRIMARY KEY (BUNDLE_VERSION_ID)
)
COMMENT = 'Versioned review and promotion records for mapping-specific semantic bundle curation.';

ALTER TABLE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_AGENT_RECOMMENDATIONS
    ADD COLUMN IF NOT EXISTS BUNDLE_VERSION_ID STRING;

CREATE OR REPLACE VIEW FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.VW_FIR_RUN_OPERATIONS AS
SELECT
    RUN_DATE, USER_ID, PROJECT_ID, TRIGGER_REASON, AGENT_NAME, TOOL_NAME,
    ASSET_ID, TARGET_TABLE, TARGET_COLUMN, STATUS,
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
FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_RUN_OBSERVABILITY
GROUP BY
    RUN_DATE, USER_ID, PROJECT_ID, TRIGGER_REASON, AGENT_NAME, TOOL_NAME,
    ASSET_ID, TARGET_TABLE, TARGET_COLUMN, STATUS;

CREATE OR REPLACE VIEW FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.VW_FIR_OPERATIONAL_ALERTS AS
SELECT
    'idle_agent_call' AS ALERT_TYPE, 'warning' AS SEVERITY, RUN_ID AS ENTITY_ID,
    'Agent was invoked without an asset, target row, or pending record.' AS DETAIL,
    COALESCE(COMPLETED_AT, STARTED_AT) AS DETECTED_AT
FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_RUN_OBSERVABILITY
WHERE AGENT_REQUEST_COUNT > 0 AND ASSET_COUNT = 0 AND TARGET_ROW_COUNT = 0
  AND COALESCE(METADATA:pending_record_count::NUMBER, 0) = 0
UNION ALL
SELECT 'duplicate_asset_processing', 'warning', ASSET_ID,
       'The same asset received more than one successful agent request on one date.',
       MAX(COALESCE(COMPLETED_AT, STARTED_AT))
FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_RUN_OBSERVABILITY
WHERE ASSET_ID IS NOT NULL AND ASSET_ID <> '' AND AGENT_REQUEST_COUNT > 0
GROUP BY RUN_DATE, ASSET_ID
HAVING COUNT_IF(STATUS IN ('success', 'partial')) > 1
UNION ALL
SELECT 'daily_budget_threshold', 'warning', TO_VARCHAR(RUN_DATE),
       'Daily FIR request or token consumption is at least 80 percent of its limit.',
       MAX(COALESCE(COMPLETED_AT, STARTED_AT))
FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_RUN_OBSERVABILITY
GROUP BY RUN_DATE
HAVING SUM(AGENT_REQUEST_COUNT) >= 0.8 * MAX(COALESCE(METADATA:daily_request_limit::NUMBER, 50))
    OR SUM(TOTAL_TOKENS) >= 0.8 * MAX(COALESCE(METADATA:daily_token_limit::NUMBER, 20000000))
UNION ALL
SELECT 'stuck_work', 'critical', LEARNING_JOB_ID,
       'Durable FIR work has remained active beyond two catch-up windows.',
       CURRENT_TIMESTAMP()
FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_LEARNING_JOBS
WHERE STATUS IN ('running', 'paused')
  AND UPDATED_AT < DATEADD('hour', -24, CURRENT_TIMESTAMP())
UNION ALL
SELECT 'repeated_timeout', 'critical', COALESCE(ASSET_ID, PROJECT_ID, RUN_ID),
       'FIR processing timed out repeatedly within two days.',
       MAX(COALESCE(COMPLETED_AT, STARTED_AT))
FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_FIR_RUN_OBSERVABILITY
WHERE STARTED_AT >= DATEADD('day', -2, CURRENT_TIMESTAMP())
  AND (LOWER(STATUS) LIKE '%timeout%'
       OR LOWER(COALESCE(METADATA:error_summary::STRING, '')) LIKE '%timeout%')
GROUP BY COALESCE(ASSET_ID, PROJECT_ID, RUN_ID)
HAVING COUNT(*) >= 2;

CREATE TABLE IF NOT EXISTS FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_WORKBENCH_ASYNC_JOBS (
    JOB_ID STRING NOT NULL,
    IDEMPOTENCY_KEY STRING NOT NULL,
    SNAPSHOT_ID STRING NOT NULL,
    STTM_ID STRING,
    PROJECT_ID STRING,
    JOB_TYPE STRING NOT NULL,
    PAYLOAD VARIANT,
    STATUS STRING NOT NULL DEFAULT 'queued',
    LEASE_OWNER STRING,
    LEASE_EXPIRES_AT TIMESTAMP_NTZ,
    ATTEMPT_COUNT NUMBER NOT NULL DEFAULT 0,
    NEXT_ATTEMPT_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    ERROR_DETAILS VARIANT,
    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    COMPLETED_AT TIMESTAMP_NTZ,
    CONSTRAINT PK_WORKBENCH_ASYNC_JOBS PRIMARY KEY (JOB_ID)
)
COMMENT = 'Durable, idempotent post-save jobs with leases and restart-safe retry state.';
