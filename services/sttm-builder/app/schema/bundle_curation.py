from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class BundleCurationPromotionRequest(BaseModel):
    expected_workspace_hash: str = ""
    expected_bundle_hash: str = ""
    approved_recommendation_ids: list[str] = Field(default_factory=list)
    approve_all_validated: bool = False
    confirmed: bool = False


class BundleCurationRecord(BaseModel):
    bundle_version_id: str
    semantic_bundle_id: str | None = None
    base_bundle_hash: str | None = None
    version_number: int = 1
    sql_asset_id: str | None = None
    project_id: str | None = None
    sttm_id: str | None = None
    workspace_context_key: str | None = None
    workspace_context_hash: str | None = None
    knowledge_graph: dict[str, Any] = Field(default_factory=dict)
    mapping_semantics: list[dict[str, Any]] = Field(default_factory=list)
    findings: list[dict[str, Any]] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    validation_summary: dict[str, Any] = Field(default_factory=dict)
    status: str = "draft"
    recommendations: list[dict[str, Any]] = Field(default_factory=list)


class BundleCurationPreview(BaseModel):
    curation: BundleCurationRecord
    eligible_recommendation_ids: list[str] = Field(default_factory=list)
    blocked_recommendations: list[dict[str, Any]] = Field(default_factory=list)
    can_promote: bool = False


class BundleCurationPromotionResponse(BaseModel):
    status: str
    bundle_version_id: str
    semantic_bundle_id: str | None = None
    promoted_recommendation_ids: list[str] = Field(default_factory=list)
    derived_source_recommendation_ids: list[str] = Field(default_factory=list)
