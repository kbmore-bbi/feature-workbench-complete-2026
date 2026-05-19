import json
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.exceptions import SnowflakeAgentError


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
    ) -> None:
        resolved_host = (host or "").strip()
        if not resolved_host:
            raise SnowflakeAgentError("SNOWFLAKE_HOST is not set for Cortex Analyst requests.")
        self._token = token
        self._host = resolved_host
        self._auth_mode = auth_mode

    def ask(
        self,
        *,
        question: str,
        semantic_view: str | None = None,
        semantic_model_yaml: str | None = None,
        semantic_views: list[str] | None = None,
    ) -> SnowflakeAnalystResponse:
        payload: dict[str, Any] = {
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": question}],
                }
            ],
            "stream": False,
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

        try:
            with httpx.Client(timeout=240.0) as client:
                response = client.post(
                    f"https://{self._host}{self._ENDPOINT}",
                    headers=self._build_headers(),
                    json=payload,
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
