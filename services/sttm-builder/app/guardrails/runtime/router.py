from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.guardrails.config.schema import GuardrailsConfig
from app.guardrails.policies.intent_policy import IntentPolicy


@dataclass(slots=True)
class RouteDecision:
    route: str
    intent_class: str
    target_agent: str | None
    reason: str


class DeterministicRouter:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config
        self._intent = IntentPolicy(config)

    def decide(
        self,
        *,
        operation: str,
        payload: dict[str, Any],
        surface: str | None = None,
    ) -> RouteDecision:
        data = payload.get("data") or {}
        message = data.get("message") if isinstance(data, dict) else None
        resolved = self._intent.resolve(operation=operation, message=message, surface=surface)

        if operation.startswith("sttm.") or operation == "conversation.handoff.sttm":
            return RouteDecision(
                route="sttm_builder",
                intent_class="sttm_handoff" if operation == "conversation.handoff.sttm" else resolved.intent_class,
                target_agent=self._config.routes.get("sttm_builder", None).default_agent if self._config.routes.get("sttm_builder") else "sttm_builder",
                reason=resolved.reason,
            )
        if resolved.intent_class == "sttm_handoff":
            return RouteDecision(
                route="sttm_builder",
                intent_class=resolved.intent_class,
                target_agent=self._config.routes.get("sttm_builder", None).default_agent if self._config.routes.get("sttm_builder") else "sttm_builder",
                reason=resolved.reason,
            )
        return RouteDecision(
            route="conversation",
            intent_class=resolved.intent_class,
            target_agent=self._config.routes.get("conversation", None).default_agent if self._config.routes.get("conversation") else "workbench_conversation",
            reason=resolved.reason,
        )
