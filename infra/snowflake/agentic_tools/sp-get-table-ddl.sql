CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_GET_TABLE_DDL("DB_NAME" VARCHAR, "SCHEMA_NAME" VARCHAR, "TABLE_NAME" VARCHAR)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS '
DECLARE
    result       VARIANT;
    query        VARCHAR;
    rs           RESULTSET;
    db_count     INTEGER;
    schema_count INTEGER;
    table_count  INTEGER;
    ddl_text     VARCHAR;
BEGIN
    -- ----------------------------------------------------------------
    -- Validate first — GET_DDL throws hard on bad inputs
    -- so we must check before calling it
    -- ----------------------------------------------------------------

    -- Check 1: DB exists?
    query := ''
        SELECT COUNT(*)
        FROM SNOWFLAKE.ACCOUNT_USAGE.DATABASES
        WHERE DATABASE_NAME = UPPER('''''' || DB_NAME || '''''')
          AND DELETED IS NULL
    '';
    rs := (EXECUTE IMMEDIATE :query);
    LET c1 CURSOR FOR rs;
    FOR r IN c1 DO
        db_count := r."COUNT(*)";
    END FOR;

    IF (db_count = 0) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''ERROR'',
            ''code'',    ''DB_NOT_FOUND'',
            ''message'', ''Database "'' || DB_NAME || ''" does not exist or is not visible to this role.''
        );
    END IF;

    -- Check 2: Schema exists?
    query := ''
        SELECT COUNT(*)
        FROM '' || DB_NAME || ''.INFORMATION_SCHEMA.SCHEMATA
        WHERE SCHEMA_NAME = UPPER('''''' || SCHEMA_NAME || '''''')
    '';
    rs := (EXECUTE IMMEDIATE :query);
    LET c2 CURSOR FOR rs;
    FOR r IN c2 DO
        schema_count := r."COUNT(*)";
    END FOR;

    IF (schema_count = 0) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''ERROR'',
            ''code'',    ''SCHEMA_NOT_FOUND'',
            ''message'', ''Schema "'' || SCHEMA_NAME || ''" does not exist in "'' || DB_NAME || ''". Check name or verify access.''
        );
    END IF;

    -- Check 3: Table exists?
    query := ''
        SELECT COUNT(*)
        FROM '' || DB_NAME || ''.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = UPPER('''''' || SCHEMA_NAME || '''''')
          AND TABLE_NAME   = UPPER('''''' || TABLE_NAME  || '''''')
    '';
    rs := (EXECUTE IMMEDIATE :query);
    LET c3 CURSOR FOR rs;
    FOR r IN c3 DO
        table_count := r."COUNT(*)";
    END FOR;

    IF (table_count = 0) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''ERROR'',
            ''code'',    ''TABLE_NOT_FOUND'',
            ''message'', ''Table "'' || TABLE_NAME || ''" does not exist in "'' || DB_NAME || ''.'' || SCHEMA_NAME || ''".''
        );
    END IF;

    -- ----------------------------------------------------------------
    -- All checks passed — safe to call GET_DDL
    -- ----------------------------------------------------------------
    query := ''
        SELECT GET_DDL(''''TABLE'''', '''''' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME || '''''') AS DDL
    '';

    rs := (EXECUTE IMMEDIATE :query);
    LET c4 CURSOR FOR rs;
    FOR r IN c4 DO
        ddl_text := r.DDL;
    END FOR;

    IF (ddl_text IS NOT NULL AND LENGTH(TRIM(ddl_text)) > 0) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''OK'',
            ''code'',    ''SUCCESS'',
            ''message'', ''DDL retrieved for '' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME,
            ''ddl'',     ddl_text
        );
    END IF;

    -- Passed all checks but DDL still empty — privilege gap
    RETURN OBJECT_CONSTRUCT(
        ''status'',  ''ERROR'',
        ''code'',    ''DDL_ACCESS_DENIED'',
        ''message'', ''Table "'' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME || ''" exists but DDL could not be retrieved. The owner role may lack OWNERSHIP or MONITOR privilege.''
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