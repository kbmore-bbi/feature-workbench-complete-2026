from __future__ import annotations

from dataclasses import dataclass

from app.guardrails.config.schema import GuardrailsConfig


@dataclass(slots=True)
class IntentResolution:
    intent_class: str
    reason: str


class IntentPolicy:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config

    def resolve(self, *, operation: str, message: str | None, surface: str | None) -> IntentResolution:
        lowered = (message or "").strip().lower()
        surface_value = (surface or "").strip().upper()
        if operation == "conversation.feedback":
            return IntentResolution(intent_class="feedback_capture", reason="operation")
        if operation == "conversation.recommend":
            return IntentResolution(intent_class="recommendation", reason="operation")
        if operation == "conversation.handoff.sttm":
            return IntentResolution(intent_class="sttm_handoff", reason="operation")

        if surface_value in {"MAPPING", "DERIVED_SOURCE"}:
            return IntentResolution(intent_class="sttm_handoff", reason="surface")

        if any(keyword in lowered for keyword in self._config.intent.feedback_keywords):
            return IntentResolution(intent_class="feedback_capture", reason="keyword")
        if any(keyword in lowered for keyword in self._config.intent.recommendation_keywords):
            return IntentResolution(intent_class="recommendation", reason="keyword")
        if any(keyword in lowered for keyword in self._config.intent.sttm_keywords):
            return IntentResolution(intent_class="sttm_handoff", reason="keyword")
        if lowered:
            return IntentResolution(intent_class="quick_answer", reason="default")
        return IntentResolution(intent_class="clarification", reason="empty")
