-- ============================================================
-- SP_FIR_APPLY_CONFIDENCE_DECAY
-- Applies temporal decay to confidence scores in FIR tables.
-- Decay formula: CURRENT = INITIAL * POWER(DECAY_FACTOR, days/30)
-- Default DECAY_FACTOR = 0.95 (5% decay per 30 days)
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_APPLY_CONFIDENCE_DECAY()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
    fir_360_updated INTEGER DEFAULT 0;
    recommendations_updated INTEGER DEFAULT 0;
    result VARIANT;
BEGIN
    -- Update confidence in TBL_AGENT_FIR_360
    UPDATE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
    SET
        CURRENT_CONFIDENCE = INITIAL_CONFIDENCE * POWER(DECAY_FACTOR, DATEDIFF('day', CREATED_AT, CURRENT_TIMESTAMP()) / 30.0),
        LAST_DECAY_AT = CURRENT_TIMESTAMP(),
        UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE PROCESSING_STAGE = 'completed'
      AND INITIAL_CONFIDENCE IS NOT NULL
      AND (
          LAST_DECAY_AT IS NULL
          OR DATEDIFF('day', LAST_DECAY_AT, CURRENT_TIMESTAMP()) >= 1
      );

    fir_360_updated := SQLROWCOUNT;

    -- Update confidence in TBL_FIR_AGENT_RECOMMENDATIONS
    -- Also factor in usage success rate for boosting
    UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
    SET
        CONFIDENCE = LEAST(1.0,
            -- Base temporal decay
            (CONFIDENCE * POWER(0.95, DATEDIFF('day', CREATED_AT, CURRENT_TIMESTAMP()) / 30.0))
            -- Usage-based boost: +0.05 per successful use (max 0.2 boost)
            + CASE
                WHEN USAGE_COUNT > 0 THEN LEAST(0.2, 0.05 * (SUCCESS_COUNT / USAGE_COUNT) * USAGE_COUNT)
                ELSE 0
              END
        ),
        UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE STATUS = 'active'
      AND DATEDIFF('day', UPDATED_AT, CURRENT_TIMESTAMP()) >= 1;

    recommendations_updated := SQLROWCOUNT;

    -- Archive very old, low-confidence recommendations
    UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
    SET STATUS = 'archived',
        UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE STATUS = 'active'
      AND CONFIDENCE < 0.1
      AND DATEDIFF('day', CREATED_AT, CURRENT_TIMESTAMP()) > 180;

    -- Build result
    result := OBJECT_CONSTRUCT(
        'status', 'success',
        'fir_360_records_updated', fir_360_updated,
        'recommendations_updated', recommendations_updated,
        'processed_at', CURRENT_TIMESTAMP()::STRING
    );

    RETURN result;
END;
$$;
