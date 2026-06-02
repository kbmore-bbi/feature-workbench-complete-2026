from __future__ import annotations

from app.guardrails.config.schema import GuardrailsConfig
from app.guardrails.contracts.decisions import GovernanceDecision


class ToxicityValidator:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config

    def inspect(self, text: str | None, decision: GovernanceDecision) -> tuple[str | None, str]:
        if not text or not self._config.toxicity_policy.enabled:
            return text, "not_checked"
        lowered = text.lower()
        matches = [
            term
            for term in self._config.toxicity_policy.block_terms
            if term and term.lower() in lowered
        ]
        if not matches:
            return text, "clean"
        decision.add_warning(
            "TOXICITY_FILTERED",
            "User-visible content matched the toxicity filter and was rewritten.",
        )
        if self._config.toxicity_policy.rewrite_on_match:
            return (
                "I can help with the task, but I can’t return harmful or abusive phrasing in the response.",
                "rewritten",
            )
        decision.require_approval("toxicity_match")
        return text, "approval_required"
