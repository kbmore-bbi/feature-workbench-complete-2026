from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from app.schema.common import TableRef


class SemanticLevel(str, Enum):
    """Semantic context depth levels.

    FULL_REGISTRY is the recommended default - it passes full semantic views
    from AGT_SEMANTIC_MODEL_V2 to agents with reading instructions.

    L0-L3 levels are deprecated but maintained for backward compatibility.
    """
    # New recommended default - full semantic views with reading instructions
    FULL_REGISTRY = "FULL_REGISTRY"

    # Legacy levels (deprecated - use FULL_REGISTRY instead)
    L0_RELATIONSHIP = "L0_RELATIONSHIP"  # Deprecated: relationships only
    L1_CONTEXT = "L1_CONTEXT"  # Deprecated: basic context
    L2_ANALYST_READY = "L2_ANALYST_READY"  # Deprecated: analyst-ready
    L3_MAPPING_ENRICHED = "L3_MAPPING_ENRICHED"  # Deprecated: full mapping enrichment


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


class SemanticProjectionProfile(str, Enum):
    CHAT_SUMMARY = "chat_summary"
    ANALYST_MODEL = "analyst_model"
    MAPPING_BATCH = "mapping_batch"
    TRANSFORMATION_ROW = "transformation_row"
    DERIVED_SOURCE = "derived_source"
    ADMIN_FULL = "admin_full"


class SemanticBundleLineage(BaseModel):
    derived_source_id: str
    derived_source_name: str | None = None
    parent_derived_source_ids: list[str] = Field(default_factory=list)
    base_source_tables: list[TableRef] = Field(default_factory=list)
    lineage_depth: int = 0
    upstream_hash: str | None = None


class SemanticRefreshStatus(BaseModel):
    bundle_id: str
    bundle_hash: str | None = None
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
    bundle_hash: str | None = None
    bundle_label: str | None = None
    source_table_count: int
    derived_source_count: int
    relationship_count: int
    semantic_level: SemanticLevel
    semantic_view_name: str | None = None
    semantic_model_yaml: str | None = None
    promoted: bool = False
    tables: list[str] = Field(default_factory=list)
    derived_sources: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    asset_versions: dict[str, str] = Field(default_factory=dict)
    composed_model_hash: str | None = None


class SemanticContextRefreshRequest(BaseModel):
    selected_source_tables: list[TableRef] = Field(default_factory=list)
    selected_derived_sources: list[str] = Field(default_factory=list)
    target_table: TableRef | None = None
    relationships: list[dict[str, Any]] = Field(default_factory=list)
    selected_columns_by_table: dict[str, list[str]] = Field(default_factory=dict)
    requested_level: SemanticLevel = SemanticLevel.FULL_REGISTRY
    force: bool = False


class SemanticReadingInstructions(BaseModel):
    """Instructions for agents on how to read and interpret semantic context.

    Provides structured guidance on:
    - Table roles (source vs target)
    - Recommended reading order
    - Key relationship paths
    - Confidence interpretation
    - Sample value and aggregate interpretation
    """
    table_roles: dict[str, str] = Field(
        default_factory=dict,
        description="Map of table qualified name to role: 'source', 'target', 'driving'",
    )
    reading_order: list[str] = Field(
        default_factory=list,
        description="Recommended order to read tables based on relationships",
    )
    key_relationships: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Critical relationship paths to understand for mapping",
    )
    confidence_guide: str = Field(
        default="",
        description="How to interpret confidence levels in semantic views",
    )
    interpretation_notes: list[str] = Field(
        default_factory=list,
        description="Additional notes for interpreting the semantic context",
    )


class SemanticContextBundleResponse(BaseModel):
    bundle_id: str
    bundle_hash: str | None = None
    bundle_label: str | None = None
    requested_level: SemanticLevel
    achieved_level: SemanticLevel
    semantic_view_name: str | None = None
    semantic_model_yaml: str | None = None
    status: SemanticBundleStatus
    promoted: bool = False
    cache_hit: bool = False
    cache_status: str = "miss"
    cache_age_ms: int | None = None
    registry_version: str | None = None
    raw_assets: list[dict[str, Any]] = Field(default_factory=list)
    composed_yaml: str | None = None
    derived_semantics: list[dict[str, Any]] = Field(default_factory=list)
    composition_diagnostics: list[dict[str, Any]] = Field(default_factory=list)
    stage_timings_ms: dict[str, float] = Field(default_factory=dict)
    summary: SemanticContextSummary
    lineage: list[SemanticBundleLineage] = Field(default_factory=list)
    semantic_context: list[dict[str, Any]] = Field(default_factory=list)
    excluded_relationships: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Relationships retained for mapping/FIR context but omitted from Cortex Analyst YAML.",
    )
    warnings: list[str] = Field(default_factory=list)
    datahub_context: dict[str, Any] | None = None
    reading_instructions: SemanticReadingInstructions | None = Field(
        default=None,
        description="Instructions for agents on how to read semantic context (FULL_REGISTRY level)",
    )


class SemanticProjectionRequest(BaseModel):
    bundle_id: str | None = None
    bundle_hash: str | None = None
    profile: SemanticProjectionProfile
    target_columns: list[str] = Field(default_factory=list)
    source_columns_by_table: dict[str, list[str]] = Field(default_factory=dict)
    mapping_row: dict[str, Any] | None = None
    include_full_semantics: bool = False
    force: bool = False


class SemanticProjectionResponse(BaseModel):
    projection_id: str
    projection_key: str
    projection_profile: SemanticProjectionProfile
    semantic_bundle_id: str | None = None
    bundle_hash: str | None = None
    projection_hash: str
    cache_hit: bool = False
    payload: dict[str, Any]
