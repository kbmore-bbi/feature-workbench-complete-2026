from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schema.common import TableRef
from app.schema.workspace_context import WorkbenchContextSnapshotV1


ProjectStatus = Literal["ACTIVE", "ARCHIVED"]
STTMStatus = Literal[
    "DRAFT",
    "IMPORTING",
    "IMPORT_FAILED",
    "IN_PROGRESS",
    "COMPLETE",
    "SUPERSEDED",
]


class ProjectPrecedentLinkInput(BaseModel):
    precedent_project_id: str = Field(min_length=1)
    priority: int = Field(default=50, ge=0, le=100)
    knowledge_categories: list[str] = Field(default_factory=list)
    allow_project_specific_values: bool = False


class MappingPrecedentLinkInput(BaseModel):
    precedent_sttm_id: str = Field(min_length=1)
    priority: int = Field(default=75, ge=0, le=100)
    knowledge_categories: list[str] = Field(default_factory=list)
    target_compatibility: str | None = None
    mapping_lifecycle: str | None = None
    purpose: str | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    allow_project_specific_values: bool = False


class ProjectPrecedentLinkRecord(ProjectPrecedentLinkInput):
    project_link_id: str
    project_id: str
    status: str = "active"
    precedent_project_name: str | None = None
    created_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MappingPrecedentLinkRecord(MappingPrecedentLinkInput):
    mapping_link_id: str
    sttm_id: str
    status: str = "active"
    precedent_project_id: str | None = None
    precedent_sttm_name: str | None = None
    precedent_target_table: str | None = None
    precedent_status: str | None = None
    created_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ProjectPrecedentLinksUpdate(BaseModel):
    links: list[ProjectPrecedentLinkInput] = Field(default_factory=list)


class MappingPrecedentLinksUpdate(BaseModel):
    links: list[MappingPrecedentLinkInput] = Field(default_factory=list)


class ProjectCreateRequest(BaseModel):
    project_name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    status: ProjectStatus = "ACTIVE"
    metadata: dict[str, Any] = Field(default_factory=dict)
    precedent_links: list[ProjectPrecedentLinkInput] = Field(default_factory=list)


class ProjectRecord(BaseModel):
    project_id: str
    project_name: str
    description: str | None = None
    status: str = "ACTIVE"
    created_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    sttm_count: int = 0
    complete_count: int = 0
    partial_count: int = 0
    draft_count: int = 0
    total_mappings: int = 0
    mapped_count: int = 0
    coverage_percent: float = 0
    metadata: dict[str, Any] = Field(default_factory=dict)
    linked_project_ids: list[str] = Field(default_factory=list)


class STTMCreateRequest(BaseModel):
    sttm_name: str | None = None
    description: str | None = None
    target_table: TableRef | None = None
    workspace_snapshot: WorkbenchContextSnapshotV1 | dict[str, Any] | None = None
    semantic_bundle_id: str | None = None
    semantic_bundle_hash: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    precedent_links: list[MappingPrecedentLinkInput] = Field(default_factory=list)


class STTMRecord(BaseModel):
    sttm_id: str
    project_id: str
    sttm_name: str | None = None
    description: str | None = None
    target_table: str | None = None
    current_version: int = 0
    has_unpublished_draft: bool = False
    status: str = "DRAFT"
    semantic_bundle_id: str | None = None
    semantic_bundle_hash: str | None = None
    last_snapshot_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    mapping_count: int = 0
    mapped_count: int = 0
    coverage_percent: float = 0
    metadata: dict[str, Any] = Field(default_factory=dict)
    linked_mapping_ids: list[str] = Field(default_factory=list)


class STTMAutosaveRequest(BaseModel):
    workspace_snapshot: WorkbenchContextSnapshotV1 | dict[str, Any]
    action: str = Field(
        default="workspace.autosaved",
        description=(
            "Optional action/event name such as mapping.accepted, mapping.rejected, "
            "mapping.edited, derived_source.saved, sql.validation_passed, or sql.validation_failed."
        ),
    )
    session_id: str | None = None
    thread_id: str | None = None
    semantic_bundle_id: str | None = None
    semantic_bundle_hash: str | None = None
    mapping_version: str | None = None
    agent_artifacts: list[dict[str, Any]] = Field(default_factory=list)
    fir_events: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class STTMAutosaveResponse(BaseModel):
    project_id: str
    sttm_id: str
    snapshot_id: str
    saved_source_count: int = 0
    saved_mapping_row_count: int = 0
    recorded_artifact_count: int = 0
    recorded_fir_event_count: int = 0
    semantic_bundle_id: str | None = None
    semantic_bundle_hash: str | None = None
    has_unpublished_draft: bool = True


class STTMPublishRequest(BaseModel):
    revision_note: str | None = None
    workspace_snapshot: WorkbenchContextSnapshotV1 | dict[str, Any] | None = None
    session_id: str | None = None
    thread_id: str | None = None
    semantic_bundle_id: str | None = None
    semantic_bundle_hash: str | None = None
    mapping_version: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class STTMPublishResponse(BaseModel):
    project_id: str
    sttm_id: str
    version_id: str
    version_number: int
    snapshot_id: str | None = None
    status: str
    semantic_bundle_id: str | None = None
    semantic_bundle_hash: str | None = None


class STTMDetailResponse(BaseModel):
    project: ProjectRecord | None = None
    sttm: STTMRecord
    latest_snapshot: dict[str, Any] | None = None
    sources: list[dict[str, Any]] = Field(default_factory=list)
    mapping_rows: list[dict[str, Any]] = Field(default_factory=list)
    versions: list[dict[str, Any]] = Field(default_factory=list)
    agent_artifacts: list[dict[str, Any]] = Field(default_factory=list)


class ProjectsSummaryResponse(BaseModel):
    """All projects and all STTMs returned in a single response to avoid N+1 fetching."""

    projects: list[ProjectRecord] = Field(default_factory=list)
    sttms: list[STTMRecord] = Field(default_factory=list)
