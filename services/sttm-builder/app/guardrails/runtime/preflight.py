from __future__ import annotations

from typing import Any

from app.core.exceptions import AuthorizationError
from app.guardrails.adapters.snowflake import strip_sample_data
from app.guardrails.config.schema import GuardrailsConfig
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.policies.redaction import Redactor
from app.guardrails.policies.resolver import PolicyResolver


class PreflightGuard:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config
        self._policies = PolicyResolver(config)
        self._redactor = Redactor(config.redaction)

    def apply_to_sttm_request(
        self,
        payload: dict[str, Any],
        *,
        trace_id: str,
        persona: str | None,
    ) -> tuple[dict[str, Any], GovernanceDecision]:
        decision = GovernanceDecision(
            trace_id=trace_id,
            request_id=payload.get("request_id"),
            operation=payload.get("operation"),
            persona=(persona or "VIEWER").upper(),
        )
        policy = self._policies.resolve(persona)
        decision.merge_meta(policy=policy.model_dump())

        operation = str(payload.get("operation") or "")
        if not policy.allows_operation(operation):
            decision.allowed = False
            decision.add_warning(
                "OPERATION_BLOCKED",
                f"Operation '{operation}' is not allowed for persona {policy.persona}.",
            )
            raise AuthorizationError(f"Operation '{operation}' is not allowed for persona {policy.persona}.")

        sanitized = payload.copy()
        context = dict(sanitized.get("context") or {})
        data = dict(sanitized.get("data") or {})

        context["trace_id"] = trace_id

        data_result = self._redactor.redact_value(data, path=("data",))
        sanitized["data"] = data_result.value
        decision.redaction_count += data_result.redaction_count
        decision.detected_pii.extend(data_result.detected_pii)

        if not policy.allow_sample_rows:
            context = strip_sample_data(context)
            decision.add_warning(
                "SAMPLE_ROWS_STRIPPED",
                "Sample values and preview rows were removed before the model call.",
            )

        context_result = self._redactor.redact_value(context, path=("context",))
        sanitized["context"] = context_result.value
        decision.redaction_count += context_result.redaction_count
        decision.detected_pii.extend(context_result.detected_pii)

        if decision.redaction_count:
            decision.add_warning(
                "SENSITIVE_CONTEXT_REDACTED",
                "Sensitive values were redacted before the model call.",
            )

        sanitized_meta = dict(sanitized.get("meta") or {})
        sanitized_meta["guardrails"] = {
            "trace_id": trace_id,
            "persona": policy.persona,
            "policy": policy.model_dump(),
            "redaction_count": decision.redaction_count,
            "detected_pii": sorted(set(decision.detected_pii)),
        }
        sanitized["meta"] = sanitized_meta
        return sanitized, decision
