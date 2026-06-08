CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_CHECK_TABLE_STALENESS(
    "DB_NAME" VARCHAR,
    "SCHEMA_NAME" VARCHAR,
    "TABLE_NAME" VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
    fqn              VARCHAR;
    stored_view_id   VARCHAR;
    stored_gen_at    TIMESTAMP_NTZ;
    stored_col_hash  VARCHAR;
    stored_altered   TIMESTAMP_NTZ;
    src_altered      TIMESTAMP_NTZ;
    live_col_hash    VARCHAR;
    query            VARCHAR;
    rs               RESULTSET;
BEGIN
    fqn := UPPER(DB_NAME) || '.' || UPPER(SCHEMA_NAME) || '.' || UPPER(TABLE_NAME);

    query := '
        SELECT VIEW_ID, GENERATED_AT, COLUMN_SET_HASH, LAST_ALTERED_TS
        FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
        WHERE DATABASE_NAME = UPPER(''' || DB_NAME || ''')
          AND SCHEMA_NAME = UPPER(''' || SCHEMA_NAME || ''')
          AND TABLE_NAME = UPPER(''' || TABLE_NAME || ''')
          AND STATUS = ''ACTIVE''
        ORDER BY GENERATED_AT DESC
        LIMIT 1
    ';
    rs := (EXECUTE IMMEDIATE :query);
    FOR r IN rs DO
        stored_view_id := r.VIEW_ID;
        stored_gen_at := r.GENERATED_AT;
        stored_col_hash := r.COLUMN_SET_HASH;
        stored_altered := r.LAST_ALTERED_TS;
    END FOR;

    IF (stored_view_id IS NULL) THEN
        RETURN OBJECT_CONSTRUCT(
            'status', 'MISSING',
            'code', 'NO_SEMANTIC_VIEW',
            'message', 'No active semantic view found for ' || fqn,
            'fqn', fqn
        );
    END IF;

    query := '
        SELECT MD5(
            LISTAGG(COLUMN_NAME || '':'' || DATA_TYPE || '':'' || IS_NULLABLE, ''|'')
            WITHIN GROUP (ORDER BY COLUMN_NAME)
        ) AS COL_HASH
        FROM ' || DB_NAME || '.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = UPPER(''' || SCHEMA_NAME || ''')
          AND TABLE_NAME = UPPER(''' || TABLE_NAME || ''')
    ';
    rs := (EXECUTE IMMEDIATE :query);
    FOR r IN rs DO live_col_hash := r.COL_HASH; END FOR;

    IF (live_col_hash != stored_col_hash OR stored_col_hash IS NULL) THEN
        RETURN OBJECT_CONSTRUCT(
            'status', 'STALE',
            'code', 'COLUMNS_CHANGED',
            'message', 'Column structure changed for ' || fqn,
            'view_id', stored_view_id,
            'generated_at', stored_gen_at
        );
    END IF;

    query := '
        SELECT LAST_ALTERED
        FROM ' || DB_NAME || '.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = UPPER(''' || SCHEMA_NAME || ''')
          AND TABLE_NAME = UPPER(''' || TABLE_NAME || ''')
    ';
    rs := (EXECUTE IMMEDIATE :query);
    FOR r IN rs DO src_altered := r.LAST_ALTERED; END FOR;

    IF (src_altered > stored_altered OR stored_altered IS NULL) THEN
        RETURN OBJECT_CONSTRUCT(
            'status', 'STALE',
            'code', 'DDL_ALTERED',
            'message', 'Table changed after semantic generation for ' || fqn,
            'view_id', stored_view_id,
            'table_last_altered', src_altered,
            'view_generated_at', stored_gen_at
        );
    END IF;

    RETURN OBJECT_CONSTRUCT(
        'status', 'FRESH',
        'code', 'USE_CACHED',
        'message', 'Cached semantic view is still current for ' || fqn,
        'view_id', stored_view_id,
        'generated_at', stored_gen_at
    );
END;
$$;
