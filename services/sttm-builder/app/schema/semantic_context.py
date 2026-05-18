from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from app.schema.common import TableRef


class SemanticLevel(str, Enum):
    L0_RELATIONSHIP = "L0_RELATIONSHIP"
    L1_CONTEXT = "L1_CONTEXT"
    L2_ANALYST_READY = "L2_ANALYST_READY"
    L3_MAPPING_ENRICHED = "L3_MAPPING_ENRICHED"


class SemanticSurface(str, Enum):
    SOURCE_SELECTION = "SOURCE_SELECTION"
    DERIVED_SOURCE = "DERIVED_SOURCE"
    MAPPING = "MAPPING"


class SemanticBundleStatus(str, Enum):
    READY = "ready"
    REFRESHED = "refreshed"
    PROMOTED = "promoted"
    PARTIAL = "partial"
    FAILED = "failed"


class SemanticBundleLineage(BaseModel):
    derived_source_id: str
    derived_source_name: str | None = None
    parent_derived_source_ids: list[str] = Field(default_factory=list)
    base_source_tables: list[TableRef] = Field(default_factory=list)
    lineage_depth: int = 0
    upstream_hash: str | None = None


class SemanticRefreshStatus(BaseModel):
    bundle_id: str
    bundle_hash: str
    bundle_label: str | None = None
    requested_level: SemanticLevel
    achieved_level: SemanticLevel
    status: SemanticBundleStatus
    semantic_view_name: str | None = None
    promoted: bool = False
    cache_hit: bool = False
    stale_reason: str | None = None


class SemanticContextSummary(BaseModel):
    bundle_id: str
    bundle_hash: str
    bundle_label: str | None = None
    source_table_count: int
    derived_source_count: int
    relationship_count: int
    semantic_level: SemanticLevel
    semantic_view_name: str | None = None
    promoted: bool = False
    tables: list[str] = Field(default_factory=list)
    derived_sources: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class SemanticContextRefreshRequest(BaseModel):
    selected_source_tables: list[TableRef] = Field(default_factory=list)
    selected_derived_sources: list[str] = Field(default_factory=list)
    target_table: TableRef | None = None
    relationships: list[dict[str, Any]] = Field(default_factory=list)
    requested_level: SemanticLevel = SemanticLevel.L1_CONTEXT
    force: bool = False


class SemanticContextBundleResponse(BaseModel):
    bundle_id: str
    bundle_hash: str
    bundle_label: str | None = None
    requested_level: SemanticLevel
    achieved_level: SemanticLevel
    semantic_view_name: str | None = None
    status: SemanticBundleStatus
    promoted: bool = False
    cache_hit: bool = False
    summary: SemanticContextSummary
    lineage: list[SemanticBundleLineage] = Field(default_factory=list)
    semantic_context: list[dict[str, Any]] = Field(default_factory=list)
    datahub_context: dict[str, Any] | None = None
