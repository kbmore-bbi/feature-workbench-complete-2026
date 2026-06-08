from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schema.common import TableRef
from app.schema.sttm_builder import RelationshipContextItem


class MappingSqlMappingItem(BaseModel):
    target_column: str
    target_type: str | None = None
    source_column: str | None = None
    source_columns: list[str] = Field(default_factory=list)
    expression: str | None = None
    rule: str | None = None
    status: str | None = None
    nl_rule: str | None = None
    description: str | None = None


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
    source_query_sql: str = Field(min_length=1)
    preview_sql: str = Field(min_length=1)
    generated_sql: str = Field(min_length=1)
    mappings: list[MappingSqlMappingItem] = Field(default_factory=list)
    preview_limit: int = Field(default=5, ge=1, le=20)


class MappingSqlPreviewRequest(MappingSqlReviewRequest):
    chosen_variant: Literal["original", "optimized"] = "original"
    approved_preview_sql: str | None = None
    approved_generated_sql: str | None = None


class MappingSqlPreviewColumn(BaseModel):
    name: str
    data_type: str


class MappingSqlPreviewRow(BaseModel):
    values: dict[str, Any]


class MappingSqlReviewResponse(BaseModel):
    valid: bool
    review_agent: str
    syntax_valid: bool
    execution_ready: bool
    review_summary: str
    optimized: bool = False
    requires_approval: bool = False
    original_preview_sql: str
    original_generated_sql: str
    optimized_preview_sql: str | None = None
    optimized_generated_sql: str | None = None
    semantic_view_name: str | None = None
    warnings: list[str] = Field(default_factory=list)


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
