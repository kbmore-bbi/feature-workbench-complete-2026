CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_ATTRIBUTE_PROFILE(
    "DB_NAME"     VARCHAR,
    "SCHEMA_NAME" VARCHAR,
    "TABLE_NAME"  VARCHAR,
    "COLUMN_NAME" VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS '
DECLARE
    query        VARCHAR;
    rs           RESULTSET;
    col_type     VARCHAR;
    dist_count   INTEGER DEFAULT 0;
    null_count   INTEGER DEFAULT 0;
    row_count    INTEGER DEFAULT 0;
    unique_vals  VARIANT;
    sample_vals  VARIANT;
    range_stats  VARIANT DEFAULT OBJECT_CONSTRUCT();
    use_unique   BOOLEAN DEFAULT FALSE;
BEGIN

    -- ── STEP 1: Column Data Type ──────────────────────────────────
    query := ''
        SELECT DATA_TYPE
        FROM '' || DB_NAME || ''.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = UPPER('''''' || SCHEMA_NAME || '''''')
          AND TABLE_NAME   = UPPER('''''' || TABLE_NAME  || '''''')
          AND COLUMN_NAME  = UPPER('''''' || COLUMN_NAME || '''''')
    '';
    rs := (EXECUTE IMMEDIATE :query);
    FOR r IN rs DO col_type := r.DATA_TYPE; END FOR;

    -- ── STEP 2: Core Stats ────────────────────────────────────────
    query := ''
        SELECT
            COUNT(*)                                    AS RC,
            COUNT(DISTINCT "'' || COLUMN_NAME || ''")   AS DC,
            COUNT(*) - COUNT("'' || COLUMN_NAME || ''") AS NC
        FROM '' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME;
    rs := (EXECUTE IMMEDIATE :query);
    FOR r IN rs DO
        row_count  := r.RC;
        dist_count := r.DC;
        null_count := r.NC;
    END FOR;

    -- ── STEP 3: Unique or Sample Values (skip VARIANT) ────────────
    IF (col_type != ''VARIANT'') THEN
        IF (dist_count <= 15) THEN
            use_unique := TRUE;
            query := ''
                SELECT ARRAY_AGG("'' || COLUMN_NAME || ''") WITHIN GROUP (ORDER BY "'' || COLUMN_NAME || ''") AS VALS
                FROM (
                    SELECT DISTINCT "'' || COLUMN_NAME || ''"
                    FROM '' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME || ''
                    WHERE "'' || COLUMN_NAME || ''" IS NOT NULL
                )
            '';
            rs := (EXECUTE IMMEDIATE :query);
            FOR r IN rs DO unique_vals := COALESCE(r.VALS, ARRAY_CONSTRUCT()); END FOR;
        ELSE
            use_unique := FALSE;
            query := ''
                SELECT ARRAY_AGG(VAL) AS VALS
                FROM (
                    SELECT DISTINCT "'' || COLUMN_NAME || ''" AS VAL
                    FROM '' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME || ''
                    WHERE "'' || COLUMN_NAME || ''" IS NOT NULL
                    LIMIT 10
                )
            '';
            rs := (EXECUTE IMMEDIATE :query);
            FOR r IN rs DO sample_vals := COALESCE(r.VALS, ARRAY_CONSTRUCT()); END FOR;
        END IF;
    ELSE
        -- VARIANT: no value profiling possible
        use_unique := TRUE;
        unique_vals := ARRAY_CONSTRUCT();
    END IF;

    -- ── STEP 4: Range / Distribution Stats (skip VARIANT) ────────
    IF (col_type IN (''NUMBER'', ''FLOAT'', ''INTEGER'')) THEN
        query := ''
            SELECT OBJECT_CONSTRUCT(
                ''''min'''',    MIN("'' || COLUMN_NAME || ''"),
                ''''max'''',    MAX("'' || COLUMN_NAME || ''"),
                ''''mean'''',   ROUND(AVG("'' || COLUMN_NAME || ''"), 4),
                ''''stddev'''', ROUND(STDDEV("'' || COLUMN_NAME || ''"), 4),
                ''''p25'''',    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "'' || COLUMN_NAME || ''"),
                ''''p50'''',    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "'' || COLUMN_NAME || ''"),
                ''''p75'''',    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "'' || COLUMN_NAME || ''")
            ) AS RS
            FROM '' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME;
        rs := (EXECUTE IMMEDIATE :query);
        FOR r IN rs DO range_stats := r.RS; END FOR;
    ELSEIF (col_type IN (''DATE'', ''TIMESTAMP_NTZ'', ''TIMESTAMP_LTZ'', ''TIMESTAMP_TZ'')) THEN
        query := ''
            SELECT OBJECT_CONSTRUCT(
                ''''min'''',       MIN("'' || COLUMN_NAME || ''"),
                ''''max'''',       MAX("'' || COLUMN_NAME || ''"),
                ''''span_days'''', DATEDIFF(''''day'''', MIN("'' || COLUMN_NAME || ''"), MAX("'' || COLUMN_NAME || ''"))
            ) AS RS
            FROM '' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME;
        rs := (EXECUTE IMMEDIATE :query);
        FOR r IN rs DO range_stats := r.RS; END FOR;
    ELSEIF (col_type != ''VARIANT'') THEN
        query := ''
            SELECT OBJECT_CONSTRUCT(
                ''''min_len'''', MIN(LENGTH("'' || COLUMN_NAME || ''")),
                ''''max_len'''', MAX(LENGTH("'' || COLUMN_NAME || ''"))
            ) AS RS
            FROM '' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME;
        rs := (EXECUTE IMMEDIATE :query);
        FOR r IN rs DO range_stats := r.RS; END FOR;
    END IF;

    -- ── STEP 5: Return — exactly one of unique_values/sample_values ──
    IF (use_unique) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',         ''OK'',
            ''column'',         COLUMN_NAME,
            ''data_type'',      col_type,
            ''row_count'',      row_count,
            ''null_count'',     null_count,
            ''null_pct'',       ROUND(null_count * 100.0 / NULLIF(row_count, 0), 2),
            ''distinct_count'', dist_count,
            ''unique_values'',  unique_vals,
            ''range_stats'',    range_stats
        );
    ELSE
        RETURN OBJECT_CONSTRUCT(
            ''status'',         ''OK'',
            ''column'',         COLUMN_NAME,
            ''data_type'',      col_type,
            ''row_count'',      row_count,
            ''null_count'',     null_count,
            ''null_pct'',       ROUND(null_count * 100.0 / NULLIF(row_count, 0), 2),
            ''distinct_count'', dist_count,
            ''sample_values'',  sample_vals,
            ''range_stats'',    range_stats
        );
    END IF;

EXCEPTION
    WHEN OTHER THEN
        RETURN OBJECT_CONSTRUCT(''status'', ''ERROR'', ''message'', SQLERRM);
END;
';