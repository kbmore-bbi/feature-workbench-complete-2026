CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_ROLLUP_SCHEMA_SUMMARY(
    "DB_NAME" VARCHAR,
    "SCHEMA_NAME" VARCHAR,
    "MODEL_NAME" VARCHAR DEFAULT 'claude-sonnet-4-6',
    "SEMANTIC_LEVEL" VARCHAR DEFAULT 'L1_CONTEXT'
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run'
EXECUTE AS CALLER
AS
$$
def run(session, db_name: str, schema_name: str, model_name: str = "claude-sonnet-4-6", semantic_level: str = "L1_CONTEXT"):
    db = str(db_name or "").strip().upper()
    schema = str(schema_name or "").strip().upper()
    rows = session.sql(
        f"""
        SELECT TABLE_NAME, SEMANTIC_VIEW
        FROM FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SEM_TABLE_VIEWS
        WHERE DATABASE_NAME = '{db}'
          AND SCHEMA_NAME = '{schema}'
          AND STATUS = 'ACTIVE'
        ORDER BY TABLE_NAME
        """
    ).collect()
    tables = []
    for row in rows:
        view = row["SEMANTIC_VIEW"] if isinstance(row["SEMANTIC_VIEW"], dict) else {}
        semantic_model = view.get("semantic_model") if isinstance(view, dict) else {}
        relationships = semantic_model.get("relationships") if isinstance(semantic_model, dict) else {}
        tables.append(
            {
                "name": row["TABLE_NAME"],
                "description": semantic_model.get("description"),
                "primary_keys": semantic_model.get("primary_keys", []),
                "relationships": relationships if isinstance(relationships, dict) else {"outgoing": [], "incoming": []},
            }
        )
    return {
        "scope": "SCHEMA",
        "database": db,
        "schema": schema,
        "table": None,
        "semantic_model": {
            "description": f"Schema-level semantic summary for {db}.{schema}.",
            "domain_summary": f"Generated rollup across {len(tables)} active semantic table views.",
            "semantic_level": semantic_level,
            "tables": tables,
        },
    }
$$;
