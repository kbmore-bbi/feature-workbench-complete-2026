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
    if not columns:
        return {
            "status": "ERROR",
            "code": "TABLE_NOT_FOUND",
            "message": f"No columns found for {db}.{schema}.{table}.",
        }

    exprs = ["COUNT(*) AS __ROW_COUNT"]
    column_meta = []
    for idx, item in enumerate(columns):
        col_name = item["COLUMN_NAME"]
        data_type = item["DATA_TYPE"]
        quoted_col = _q(col_name)
        null_alias = f"__NULL_{idx}"
        distinct_alias = f"__DISTINCT_{idx}"
        exprs.append(f"COUNT_IF({quoted_col} IS NULL) AS {null_alias}")
        if str(data_type).upper() == "VARIANT":
            exprs.append(f"NULL AS {distinct_alias}")
        else:
            exprs.append(f"APPROX_COUNT_DISTINCT({quoted_col}) AS {distinct_alias}")
        column_meta.append(
            {
                "name": col_name,
                "data_type": data_type,
                "null_alias": null_alias,
                "distinct_alias": distinct_alias,
            }
        )

    table_fqn = f'{_q(db)}.{_q(schema)}.{_q(table)}'
    stats_sql = f"SELECT {', '.join(exprs)} FROM {table_fqn}"
    stats_row = session.sql(stats_sql).collect()[0]
    row_count = stats_row["__ROW_COUNT"] or 0

    stats = []
    for meta in column_meta:
        null_count = stats_row[meta["null_alias"]] or 0
        distinct_count = stats_row[meta["distinct_alias"]]
        stats.append(
            {
                "name": meta["name"],
                "data_type": meta["data_type"],
                "row_count": row_count,
                "distinct_count": int(distinct_count) if distinct_count is not None else None,
                "null_count": int(null_count),
                "null_pct": round((float(null_count) * 100.0 / row_count), 2) if row_count else 0.0,
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
