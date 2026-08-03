from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


PatternScope = Literal["client", "project", "mapping"]
PatternValidationStatus = Literal[
    "extracted", "enriched", "accepted", "validated", "published", "rejected"
]


class TargetMappingPatternV2(BaseModel):
    pattern_id: str
    scope: PatternScope = "client"
    project_id: str | None = None
    sttm_id: str | None = None
    target_contract: dict[str, Any]
    source_system_profile: dict[str, Any] = Field(default_factory=dict)
    source_compatibility_signature: str
    mapping_recipe: dict[str, Any]
    relationship_dependencies: list[dict[str, Any]] = Field(default_factory=list)
    derived_dependencies: list[dict[str, Any]] = Field(default_factory=list)
    query_shaping_dependencies: list[dict[str, Any]] = Field(default_factory=list)
    business_rationale: str | None = None
    applicability_conditions: list[str] = Field(default_factory=list)
    exclusions: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    support_count: int = 1
    contradiction_count: int = 0
    validation_status: PatternValidationStatus = "extracted"
    provenance: dict[str, Any] = Field(default_factory=dict)
    evidence_ids: list[str] = Field(default_factory=list)
    superseded_by: str | None = None
    content_hash: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TargetMappingPatternQuery(BaseModel):
    target_table: str | None = None
    target_columns: list[str] = Field(default_factory=list)
    source_tables: list[str] = Field(default_factory=list)
    source_columns: list[str] = Field(default_factory=list)
    source_column_profiles: list[dict[str, Any]] = Field(default_factory=list)
    crm_family: str | None = None
    relationship_paths: list[str] = Field(default_factory=list)
    derived_outputs: list[str] = Field(default_factory=list)
    workspace_context_id: str | None = None
    project_id: str | None = None
    limit: int = Field(default=100, ge=1, le=500)


class TargetMappingPatternCandidate(BaseModel):
    pattern: TargetMappingPatternV2
    compatibility_tier: int
    compatibility_score: float
    decision: Literal[
        "accept_exact_precedent", "adapt_pattern", "override_pattern", "unresolved"
    ]
    compatibility_reasons: list[str] = Field(default_factory=list)
    missing_dependencies: list[str] = Field(default_factory=list)
    adapted_source_columns: list[str] = Field(default_factory=list)
    compatibility_checks: dict[str, bool | None] = Field(default_factory=dict)
    prepare_source_action: dict[str, Any] | None = None


class FIRLearningJobResponse(BaseModel):
    learning_job_id: str
    status: str
    asset_id: str | None = None
    project_id: str | None = None
    discovered_pattern_count: int = 0
    completed_pattern_count: int = 0
    failed_pattern_count: int = 0
    stage: str | None = None
    progress: float = 0.0
    warnings: list[str] = Field(default_factory=list)
    work_items_by_status: dict[str, int] = Field(default_factory=dict)
    work_items_by_type: dict[str, dict[str, int]] = Field(default_factory=dict)
    target_column_progress: list[dict[str, Any]] = Field(default_factory=list)
