CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_SUBAGT_SOURCE_MAPPING("QUERY_CONTEXT" VARCHAR, "MODEL_NAME" VARCHAR DEFAULT 'claude-haiku-4-5')
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

def run_agent(session, query_context: str, model_name: str = ''claude-haiku-4-5'') -> str:
    # query_context is the canonical model-facing agent payload JSON string.
    current_database, current_schema = _current_namespace(session)

    payload = {
        "models": {"orchestration": model_name},
        "messages": [
            {
                "role": "user",
                "content": [{"type": "text", "text": query_context}]
            }
        ],
        "stream": False   # non-streaming: get a single JSON response
    }

    response = _snowflake.send_snow_api_request(
        ''POST'',
        f''/api/v2/databases/{current_database}/schemas/{current_schema}/agents/AGT_SOURCE_MAPPING:run'',
        {},                          # query params
        {},                          # headers (auth injected automatically)
        payload,
        None,                        # request_guid
        60000                        # timeout ms for sub-agent run
    )

    if response is None:
        return ''Sub-agent failed: null response from Cortex Agent API.''

    status_code = response.get(''status'', 0)
    body_raw    = response.get(''content'', ''{}'')

    # body may already be a dict if Snowpark parsed it, or still a JSON string
    body = body_raw if isinstance(body_raw, dict) else json.loads(body_raw)

    if status_code not in (200, 201):
        return f''Sub-agent error (HTTP {status_code}): {json.dumps(body)}''

    # ── Extract text from content[0].text  ──
    try:
        content_blocks = body.get(''content'', [])
        for block in content_blocks:
            if block.get(''type'') == ''text'':
                return block.get(''text'', '''')
        return ''Sub-agent returned no text content block.''
    except Exception as e:
        return f''Sub-agent response parse error: {str(e)} | Raw: {json.dumps(body)}''
';
