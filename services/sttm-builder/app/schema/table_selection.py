from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel

from app.schema.common import TableRef


class SchemaItem(BaseModel):
    schema_name: str
    created: datetime


class DatabaseItem(BaseModel):
    database_name: str
    created: datetime
    schemas: list[SchemaItem]


class TableItem(BaseModel):
    table_name: str
    row_count: Optional[int] = None
    column_count: int = 0


class ColumnItem(BaseModel):
    column_name: str
    data_type: str
    is_nullable: str
    ordinal_position: int
    comment: Optional[str]
    is_primary_key: bool = False
    is_foreign_key: bool = False


class TableAttributes(BaseModel):
    table: TableRef
    columns: list[ColumnItem]


class RelationshipColumnMapping(BaseModel):
    left_column: str
    right_column: str
    operator: str = "="


class RelationshipItem(BaseModel):
    id: str
    left_table: TableRef
    right_table: TableRef
    constraint_name: str | None = None
    join_type: str = "INNER"
    conditions: list[RelationshipColumnMapping]
    source: str = "FOREIGN_KEY"
    locked: bool = True
    review_required: bool = False
    confidence: float | None = None
    review_reason: str | None = None
    evidence: dict[str, Any] | None = None


class RelationshipRequest(BaseModel):
    tables: list[TableRef]


class RelationshipReviewRequest(BaseModel):
    relationship: RelationshipItem
    outcome: Literal["accepted", "rejected"]
    project_id: str | None = None
    sttm_id: str | None = None
    context_hash: str | None = None


class ListDatabasesRequestData(BaseModel):
    pass


class ListSchemasRequestData(BaseModel):
    database: str


class ListTablesRequestData(BaseModel):
    database: str
    schema: str


class ListAttributesRequestData(BaseModel):
    tables: list[str]
