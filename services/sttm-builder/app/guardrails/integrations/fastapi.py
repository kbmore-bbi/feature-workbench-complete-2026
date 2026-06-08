from __future__ import annotations

import json

from starlette.datastructures import MutableHeaders
from starlette.requests import ClientDisconnect, Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

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


class GuardrailsMiddleware:
    def __init__(self, app: ASGIApp, *, config: GuardrailsConfig) -> None:
        self.app = app
        self._config = config

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        scope.setdefault("state", {})
        request = Request(scope, receive=receive)
        decision = get_governance_decision(request)

        downstream_receive = receive
        content_type = request.headers.get("content-type", "")
        if self._config.enabled and content_type.startswith("application/json"):
            body = await _consume_request_body(receive)
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
            downstream_receive = _buffered_receive(body, receive)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Trace-Id", decision.trace_id)
                if decision.request_id:
                    headers.setdefault("X-Request-Id", decision.request_id)
            await send(message)

        await self.app(scope, downstream_receive, send_wrapper)


async def _consume_request_body(receive: Receive) -> bytes:
    body_parts: list[bytes] = []
    more_body = True
    while more_body:
        message = await receive()
        if message["type"] == "http.disconnect":
            raise ClientDisconnect()
        body_parts.append(message.get("body", b""))
        more_body = bool(message.get("more_body", False))
    return b"".join(body_parts)


def _buffered_receive(body: bytes, receive: Receive) -> Receive:
    consumed = False

    async def buffered() -> Message:
        nonlocal consumed
        if not consumed:
            consumed = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()

    return buffered
