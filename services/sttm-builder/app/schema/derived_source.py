from typing import Any

from pydantic import BaseModel, Field

from app.schema.common import TableRef
from app.schema.sttm_builder import RelationshipContextItem


class DerivedSourcePreviewColumn(BaseModel):
    name: str
    data_type: str
    is_primary_key: bool = False


class DerivedSourcePreviewRow(BaseModel):
    values: dict[str, Any]


class DerivedSourceDefinition(BaseModel):
    derived_source_id: str | None = None
    derived_source_name: str = Field(min_length=1)
    sql_text: str = Field(min_length=1)
    source_tables: list[TableRef] = Field(min_length=1)
    parent_derived_source_ids: list[str] = Field(default_factory=list)
    driving_table: TableRef | None = None
    relationships: list[RelationshipContextItem] = Field(default_factory=list)
    filters: list[dict[str, Any]] = Field(default_factory=list)
    selected_columns_by_table: dict[str, list[str]] = Field(default_factory=dict)


class DerivedSourceValidateRequest(DerivedSourceDefinition):
    pass


class DerivedSourceValidateResponse(BaseModel):
    valid: bool = True
    message: str
    preview_columns: list[DerivedSourcePreviewColumn]
    preview_rows: list[DerivedSourcePreviewRow]


class DerivedSourceRecord(DerivedSourceDefinition):
    derived_source_id: str
    preview_columns: list[DerivedSourcePreviewColumn] = Field(default_factory=list)
    base_source_tables: list[TableRef] = Field(default_factory=list)
    lineage_depth: int = 0
    semantic_bundle_id: str | None = None
    semantic_view_name: str | None = None
    semantic_level: str | None = None
    upstream_hash: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    is_active: bool = True
