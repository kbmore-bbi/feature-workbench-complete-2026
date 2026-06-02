from __future__ import annotations

from dataclasses import dataclass

from app.guardrails.config.schema import GuardrailsConfig


@dataclass(frozen=True)
class SafetySignal:
    status: str
    reasons: list[str]


class ContentSafetyAdapter:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config

    def inspect_text(self, text: str | None) -> SafetySignal:
        if not text:
            return SafetySignal(status="not_checked", reasons=[])
        if self._config.managed_safety.content_safety_provider == "azure":
            return SafetySignal(status="managed_not_configured", reasons=["azure_not_wired"])
        return SafetySignal(status="local_only", reasons=[])
