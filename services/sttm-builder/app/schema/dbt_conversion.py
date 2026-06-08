from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schema.common import TableRef
from app.schema.mapping_sql import MappingSqlMappingItem
from app.schema.sttm_builder import RelationshipContextItem, SemanticContextItem


class DbtConversionRequest(BaseModel):
    project_name: str | None = None
    domain_name: str | None = None
    target_layer: Literal["raw", "curated", "mart"] | str | None = None
    materialization: Literal["incremental", "table", "view"] | str | None = None
    source_tables: list[TableRef] = Field(default_factory=list)
    target_table: TableRef
    driving_table: TableRef | None = None
    selected_derived_sources: list[str] = Field(default_factory=list)
    relationships: list[RelationshipContextItem] = Field(default_factory=list)
    selected_columns_by_table: dict[str, list[str]] = Field(default_factory=dict)
    semantic_bundle_id: str | None = None
    semantic_bundle_label: str | None = None
    semantic_view_name: str | None = None
    source_query_sql: str | None = None
    validated_sql: str = Field(min_length=1)
    generated_sql: str | None = None
    mappings: list[MappingSqlMappingItem] = Field(default_factory=list)
    semantic_context: list[SemanticContextItem] = Field(default_factory=list)
    derived_source_lineage: list[dict[str, Any]] = Field(default_factory=list)
    datahub_context: dict[str, Any] | None = None
    checklist: list[str] = Field(default_factory=list)


class DbtConversionGeneratedFile(BaseModel):
    file_name: str
    file_path: str
    file_type: str = "MODEL"
    content: str
    language: Literal["sql", "yaml", "text"] = "sql"


class DbtConversionSourceUpdate(BaseModel):
    file_path: str
    action: Literal["UPDATE", "NO_CHANGE"] | str
    content: str | None = None
    language: Literal["yaml", "text"] = "yaml"


class DbtConversionResponse(BaseModel):
    status: Literal["completed", "failed"] | str
    action: Literal["CREATE_NEW", "UPDATE_EXISTING", "CREATE_WITH_REFERENCE", "REUSE_EXISTING"] | str | None = None
    message: str | None = None
    generated_files: list[DbtConversionGeneratedFile] = Field(default_factory=list)
    source_update: DbtConversionSourceUpdate | None = None
    schema_files: list[DbtConversionGeneratedFile] = Field(default_factory=list)
    macros_used: list[str] = Field(default_factory=list)
    materialization: str | None = None
    materialization_reason: str | None = None
    agent_name: str
    domain_name: str | None = None
    target_layer: str | None = None
    branch: str = "main"

