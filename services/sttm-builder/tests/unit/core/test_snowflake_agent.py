import json
from typing import Any

import httpx

from app.core.snowflake_agent import SnowflakeAgentClient


class _FakeHttpClient:
    captured: dict[str, Any] = {}

    def __init__(
        self,
        *,
        timeout: float | None = None,
        **_kwargs: Any,
    ) -> None:
        self.timeout = timeout
        self.is_closed = False

    def __enter__(self) -> "_FakeHttpClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
        return None

    def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
        **_kwargs: Any,
    ) -> httpx.Response:
        self.captured = {
            "url": url,
            "headers": headers,
            "json": json,
        }
        _FakeHttpClient.captured = self.captured
        return httpx.Response(
            200,
            json={
                "message": {
                    "content": [
                        {"type": "text", "text": "ok"},
                    ],
                },
                "metadata": {"thread_id": 123},
            },
        )


def test_oauth_agent_object_call_uses_object_endpoint_and_content_blocks(monkeypatch) -> None:
    monkeypatch.setattr("app.core.snowflake_agent.httpx.Client", _FakeHttpClient)
    client = SnowflakeAgentClient(
        token="oauth-token",
        host="acct.snowflakecomputing.com",
        auth_mode="oauth_bearer",
    )

    text, thread_id, _ = client.run_detailed(
        [{"role": "user", "content": "hello"}],
        agent="DB.SCHEMA.AGT_SOURCE_MAPPING",
    )

    assert text == "ok"
    assert thread_id == "123"
    captured = _FakeHttpClient.captured
    assert captured["url"] == (
        "https://acct.snowflakecomputing.com"
        "/api/v2/databases/DB/schemas/SCHEMA/agents/AGT_SOURCE_MAPPING:run"
    )
    assert captured["headers"]["Authorization"] == "Bearer oauth-token"
    assert captured["headers"]["X-Snowflake-Authorization-Token-Type"] == "OAUTH"
    assert captured["json"] == {
        "messages": [
            {
                "role": "user",
                "content": [{"type": "text", "text": "hello"}],
                "status": "completed",
            }
        ],
        "stream": False,
    }
    assert "agent" not in json.dumps(captured["json"])
    assert "models" not in captured["json"]
