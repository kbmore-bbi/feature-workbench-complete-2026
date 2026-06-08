CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_GET_TABLE_CONTEXT_BUNDLE(
    "DB_NAME" VARCHAR,
    "SCHEMA_NAME" VARCHAR,
    "TABLE_NAME" VARCHAR,
    "SAMPLE_SIZE" NUMBER(38,0) DEFAULT 5
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


def _needs_distinct_profile(column_name: str, data_type: str, is_primary_key: bool, is_foreign_key: bool) -> bool:
    name = str(column_name or "").upper()
    dtype = str(data_type or "").upper()
    if dtype == "VARIANT":
        return False
    if is_primary_key or is_foreign_key:
        return True
    keywords = (
        "ID", "UUID", "KEY", "CODE", "TYPE", "STATUS", "OUTCOME", "FLAG",
        "ACTION", "ACTIVITY", "PARTNER", "CATEGORY", "STATE", "SOURCE",
    )
    return any(token in name for token in keywords)


def _show_keys(session, statement: str, group_schema_key: str, group_table_key: str):
    session.sql(statement).collect()
    rows = session.sql("SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))").collect()
    grouped = {}
    for row in rows:
        key = (
            row[group_schema_key],
            row[group_table_key],
            row["fk_name"],
        )
        grouped.setdefault(
            key,
            {
                "schema": row[group_schema_key],
                "table": row[group_table_key],
                "constraint_name": row["fk_name"],
                "column_mappings": [],
            },
        )
        grouped[key]["column_mappings"].append(
            {
                "fk_column": row["fk_column_name"],
                "pk_column": row["pk_column_name"],
            }
        )
    return list(grouped.values())


def run(session, db_name: str, schema_name: str, table_name: str, sample_size: int = 5):
    db = str(db_name or "").strip().upper()
    schema = str(schema_name or "").strip().upper()
    table = str(table_name or "").strip().upper()
    sample_n = int(sample_size or 5)
    if not db or not schema or not table:
        return {
            "status": "ERROR",
            "code": "INVALID_ARGUMENT",
            "message": "DB_NAME, SCHEMA_NAME, and TABLE_NAME are required.",
        }

    column_sql = f"""
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, ORDINAL_POSITION, COMMENT
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

    session.sql(f"SHOW TABLES LIKE '{table}' IN SCHEMA {_q(db)}.{_q(schema)}").collect()
    show_table_rows = session.sql("SELECT * FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))").collect()
    table_comment = None
    for row in show_table_rows:
        if str(row["name"] or "").upper() == table:
            table_comment = row["comment"]
            break

    imported_rows = _show_keys(
        session,
        f"SHOW IMPORTED KEYS IN TABLE {_q(db)}.{_q(schema)}.{_q(table)}",
        "pk_schema_name",
        "pk_table_name",
    )
    exported_rows = _show_keys(
        session,
        f"SHOW EXPORTED KEYS IN TABLE {_q(db)}.{_q(schema)}.{_q(table)}",
        "fk_schema_name",
        "fk_table_name",
    )

    pk_rows = session.sql(f"SHOW PRIMARY KEYS IN TABLE {_q(db)}.{_q(schema)}.{_q(table)}").collect()
    primary_keys = {row["column_name"] for row in pk_rows if row["column_name"]}
    foreign_keys = {
        mapping["fk_column"]
        for rel in imported_rows
        for mapping in rel["column_mappings"]
        if mapping.get("fk_column")
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
        should_profile_distinct = _needs_distinct_profile(
            col_name,
            data_type,
            col_name in primary_keys,
            col_name in foreign_keys,
        )
        if not should_profile_distinct:
            exprs.append(f"NULL AS {distinct_alias}")
        else:
            exprs.append(f"APPROX_COUNT_DISTINCT({quoted_col}) AS {distinct_alias}")
        column_meta.append(
            {
                "name": col_name,
                "data_type": data_type,
                "is_nullable": item["IS_NULLABLE"],
                "ordinal_position": item["ORDINAL_POSITION"],
                "comment": item["COMMENT"],
                "is_primary_key": col_name in primary_keys,
                "is_foreign_key": col_name in foreign_keys,
                "null_alias": null_alias,
                "distinct_alias": distinct_alias,
            }
        )

    table_fqn = f'{_q(db)}.{_q(schema)}.{_q(table)}'
    stats_row = session.sql(f"SELECT {', '.join(exprs)} FROM {table_fqn}").collect()[0]
    row_count = stats_row["__ROW_COUNT"] or 0

    profiled_columns = []
    for meta in column_meta:
        null_count = stats_row[meta["null_alias"]] or 0
        distinct_count = stats_row[meta["distinct_alias"]]
        profiled_columns.append(
            {
                "name": meta["name"],
                "data_type": meta["data_type"],
                "is_nullable": meta["is_nullable"],
                "ordinal_position": meta["ordinal_position"],
                "comment": meta["comment"],
                "is_primary_key": meta["is_primary_key"],
                "is_foreign_key": meta["is_foreign_key"],
                "row_count": row_count,
                "null_count": int(null_count),
                "null_pct": round((float(null_count) * 100.0 / row_count), 2) if row_count else 0.0,
                "distinct_count": int(distinct_count) if distinct_count is not None else None,
            }
        )

    ddl_row = session.sql(
        f"SELECT GET_DDL('TABLE', '{db}.{schema}.{table}') AS TABLE_DDL"
    ).collect()[0]
    ddl = ddl_row["TABLE_DDL"]

    sample_rows_result = session.sql(
        f"SELECT OBJECT_CONSTRUCT(*) AS ROW_DATA FROM {table_fqn} LIMIT {sample_n}"
    ).collect()
    sample_rows = [row["ROW_DATA"] for row in sample_rows_result]

    return {
        "status": "OK",
        "database": db,
        "schema": schema,
        "table": table,
        "table_comment": table_comment,
        "ddl": ddl,
        "row_count": row_count,
        "columns": profiled_columns,
        "relationships": {
            "outgoing": imported_rows,
            "incoming": exported_rows,
            "summary": {
                "outgoing_count": len(imported_rows),
                "incoming_count": len(exported_rows),
            },
        },
        "sample_rows": sample_rows,
    }
$$;
