import json
import os
import uuid
from typing import Any
from urllib.parse import quote

import httpx

from app.core.exceptions import SnowflakeAgentError


class SnowflakeAgentClient:
    """
    Client for the Snowflake Cortex Agents REST API (synchronous / non-streaming).

    The agent's system prompt, tools, and tool resources are defined inside
    Snowflake — this client only handles transport, auth, and thread management.

    Configuration (env vars):
        SNOWFLAKE_HOST        — required, e.g. "org-account.snowflakecomputing.com"
        SNOWFLAKE_AGENT_MODEL — optional LLM override, default "llama3.3-70b"
    """

    _ENDPOINT = "/api/v2/cortex/agent:run"
    _DEFAULT_MODEL = "claude-sonnet-4"

    def __init__(
        self,
        token: str,
        model: str | None = None,
        *,
        host: str | None = None,
        auth_mode: str = "oauth_bearer",
    ) -> None:
        self._token = token
        self.model = model or os.getenv("SNOWFLAKE_AGENT_ORCHESTRATION_MODEL", self._DEFAULT_MODEL)
        resolved_host = (host or os.getenv("SNOWFLAKE_HOST", "")).strip()
        if not resolved_host:
            raise SnowflakeAgentError("SNOWFLAKE_HOST is not set for Cortex Agent requests.")
        self._base_url = f"https://{resolved_host}"
        self._auth_mode = auth_mode

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(
        self,
        messages: list[dict[str, Any]],
        *,
        agent: str | None = None,
        thread_id: str | None = None,
    ) -> tuple[str, str]:
        """
        Send *messages* to the Cortex Agent and return ``(response_text, thread_id)``.

        Args:
            messages:  Conversation turns in OpenAI-compatible format.
            agent:     Fully-qualified Snowflake Cortex Agent name
                       (e.g. "DB.SCHEMA.AGENT_NAME").
            thread_id: Pass an existing ID to continue a session; omit to
                       start a new one.
        """
        payload: dict[str, Any] = {
            "models": {"orchestration": self.model},
            "messages": messages,
        }

        if agent and self._auth_mode != "snowflake_token":
            payload["agent"] = agent

        if thread_id:
            payload["thread_id"] = thread_id

        headers = self._build_headers()
        endpoint = self._build_endpoint(agent)

        try:
            with httpx.Client(timeout=120.0) as client:
                response = client.post(
                    f"{self._base_url}{endpoint}",
                    headers=headers,
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise SnowflakeAgentError(
                f"HTTP error communicating with Cortex Agent: {exc}"
            ) from exc

        if response.status_code != 200:
            raise SnowflakeAgentError(
                f"Cortex Agent returned HTTP {response.status_code}: {response.text}"
            )

        try:
            data = response.json()
        except json.JSONDecodeError as exc:
            raw_text = response.text.strip()
            if raw_text:
                return raw_text, thread_id or str(uuid.uuid4())
            raise SnowflakeAgentError(
                f"Cortex Agent response is not valid JSON: {exc}"
            ) from exc

        return self._extract_text_and_thread(data, thread_id)

    def _build_headers(self) -> dict[str, str]:
        if self._auth_mode == "snowflake_token":
            return {
                "Authorization": f'Snowflake Token="{self._token}"',
                "Content-Type": "application/json",
                "Accept": "application/json",
            }

        return {
            "Authorization": f"Bearer {self._token}",
            "X-Snowflake-Authorization-Token-Type": "OAUTH",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _build_endpoint(self, agent: str | None) -> str:
        if self._auth_mode != "snowflake_token":
            return self._ENDPOINT

        if not agent:
            raise SnowflakeAgentError(
                "Local Snowflake-token Cortex Agent requests require a fully-qualified agent name."
            )

        parts = agent.split(".", 2)
        if len(parts) != 3 or not all(parts):
            raise SnowflakeAgentError(
                "Expected fully-qualified agent name in DATABASE.SCHEMA.AGENT format for local requests."
            )

        database, schema, agent_name = parts
        return (
            f"/api/v2/databases/{quote(database, safe='')}"
            f"/schemas/{quote(schema, safe='')}"
            f"/agents/{quote(agent_name, safe='')}:run"
        )

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_text_and_thread(
        data: dict[str, Any], fallback_thread_id: str | None
    ) -> tuple[str, str]:
        thread_id: str = (
            data.get("thread_id")
            or fallback_thread_id
            or str(uuid.uuid4())
        )

        # Normalise: some responses wrap content under "message", others don't
        message: dict[str, Any] = data.get("message") or data
        content = message.get("content", [])

        if isinstance(content, str):
            return content, thread_id

        texts: list[str] = []
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "text":
                continue
            text_val = block.get("text", "")
            texts.append(text_val if isinstance(text_val, str) else text_val.get("value", ""))

        return "".join(texts), thread_id
