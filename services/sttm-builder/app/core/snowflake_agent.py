import json
import logging
import os
import threading
import time
import uuid
from collections.abc import Iterator
from typing import Any
from urllib.parse import quote

import httpx

from app.core.exceptions import SnowflakeAgentError

logger = logging.getLogger(__name__)

_HTTP_CLIENT_LOCK = threading.Lock()
_HTTP_CLIENTS: dict[str, httpx.Client] = {}


def _shared_http_client(base_url: str) -> httpx.Client:
    """Reuse TLS connections to the same Snowflake account across API requests."""
    with _HTTP_CLIENT_LOCK:
        client = _HTTP_CLIENTS.get(base_url)
        if client is None or client.is_closed:
            client = httpx.Client(
                limits=httpx.Limits(
                    max_connections=50,
                    max_keepalive_connections=20,
                    keepalive_expiry=60.0,
                ),
            )
            _HTTP_CLIENTS[base_url] = client
        return client


class SnowflakeAgentClient:
    """
    Client for the Snowflake Cortex Agents REST API.

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
        request_timeout: float | None = None,
        role: str | None = None,
        warehouse: str | None = None,
    ) -> None:
        self._token = token
        self.model = model or os.getenv("SNOWFLAKE_AGENT_ORCHESTRATION_MODEL", self._DEFAULT_MODEL)
        self._timeout = request_timeout or float(os.getenv("SNOWFLAKE_AGENT_TIMEOUT_SECONDS", "240"))
        self._retry_attempts = max(
            1,
            int(os.getenv("SNOWFLAKE_AGENT_RETRY_ATTEMPTS", "3")),
        )
        self._retry_backoff_seconds = max(
            0.0,
            float(os.getenv("SNOWFLAKE_AGENT_RETRY_BACKOFF_SECONDS", "1.0")),
        )
        resolved_host = (host or os.getenv("SNOWFLAKE_HOST", "")).strip()
        if not resolved_host:
            raise SnowflakeAgentError("SNOWFLAKE_HOST is not set for Cortex Agent requests.")
        self._base_url = f"https://{resolved_host}"
        self._auth_mode = auth_mode
        self._role = (role or "").strip()
        self._warehouse = (warehouse or "").strip()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(
        self,
        messages: list[dict[str, Any]],
        *,
        agent: str | None = None,
        thread_id: str | None = None,
        parent_message_id: int | None = None,
        request_timeout: float | None = None,
    ) -> tuple[str, str]:
        text, resolved_thread_id, _ = self.run_detailed(
            messages,
            agent=agent,
            thread_id=thread_id,
            parent_message_id=parent_message_id,
            request_timeout=request_timeout,
        )
        return text, resolved_thread_id

    def stream_events(
        self,
        messages: list[dict[str, Any]],
        *,
        agent: str | None = None,
        thread_id: str | None = None,
        parent_message_id: int | None = None,
    ) -> Iterator[tuple[str, Any]]:
        payload: dict[str, Any] = {
            "messages": self._normalize_messages(messages),
            "stream": True,
        }

        if not agent:
            payload["models"] = {"orchestration": self.model}

        if thread_id:
            payload["thread_id"] = thread_id
        if parent_message_id is not None:
            payload["parent_message_id"] = parent_message_id

        headers = self._build_headers()
        endpoint = self._build_endpoint(agent)
        client = _shared_http_client(self._base_url)

        last_error: Exception | None = None
        for attempt in range(1, self._retry_attempts + 1):
            try:
                with client.stream(
                    "POST",
                    f"{self._base_url}{endpoint}",
                    headers=headers,
                    json=payload,
                    timeout=self._timeout,
                ) as response:
                    if response.status_code != 200:
                        error_body = response.read().decode("utf-8", errors="replace").strip()
                        error = SnowflakeAgentError(
                            f"Cortex Agent returned HTTP {response.status_code}: {error_body}"
                        )
                        if (
                            attempt < self._retry_attempts
                            and self._is_retryable_status_code(response.status_code)
                        ):
                            self._sleep_before_retry(attempt, error)
                            continue
                        raise error
                    yield from self._iter_sse_events(response)
                    return
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt >= self._retry_attempts or not self._is_retryable_http_error(exc):
                    raise SnowflakeAgentError(
                        f"HTTP error communicating with Cortex Agent: {exc}"
                    ) from exc
                self._sleep_before_retry(attempt, exc)

        raise SnowflakeAgentError(
            f"HTTP error communicating with Cortex Agent: {last_error}"
        ) from last_error

    def run_detailed(
        self,
        messages: list[dict[str, Any]],
        *,
        agent: str | None = None,
        thread_id: str | None = None,
        parent_message_id: int | None = None,
        request_timeout: float | None = None,
    ) -> tuple[str, str, dict[str, Any] | None]:
        """
        Send *messages* to the Cortex Agent and return
        ``(response_text, thread_id, raw_payload)``.

        Args:
            messages:  Conversation turns in OpenAI-compatible format.
            agent:     Fully-qualified Snowflake Cortex Agent name
                       (e.g. "DB.SCHEMA.AGENT_NAME").
            thread_id: Pass an existing ID to continue a session; omit to
                       start a new one.
        """
        payload: dict[str, Any] = {
            "messages": self._normalize_messages(messages),
            "stream": False,
        }

        if not agent:
            payload["models"] = {"orchestration": self.model}

        if thread_id:
            payload["thread_id"] = thread_id
        if parent_message_id is not None:
            payload["parent_message_id"] = parent_message_id

        headers = self._build_headers()
        endpoint = self._build_endpoint(agent)

        timeout = request_timeout or self._timeout
        response: httpx.Response | None = None
        last_error: Exception | None = None
        client = _shared_http_client(self._base_url)
        for attempt in range(1, self._retry_attempts + 1):
            try:
                response = client.post(
                    f"{self._base_url}{endpoint}",
                    headers=headers,
                    json=payload,
                    timeout=timeout,
                )
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt >= self._retry_attempts or not self._is_retryable_http_error(exc):
                    raise SnowflakeAgentError(
                        f"HTTP error communicating with Cortex Agent: {exc}"
                    ) from exc
                self._sleep_before_retry(attempt, exc)
                continue

            if response.status_code == 200:
                break

            error = SnowflakeAgentError(
                f"Cortex Agent returned HTTP {response.status_code}: {response.text}"
            )
            if (
                attempt >= self._retry_attempts
                or not self._is_retryable_status_code(response.status_code)
            ):
                raise error
            last_error = error
            self._sleep_before_retry(attempt, error)

        if response is None:
            raise SnowflakeAgentError(
                f"HTTP error communicating with Cortex Agent: {last_error}"
            ) from last_error

        try:
            data = response.json()
        except json.JSONDecodeError as exc:
            raw_text = response.text.strip()
            if raw_text:
                return raw_text, thread_id or str(uuid.uuid4()), None
            raise SnowflakeAgentError(
                f"Cortex Agent response is not valid JSON: {exc}"
            ) from exc

        text, resolved_thread_id = self._extract_text_and_thread(data, thread_id)
        return text, resolved_thread_id, data

    def _sleep_before_retry(self, attempt: int, error: Exception) -> None:
        logger.warning(
            "Retrying Cortex Agent request after transient failure (attempt %s/%s) in %.1fs: %s",
            attempt,
            self._retry_attempts,
            self._retry_backoff_seconds,
            error,
        )
        if self._retry_backoff_seconds > 0:
            time.sleep(self._retry_backoff_seconds)

    @staticmethod
    def _is_retryable_status_code(status_code: int) -> bool:
        return status_code in {408, 409, 425, 429, 500, 502, 503, 504}

    @staticmethod
    def _is_retryable_http_error(exc: httpx.HTTPError) -> bool:
        return isinstance(
            exc,
            (
                httpx.ConnectError,
                httpx.ConnectTimeout,
                httpx.ReadTimeout,
                httpx.WriteTimeout,
                httpx.RemoteProtocolError,
                httpx.PoolTimeout,
            ),
        )

    def _build_headers(self) -> dict[str, str]:
        if self._auth_mode == "snowflake_token":
            return {
                "Authorization": f'Snowflake Token="{self._token}"',
                "Content-Type": "application/json",
                "Accept": "application/json",
            }

        headers = {
            "Authorization": f"Bearer {self._token}",
            "X-Snowflake-Authorization-Token-Type": "OAUTH",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self._role:
            headers["X-Snowflake-Role"] = self._role
        if self._warehouse:
            headers["X-Snowflake-Warehouse"] = self._warehouse
        return headers

    def _build_endpoint(self, agent: str | None) -> str:
        if not agent:
            return self._ENDPOINT

        parts = agent.split(".", 2)
        if len(parts) != 3 or not all(parts):
            raise SnowflakeAgentError(
                "Expected fully-qualified agent name in DATABASE.SCHEMA.AGENT format."
            )

        database, schema, agent_name = parts
        return (
            f"/api/v2/databases/{quote(database, safe='')}"
            f"/schemas/{quote(schema, safe='')}"
            f"/agents/{quote(agent_name, safe='')}:run"
        )

    @staticmethod
    def _normalize_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for message in messages:
            role = message.get("role") or "user"
            content = message.get("content", "")
            if isinstance(content, str):
                normalized_content: Any = [{"type": "text", "text": content}]
            else:
                normalized_content = content

            normalized_message: dict[str, Any] = {
                **message,
                "role": role,
                "content": normalized_content,
            }
            normalized_message.setdefault("status", "completed")
            normalized.append(normalized_message)
        return normalized

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_text_and_thread(
        data: dict[str, Any], fallback_thread_id: str | None
    ) -> tuple[str, str]:
        metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
        thread_id: str = (
            data.get("thread_id")
            or metadata.get("thread_id")
            or fallback_thread_id
            or str(uuid.uuid4())
        )
        thread_id = str(thread_id)

        # Normalise: some responses wrap content under "message", others don't
        message: dict[str, Any] | str = data.get("message") or data
        if isinstance(message, str):
            return message, thread_id
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

    @staticmethod
    def _iter_sse_events(response: httpx.Response) -> Iterator[tuple[str, Any]]:
        event_name = "message"
        data_parts: list[str] = []

        def flush() -> tuple[str, Any] | None:
            nonlocal event_name, data_parts
            if not data_parts:
                event_name = "message"
                return None
            raw_data = "\n".join(data_parts).strip()
            data_parts = []
            current_event = event_name
            event_name = "message"
            if raw_data == "[DONE]":
                return current_event, raw_data
            try:
                return current_event, json.loads(raw_data)
            except json.JSONDecodeError:
                return current_event, raw_data

        for raw_line in response.iter_lines():
            line = raw_line if isinstance(raw_line, str) else raw_line.decode()
            if line == "":
                flushed = flush()
                if flushed is not None:
                    yield flushed
                continue
            if line.startswith(":"):
                continue
            if line.startswith("event:"):
                event_name = line.partition(":")[2].strip() or "message"
                continue
            if line.startswith("data:"):
                data_parts.append(line.partition(":")[2].lstrip())

        flushed = flush()
        if flushed is not None:
            yield flushed
