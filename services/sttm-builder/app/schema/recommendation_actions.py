from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


RecommendationActionKind = Literal[
    "add_source_table",
    "select_source_column",
    "bind_value",
    "apply_direct_mapping",
    "apply_transformation",
    "add_relationship",
    "upsert_derived_source",
    "open_source_preparation",
    "apply_sql_repair",
]


class ApplicableRecommendation(BaseModel):
    recommendation_id: str
    recommendation_version: int = 1
    workflow_stage: str | None = None
    target_entity: dict[str, Any] = Field(default_factory=dict)
    title: str
    business_rationale: str | None = None
    confidence: float | None = None
    compatibility_tier: int | None = None
    candidate_sources: list[dict[str, Any]] = Field(default_factory=list)
    missing_dependencies: list[str] = Field(default_factory=list)
    evidence_summary: str | None = None
    action_kind: RecommendationActionKind | None = None
    action_payload: dict[str, Any] = Field(default_factory=dict)
    preconditions: list[dict[str, Any]] = Field(default_factory=list)
    expected_workspace_hash: str | None = None
    requires_confirmation: bool = False
    can_apply: bool = False
    blocked_reasons: list[str] = Field(default_factory=list)
    validation_plan: list[str] = Field(default_factory=list)


class RecommendationPreviewRequest(BaseModel):
    sttm_id: str = Field(min_length=1)
    workspace_snapshot: dict[str, Any]
    expected_workspace_hash: str = Field(min_length=1)
    action_id: str | None = None


class RecommendationApplyRequest(RecommendationPreviewRequest):
    idempotency_key: str = Field(min_length=8, max_length=200)
    confirmed: bool = False


class RecommendationUndoRequest(BaseModel):
    sttm_id: str = Field(min_length=1)
    action_history_id: str = Field(min_length=1)
    expected_workspace_hash: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=8, max_length=200)


class RecommendationFeedbackRequest(BaseModel):
    outcome: Literal["accepted", "rejected", "corrected"]
    sttm_id: str | None = None
    context_key: str | None = None
    snapshot_id: str | None = None
    idempotency_key: str = Field(min_length=8, max_length=200)
    reason: str | None = None
    correction: dict[str, Any] | None = None


class WorkspaceDiffOperation(BaseModel):
    op: Literal["add", "remove", "replace"]
    path: str
    before: Any = None
    after: Any = None


class RecommendationPreviewResponse(BaseModel):
    recommendation: ApplicableRecommendation
    before_workspace_hash: str
    after_workspace_hash: str
    workspace_diff: list[WorkspaceDiffOperation] = Field(default_factory=list)
    validation_impact: list[str] = Field(default_factory=list)
    can_apply: bool
    blocked_reasons: list[str] = Field(default_factory=list)


class RecommendationApplyResponse(RecommendationPreviewResponse):
    status: Literal["applied", "already_applied", "no_change"]
    action_history_id: str
    snapshot_id: str | None = None


class RecommendationUndoResponse(BaseModel):
    status: Literal["undone", "already_undone"]
    action_history_id: str
    workspace_hash: str
    snapshot_id: str | None = None
