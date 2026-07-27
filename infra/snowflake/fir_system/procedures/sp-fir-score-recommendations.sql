-- ============================================================
-- SP_FIR_SCORE_RECOMMENDATIONS
-- Calculates and updates recommendation scores using:
--   base_confidence * usage_factor * recency_factor * feedback_factor
-- Runs as part of the confidence decay task or on-demand.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_SCORE_RECOMMENDATIONS()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS CALLER
AS
$$
DECLARE
    updated_count INTEGER DEFAULT 0;
    outcome_count INTEGER DEFAULT 0;
BEGIN
    -- Outcome rows are authoritative. Retrieval and display never change counters.
    UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS r
    SET USAGE_COUNT = outcomes.USAGE_COUNT,
        SUCCESS_COUNT = outcomes.SUCCESS_COUNT,
        UPDATED_AT = CURRENT_TIMESTAMP()
    FROM (
        SELECT AGENT_RECOMMENDATION_ID,
               COUNT_IF(OUTCOME_TYPE IN ('used', 'accepted', 'corrected', 'rejected', 'validated', 'published')) AS USAGE_COUNT,
               COUNT_IF(OUTCOME_TYPE IN ('accepted', 'validated', 'published')) AS SUCCESS_COUNT
        FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_RECOMMENDATION_OUTCOMES
        GROUP BY AGENT_RECOMMENDATION_ID
    ) outcomes
    WHERE r.AGENT_RECOMMENDATION_ID = outcomes.AGENT_RECOMMENDATION_ID;

    outcome_count := SQLROWCOUNT;

    UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS r
    SET STATUS = 'inactive',
        UPDATED_AT = CURRENT_TIMESTAMP()
    FROM (
        SELECT AGENT_RECOMMENDATION_ID, OUTCOME_TYPE
        FROM __STTM_METADATA_NAMESPACE__.TBL_FIR_RECOMMENDATION_OUTCOMES
        WHERE OUTCOME_TYPE IN ('accepted', 'corrected', 'rejected', 'published')
        QUALIFY ROW_NUMBER() OVER (
            PARTITION BY AGENT_RECOMMENDATION_ID ORDER BY CREATED_AT DESC, OUTCOME_ID DESC
        ) = 1
    ) latest
    WHERE r.AGENT_RECOMMENDATION_ID = latest.AGENT_RECOMMENDATION_ID
      AND latest.OUTCOME_TYPE = 'rejected'
      AND r.STATUS = 'active';

    -- Update RECOMMENDATION_PRIORITY based on scoring formula:
    -- base_confidence * (1 + ln(1 + success_count) / ln(1 + greatest(usage_count, 1)))
    --   * pow(0.95, datediff('day', created_at, current_timestamp()) / 30)
    --   * feedback_factor (boost from user confirmations)
    UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS
    SET RECOMMENDATION_PRIORITY = LEAST(100, GREATEST(1, ROUND(
        (COALESCE(CONFIDENCE, 0.5) * 100)
        * (1.0 + LN(1 + COALESCE(SUCCESS_COUNT, 0)) / LN(1 + GREATEST(COALESCE(USAGE_COUNT, 0), 1)))
        * POWER(0.95, DATEDIFF('day', CREATED_AT, CURRENT_TIMESTAMP()) / 30.0)
    ))),
    UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE STATUS = 'active'
      AND CREATED_AT < CURRENT_TIMESTAMP();

    updated_count := SQLROWCOUNT;

    -- Also integrate ML model scores if available
    UPDATE __STTM_METADATA_NAMESPACE__.TBL_FIR_AGENT_RECOMMENDATIONS r
    SET RECOMMENDATION_PRIORITY = LEAST(100, GREATEST(1, ROUND(
        r.RECOMMENDATION_PRIORITY * (0.5 + 0.5 * COALESCE(m.RECOMMENDATION_HELPFULNESS_PROBABILITY, 0.5))
    )))
    FROM __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_FIR_MODEL_SCORES m
    WHERE r.AGENT_RECOMMENDATION_ID = m.ENTITY_ID
      AND m.ENTITY_TYPE = 'recommendation'
      AND m.UPDATED_AT > DATEADD('day', -7, CURRENT_TIMESTAMP())
      AND r.STATUS = 'active';

    RETURN OBJECT_CONSTRUCT(
        'status', 'success',
        'recommendations_with_outcomes', :outcome_count,
        'recommendations_scored', :updated_count,
        'scored_at', CURRENT_TIMESTAMP()::STRING
    );
END;
$$;
