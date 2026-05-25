from __future__ import annotations

from typing import Any

from app.guardrails.config.schema import GuardrailsConfig
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.observability.audit_log import AsyncAuditLogger
from app.guardrails.runtime.output_validator import OutputValidator
from app.schema.contracts import ApiWarning


class PostflightGuard:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config
        self._validator = OutputValidator(config)
        self._audit = AsyncAuditLogger()

    def finalize_sttm_response(self, response: Any, decision: GovernanceDecision) -> Any:
        if hasattr(response, "message") and (
            isinstance(response.message, str) or response.message is None
        ):
            response.message = self._validator.inspect_text(response.message, decision, field="message")

        if hasattr(response, "data") and response.data is not None:
            response.data.message = self._validator.inspect_text(
                response.data.message,
                decision,
                field="data.message",
            )
            response.data.artifact = self._validator.inspect_artifact(response.data.artifact, decision)

        if hasattr(response, "warnings"):
            existing = list(getattr(response, "warnings") or [])
            existing_codes = {
                item.code
                for item in existing
                if hasattr(item, "code")
            }
            existing.extend(
                ApiWarning(code=warning.code, message=warning.message, field=warning.field)
                for warning in decision.warnings
                if warning.code not in existing_codes
            )
            response.warnings = existing

        meta = dict(getattr(response, "meta", {}) or {})
        guardrails_meta = dict(meta.get("guardrails") or {})
        guardrails_meta.update(
            {
                "trace_id": decision.trace_id,
                "request_id": decision.request_id,
                "persona": decision.persona,
                "approval_required": decision.approval_required,
                "redaction_count": decision.redaction_count,
                "detected_pii": sorted(set(decision.detected_pii)),
            }
        )
        meta["guardrails"] = guardrails_meta
        response.meta = meta

        self._audit.emit(
            decision=decision,
            payload={
                "status": getattr(getattr(response, "data", None), "status", None),
                "artifact_type": getattr(getattr(response, "data", None), "artifact_type", None),
            },
        )
        return response

    def augment_response_envelope(self, envelope: Any, decision: GovernanceDecision) -> Any:
        meta = dict(getattr(envelope, "meta", {}) or {})
        guardrails_meta = dict(meta.get("guardrails") or {})
        guardrails_meta.update(
            {
                "trace_id": decision.trace_id,
                "request_id": decision.request_id,
                "persona": decision.persona,
            }
        )
        meta["guardrails"] = guardrails_meta
        envelope.meta = meta
        return envelope
