from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.guardrails.contracts.approval import ApprovalDecision
from app.guardrails.contracts.trust import TrustBundle


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
    approval: ApprovalDecision = Field(default_factory=ApprovalDecision)
    trust: TrustBundle = Field(default_factory=TrustBundle)

    def add_warning(self, code: str, message: str, *, field: str | None = None) -> None:
        self.warnings.append(GovernanceWarning(code=code, message=message, field=field))

    def merge_meta(self, **values: Any) -> None:
        self.meta.update(values)

    def require_approval(self, *codes: str) -> None:
        self.approval_required = True
        self.approval.require(*codes)
