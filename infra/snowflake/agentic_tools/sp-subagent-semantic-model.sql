CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_SUBAGT_SEMANTIC_MODEL("QUERY_CONTEXT" VARCHAR, "MODEL_NAME" VARCHAR DEFAULT 'claude-sonnet-4-6')
RETURNS VARCHAR
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run_agent'
EXECUTE AS CALLER
AS '
import json
import _snowflake

def _current_namespace(session):
    row = session.sql("SELECT CURRENT_DATABASE() AS DB, CURRENT_SCHEMA() AS SCH").collect()[0]
    return str(row["DB"]), str(row["SCH"])


def _semantic_model_table(session):
    current_database, current_schema = _current_namespace(session)
    return f"{current_database}.{current_schema}.TBL_SEMANTIC_MODELS"


def _semantic_agent_path(session):
    current_database, current_schema = _current_namespace(session)
    return f"/api/v2/databases/{current_database}/schemas/{current_schema}/agents/AGT_SEMANTIC_MODEL:run"


def _safe_json_loads(value):
    if isinstance(value, dict):
        return value
    if value is None:
        return {}
    try:
        return json.loads(value)
    except Exception:
        return {}


def _normalize_table_ref(item):
    if not isinstance(item, dict):
        return None
    database = str(item.get("database") or "").strip().upper()
    schema = str(item.get("schema") or "").strip().upper()
    table = str(item.get("table") or "").strip().upper()
    if not database or not schema or not table:
        return None
    return {
        "database": database,
        "schema": schema,
        "table": table,
    }


def _extract_request_tables(payload):
    if isinstance(payload.get("data"), dict):
        data = payload.get("data") or {}
        scope = str(data.get("scope") or "TABLE").upper()
        semantic_level = str(
            (payload.get("context") or {}).get("semantic_level_requested")
            or data.get("semantic_level")
            or "L1_CONTEXT"
        ).upper()
        if scope != "TABLE":
            return [], semantic_level
        table_name = str(data.get("table") or "").strip()
        if not table_name:
            return [], semantic_level
        ref = _normalize_table_ref(
            {
                "database": data.get("database"),
                "schema": data.get("schema"),
                "table": table_name,
            }
        )
        return ([ref] if ref else []), semantic_level

    if "scope" in payload and "database" in payload and "schema" in payload:
        scope = str(payload.get("scope") or "TABLE").upper()
        if scope != "TABLE":
            return [], str(payload.get("semantic_level") or "L1_CONTEXT").upper()
        table_name = str(payload.get("table") or "").strip()
        if not table_name:
            return [], str(payload.get("semantic_level") or "L1_CONTEXT").upper()
        ref = _normalize_table_ref(
            {
                "database": payload.get("database"),
                "schema": payload.get("schema"),
                "table": table_name,
            }
        )
        return ([ref] if ref else []), str(payload.get("semantic_level") or "L1_CONTEXT").upper()

    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    source_tables = context.get("source_tables") if isinstance(context.get("source_tables"), list) else []
    refs = []
    seen = set()
    for item in source_tables:
        ref = _normalize_table_ref(item)
        if ref is None:
            continue
        key = (ref["database"], ref["schema"], ref["table"])
        if key in seen:
            continue
        seen.add(key)
        refs.append(ref)
    return refs, str(context.get("semantic_level_requested") or "L1_CONTEXT").upper()


def _extract_text_block(body):
    content_blocks = body.get("content", [])
    for block in content_blocks:
        if block.get("type") == "text":
            return block.get("text", "")
    return ""


def _extract_json_envelope(raw_text):
    start = raw_text.find("{")
    end = raw_text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError(f"No JSON found in semantic-model response: {raw_text[:300]}")
    return json.loads(raw_text[start : end + 1])


def _compute_table_hash(session, table_ref):
    sql = (
        "SELECT MD5(GET_DDL(''TABLE'', ''{db}.{schema}.{table}'')) AS HASH"
        .format(db=table_ref["database"], schema=table_ref["schema"], table=table_ref["table"])
    )
    rows = session.sql(sql).collect()
    if not rows or rows[0]["HASH"] is None:
        raise ValueError(
            "Could not compute DDL hash for {db}.{schema}.{table}".format(**table_ref)
        )
    return rows[0]["HASH"]


