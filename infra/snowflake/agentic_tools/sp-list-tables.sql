CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_LIST_TABLES("DB_NAME" VARCHAR, "SCHEMA_NAME" VARCHAR)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS '
DECLARE
    result        VARIANT;
    query         VARCHAR;
    rs            RESULTSET;
    db_count      INTEGER;
    schema_count  INTEGER;
    table_count   INTEGER;
BEGIN
    -- ----------------------------------------------------------------
    -- Fast path: try direct query first
    -- ----------------------------------------------------------------
    query := ''
        SELECT ARRAY_AGG(
            '''''' || DB_NAME || '''''' || ''''.'''' || TABLE_SCHEMA || ''''.'''' || TABLE_NAME
        ) AS FULL_TABLE_NAMES
        FROM '' || DB_NAME || ''.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = UPPER('''''' || SCHEMA_NAME || '''''')
          AND TABLE_TYPE   = ''''BASE TABLE''''
        ORDER BY TABLE_NAME
    '';

    rs := (EXECUTE IMMEDIATE :query);
    LET c1 CURSOR FOR rs;
    FOR r IN c1 DO
        result := r.FULL_TABLE_NAMES;
    END FOR;

    -- Got results — return immediately, no validation overhead
    IF (result IS NOT NULL) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''OK'',
            ''code'',    ''SUCCESS'',
            ''message'', ''Tables retrieved from '' || DB_NAME || ''.'' || SCHEMA_NAME,
            ''tables'',  result
        );
    END IF;

    -- ----------------------------------------------------------------
    -- Slow path: result was NULL — need to know WHY
    -- ----------------------------------------------------------------

    -- Check 1: Does the DB exist?
    query := ''
        SELECT COUNT(*)
        FROM SNOWFLAKE.ACCOUNT_USAGE.DATABASES
        WHERE DATABASE_NAME = UPPER('''''' || DB_NAME || '''''')
          AND DELETED IS NULL
    '';
    rs := (EXECUTE IMMEDIATE :query);
    LET c2 CURSOR FOR rs;
    FOR r IN c2 DO
        db_count := r."COUNT(*)";
    END FOR;

    IF (db_count = 0) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''ERROR'',
            ''code'',    ''DB_NOT_FOUND'',
            ''message'', ''Database "'' || DB_NAME || ''" does not exist or is not visible to this role.''
        );
    END IF;

    -- Check 2: Does the schema exist?
    query := ''
        SELECT COUNT(*)
        FROM '' || DB_NAME || ''.INFORMATION_SCHEMA.SCHEMATA
        WHERE SCHEMA_NAME = UPPER('''''' || SCHEMA_NAME || '''''')
    '';
    rs := (EXECUTE IMMEDIATE :query);
    LET c3 CURSOR FOR rs;
    FOR r IN c3 DO
        schema_count := r."COUNT(*)";
    END FOR;

    IF (schema_count = 0) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''ERROR'',
            ''code'',    ''SCHEMA_NOT_FOUND'',
            ''message'', ''Schema "'' || SCHEMA_NAME || ''" does not exist in "'' || DB_NAME || ''". Check name or verify access.''
        );
    END IF;

    -- Check 3: Schema exists but genuinely has no tables
    query := ''
        SELECT COUNT(*)
        FROM '' || DB_NAME || ''.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = UPPER('''''' || SCHEMA_NAME || '''''')
          AND TABLE_TYPE   = ''''BASE TABLE''''
    '';
    rs := (EXECUTE IMMEDIATE :query);
    LET c4 CURSOR FOR rs;
    FOR r IN c4 DO
        table_count := r."COUNT(*)";
    END FOR;

    IF (table_count = 0) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''OK'',
            ''code'',    ''EMPTY_SCHEMA'',
            ''message'', ''Schema "'' || DB_NAME || ''.'' || SCHEMA_NAME || ''" exists but contains no tables.'',
            ''tables'',  ARRAY_CONSTRUCT()
        );
    END IF;

    -- Should not reach here — but guard anyway
    RETURN OBJECT_CONSTRUCT(
        ''status'',  ''ERROR'',
        ''code'',    ''UNKNOWN'',
        ''message'', ''Could not retrieve tables. Schema and DB exist but result was empty for an unknown reason.''
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