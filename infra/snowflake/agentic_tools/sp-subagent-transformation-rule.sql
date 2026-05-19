CREATE OR REPLACE PROCEDURE FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA.SP_SUBAGT_TRANSFORMATION_RULE("QUERY_CONTEXT" VARCHAR, "MODEL_NAME" VARCHAR DEFAULT 'claude-haiku-4-5')
RETURNS VARCHAR
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'run_agent'
EXECUTE AS CALLER
AS '
import json
import _snowflake

def run_agent(session, query_context: str, model_name: str = ''claude-haiku-4-5'') -> str:
    # query_context is the canonical model-facing agent payload JSON string.

    payload = {
        "models": {"orchestration": model_name},
        "messages": [
            {
                "role": "user",
                "content": [{"type": "text", "text": query_context}]
            }
        ],
        "stream": False
    }

    response = _snowflake.send_snow_api_request(
        ''POST'',
        ''/api/v2/databases/FFP_HDP_CRM_MIG_DB_DEV/schemas/SCH_STTM_METADATA/agents/AGT_TRANSFORMATION_RULE:run'',
        {},
        {},
        payload,
        None,
        60000
    )

    if response is None:
        return ''Sub-agent failed: null response from Cortex Agent API.''

    status_code = response.get(''status'', 0)
    body_raw    = response.get(''content'', ''{}'')

    body = body_raw if isinstance(body_raw, dict) else json.loads(body_raw)

    if status_code not in (200, 201):
        return f''Sub-agent error (HTTP {status_code}): {json.dumps(body)}''

    try:
        content_blocks = body.get(''content'', [])
        for block in content_blocks:
            if block.get(''type'') == ''text'':
                return block.get(''text'', '''')
        return ''Sub-agent returned no text content block.''
    except Exception as e:
        return f''Sub-agent response parse error: {str(e)} | Raw: {json.dumps(body)}''
';