def _merge_row(session, scope, table_ref, attribute_name, model_payload, ddl_hash):
    model_json = json.dumps(model_payload or {}, default=str).replace("$$", "$ $")
    table_name = table_ref["table"]
    attr = (attribute_name or "").upper()
    sql = """
        MERGE INTO {sm_table} AS tgt
        USING (
            SELECT
                ''{scope}'' AS SCOPE,
                ''{db}'' AS DB_NAME,
                ''{schema}'' AS SCHEMA_NAME,
                ''{table}'' AS TABLE_NAME,
                ''{attr}'' AS ATTRIBUTE_NAME,
                PARSE_JSON($${model_json}$$) AS SEMANTIC_MODEL,
                ''{ddl_hash}'' AS DDL_HASH,
                CURRENT_TIMESTAMP() AS NOW
        ) AS src
        ON  tgt.SCOPE = src.SCOPE
        AND tgt.DB_NAME = src.DB_NAME
        AND tgt.SCHEMA_NAME = src.SCHEMA_NAME
        AND tgt.TABLE_NAME = src.TABLE_NAME
        AND tgt.ATTRIBUTE_NAME = src.ATTRIBUTE_NAME
        WHEN MATCHED THEN UPDATE SET
            tgt.SEMANTIC_MODEL = src.SEMANTIC_MODEL,
            tgt.DDL_HASH = src.DDL_HASH,
            tgt.UPDATED_AT = src.NOW
        WHEN NOT MATCHED THEN INSERT (
            SCOPE, DB_NAME, SCHEMA_NAME, TABLE_NAME, ATTRIBUTE_NAME,
            SEMANTIC_MODEL, DDL_HASH, GENERATED_AT, UPDATED_AT
        ) VALUES (
            src.SCOPE, src.DB_NAME, src.SCHEMA_NAME, src.TABLE_NAME, src.ATTRIBUTE_NAME,
            src.SEMANTIC_MODEL, src.DDL_HASH, src.NOW, src.NOW
        )
    """.format(
        sm_table=_semantic_model_table(session),
        scope=scope,
        db=table_ref["database"],
        schema=table_ref["schema"],
        table=table_name,
        attr=attr,
        model_json=model_json,
        ddl_hash=ddl_hash,
    )
    session.sql(sql).collect()


def _persist_table_envelope(session, table_ref, envelope):
    ddl_hash = _compute_table_hash(session, table_ref)
    semantic_model = envelope.get("semantic_model") or {}
    _merge_row(session, "TABLE", table_ref, "", semantic_model, ddl_hash)
    attribute_models = envelope.get("attribute_semantic_model")
    if attribute_models is None:
        attribute_models = []
    if not isinstance(attribute_models, list):
        raise ValueError("attribute_semantic_model must be an array when present")
    for item in attribute_models:
        if not isinstance(item, dict):
            continue
        attribute_name = str(item.get("name") or item.get("attribute") or "").strip().upper()
        if not attribute_name:
            continue
        _merge_row(session, "ATTRIBUTE", table_ref, attribute_name, item, ddl_hash)


def _run_single_table(session, table_ref, semantic_level, model_name):
    query_payload = {
        "scope": "TABLE",
        "database": table_ref["database"],
        "schema": table_ref["schema"],
        "table": table_ref["table"],
        "semantic_level": semantic_level,
    }
    payload = {
        "models": {"orchestration": model_name},
        "messages": [
            {
                "role": "user",
                "content": [{"type": "text", "text": json.dumps(query_payload)}]
            }
        ],
        "stream": False
    }

    response = _snowflake.send_snow_api_request(
        "POST",
        _semantic_agent_path(session),
        {},
        {},
        payload,
        None,
        60000
    )
    if response is None:
        raise ValueError("Semantic-model sub-agent failed: null response from Cortex Agent API")

    status_code = response.get("status", 0)
    body = response.get("content", {})
    if not isinstance(body, dict):
        body = _safe_json_loads(body)
    if status_code not in (200, 201):
        raise ValueError(
            "Semantic-model sub-agent error (HTTP {status}): {body}".format(
                status=status_code,
                body=json.dumps(body),
            )
        )

    raw_text = _extract_text_block(body)
    envelope = _extract_json_envelope(raw_text)
    _persist_table_envelope(session, table_ref, envelope)
    return {
        "table": table_ref,
        "scope": "TABLE",
        "semantic_model": envelope.get("semantic_model") or {},
        "attribute_semantic_model": envelope.get("attribute_semantic_model") or [],
    }


def run_agent(session, query_context: str, model_name: str = "claude-sonnet-4-6") -> str:
    payload = _safe_json_loads(query_context)
    tables, semantic_level = _extract_request_tables(payload)
    if not tables:
        return json.dumps(
            {
                "status": "completed",
                "semantic_level": semantic_level,
                "generated": 0,
                "skipped": 0,
                "semantic_context": [],
                "message": "No raw source tables were present for semantic refresh.",
            }
        )

    semantic_context = []
    for table_ref in tables:
        semantic_context.append(_run_single_table(session, table_ref, semantic_level, model_name))

    return json.dumps(
        {
            "status": "completed",
            "semantic_level": semantic_level,
            "generated": len(semantic_context),
            "skipped": 0,
            "semantic_context": semantic_context,
        }
    )
';
