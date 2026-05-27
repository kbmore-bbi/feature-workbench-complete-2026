CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_GET_CACHED_SEMANTIC_VIEW(
    "DB_NAME" VARCHAR,
    "SCHEMA_NAME" VARCHAR,
    "TABLE_NAME" VARCHAR
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
EXECUTE AS OWNER
AS
$$
def _q(identifier: str) -> str:
    return '"' + str(identifier or "").replace('"', '""') + '"'


def run(session, db_name: str, schema_name: str, table_name: str):
    db = str(db_name or "").strip().upper()
    schema = str(schema_name or "").strip().upper()
    table = str(table_name or "").strip().upper()
    if not db or not schema or not table:
        return {
            "status": "ERROR",
            "code": "INVALID_ARGUMENT",
            "message": "DB_NAME, SCHEMA_NAME, and TABLE_NAME are required.",
        }

    table_sql = f"""
        SELECT VIEW_ID, SEMANTIC_VIEW
        FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
        WHERE DATABASE_NAME = '{db}'
          AND SCHEMA_NAME = '{schema}'
          AND TABLE_NAME = '{table}'
          AND STATUS = 'ACTIVE'
        ORDER BY GENERATED_AT DESC
        LIMIT 1
    """
    table_rows = session.sql(table_sql).collect()
    if not table_rows:
        return {
            "status": "MISSING",
            "code": "NO_SEMANTIC_VIEW",
            "message": f"No cached semantic view found for {db}.{schema}.{table}.",
        }

    semantic_view = table_rows[0]["SEMANTIC_VIEW"]
    view_id = table_rows[0]["VIEW_ID"]
    column_sql = f"""
        SELECT ATTRIBUTE_VIEW
        FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_COLUMN_VIEWS
        WHERE DATABASE_NAME = '{db}'
          AND SCHEMA_NAME = '{schema}'
          AND TABLE_NAME = '{table}'
          AND TABLE_VIEW_ID = '{view_id}'
          AND STATUS = 'ACTIVE'
        ORDER BY COLUMN_NAME
    """
    column_rows = session.sql(column_sql).collect()

    payload = semantic_view if isinstance(semantic_view, dict) else {}
    payload["attribute_semantic_model"] = [
        row["ATTRIBUTE_VIEW"] if isinstance(row["ATTRIBUTE_VIEW"], dict) else {}
        for row in column_rows
    ]
    return payload
$$;
