from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


ClientMessageType = Literal[
    "session.start",
    "message.send",
    "permission.decide",
    "question.answer",
    "plan.review",
    "session.cancel",
    "heartbeat",
]


class CocoClientFrame(BaseModel):
    contract_version: Literal["1.0"] = "1.0"
    type: ClientMessageType
    session_id: str | None = None
    request_id: str = Field(default_factory=lambda: str(uuid4()))
    event_id: str = Field(default_factory=lambda: str(uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    context_hash: str = ""
    data: dict[str, Any] = Field(default_factory=dict)


class CocoServerFrame(BaseModel):
    contract_version: Literal["1.0"] = "1.0"
    type: str
    session_id: str
    request_id: str
    event_id: str = Field(default_factory=lambda: str(uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    context_hash: str = ""
    data: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class PermissionDecision(BaseModel):
    permission_id: str
    decision: Literal[
        "allow_once",
        "allow_session",
        "deny",
        "deny_with_feedback",
        "cancel",
    ]
    feedback: str = ""
    normalized_resource_pattern: str | None = None


class QuestionAnswer(BaseModel):
    permission_id: str
    answers: dict[str, str]


class PlanReview(BaseModel):
    permission_id: str
    decision: Literal["approve", "request_changes", "cancel"]
    feedback: str = ""
