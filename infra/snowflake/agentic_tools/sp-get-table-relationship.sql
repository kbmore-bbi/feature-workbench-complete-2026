CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_GET_TABLE_RELATIONSHIPS_V2(
    "DB_NAME"     VARCHAR,
    "SCHEMA_NAME" VARCHAR,
    "TABLE_NAME"  VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS '
DECLARE
    result        VARIANT;
    query         VARCHAR;
    rs            RESULTSET;
    table_count   INTEGER;

    -- Outgoing FK accumulators
    out_arr       ARRAY  DEFAULT ARRAY_CONSTRUCT();
    out_obj       OBJECT;

    -- Incoming FK accumulators
    in_arr        ARRAY  DEFAULT ARRAY_CONSTRUCT();
    in_obj        OBJECT;
BEGIN
    -- One local metadata probe replaces three V1 guards, including the
    -- multi-second SNOWFLAKE.ACCOUNT_USAGE.DATABASES scan.
    query := ''
        SELECT COUNT(*)
        FROM '' || DB_NAME || ''.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = UPPER('''''' || SCHEMA_NAME || '''''')
          AND TABLE_NAME   = UPPER('''''' || TABLE_NAME  || '''''')
    '';
    rs := (EXECUTE IMMEDIATE :query);
    LET c1 CURSOR FOR rs;
    FOR r IN c1 DO
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
    -- 1. Outgoing FKs (Imported Keys)
    -- ----------------------------------------------------------------
    query := ''SHOW IMPORTED KEYS IN TABLE '' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME;
    EXECUTE IMMEDIATE :query;

    query := ''
        SELECT
            "pk_schema_name"   AS ref_schema,
            "pk_table_name"    AS ref_table,
            "fk_name"          AS constraint_name,
            ARRAY_AGG(OBJECT_CONSTRUCT(
                ''''fk_column'''', "fk_column_name",
                ''''pk_column'''', "pk_column_name"
            )) WITHIN GROUP (ORDER BY "key_sequence") AS col_mappings
        FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
        GROUP BY "pk_schema_name", "pk_table_name", "fk_name"
    '';
    rs := (EXECUTE IMMEDIATE :query);
    LET c2 CURSOR FOR rs;
    FOR r IN c2 DO
        out_obj := OBJECT_CONSTRUCT(
            ''schema'',          r.ref_schema,
            ''table'',           r.ref_table,
            ''constraint_name'', r.constraint_name,
            ''full_name'',       r.ref_schema || ''.'' || r.ref_table,
            ''column_mappings'', r.col_mappings
        );
        out_arr := ARRAY_APPEND(out_arr, out_obj);
    END FOR;

    -- ----------------------------------------------------------------
    -- 2. Incoming FKs (Exported Keys)
    -- ----------------------------------------------------------------
    query := ''SHOW EXPORTED KEYS IN TABLE '' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME;
    EXECUTE IMMEDIATE :query;

    query := ''
        SELECT
            "fk_schema_name"   AS src_schema,
            "fk_table_name"    AS src_table,
            "fk_name"          AS constraint_name,
            ARRAY_AGG(OBJECT_CONSTRUCT(
                ''''fk_column'''', "fk_column_name",
                ''''pk_column'''', "pk_column_name"
            )) WITHIN GROUP (ORDER BY "key_sequence") AS col_mappings
        FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
        GROUP BY "fk_schema_name", "fk_table_name", "fk_name"
    '';
    rs := (EXECUTE IMMEDIATE :query);
    LET c3 CURSOR FOR rs;
    FOR r IN c3 DO
        in_obj := OBJECT_CONSTRUCT(
            ''schema'',          r.src_schema,
            ''table'',           r.src_table,
            ''constraint_name'', r.constraint_name,
            ''full_name'',       r.src_schema || ''.'' || r.src_table,
            ''column_mappings'', r.col_mappings
        );
        in_arr := ARRAY_APPEND(in_arr, in_obj);
    END FOR;

    -- ----------------------------------------------------------------
    -- Return structured result
    -- ----------------------------------------------------------------
    RETURN OBJECT_CONSTRUCT(
        ''status'',   ''OK'',
        ''code'',     ''SUCCESS'',
        ''message'',  ''Relationships retrieved for '' || DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME,
        ''table'',    OBJECT_CONSTRUCT(
                          ''database'', DB_NAME,
                          ''schema'',   SCHEMA_NAME,
                          ''name'',     TABLE_NAME,
                          ''full_name'', DB_NAME || ''.'' || SCHEMA_NAME || ''.'' || TABLE_NAME
                      ),
        ''summary'',  OBJECT_CONSTRUCT(
                          ''outgoing_count'', ARRAY_SIZE(out_arr),
                          ''incoming_count'', ARRAY_SIZE(in_arr)
                      ),
        ''outgoing'', out_arr,
        ''incoming'', in_arr
    );

EXCEPTION
    WHEN OTHER THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''ERROR'',
            ''code'',    ''RELATIONSHIP_LOOKUP_FAILED'',
            ''message'', SQLERRM
        );
END;
';
