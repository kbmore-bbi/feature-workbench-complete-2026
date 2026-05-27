from __future__ import annotations

from typing import Any

from app.guardrails.config.schema import GuardrailsConfig
from app.guardrails.contracts.decisions import GovernanceDecision


class GroundingValidator:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config

    def inspect(
        self,
        *,
        operation: str,
        citations: list[dict[str, Any]] | None,
        decision: GovernanceDecision,
    ) -> str:
        requires_citations = operation in self._config.grounding_policy.require_citations_for
        citation_count = len(citations or [])
        if requires_citations and citation_count == 0:
            decision.add_warning(
                "GROUNDING_EVIDENCE_MISSING",
                f"Operation '{operation}' requires grounded evidence before leaving the app.",
            )
            if not self._config.grounding_policy.allow_best_effort_without_citations:
                decision.require_approval("insufficient_evidence")
                return "insufficient_evidence"
        return "grounded" if citation_count else "best_effort"
