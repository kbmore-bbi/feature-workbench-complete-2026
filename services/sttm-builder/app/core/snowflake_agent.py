import json
import os
import uuid
from typing import Any

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

    def __init__(self, token: str, model: str | None = None) -> None:
        self._token = token
        self.model = model or os.getenv("SNOWFLAKE_AGENT_ORCHESTRATION_MODEL", self._DEFAULT_MODEL)
        self._base_url = f"https://{os.environ['SNOWFLAKE_HOST']}"

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

        if agent:
            payload["agent"] = agent

        if thread_id:
            payload["thread_id"] = thread_id

        headers = {
            "Authorization": f"Bearer {self._token}",
            "X-Snowflake-Authorization-Token-Type": "OAUTH",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        try:
            with httpx.Client(timeout=120.0) as client:
                response = client.post(
                    f"{self._base_url}{self._ENDPOINT}",
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
            raise SnowflakeAgentError(
                f"Cortex Agent response is not valid JSON: {exc}"
            ) from exc

        return self._extract_text_and_thread(data, thread_id)

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
