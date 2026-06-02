from __future__ import annotations

from pydantic import BaseModel

from app.guardrails.config.schema import GuardrailsConfig
from app.guardrails.policies.operation_policy import is_operation_allowed


class ResolvedPolicy(BaseModel):
    persona: str
    allowed_operations: list[str]
    allow_sample_rows: bool = False
    allow_raw_pii: bool = False

    def allows_operation(self, operation: str) -> bool:
        return is_operation_allowed(self.allowed_operations, operation)


class PolicyResolver:
    def __init__(self, config: GuardrailsConfig) -> None:
        self._config = config

    def resolve(self, persona: str | None) -> ResolvedPolicy:
        key = (persona or "VIEWER").upper()
        resolved = self._config.personas.get(key)
        if resolved is None:
            resolved = self._config.personas.get("VIEWER")
        if resolved is None:
            return ResolvedPolicy(persona=key, allowed_operations=["*"])
        return ResolvedPolicy(persona=key, **resolved.model_dump())
