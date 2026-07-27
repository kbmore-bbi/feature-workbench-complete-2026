-- Reads rich semantic evidence for one exact table on demand. ReadPendingFIR
-- returns only a compact manifest so repeated records cannot exhaust the agent context.
CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_READ_SEMANTIC_EVIDENCE(
    "TABLE_FQN" VARCHAR,
    "COLUMN_LIMIT" INTEGER DEFAULT 250
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'read_semantic_evidence'
EXECUTE AS OWNER
AS
$$
import json


NS = "__STTM_METADATA_NAMESPACE__"
SEM_NS = "__SEMANTIC_REGISTRY_NAMESPACE__"
SEM_TABLE_OBJECT = "__SEMANTIC_TABLE_VIEWS_OBJECT__"
SEM_COLUMN_OBJECT = "__SEMANTIC_COLUMN_VIEWS_OBJECT__"
SEM_NATIVE_OBJECT = "__SEMANTIC_NATIVE_VIEWS_OBJECT__"


def _semantic_object(name):
    normalized = str(name or "").strip()
    return normalized if normalized.count(".") == 2 else f"{SEM_NS}.{normalized}"


def _rows(session, query, params=None):
    return [row.as_dict() for row in session.sql(query, params or []).collect()]


def read_semantic_evidence(session, table_fqn: str, column_limit: int = 250) -> dict:
    normalized_fqn = str(table_fqn or "").strip().upper()
    if len(normalized_fqn.split(".")) != 3:
        return {
            "status": "invalid_request",
            "error": "TABLE_FQN must be a fully qualified DB.SCHEMA.TABLE name",
        }

    limit = max(1, min(int(column_limit or 250), 1000))
    table_source = _semantic_object(SEM_TABLE_OBJECT)
    column_source = _semantic_object(SEM_COLUMN_OBJECT)
    native_source = _semantic_object(SEM_NATIVE_OBJECT)

    table_rows = _rows(session, f"""
        SELECT * FROM {table_source}
        WHERE UPPER(COALESCE(FQN, CONCAT_WS('.', DATABASE_NAME, SCHEMA_NAME, TABLE_NAME))) = ?
        LIMIT 1
    """, [normalized_fqn])
    column_rows = _rows(session, f"""
        SELECT * FROM {column_source}
        WHERE UPPER(CONCAT_WS('.', DATABASE_NAME, SCHEMA_NAME, TABLE_NAME)) = ?
        LIMIT ?
    """, [normalized_fqn, limit])
    native_rows = _rows(session, f"""
        SELECT * FROM {native_source}
        WHERE UPPER(COALESCE(SOURCE_FQN, CONCAT_WS('.', DATABASE_NAME, SCHEMA_NAME, TABLE_NAME))) = ?
        LIMIT 1
    """, [normalized_fqn])
    curated_rows = _rows(session, f"""
        SELECT *
        FROM {NS}.TBL_SEMANTIC_VIEW_VERSIONS
        WHERE UPPER(SEMANTIC_VIEW_FQN) = ?
          AND STATUS = 'active'
        ORDER BY VERSION_NUMBER DESC, UPDATED_AT DESC
        LIMIT 1
    """, [normalized_fqn])

    return {
        "status": "success" if table_rows else "semantic_table_not_found",
        "table_fqn": normalized_fqn,
        "semantic_sources": {
            "table": table_source,
            "column": column_source,
            "native": native_source,
        },
        "table_semantic": table_rows[0] if table_rows else None,
        "column_semantics": column_rows,
        "column_rows_returned": len(column_rows),
        "column_limit": limit,
        "native_semantic_view": native_rows[0] if native_rows else None,
        "curated_semantic_version": curated_rows[0] if curated_rows else None,
    }
$$;
