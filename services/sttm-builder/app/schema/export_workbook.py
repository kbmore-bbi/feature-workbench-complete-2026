from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.schema.common import TableRef
from app.schema.sttm_builder import RelationshipContextItem
from app.schema.mapping_sql import MappingSqlMappingItem


class WorkbookDerivedSourceItem(BaseModel):
    derived_source_id: str
    derived_source_name: str
    sql_text: str | None = None
    source_tables: list[TableRef] = Field(default_factory=list)
    base_source_tables: list[TableRef] = Field(default_factory=list)
    semantic_view_name: str | None = None
    semantic_bundle_label: str | None = None


class WorkbookDbtGeneratedFile(BaseModel):
    file_name: str
    file_path: str
    file_type: str
    content: str
    language: str


class WorkbookDbtSourceUpdate(BaseModel):
    file_path: str
    action: str
    content: str | None = None
    language: str


class WorkbookDbtConversionItem(BaseModel):
    status: str | None = None
    action: str | None = None
    message: str | None = None
    materialization: str | None = None
    materialization_reason: str | None = None
    generated_files: list[WorkbookDbtGeneratedFile] = Field(default_factory=list)
    schema_files: list[WorkbookDbtGeneratedFile] = Field(default_factory=list)
    source_update: WorkbookDbtSourceUpdate | None = None


class WorkbookExportRequest(BaseModel):
    project_name: str | None = None
    summary_narrative: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    version_label: str | None = None
    target_table: TableRef | None = None
    source_tables: list[TableRef] = Field(default_factory=list)
    relationships: list[RelationshipContextItem] = Field(default_factory=list)
    derived_sources: list[WorkbookDerivedSourceItem] = Field(default_factory=list)
    filters_sql: str | None = None
    source_query_sql: str = Field(default="")
    preview_sql: str = Field(default="")
    generated_sql: str = Field(default="")
    sql_variant_label: str | None = None
    derived_source_lineage: list[dict[str, Any]] = Field(default_factory=list)
    lineage_table_mermaid: str | None = None
    lineage_column_mermaid: str | None = None
    dbt_conversion: WorkbookDbtConversionItem | None = None
    mappings: list[MappingSqlMappingItem] = Field(default_factory=list)
