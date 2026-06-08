from __future__ import annotations

from typing import Any

from app.core.exceptions import AuthorizationError
from app.guardrails.config.schema import GuardrailsConfig


class BusinessRules:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config

    def validate_feedback(self, payload: dict[str, Any]) -> None:
        feedback = payload.get("feedback") or {}
        rating = feedback.get("rating")
        category = str(feedback.get("category") or "").strip().lower()
        policy = self._config.feedback_policy
        if category and category not in policy.allowed_categories:
            raise AuthorizationError(f"Feedback category '{category}' is not allowed.")
        if rating is not None and not (policy.min_rating <= int(rating) <= policy.max_rating):
            raise AuthorizationError(
                f"Feedback rating must be between {policy.min_rating} and {policy.max_rating}."
            )

    @staticmethod
    def validate_handoff_payload(payload: dict[str, Any]) -> None:
        handoff = payload.get("handoff_request")
        if handoff is None:
            raise AuthorizationError("conversation.handoff.sttm requires a handoff_request payload.")
