CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_CHECK_COLUMN_STALENESS(
    "DB_NAME" VARCHAR,
    "SCHEMA_NAME" VARCHAR,
    "TABLE_NAME" VARCHAR,
    "COLUMN_NAME" VARCHAR
)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
    table_view_id     VARCHAR;
    stored_column_hash VARCHAR;
    live_column_hash   VARCHAR;
    query              VARCHAR;
    rs                 RESULTSET;
    fqn                VARCHAR;
BEGIN
    fqn := UPPER(DB_NAME) || '.' || UPPER(SCHEMA_NAME) || '.' || UPPER(TABLE_NAME) || '.' || UPPER(COLUMN_NAME);

    query := '
        SELECT TABLE_VIEW_ID, COLUMN_HASH
        FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_COLUMN_VIEWS
        WHERE DATABASE_NAME = UPPER(''' || DB_NAME || ''')
          AND SCHEMA_NAME = UPPER(''' || SCHEMA_NAME || ''')
          AND TABLE_NAME = UPPER(''' || TABLE_NAME || ''')
          AND COLUMN_NAME = UPPER(''' || COLUMN_NAME || ''')
          AND STATUS = ''ACTIVE''
        ORDER BY UPDATED_AT DESC
        LIMIT 1
    ';
    rs := (EXECUTE IMMEDIATE :query);
    FOR r IN rs DO
        table_view_id := r.TABLE_VIEW_ID;
        stored_column_hash := r.COLUMN_HASH;
    END FOR;

    IF (table_view_id IS NULL) THEN
        RETURN OBJECT_CONSTRUCT(
            'status', 'MISSING',
            'code', 'NO_COLUMN_VIEW',
            'message', 'No active semantic column view found for ' || fqn
        );
    END IF;

    query := '
        SELECT MD5(DATA_TYPE || '':'' || IS_NULLABLE) AS COL_HASH
        FROM ' || DB_NAME || '.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = UPPER(''' || SCHEMA_NAME || ''')
          AND TABLE_NAME = UPPER(''' || TABLE_NAME || ''')
          AND COLUMN_NAME = UPPER(''' || COLUMN_NAME || ''')
    ';
    rs := (EXECUTE IMMEDIATE :query);
    FOR r IN rs DO live_column_hash := r.COL_HASH; END FOR;

    IF (live_column_hash IS NULL) THEN
        RETURN OBJECT_CONSTRUCT(
            'status', 'STALE',
            'code', 'COLUMN_MISSING',
            'message', 'Column is no longer present for ' || fqn
        );
    END IF;

    IF (live_column_hash != stored_column_hash OR stored_column_hash IS NULL) THEN
        RETURN OBJECT_CONSTRUCT(
            'status', 'STALE',
            'code', 'COLUMN_CHANGED',
            'message', 'Column structure changed for ' || fqn,
            'table_view_id', table_view_id
        );
    END IF;

    RETURN OBJECT_CONSTRUCT(
        'status', 'FRESH',
        'code', 'USE_CACHED',
        'message', 'Cached semantic column view is still current for ' || fqn,
        'table_view_id', table_view_id
    );
END;
$$;
