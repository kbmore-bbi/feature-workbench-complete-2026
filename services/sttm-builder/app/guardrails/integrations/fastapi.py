from __future__ import annotations

import json
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.guardrails.config.schema import GuardrailsConfig
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.observability.tracer import ensure_trace_id


def get_governance_decision(request: Request) -> GovernanceDecision:
    existing = getattr(request.state, "governance_decision", None)
    if isinstance(existing, GovernanceDecision):
        return existing
    decision = GovernanceDecision(trace_id=ensure_trace_id(request))
    request.state.governance_decision = decision
    return decision


def attach_governance_decision(request: Request, decision: GovernanceDecision) -> GovernanceDecision:
    request.state.governance_decision = decision
    request.state.trace_id = decision.trace_id
    return decision


class GuardrailsMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Any, *, config: GuardrailsConfig) -> None:
        super().__init__(app)
        self._config = config

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        decision = get_governance_decision(request)

        if self._config.enabled and request.headers.get("content-type", "").startswith("application/json"):
            body = await request.body()
            if body:
                try:
                    payload = json.loads(body)
                except json.JSONDecodeError:
                    payload = None
                if isinstance(payload, dict):
                    if isinstance(payload.get("request_id"), str) and payload["request_id"]:
                        decision.request_id = payload["request_id"]
                    if isinstance(payload.get("operation"), str) and payload["operation"]:
                        decision.operation = payload["operation"]

                async def receive() -> dict[str, Any]:
                    return {"type": "http.request", "body": body, "more_body": False}

                request._receive = receive  # type: ignore[attr-defined]

        response = await call_next(request)
        response.headers.setdefault("X-Trace-Id", decision.trace_id)
        if decision.request_id:
            response.headers.setdefault("X-Request-Id", decision.request_id)
        return response
