CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_GET_TABLE_STATS(
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


def _qq(identifier: str) -> str:
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

    column_sql = f"""
        SELECT COLUMN_NAME, DATA_TYPE
        FROM {_q(db)}.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '{schema}'
          AND TABLE_NAME = '{table}'
        ORDER BY ORDINAL_POSITION
    """
    columns = session.sql(column_sql).collect()
    table_fqn = f'{_q(db)}.{_q(schema)}.{_q(table)}'
    row_count = session.sql(f"SELECT COUNT(*) AS ROW_COUNT FROM {table_fqn}").collect()[0]["ROW_COUNT"]

    stats = []
    for item in columns:
        col_name = item["COLUMN_NAME"]
        col_type = item["DATA_TYPE"]
        quoted_col = _qq(col_name)
        stat_sql = f"""
            SELECT
                COUNT(*) AS ROW_COUNT,
                COUNT(DISTINCT {quoted_col}) AS DISTINCT_COUNT,
                COUNT(*) - COUNT({quoted_col}) AS NULL_COUNT
            FROM {table_fqn}
        """
        stat_row = session.sql(stat_sql).collect()[0]
        stats.append(
            {
                "name": col_name,
                "data_type": col_type,
                "row_count": stat_row["ROW_COUNT"],
                "distinct_count": stat_row["DISTINCT_COUNT"],
                "null_count": stat_row["NULL_COUNT"],
                "null_pct": round((stat_row["NULL_COUNT"] * 100.0 / row_count), 2) if row_count else 0.0,
            }
        )

    return {
        "status": "OK",
        "database": db,
        "schema": schema,
        "table": table,
        "row_count": row_count,
        "columns": stats,
    }
$$;
