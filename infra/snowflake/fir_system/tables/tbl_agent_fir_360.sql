-- ============================================================
-- TBL_AGENT_FIR_360 - Core FIR Lineage Table
-- End-to-end lineage linking feedback → inference → recommendation
-- with full metadata and confidence decay.
-- ============================================================

CREATE TABLE IF NOT EXISTS __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 (
    -- Primary identification
    FIR_RECORD_ID           STRING          NOT NULL,
    FIR_RECORD_KEY          STRING          NOT NULL,

    -- Lineage references (FKs to existing FIR tables)
    FEEDBACK_ID             STRING,
    INFERENCE_ID            STRING,
    RECOMMENDATION_ID       STRING,

    -- Source classification
    SOURCE_TYPE             STRING          NOT NULL
                                CHECK (SOURCE_TYPE IN (
                                    'mapping_feedback', 'conversation',
                                    'explicit', 'implicit', 'collaborative',
                                    'document_upload'
                                )),
    SOURCE_EVENT_TYPE       STRING          NOT NULL,

    -- Entity context
    USER_ID                 STRING,
    SESSION_ID              STRING,
    PROJECT_ID              STRING,
    STTM_ID                 STRING,
    SEMANTIC_BUNDLE_ID      STRING,
    ENTITY_TYPE             STRING,
    ENTITY_IDS              VARIANT,

    -- Processing state machine
    PROCESSING_STAGE        STRING          NOT NULL DEFAULT 'pending'
                                CHECK (PROCESSING_STAGE IN (
                                    'pending', 'feedback_collected',
                                    'inference_generated', 'recommendation_created',
                                    'completed', 'failed'
                                )),
    PROCESSING_VERSION      STRING          DEFAULT '1.0',

    -- Payload snapshots (denormalized for query performance)
    FEEDBACK_PAYLOAD        VARIANT,
    INFERENCE_PAYLOAD       VARIANT,
    RECOMMENDATION_PAYLOAD  VARIANT,

    -- Confidence with temporal decay
    INITIAL_CONFIDENCE      FLOAT           CHECK (INITIAL_CONFIDENCE IS NULL OR (INITIAL_CONFIDENCE >= 0 AND INITIAL_CONFIDENCE <= 1)),
    CURRENT_CONFIDENCE      FLOAT           CHECK (CURRENT_CONFIDENCE IS NULL OR (CURRENT_CONFIDENCE >= 0 AND CURRENT_CONFIDENCE <= 1)),
    DECAY_FACTOR            FLOAT           DEFAULT 0.95 CHECK (DECAY_FACTOR > 0 AND DECAY_FACTOR <= 1),
    LAST_DECAY_AT           TIMESTAMP_NTZ,

    -- Agent targeting
    TARGET_AGENTS           VARIANT,

    -- Agent reasoning (populated by AGT_FIR_SYSTEM LLM, not procedures)
    AGENT_NOTES             VARCHAR,
    AGENT_REASONING_PAYLOAD VARIANT,

    -- Audit fields
    CREATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    UPDATED_AT              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    PROCESSED_BY            STRING,
    PROCESSING_ERROR        STRING,

    CONSTRAINT PK_TBL_AGENT_FIR_360 PRIMARY KEY (FIR_RECORD_ID)
)
COMMENT = 'End-to-end FIR lineage linking feedback → inference → recommendation with full metadata and confidence decay.';
