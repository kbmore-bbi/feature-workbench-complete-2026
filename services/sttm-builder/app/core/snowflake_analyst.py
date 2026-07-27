import json
import threading
from dataclasses import dataclass, field
from typing import Any, Iterator

import httpx

from app.core.exceptions import SnowflakeAgentError

_HTTP_CLIENT_LOCK = threading.Lock()
_HTTP_CLIENTS: dict[str, httpx.Client] = {}


def _shared_http_client(base_url: str) -> httpx.Client:
    with _HTTP_CLIENT_LOCK:
        client = _HTTP_CLIENTS.get(base_url)
        if client is None or client.is_closed:
            client = httpx.Client(
                limits=httpx.Limits(
                    max_connections=30,
                    max_keepalive_connections=15,
                    keepalive_expiry=60.0,
                )
            )
            _HTTP_CLIENTS[base_url] = client
        return client


@dataclass
class SnowflakeAnalystResponse:
    request_id: str | None
    text: str | None
    sql: str | None
    suggestions: list[str] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)
    response_metadata: dict[str, Any] = field(default_factory=dict)
    raw_message: dict[str, Any] = field(default_factory=dict)
    verified_query_used: dict[str, Any] | None = None


class SnowflakeAnalystClient:
    _ENDPOINT = "/api/v2/cortex/analyst/message"

    def __init__(
        self,
        token: str,
        *,
        host: str,
        auth_mode: str = "oauth_bearer",
        role: str | None = None,
        warehouse: str | None = None,
    ) -> None:
        resolved_host = (host or "").strip()
        if not resolved_host:
            raise SnowflakeAgentError("SNOWFLAKE_HOST is not set for Cortex Analyst requests.")
        self._token = token
        self._host = resolved_host
        self._base_url = f"https://{resolved_host}"
        self._auth_mode = auth_mode
        self._role = (role or "").strip()
        self._warehouse = (warehouse or "").strip()

    def ask(
        self,
        *,
        question: str,
        semantic_view: str | None = None,
        semantic_model_yaml: str | None = None,
        semantic_views: list[str] | None = None,
    ) -> SnowflakeAnalystResponse:
        payload = self._build_payload(
            question=question,
            semantic_view=semantic_view,
            semantic_model_yaml=semantic_model_yaml,
            semantic_views=semantic_views,
            stream=False,
        )

        try:
            response = _shared_http_client(self._base_url).post(
                f"{self._base_url}{self._ENDPOINT}",
                headers=self._build_headers(),
                json=payload,
                timeout=240.0,
            )
        except httpx.HTTPError as exc:
            raise SnowflakeAgentError(f"HTTP error communicating with Cortex Analyst: {exc}") from exc

        if response.status_code != 200:
            raise SnowflakeAgentError(
                f"Cortex Analyst returned HTTP {response.status_code}: {response.text}"
            )

        try:
            data = response.json()
        except json.JSONDecodeError as exc:
            raise SnowflakeAgentError(
                f"Cortex Analyst response is not valid JSON: {exc}"
            ) from exc

        return self._parse_response(data)

    def stream_events(
        self,
        *,
        question: str,
        semantic_view: str | None = None,
        semantic_model_yaml: str | None = None,
        semantic_views: list[str] | None = None,
    ) -> Iterator[tuple[str, dict[str, Any]]]:
        """Yield the genuine Cortex Analyst SSE events without buffering."""
        payload = self._build_payload(
            question=question,
            semantic_view=semantic_view,
            semantic_model_yaml=semantic_model_yaml,
            semantic_views=semantic_views,
            stream=True,
        )
        headers = {**self._build_headers(), "Accept": "text/event-stream"}
        try:
            with _shared_http_client(self._base_url).stream(
                "POST",
                f"{self._base_url}{self._ENDPOINT}",
                headers=headers,
                json=payload,
                timeout=240.0,
            ) as response:
                if response.status_code != 200:
                    body = response.read().decode("utf-8", errors="replace")
                    raise SnowflakeAgentError(
                        f"Cortex Analyst returned HTTP {response.status_code}: {body}"
                    )
                event_name = "message"
                data_lines: list[str] = []
                for line in response.iter_lines():
                    if line == "":
                        if data_lines:
                            raw = "\n".join(data_lines)
                            try:
                                data = json.loads(raw)
                            except json.JSONDecodeError:
                                data = {"text": raw}
                            yield event_name, data
                        event_name = "message"
                        data_lines = []
                        continue
                    if line.startswith("event:"):
                        event_name = line[6:].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line[5:].lstrip())
                if data_lines:
                    raw = "\n".join(data_lines)
                    try:
                        data = json.loads(raw)
                    except json.JSONDecodeError:
                        data = {"text": raw}
                    yield event_name, data
        except SnowflakeAgentError:
            raise
        except httpx.HTTPError as exc:
            raise SnowflakeAgentError(
                f"HTTP error communicating with Cortex Analyst: {exc}"
            ) from exc

    @staticmethod
    def _build_payload(
        *,
        question: str,
        semantic_view: str | None,
        semantic_model_yaml: str | None,
        semantic_views: list[str] | None,
        stream: bool,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": question}],
                }
            ],
            "stream": stream,
        }
        if semantic_views:
            payload["semantic_models"] = [{"semantic_view": value} for value in semantic_views]
        elif semantic_view:
            payload["semantic_view"] = semantic_view
        elif semantic_model_yaml:
            payload["semantic_model"] = semantic_model_yaml
        else:
            raise SnowflakeAgentError(
                "Cortex Analyst requests require a semantic_view, semantic_views, or semantic_model_yaml."
            )
        return payload

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

    @staticmethod
    def _parse_response(data: dict[str, Any]) -> SnowflakeAnalystResponse:
        message = data.get("message") if isinstance(data.get("message"), dict) else {}
        content = message.get("content") if isinstance(message.get("content"), list) else []

        text_blocks: list[str] = []
        suggestions: list[str] = []
        sql_statement: str | None = None
        verified_query_used: dict[str, Any] | None = None

        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = block.get("type")
            if block_type == "text" and isinstance(block.get("text"), str):
                text_blocks.append(block["text"])
            elif block_type == "suggestions" and isinstance(block.get("suggestions"), list):
                suggestions.extend(str(item) for item in block["suggestions"] if item is not None)
            elif block_type == "sql":
                statement = block.get("statement")
                if isinstance(statement, str):
                    sql_statement = statement
                verified = block.get("verified_query_used")
                if isinstance(verified, dict):
                    verified_query_used = verified

        warnings = data.get("warnings") if isinstance(data.get("warnings"), list) else []
        response_metadata = (
            data.get("response_metadata")
            if isinstance(data.get("response_metadata"), dict)
            else {}
        )

        return SnowflakeAnalystResponse(
            request_id=data.get("request_id") if isinstance(data.get("request_id"), str) else None,
            text="\n".join(part for part in text_blocks if part).strip() or None,
            sql=sql_statement,
            suggestions=suggestions,
            warnings=warnings,
            response_metadata=response_metadata,
            raw_message=message,
            verified_query_used=verified_query_used,
        )
