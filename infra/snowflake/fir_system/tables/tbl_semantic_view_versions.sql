-- ============================================================
-- TBL_SEMANTIC_VIEW_VERSIONS - Curated Semantic View Versioning
-- Tracks semantic view evolution: RAW → CURATED_V1 → CURATED_V2 → ...
-- Stores business understanding extracted from user feedback and mappings.
-- ============================================================

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS (
    -- Version identification
    VERSION_ID              STRING          NOT NULL,
    SEMANTIC_VIEW_FQN       STRING          NOT NULL,
    VERSION_NUMBER          INTEGER         NOT NULL CHECK (VERSION_NUMBER >= 0),
    VERSION_LABEL           STRING          NOT NULL
                                CHECK (VERSION_LABEL = 'RAW' OR VERSION_LABEL LIKE 'CURATED_V%'),

    -- Lineage
    PARENT_VERSION_ID       STRING,
    PROMOTION_REASON        STRING,

    -- Semantic content (VARIANT for flexible schema)
    BUSINESS_GLOSSARY       VARIANT,
    RELATIONSHIP_RULES      VARIANT,
    TRANSFORMATION_PATTERNS VARIANT,
    COLUMN_SEMANTICS        VARIANT,
    DERIVED_SOURCE_PATTERNS VARIANT,

    -- Question and answer pairs from feedback/inference cycles
    QA_PAIRS                VARIANT,
    AGENT_NOTES             VARCHAR,

    -- Learning sources (traceability)
    LEARNING_SOURCES        VARIANT,
    MAPPING_EXECUTION_IDS   VARIANT,
    PROCESSING_RULE_IDS     VARIANT,

    -- Confidence and validation
    CONFIDENCE              FLOAT           DEFAULT 0.5 CHECK (CONFIDENCE >= 0 AND CONFIDENCE <= 1),
    VALIDATION_STATUS       STRING          DEFAULT 'pending'
                                CHECK (VALIDATION_STATUS IN ('pending', 'validated', 'rejected')),

    -- Context
    SEMANTIC_BUNDLE_ID      STRING,
    PROJECT_IDS             VARIANT,

    -- Audit fields
    CREATED_BY              STRING,
    CREATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    STATUS                  STRING          DEFAULT 'active'
                                CHECK (STATUS IN ('active', 'superseded', 'archived')),

    CONSTRAINT PK_TBL_SEMANTIC_VIEW_VERSIONS PRIMARY KEY (VERSION_ID),
    CONSTRAINT UQ_SEMANTIC_VERSION UNIQUE (SEMANTIC_VIEW_FQN, VERSION_NUMBER)
)
COMMENT = 'Versioned curated semantic views tracking business understanding evolution: RAW → CURATED_V1 → CURATED_V2 → ...';
