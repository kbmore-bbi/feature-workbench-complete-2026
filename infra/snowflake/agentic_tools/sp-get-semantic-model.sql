CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_GET_SEMANTIC_MODEL(
    "SCOPE"           VARCHAR,
    "DB_NAME"         VARCHAR,
    "SCHEMA_NAME"     VARCHAR,
    "TABLE_NAME"      VARCHAR DEFAULT '',
    "ATTRIBUTE_NAME"  VARCHAR DEFAULT ''
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS '
DECLARE
    query        VARCHAR;
    rs           RESULTSET;
    tbl_name     VARCHAR;
    attr_name    VARCHAR;
    stored_model VARIANT;
    row_count    INTEGER := 0;
BEGIN
    tbl_name  := UPPER(COALESCE(TABLE_NAME,     ''''));
    attr_name := UPPER(COALESCE(ATTRIBUTE_NAME, ''''));

    IF (SCOPE NOT IN (''SCHEMA'', ''TABLE'', ''ATTRIBUTE'')) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''ERROR'',
            ''code'',    ''INVALID_SCOPE'',
            ''message'', ''scope must be SCHEMA, TABLE, or ATTRIBUTE''
        );
    END IF;

    IF (SCOPE IN (''TABLE'', ''ATTRIBUTE'') AND LENGTH(TRIM(tbl_name)) = 0) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''ERROR'',
            ''code'',    ''TABLE_NAME_REQUIRED'',
            ''message'', ''table_name is required for TABLE and ATTRIBUTE scope''
        );
    END IF;

    IF (SCOPE = ''ATTRIBUTE'' AND LENGTH(TRIM(attr_name)) = 0) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''ERROR'',
            ''code'',    ''ATTRIBUTE_NAME_REQUIRED'',
            ''message'', ''attribute_name is required for ATTRIBUTE scope''
        );
    END IF;

    query := ''
        SELECT SEMANTIC_MODEL
        FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_MODELS
        WHERE SCOPE          = UPPER('''''' || SCOPE || '''''')
          AND DB_NAME        = UPPER('''''' || DB_NAME || '''''')
          AND SCHEMA_NAME    = UPPER('''''' || SCHEMA_NAME || '''''')
          AND TABLE_NAME     = UPPER('''''' || tbl_name || '''''')
          AND ATTRIBUTE_NAME = UPPER('''''' || attr_name || '''''')
    '';
    rs := (EXECUTE IMMEDIATE :query);
    LET c1 CURSOR FOR rs;
    FOR r IN c1 DO
        stored_model := r.SEMANTIC_MODEL;
        row_count    := row_count + 1;
    END FOR;

    IF (row_count = 0) THEN
        RETURN OBJECT_CONSTRUCT(
            ''status'',  ''OK'',
            ''code'',    ''NOT_FOUND'',
            ''message'', ''No semantic model found for '' || UPPER(DB_NAME) || ''.'' || UPPER(SCHEMA_NAME) || IFF(LENGTH(tbl_name) > 0, ''.'' || tbl_name, '''') || IFF(LENGTH(attr_name) > 0, ''.'' || attr_name, '''')
        );
    END IF;

    RETURN OBJECT_CONSTRUCT(
        ''status'',         ''OK'',
        ''code'',           ''FOUND'',
        ''scope'',          UPPER(SCOPE),
        ''database'',       UPPER(DB_NAME),
        ''schema'',         UPPER(SCHEMA_NAME),
        ''table'',          IFF(LENGTH(tbl_name)  > 0, tbl_name,  NULL),
        ''attribute'',      IFF(LENGTH(attr_name) > 0, attr_name, NULL),
        ''semantic_model'', stored_model
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
