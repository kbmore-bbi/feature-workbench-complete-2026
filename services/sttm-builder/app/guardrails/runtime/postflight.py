from __future__ import annotations

from typing import Any

from app.guardrails.config.schema import GuardrailsConfig
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.observability.audit_log import AsyncAuditLogger
from app.guardrails.runtime.grounding_validator import GroundingValidator
from app.guardrails.runtime.output_validator import OutputValidator
from app.guardrails.runtime.toxicity_validator import ToxicityValidator
from app.schema.contracts import ApiWarning


class PostflightGuard:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config
        self._validator = OutputValidator(config)
        self._audit = AsyncAuditLogger()
        self._grounding = GroundingValidator(config)
        self._toxicity = ToxicityValidator(config)

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

        self._merge_warnings(response, decision)
        response.meta = self._merge_meta(dict(getattr(response, "meta", {}) or {}), decision)

        self._audit.emit(
            decision=decision,
            payload={
                "status": getattr(getattr(response, "data", None), "status", None),
                "artifact_type": getattr(getattr(response, "data", None), "artifact_type", None),
            },
        )
        return response

    def finalize_conversation_envelope(self, envelope: Any, decision: GovernanceDecision) -> Any:
        data = getattr(envelope, "data", None)
        if data is not None and hasattr(data, "message"):
            text = self._validator.inspect_text(data.message, decision, field="data.message")
            text, toxicity_status = self._toxicity.inspect(text, decision)
            data.message = text
            citations = getattr(data, "citations", None)
            grounding_status = self._grounding.inspect(
                operation=getattr(envelope, "operation", decision.operation or ""),
                citations=[item.model_dump(mode="json") if hasattr(item, "model_dump") else dict(item) for item in (citations or [])],
                decision=decision,
            )
            data.approval_required = decision.approval_required
            envelope.data = data
            meta = dict(getattr(envelope, "meta", {}) or {})
            guardrails_meta = dict(meta.get("guardrails") or {})
            guardrails_meta.update(
                {
                    "toxicity_status": toxicity_status,
                    "grounding_status": grounding_status,
                }
            )
            meta["guardrails"] = guardrails_meta
            envelope.meta = meta

        self._merge_warnings(envelope, decision)
        envelope.meta = self._merge_meta(dict(getattr(envelope, "meta", {}) or {}), decision)
        self._audit.emit(
            decision=decision,
            payload={
                "status": getattr(getattr(envelope, "data", None), "status", None),
                "route": getattr(getattr(envelope, "data", None), "route", None),
            },
        )
        return envelope

    def augment_response_envelope(self, envelope: Any, decision: GovernanceDecision) -> Any:
        envelope.meta = self._merge_meta(dict(getattr(envelope, "meta", {}) or {}), decision)
        return envelope

    @staticmethod
    def _merge_warnings(response: Any, decision: GovernanceDecision) -> None:
        if not hasattr(response, "warnings"):
            return
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

    @staticmethod
    def _merge_meta(meta: dict[str, Any], decision: GovernanceDecision) -> dict[str, Any]:
        guardrails_meta = dict(meta.get("guardrails") or {})
        guardrails_meta.update(
            {
                "trace_id": decision.trace_id,
                "request_id": decision.request_id,
                "persona": decision.persona,
                "approval_required": decision.approval_required,
                "approval": decision.approval.model_dump(mode="json"),
                "redaction_count": decision.redaction_count,
                "detected_pii": sorted(set(decision.detected_pii)),
                "trust_labels": decision.trust.labels(),
            }
        )
        meta["guardrails"] = guardrails_meta
        return meta
