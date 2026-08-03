from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator

from app.schema.common import TableRef


WORKBENCH_CONTEXT_VERSION = "2.0"
SUPPORTED_WORKBENCH_CONTEXT_VERSIONS = {"1.0", "2.0"}
WORKBENCH_SCOPE_TYPES = {
    "project",
    "schema",
    "table",
    "table_set",
    "target",
    "mapping",
    "column",
    "derived_source",
}


def _stable_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _table_fqn(value: TableRef | dict[str, Any] | str | None) -> str:
    if isinstance(value, TableRef):
        return value.qualified_name.upper()
    if isinstance(value, dict):
        qualified_name = (
            value.get("qualifiedName")
            or value.get("qualified_name")
            or value.get("fqn")
        )
        if qualified_name:
            return str(qualified_name).strip().upper()
        database = str(
            value.get("database")
            or value.get("database_name")
            or ""
        ).strip()
        schema = str(
            value.get("schema")
            or value.get("schema_name")
            or ""
        ).strip()
        table = str(
            value.get("table")
            or value.get("table_name")
            or value.get("name")
            or ""
        ).strip()
        return ".".join(part for part in (database, schema, table) if part).upper()
    return str(value or "").strip().upper()


def build_workbench_context_key(
    *,
    project_id: str | None,
    sttm_id: str | None = None,
    source_tables: list[TableRef | dict[str, Any] | str] | None,
    target_table: TableRef | dict[str, Any] | str | None,
    derived_source_ids: list[str] | None,
    selected_columns_by_table: dict[str, list[str]] | None,
    mapping_lifecycle: str | None,
    milestone: str | None,
) -> str:
    selected_columns = {
        str(table).upper(): sorted({str(column).upper() for column in columns})
        for table, columns in sorted((selected_columns_by_table or {}).items())
    }
    identity = {
        "project_id": str(project_id or ""),
        "sttm_id": str(sttm_id or ""),
        "source_tables": sorted({_table_fqn(table) for table in (source_tables or []) if _table_fqn(table)}),
        "target_table": _table_fqn(target_table),
        "derived_source_ids": sorted({str(item) for item in (derived_source_ids or []) if item}),
        "selected_columns_by_table": selected_columns,
        "mapping_lifecycle": str(mapping_lifecycle or "unknown").lower(),
        "milestone": str(milestone or "unknown").lower(),
    }
    return f"ctx_{_stable_hash(identity)[:40]}"


def build_workbench_scope_key(
    *,
    scope_type: str | None,
    project_id: str | None,
    sttm_id: str | None = None,
    browsing_context: dict[str, Any] | None,
    source_tables: list[TableRef | dict[str, Any] | str] | None,
    target_table: TableRef | dict[str, Any] | str | None,
) -> str:
    """Build identity for guidance that exists before a complete mapping context."""
    browse = browsing_context or {}
    identity = {
        "scope_type": str(scope_type or "table_set").strip().lower(),
        "project_id": str(project_id or ""),
        "sttm_id": str(sttm_id or ""),
        "side": str(browse.get("side") or "").strip().lower(),
        "database": str(browse.get("database") or "").strip().upper(),
        "schema": str(browse.get("schema") or "").strip().upper(),
        "source_tables": sorted(
            {_table_fqn(table) for table in (source_tables or []) if _table_fqn(table)}
        ),
        "target_table": _table_fqn(target_table),
    }
    return f"scope_{_stable_hash(identity)[:40]}"


