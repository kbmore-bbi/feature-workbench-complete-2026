from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schema.common import TableRef
from app.schema.mapping_sql import MappingSqlMappingItem
from app.schema.sttm_builder import RelationshipContextItem, SemanticContextItem


class TestCaseDerivedBaseSource(BaseModel):
    table: TableRef
    attribute_semantic_model: list[dict[str, Any]] = Field(default_factory=list)


class TestCaseDerivedSourceItem(BaseModel):
    derived_source_name: str
    sql_text: str | None = None
    semantic_view_name: str | None = None
    base_sources: list[TestCaseDerivedBaseSource] = Field(default_factory=list)


class TestCaseGenerationRequest(BaseModel):
    project_id: str | None = None
    sttm_id: str | None = None
    project_name: str | None = None
    domain_name: str | None = None
    target_layer: Literal["raw", "curated", "mart"] | str | None = None
    materialization: Literal["incremental", "table", "view"] | str | None = None
    source_tables: list[TableRef] = Field(default_factory=list)
    target_table: TableRef
    relationships: list[RelationshipContextItem] = Field(default_factory=list)
    validated_sql: str = Field(min_length=1)
    mappings: list[MappingSqlMappingItem] = Field(default_factory=list)
    semantic_context: list[SemanticContextItem] = Field(default_factory=list)
    derived_sources: list[TestCaseDerivedSourceItem] = Field(default_factory=list)


class TestCaseGroup(BaseModel):
    group: str
    target_columns: list[str] = Field(default_factory=list)


class TestCaseSeedFile(BaseModel):
    file_path: str
    file_type: str
    content: str


class TestCaseDocumentItem(BaseModel):
    test_case_id: str
    group: str
    target_attribute: str
    source_columns: str
    mapping_rule: str
    test_case_description: str
    test_type: str
    sample_source_input: str
    expected_target_value: str
    confidence: str | None = None


class TestCaseGenerationResponse(BaseModel):
    status: Literal["completed", "failed"] | str
    domain_name: str | None = None
    target_layer: str | None = None
    materialization: str | None = None
    target_model: str | None = None
    target_table: str | None = None
    test_groups: list[TestCaseGroup] = Field(default_factory=list)
    seed_files: list[TestCaseSeedFile] = Field(default_factory=list)
    test_case_document: list[TestCaseDocumentItem] = Field(default_factory=list)
    agent_name: str
    retrieved_inference_ids: list[str] = Field(default_factory=list)
    retrieved_recommendation_ids: list[str] = Field(default_factory=list)
    used_inference_ids: list[str] = Field(default_factory=list)
    used_recommendation_ids: list[str] = Field(default_factory=list)
