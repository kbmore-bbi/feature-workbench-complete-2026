from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class ApprovalStatus(str, Enum):
    NOT_REQUIRED = "not_required"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ApprovalDecision(BaseModel):
    status: ApprovalStatus = ApprovalStatus.NOT_REQUIRED
    reason_codes: list[str] = Field(default_factory=list)
    reviewer_role: str | None = None

    def require(self, *codes: str) -> None:
        self.status = ApprovalStatus.PENDING
        for code in codes:
            if code and code not in self.reason_codes:
                self.reason_codes.append(code)
