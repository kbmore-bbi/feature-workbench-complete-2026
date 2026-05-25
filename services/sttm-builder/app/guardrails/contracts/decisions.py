from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class GovernanceWarning(BaseModel):
    code: str
    message: str
    field: str | None = None


class GovernanceDecision(BaseModel):
    trace_id: str
    request_id: str | None = None
    operation: str | None = None
    persona: str | None = None
    policy_name: str = "default"
    allowed: bool = True
    approval_required: bool = False
    redaction_count: int = 0
    detected_pii: list[str] = Field(default_factory=list)
    warnings: list[GovernanceWarning] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)

    def add_warning(self, code: str, message: str, *, field: str | None = None) -> None:
        self.warnings.append(GovernanceWarning(code=code, message=message, field=field))

    def merge_meta(self, **values: Any) -> None:
        self.meta.update(values)
