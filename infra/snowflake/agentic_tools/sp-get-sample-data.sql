CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_GET_SAMPLE_DATA("DB_NAME" VARCHAR, "SCHEMA_NAME" VARCHAR, "TABLE_NAME" VARCHAR, "SAMPLE_SIZE" NUMBER(38,0))
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS '
DECLARE
    query        VARCHAR;
    rs           RESULTSET;
    result       VARIANT;
    row_count    INTEGER DEFAULT 0;
    n            INTEGER;
    fetch_failed BOOLEAN DEFAULT FALSE;

    -- Moved these to the DECLARE block (inline LET is not allowed in execution blocks)
    db_cnt       INTEGER DEFAULT 0;
    sc_cnt       INTEGER DEFAULT 0;
    tb_cnt       INTEGER DEFAULT 0;
BEGIN
    n := COALESCE(SAMPLE_SIZE, 10);

    -- ── STEP 1: Attempt sample fetch directly ────────────────────
    BEGIN
        -- Changed alias from ROWS to SAMPLE_ROWS
        query := ''
            SELECT ARRAY_AGG(row_data) AS SAMPLE_ROWS
            FROM (
                SELECT OBJECT_CONSTRUCT(*) AS row_data
                FROM '' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME || ''
                LIMIT '' || n || ''
            )
        '';
        rs := (EXECUTE IMMEDIATE :query);

        -- Loop directly over the RESULTSET (No LET CURSOR needed)
        FOR rec IN rs DO
            result := rec.SAMPLE_ROWS;
        END FOR;

    EXCEPTION
        WHEN OTHER THEN
            fetch_failed := TRUE;
    END;

    -- ── Validate on failure to return precise error ───────────────
    IF (fetch_failed = TRUE) THEN

        query := ''SELECT COUNT(*) AS CNT FROM SNOWFLAKE.ACCOUNT_USAGE.DATABASES
                  WHERE DATABASE_NAME = UPPER('''''' || DB_NAME || '''''') AND DELETED IS NULL'';
        rs := (EXECUTE IMMEDIATE :query);
        FOR rec IN rs DO db_cnt := rec.CNT; END FOR;

        IF (db_cnt = 0) THEN
            RETURN OBJECT_CONSTRUCT(''status'', ''ERROR'', ''code'', ''DB_NOT_FOUND'',
                ''message'', ''Database "'' || DB_NAME || ''" does not exist.'');
        END IF;

        query := ''SELECT COUNT(*) AS CNT FROM '' || DB_NAME || ''.INFORMATION_SCHEMA.SCHEMATA
                  WHERE SCHEMA_NAME = UPPER('''''' || SCHEMA_NAME || '''''')'';
        rs := (EXECUTE IMMEDIATE :query);
        FOR rec IN rs DO sc_cnt := rec.CNT; END FOR;

        IF (sc_cnt = 0) THEN
            RETURN OBJECT_CONSTRUCT(''status'', ''ERROR'', ''code'', ''SCHEMA_NOT_FOUND'',
                ''message'', ''Schema "'' || SCHEMA_NAME || ''" does not exist in "'' || DB_NAME || ''".'');
        END IF;

        query := ''SELECT COUNT(*) AS CNT FROM '' || DB_NAME || ''.INFORMATION_SCHEMA.TABLES
                  WHERE TABLE_SCHEMA = UPPER('''''' || SCHEMA_NAME || '''''')
                    AND TABLE_NAME   = UPPER('''''' || TABLE_NAME  || '''''')'';
        rs := (EXECUTE IMMEDIATE :query);
        FOR rec IN rs DO tb_cnt := rec.CNT; END FOR;

        IF (tb_cnt = 0) THEN
            RETURN OBJECT_CONSTRUCT(''status'', ''ERROR'', ''code'', ''TABLE_NOT_FOUND'',
                ''message'', ''Table "'' || TABLE_NAME || ''" does not exist in "''
                            || DB_NAME || ''.'' || SCHEMA_NAME || ''".'');
        END IF;

        RETURN OBJECT_CONSTRUCT(''status'', ''ERROR'', ''code'', ''UNEXPECTED_ERROR'',
            ''message'', ''Could not fetch sample from "''
                        || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME || ''".'');
    END IF;

    -- ── STEP 2: Handle empty table ────────────────────────────────
    -- ARRAY_AGG on zero rows returns NULL, not an empty array
    IF (result IS NULL) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''OK'',
            ''code'',    ''EMPTY_TABLE'',
            ''message'', ''Table "'' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME || ''" has no rows.'',
            ''rows'',    ARRAY_CONSTRUCT()
        );
    END IF;

    -- ── STEP 3: Return ────────────────────────────────────────────
    RETURN OBJECT_CONSTRUCT(
        ''status'',      ''OK'',
        ''code'',        ''SUCCESS'',
        ''table'',       DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME,
        ''sample_size'', ARRAY_SIZE(result::ARRAY),
        ''rows'',        result
    );

EXCEPTION
    WHEN OTHER THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''ERROR'',
            ''code'',    ''UNEXPECTED_ERROR'',
            ''message'', SQLERRM
        );
END;
';