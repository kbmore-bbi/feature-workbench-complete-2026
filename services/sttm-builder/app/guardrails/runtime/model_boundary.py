from __future__ import annotations

from typing import Any

from app.core.exceptions import AuthorizationError
from app.guardrails.config.schema import GuardrailsConfig
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.policies.operation_policy import find_forbidden_sql_tokens


_MODEL_TARGETS: dict[str, set[str]] = {
    "conversation.ask": {"agent"},
    "conversation.recommend": {"agent"},
    "sttm.auto_map": {"agent"},
    "sttm.transform": {"agent"},
    "sttm.chat": {"agent", "analyst"},
}


class ModelBoundaryGuard:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config

    def assert_model_target_allowed(
        self,
        *,
        operation: str,
        target: str,
        decision: GovernanceDecision,
    ) -> None:
        allowed = _MODEL_TARGETS.get(operation, {"agent"})
        if target not in allowed:
            decision.add_warning(
                "MODEL_TARGET_BLOCKED",
                f"Guardrails blocked target '{target}' for operation '{operation}'.",
            )
            raise AuthorizationError(
                f"Guardrails blocked target '{target}' for operation '{operation}'."
            )

    def guard_sql(self, sql_text: str | None, decision: GovernanceDecision) -> None:
        if not sql_text:
            return
        forbidden = find_forbidden_sql_tokens(sql_text, self._config.output.reject_sql_patterns)
        if not forbidden:
            return
        decision.require_approval("unsafe_sql")
        decision.add_warning(
            "UNSAFE_SQL_ARTIFACT",
            f"Generated SQL contains restricted token(s): {', '.join(sorted(set(forbidden)))}.",
        )

    def merge_guardrail_meta(
        self,
        meta: dict[str, Any] | None,
        decision: GovernanceDecision,
        *,
        target: str,
    ) -> dict[str, Any]:
        merged = dict(meta or {})
        guardrails_meta = dict(merged.get("guardrails") or {})
        guardrails_meta.update(
            {
                "trace_id": decision.trace_id,
                "request_id": decision.request_id,
                "persona": decision.persona,
                "model_target": target,
                "redaction_count": decision.redaction_count,
                "detected_pii": sorted(set(decision.detected_pii)),
                "trust_labels": decision.trust.labels(),
                "approval": decision.approval.model_dump(mode="json"),
            }
        )
        merged["guardrails"] = guardrails_meta
        return merged
