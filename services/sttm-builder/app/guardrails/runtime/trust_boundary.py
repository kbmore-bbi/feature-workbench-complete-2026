from __future__ import annotations

from typing import Any

from app.guardrails.contracts.trust import TrustAssertion, TrustBundle, TrustLabel


def build_request_trust_bundle(payload: dict[str, Any]) -> TrustBundle:
    assertions: list[TrustAssertion] = [TrustAssertion(label=TrustLabel.SYSTEM_POLICY, source="backend")]
    if payload.get("data"):
        assertions.append(TrustAssertion(label=TrustLabel.USER_INPUT, source="request.data"))
    context = payload.get("context") or {}
    if any(key in context for key in ("semantic_context", "relationships", "selected_columns_by_table")):
        assertions.append(
            TrustAssertion(
                label=TrustLabel.GOVERNED_STRUCTURED_DATA,
                source="request.context",
                detail="semantic_context",
            )
        )
    if context.get("datahub_context"):
        assertions.append(
            TrustAssertion(
                label=TrustLabel.RETRIEVED_UNTRUSTED,
                source="request.context.datahub_context",
            )
        )
    return TrustBundle(assertions=assertions)
