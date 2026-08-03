from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schema.common import TableRef
from app.schema.sttm_builder import RelationGraphContext, RelationshipContextItem


class MappingSqlMappingItem(BaseModel):
    target_column: str
    target_type: str | None = None
    source_column: str | None = None
    source_columns: list[str] = Field(default_factory=list)
    mapping_mode: Literal["source", "constant", "attribute"] = "source"
    constant_value: str | None = None
    attribute_name: str | None = None
    expression: str | None = None
    rule: str | None = None
    status: str | None = None
    nl_rule: str | None = None
    description: str | None = None
    source_dependencies: list[str] = Field(default_factory=list)
    value_binding_ids: list[str] = Field(default_factory=list)
    precedent_decision: str | None = None
    precedent_mapping_id: str | None = None


class MappingSqlCompileRequest(BaseModel):
    relation_graph: RelationGraphContext
    mappings: list[MappingSqlMappingItem] = Field(min_length=1)
    target_table: TableRef | None = None
    driving_relation_id: str | None = None
    where_predicates: list[str] = Field(default_factory=list)
    group_by_expressions: list[str] = Field(default_factory=list)
    qualify_predicates: list[str] = Field(default_factory=list)
    order_by_expressions: list[str] = Field(default_factory=list)
    self_contained_derived: bool = True
    validate_with_explain: bool = True
    allow_unresolved_placeholders: bool = False
    accepted_precedent_sttm_id: str | None = None


class MappingSqlCompileResponse(BaseModel):
    valid: bool
    ready: bool
    preview_sql: str
    generated_sql: str
    relation_aliases: dict[str, str] = Field(default_factory=dict)
    required_relation_ids: list[str] = Field(default_factory=list)
    unresolved_placeholders: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class MappingSqlReviewRequest(BaseModel):
    source_tables: list[TableRef] = Field(default_factory=list)
    target_table: TableRef | None = None
    driving_table: TableRef | None = None
    selected_derived_sources: list[str] = Field(default_factory=list)
    relationships: list[RelationshipContextItem] = Field(default_factory=list)
    selected_columns_by_table: dict[str, list[str]] = Field(default_factory=dict)
    semantic_bundle_id: str | None = None
    semantic_bundle_label: str | None = None
    semantic_view_name: str | None = None
    semantic_model_yaml: str | None = None
    relation_graph: RelationGraphContext | None = None
    source_query_sql: str = Field(min_length=1)
    preview_sql: str = Field(min_length=1)
    generated_sql: str = Field(min_length=1)
    mappings: list[MappingSqlMappingItem] = Field(default_factory=list)
    preview_limit: int = Field(default=5, ge=1, le=20)
    attempt_ai_repair: bool = False


class MappingSqlPreviewRequest(MappingSqlReviewRequest):
    chosen_variant: Literal["original", "optimized"] = "original"
    approved_preview_sql: str | None = None
    approved_generated_sql: str | None = None


class MappingSqlPreviewColumn(BaseModel):
    name: str
    data_type: str


class MappingSqlPreviewRow(BaseModel):
    values: dict[str, Any]


class MappingSqlRepairOption(BaseModel):
    code: Literal[
        "apply_suggested_sql",
        "fix_with_ai",
        "resolve_value_binding",
        "verify_source_contract",
        "edit_sql",
    ]
    title: str
    description: str
    action: Literal["review_suggested_sql", "request_ai_repair", "open_mapping", "edit_sql"]
    identifier: str | None = None


class MappingSqlReviewResponse(BaseModel):
    valid: bool
    review_agent: str
    syntax_valid: bool
    execution_ready: bool
    review_summary: str
    validation_error: str | None = None
    review_kind: Literal["none", "optimization", "repair"] = "none"
    optimized: bool = False
    requires_approval: bool = False
    original_preview_sql: str
    original_generated_sql: str
    optimized_preview_sql: str | None = None
    optimized_generated_sql: str | None = None
    semantic_view_name: str | None = None
    warnings: list[str] = Field(default_factory=list)
    repair_options: list[MappingSqlRepairOption] = Field(default_factory=list)


class MappingSqlPreviewResponse(BaseModel):
    valid: bool
    variant_used: Literal["original", "optimized"]
    executed_preview_sql: str
    executed_generated_sql: str
    preview_columns: list[MappingSqlPreviewColumn] = Field(default_factory=list)
    preview_rows: list[MappingSqlPreviewRow] = Field(default_factory=list)
    source_sample_aliases: dict[str, str] = Field(default_factory=dict)
    source_sample_rows: list[MappingSqlPreviewRow] = Field(default_factory=list)
    semantic_view_name: str | None = None
    warnings: list[str] = Field(default_factory=list)


class MappingSqlParseRequest(BaseModel):
    sql: str = Field(min_length=1)
    current_workspace: dict[str, Any] = Field(default_factory=dict)
    known_tables: list[TableRef] = Field(default_factory=list)


class MappingSqlParseResponse(BaseModel):
    valid: bool
    parsed_workspace: dict[str, Any] = Field(default_factory=dict)
    diff: dict[str, list[Any]] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    unresolved_references: list[str] = Field(default_factory=list)
    ambiguous_references: dict[str, list[str]] = Field(default_factory=dict)