class WorkspaceBrowsingContext(BaseModel):
    side: str | None = None
    database: str | None = None
    schema: str | None = None
    visible_candidate_tables: list[str] = Field(default_factory=list)
    search_text: str | None = None

    @field_validator("visible_candidate_tables", mode="before")
    @classmethod
    def normalize_visible_candidate_tables(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        normalized = {
            _table_fqn(item)
            for item in value
            if _table_fqn(item)
        }
        return sorted(normalized)


class WorkspaceDerivedSourceRef(BaseModel):
    id: str
    name: str | None = None
    sql_hash: str | None = None
    selected_columns_by_table: dict[str, list[str]] = Field(default_factory=dict)
    lineage: list[dict[str, Any]] = Field(default_factory=list)


class WorkspaceMappingRow(BaseModel):
    id: str
    target_column: str
    target_type: str | None = None
    source_columns: list[str] = Field(default_factory=list)
    source_type: str | None = None
    mapping_mode: Literal["source", "constant", "attribute"] = "source"
    constant_value: str | None = None
    attribute_name: str | None = None
    rule: str | None = None
    expression: str | None = None
    natural_language_rule: str | None = None
    description: str | None = None
    load_order: str | None = None
    confidence: float | None = None
    confidence_reason: str | None = None
    status: str | None = None
    provenance: str | None = None
    ai_suggested: bool = False
    accepted: bool = False
    was_corrected: bool = False
    preprocessing_rule_type: str | None = None
    source_asset_ids: list[str] = Field(default_factory=list)
    used_inference_ids: list[str] = Field(default_factory=list)
    used_recommendation_ids: list[str] = Field(default_factory=list)
    used_learning_ids: list[str] = Field(default_factory=list)


class WorkspaceFilterState(BaseModel):
    filter_sql: str | None = None
    base_query_sql: str | None = None
    group_by_sql: str | None = None
    order_by_sql: str | None = None
    groups: list[dict[str, Any]] = Field(default_factory=list)


class WorkspaceSemanticRef(BaseModel):
    bundle_id: str | None = None
    bundle_hash: str | None = None
    bundle_label: str | None = None
    level: str | None = None
    status: str | None = None
    view_name: str | None = None
    composed_model_hash: str | None = None
    asset_versions: dict[str, str] = Field(default_factory=dict)


class WorkspaceSemanticBundleRef(BaseModel):
    bundle_id: str | None = None
    bundle_hash: str | None = None
    bundle_label: str | None = None
    level: str | None = None
    status: str | None = None
    semantic_view_name: str | None = None
    composed_model_hash: str | None = None
    asset_versions: dict[str, str] = Field(default_factory=dict)
    source_tables: list[TableRef] = Field(default_factory=list)
    target_table: TableRef | None = None
    driving_table: TableRef | None = None
    derived_source_ids: list[str] = Field(default_factory=list)
    relationship_hash: str | None = None


class WorkbenchContextSnapshotV1(BaseModel):
    """Backward-compatible canonical UI state attached to every agent request."""

    context_version: str = WORKBENCH_CONTEXT_VERSION
    context_hash: str = ""
    context_key: str = ""
    snapshot_id: str | None = None
    captured_at: datetime = Field(default_factory=datetime.utcnow)
    page: str = Field(default="builder", validation_alias=AliasChoices("page", "current_page"))
    surface: str = Field(default="SOURCE_SELECTION", validation_alias=AliasChoices("surface", "current_surface"))
    action: str | None = None
    milestone: str | None = None
    checkpoint: str | None = None
    scope_type: str | None = None
    scope_key: str = ""
    candidate_action: str | None = None
    browsing_context: WorkspaceBrowsingContext | None = None
    project_id: str | None = None
    project_name: str | None = None
    project_description: str | None = None
    project_domain: str | None = None
    project_outcome: str | None = None
    sttm_id: str | None = None
    sttm_name: str | None = None
    sttm_description: str | None = None
    mapping_lifecycle: str | None = None
    business_goal: str | None = None
    source_tables: list[TableRef] = Field(default_factory=list)
    driving_table: TableRef | None = None
    target_table: TableRef | None = None
    selected_columns_by_table: dict[str, list[str]] = Field(default_factory=dict)
    derived_sources: list[WorkspaceDerivedSourceRef] = Field(default_factory=list)
    relation_graph: dict[str, Any] | None = None
    relationships: list[dict[str, Any]] = Field(default_factory=list)
    filters: WorkspaceFilterState = Field(default_factory=WorkspaceFilterState)
    mapping_intent: dict[str, Any] | None = None
    mapping_rows: list[WorkspaceMappingRow] = Field(default_factory=list)
    checked_mapping_row_ids: list[str] = Field(default_factory=list)
    active_mapping_row_id: str | None = None
    # Authoritative imported/edited SQL and its structured projection are
    # separate immutable snapshot artifacts. mapping_sql remains as a legacy
    # alias for clients that have not moved to raw_mapping_sql yet.
    raw_mapping_sql: str | None = None
    parsed_mapping_model: dict[str, Any] | None = None
    mapping_sql: str | None = None
    mapping_preview_sql: str | None = None
    compiled_mapping_sql: str | None = None
    compiled_mapping_preview_sql: str | None = None
    compiled_mapping_context_hash: str | None = None
    semantic: WorkspaceSemanticRef = Field(default_factory=WorkspaceSemanticRef)
    semantic_bundle: WorkspaceSemanticBundleRef | None = None
    mapping_artifacts: list[dict[str, Any]] = Field(default_factory=list)
    validation_history: list[dict[str, Any]] = Field(default_factory=list)
    conversation_history: list[dict[str, str]] = Field(default_factory=list)
    source_set_hash: str = ""
    derived_set_hash: str = ""

    @model_validator(mode="before")
    @classmethod
    def _normalize_legacy_payload(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        normalized.setdefault("source_tables", normalized.get("selected_source_tables") or [])
        normalized.setdefault("target_table", normalized.get("selected_target_table"))
        normalized.setdefault("driving_table", normalized.get("selected_driving_table"))
        normalized.setdefault("derived_sources", normalized.get("selected_derived_sources") or [])
        normalized.setdefault("semantic", normalized.get("semantic_ref") or {})
        normalized.setdefault("raw_mapping_sql", normalized.get("mapping_sql"))
        normalized.setdefault("mapping_sql", normalized.get("raw_mapping_sql"))
        derived_sources: list[dict[str, Any]] = []
        for item in normalized.get("derived_sources") or []:
            if isinstance(item, str):
                derived_sources.append({"id": item})
            elif isinstance(item, dict):
                item_id = item.get("id") or item.get("derived_source_id")
                if item_id:
                    derived_sources.append({**item, "id": item_id})
        normalized["derived_sources"] = derived_sources
        return normalized

    @model_validator(mode="after")
    def _validate_version(self) -> "WorkbenchContextSnapshotV1":
        if self.context_version not in SUPPORTED_WORKBENCH_CONTEXT_VERSIONS:
            raise ValueError(
                "WORKSPACE_CONTEXT_VERSION_UNSUPPORTED: expected context_version '1.0' or '2.0'"
            )
        derived_ids = self.selected_derived_source_ids()
        source_fqns = sorted(table.qualified_name.upper() for table in self.source_tables)
        if not self.source_set_hash:
            self.source_set_hash = _stable_hash(source_fqns)
        if not self.derived_set_hash:
            self.derived_set_hash = _stable_hash(sorted(derived_ids))
        if not self.context_key:
            self.context_key = build_workbench_context_key(
                project_id=self.project_id,
                sttm_id=self.sttm_id,
                source_tables=self.source_tables,
                target_table=self.target_table,
                derived_source_ids=derived_ids,
                selected_columns_by_table=self.selected_columns_by_table,
                mapping_lifecycle=self.mapping_lifecycle,
                milestone=self.milestone or self.action,
            )
        normalized_scope_type = str(self.scope_type or "").strip().lower()
        if normalized_scope_type and normalized_scope_type not in WORKBENCH_SCOPE_TYPES:
            raise ValueError(f"WORKSPACE_SCOPE_TYPE_UNSUPPORTED: {normalized_scope_type}")
        if not self.scope_type:
            self.scope_type = "schema" if self.browsing_context else "table_set"
        if not self.scope_key:
            self.scope_key = build_workbench_scope_key(
                scope_type=self.scope_type,
                project_id=self.project_id,
                sttm_id=self.sttm_id,
                browsing_context=(
                    self.browsing_context.model_dump(mode="json")
                    if self.browsing_context
                    else None
                ),
                source_tables=self.source_tables,
                target_table=self.target_table,
            )
        if not self.checkpoint:
            self.checkpoint = self.milestone or self.action
        if not self.context_hash:
            self.context_hash = _stable_hash(
                {
                    "context_key": self.context_key,
                    "scope_key": self.scope_key,
                    "checkpoint": self.checkpoint,
                    "browsing_context": (
                        self.browsing_context.model_dump(mode="json")
                        if self.browsing_context
                        else None
                    ),
                    "relationships": self.relationships,
                    "relation_graph": self.relation_graph,
                    "filters": self.filters.model_dump(mode="json"),
                    "mapping_rows": [row.model_dump(mode="json") for row in self.mapping_rows],
                    "mapping_sql": self.mapping_sql,
                    "semantic": self.semantic.model_dump(mode="json"),
                    "validation_history": self.validation_history,
                }
            )
        return self

    def selected_derived_source_ids(self) -> list[str]:
        return [item.id for item in self.derived_sources]


class WorkbenchContextSnapshotV2(WorkbenchContextSnapshotV1):
    context_version: str = WORKBENCH_CONTEXT_VERSION

    @model_validator(mode="after")
    def _require_v2(self) -> "WorkbenchContextSnapshotV2":
        if self.context_version != "2.0":
            raise ValueError("WORKSPACE_CONTEXT_VERSION_UNSUPPORTED: expected context_version '2.0'")
        return self
