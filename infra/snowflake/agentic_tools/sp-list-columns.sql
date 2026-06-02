CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_LIST_COLUMNS(
    "DB_NAME" VARCHAR,
    "SCHEMA_NAME" VARCHAR,
    "TABLE_NAME" VARCHAR
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
EXECUTE AS CALLER
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

    sql = f"""
        SELECT
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            ORDINAL_POSITION
        FROM {_q(db)}.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '{schema}'
          AND TABLE_NAME = '{table}'
        ORDER BY ORDINAL_POSITION
    """
    rows = session.sql(sql).collect()
    return {
        "status": "OK",
        "database": db,
        "schema": schema,
        "table": table,
        "columns": [
            {
                "name": row["COLUMN_NAME"],
                "data_type": row["DATA_TYPE"],
                "nullable": str(row["IS_NULLABLE"]).upper() == "YES",
                "ordinal_position": row["ORDINAL_POSITION"],
            }
            for row in rows
        ],
    }
$$;
