from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schema.workspace_context import WorkbenchContextSnapshotV1


PreparedContextStatus = Literal["ready", "updating", "partial", "failed"]


class PreparedWorkspaceContextRequest(BaseModel):
    workspace: WorkbenchContextSnapshotV1
    workspace_context_id: str | None = None
    workspace_context_hash: str | None = None
    semantic_bundle_id: str | None = None
    semantic_bundle_hash: str | None = None
    learning_context_id: str | None = None
    learning_context_hash: str | None = None
    semantic_registry_version: str | None = None
    fir_epoch: str | None = None
    precedent_version: str | None = None
    correction_version: str | None = None
    force: bool = False


class PreparedWorkspaceContextResponse(BaseModel):
    workspace_context_id: str
    workspace_context_hash: str
    workspace_version: str
    semantic_bundle_id: str | None = None
    semantic_bundle_hash: str | None = None
    semantic_registry_version: str | None = None
    semantic_projection_ids: list[str] = Field(default_factory=list)
    learning_context_id: str | None = None
    learning_context_hash: str | None = None
    fir_epoch: str | None = None
    precedent_version: str | None = None
    correction_version: str | None = None
    artifact_refs: list[dict[str, Any]] = Field(default_factory=list)
    status: PreparedContextStatus = "ready"
    cache_status: str = "miss"
    cache_persisted: bool | None = None
    dependency_fingerprint: str | None = None
    readiness: dict[str, bool] = Field(default_factory=dict)
    stage_timings_ms: dict[str, float] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None
