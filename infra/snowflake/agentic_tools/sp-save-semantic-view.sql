CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_SAVE_SEMANTIC_VIEW(
    "SEMANTIC_VIEW_JSON_STR" VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
    SEMANTIC_VIEW_JSON VARIANT;
    scope           VARCHAR;
    db_name         VARCHAR;
    schema_name     VARCHAR;
    table_name      VARCHAR;
    fqn             VARCHAR;
    col_count       INTEGER;
    row_count       INTEGER;
    new_view_id     VARCHAR;
    col_set_hash    VARCHAR;
    last_altered    TIMESTAMP_NTZ;
    version         VARCHAR;
    semantic_level  VARCHAR;
    query           VARCHAR;
    rs              RESULTSET;
BEGIN
    BEGIN
        SEMANTIC_VIEW_JSON := PARSE_JSON(SEMANTIC_VIEW_JSON_STR);
    EXCEPTION WHEN OTHER THEN
        RETURN OBJECT_CONSTRUCT('status', 'ERROR', 'code', 'INVALID_JSON', 'message', 'Failed to parse semantic JSON.');
    END;

    scope := UPPER(COALESCE(SEMANTIC_VIEW_JSON:scope::VARCHAR, ''));
    db_name := UPPER(COALESCE(SEMANTIC_VIEW_JSON:database::VARCHAR, ''));
    schema_name := UPPER(COALESCE(SEMANTIC_VIEW_JSON:schema::VARCHAR, ''));
    table_name := UPPER(COALESCE(SEMANTIC_VIEW_JSON:table::VARCHAR, ''));
    semantic_level := COALESCE(SEMANTIC_VIEW_JSON:semantic_model:semantic_level::VARCHAR, 'L1_CONTEXT');
    fqn := db_name || '.' || schema_name || '.' || table_name;

    IF (scope != 'TABLE') THEN
        RETURN OBJECT_CONSTRUCT('status', 'ERROR', 'code', 'UNSUPPORTED_SCOPE', 'message', 'SP_SAVE_SEMANTIC_VIEW currently supports TABLE scope only.');
    END IF;

    col_count := ARRAY_SIZE(SEMANTIC_VIEW_JSON:attribute_semantic_model);
    IF (col_count > 0) THEN
        row_count := SEMANTIC_VIEW_JSON:attribute_semantic_model[0]:data_quality:row_count::INTEGER;
    ELSE
        row_count := NULL;
    END IF;

    new_view_id := UUID_STRING();

    query := '
        SELECT MD5(LISTAGG(COLUMN_NAME || '':'' || DATA_TYPE || '':'' || IS_NULLABLE, ''|'')
               WITHIN GROUP (ORDER BY COLUMN_NAME)) AS COL_HASH
        FROM ' || db_name || '.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = UPPER(''' || schema_name || ''')
          AND TABLE_NAME = UPPER(''' || table_name || ''')
    ';
    rs := (EXECUTE IMMEDIATE :query);
    FOR r IN rs DO col_set_hash := r.COL_HASH; END FOR;

    query := '
        SELECT LAST_ALTERED
        FROM ' || db_name || '.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = UPPER(''' || schema_name || ''')
          AND TABLE_NAME = UPPER(''' || table_name || ''')
    ';
    rs := (EXECUTE IMMEDIATE :query);
    FOR r IN rs DO last_altered := r.LAST_ALTERED; END FOR;

    query := '
        SELECT COALESCE(MAX(TRY_TO_NUMBER(VERSION)), 0) + 1 AS NEXT_VER
        FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
        WHERE DATABASE_NAME = UPPER(''' || db_name || ''')
          AND SCHEMA_NAME = UPPER(''' || schema_name || ''')
          AND TABLE_NAME = UPPER(''' || table_name || ''')
    ';
    rs := (EXECUTE IMMEDIATE :query);
    FOR r IN rs DO version := r.NEXT_VER::VARCHAR; END FOR;
    IF (version IS NULL) THEN version := '1'; END IF;

    query := '
        UPDATE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
        SET STATUS = ''SUPERSEDED'', UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE DATABASE_NAME = UPPER(''' || db_name || ''')
          AND SCHEMA_NAME = UPPER(''' || schema_name || ''')
          AND TABLE_NAME = UPPER(''' || table_name || ''')
          AND STATUS = ''ACTIVE''
    ';
    EXECUTE IMMEDIATE :query;

    INSERT INTO FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS (
        VIEW_ID, DATABASE_NAME, SCHEMA_NAME, TABLE_NAME, FQN, GENERATED_BY, STATUS, VERSION,
        ROW_COUNT, COLUMN_COUNT, COLUMN_SET_HASH, LAST_ALTERED_TS, SEMANTIC_LEVEL, SEMANTIC_VIEW,
        GENERATED_AT, UPDATED_AT
    )
    SELECT
        :new_view_id, :db_name, :schema_name, :table_name, :fqn, CURRENT_USER(), 'ACTIVE', :version,
        :row_count, :col_count, :col_set_hash, :last_altered, :semantic_level, :SEMANTIC_VIEW_JSON,
        CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP();

    query := '
        UPDATE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_COLUMN_VIEWS
        SET STATUS = ''SUPERSEDED'', UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE DATABASE_NAME = UPPER(''' || db_name || ''')
          AND SCHEMA_NAME = UPPER(''' || schema_name || ''')
          AND TABLE_NAME = UPPER(''' || table_name || ''')
          AND STATUS = ''ACTIVE''
    ';
    EXECUTE IMMEDIATE :query;

    INSERT INTO FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_COLUMN_VIEWS (
        VIEW_ID, DATABASE_NAME, SCHEMA_NAME, TABLE_NAME, COLUMN_NAME, FQN, TABLE_VIEW_ID,
        GENERATED_BY, STATUS, DATA_TYPE, COLUMN_HASH, ATTRIBUTE_VIEW, GENERATED_AT, UPDATED_AT
    )
    SELECT
        UUID_STRING(),
        :db_name,
        :schema_name,
        :table_name,
        UPPER(f.value:name::VARCHAR),
        :fqn || '.' || UPPER(f.value:name::VARCHAR),
        :new_view_id,
        CURRENT_USER(),
        'ACTIVE',
        f.value:data_type::VARCHAR,
        MD5(f.value:data_type::VARCHAR || ':' || IFF(f.value:nullable::BOOLEAN, 'YES', 'NO')),
        f.value,
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
    FROM TABLE(FLATTEN(input => :SEMANTIC_VIEW_JSON, path => 'attribute_semantic_model')) f;

    MERGE INTO FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_MODELS tgt
    USING (
        SELECT
            'TABLE' AS SCOPE,
            :db_name AS DB_NAME,
            :schema_name AS SCHEMA_NAME,
            :table_name AS TABLE_NAME,
            '' AS ATTRIBUTE_NAME,
            :SEMANTIC_VIEW_JSON:semantic_model AS SEMANTIC_MODEL,
            :col_set_hash AS DDL_HASH,
            CURRENT_TIMESTAMP() AS NOW_TS
    ) src
    ON tgt.SCOPE = src.SCOPE
       AND tgt.DB_NAME = src.DB_NAME
       AND tgt.SCHEMA_NAME = src.SCHEMA_NAME
       AND tgt.TABLE_NAME = src.TABLE_NAME
       AND tgt.ATTRIBUTE_NAME = src.ATTRIBUTE_NAME
    WHEN MATCHED THEN UPDATE SET
        tgt.SEMANTIC_MODEL = src.SEMANTIC_MODEL,
        tgt.DDL_HASH = src.DDL_HASH,
        tgt.UPDATED_AT = src.NOW_TS
    WHEN NOT MATCHED THEN INSERT (
        SCOPE, DB_NAME, SCHEMA_NAME, TABLE_NAME, ATTRIBUTE_NAME,
        SEMANTIC_MODEL, DDL_HASH, GENERATED_AT, UPDATED_AT
    ) VALUES (
        src.SCOPE, src.DB_NAME, src.SCHEMA_NAME, src.TABLE_NAME, src.ATTRIBUTE_NAME,
        src.SEMANTIC_MODEL, src.DDL_HASH, src.NOW_TS, src.NOW_TS
    );

    MERGE INTO FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.TBL_SEMANTIC_MODELS tgt
    USING (
        SELECT
            'ATTRIBUTE' AS SCOPE,
            :db_name AS DB_NAME,
            :schema_name AS SCHEMA_NAME,
            :table_name AS TABLE_NAME,
            UPPER(f.value:name::VARCHAR) AS ATTRIBUTE_NAME,
            f.value AS SEMANTIC_MODEL,
            :col_set_hash AS DDL_HASH,
            CURRENT_TIMESTAMP() AS NOW_TS
        FROM TABLE(FLATTEN(input => :SEMANTIC_VIEW_JSON, path => 'attribute_semantic_model')) f
    ) src
    ON tgt.SCOPE = src.SCOPE
       AND tgt.DB_NAME = src.DB_NAME
       AND tgt.SCHEMA_NAME = src.SCHEMA_NAME
       AND tgt.TABLE_NAME = src.TABLE_NAME
       AND tgt.ATTRIBUTE_NAME = src.ATTRIBUTE_NAME
    WHEN MATCHED THEN UPDATE SET
        tgt.SEMANTIC_MODEL = src.SEMANTIC_MODEL,
        tgt.DDL_HASH = src.DDL_HASH,
        tgt.UPDATED_AT = src.NOW_TS
    WHEN NOT MATCHED THEN INSERT (
        SCOPE, DB_NAME, SCHEMA_NAME, TABLE_NAME, ATTRIBUTE_NAME,
        SEMANTIC_MODEL, DDL_HASH, GENERATED_AT, UPDATED_AT
    ) VALUES (
        src.SCOPE, src.DB_NAME, src.SCHEMA_NAME, src.TABLE_NAME, src.ATTRIBUTE_NAME,
        src.SEMANTIC_MODEL, src.DDL_HASH, src.NOW_TS, src.NOW_TS
    );

    RETURN OBJECT_CONSTRUCT(
        'status', 'OK',
        'fqn', fqn,
        'table_view_id', new_view_id,
        'version', version,
        'columns_saved', col_count,
        'column_set_hash', col_set_hash
    );
EXCEPTION
    WHEN OTHER THEN
        RETURN OBJECT_CONSTRUCT('status', 'ERROR', 'code', 'SAVE_FAILED', 'message', SQLERRM);
END;
$$;
