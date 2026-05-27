from __future__ import annotations

from typing import Any

from app.guardrails.config.schema import GuardrailsConfig
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.policies.operation_policy import find_forbidden_sql_tokens
from app.guardrails.policies.redaction import Redactor


class OutputValidator:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config
        self._redactor = Redactor(config.redaction)

    def inspect_text(self, text: str | None, decision: GovernanceDecision, *, field: str) -> str | None:
        if not text:
            return text
        result = self._redactor.redact_text(text)
        if result.redaction_count:
            decision.redaction_count += result.redaction_count
            decision.detected_pii.extend(result.detected_pii)
            decision.add_warning(
                "RESPONSE_PII_DETECTED",
                f"Potential PII was detected in {field}.",
                field=field,
            )
            if self._config.output.reject_if_contains_raw_pii:
                return result.value
        return result.value if self._config.output.reject_if_contains_raw_pii else text

    def inspect_artifact(self, artifact: dict[str, Any] | None, decision: GovernanceDecision) -> dict[str, Any] | None:
        if artifact is None:
            return artifact
        sanitized = dict(artifact)
        for text_key in ("answer_text", "sql_text"):
            if isinstance(sanitized.get(text_key), str):
                sanitized[text_key] = self.inspect_text(
                    sanitized[text_key],
                    decision,
                    field=f"artifact.{text_key}",
                )
        sql_text = sanitized.get("sql_text")
        if isinstance(sql_text, str):
            forbidden = find_forbidden_sql_tokens(sql_text, self._config.output.reject_sql_patterns)
            if forbidden:
                decision.require_approval("unsafe_sql")
                decision.add_warning(
                    "UNSAFE_SQL_ARTIFACT",
                    f"Generated SQL contains restricted token(s): {', '.join(sorted(set(forbidden)))}.",
                    field="artifact.sql_text",
                )
        return sanitized
