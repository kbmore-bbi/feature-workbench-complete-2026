from datetime import datetime
from typing import Optional

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


class ColumnItem(BaseModel):
    column_name: str
    data_type: str
    is_nullable: str
    ordinal_position: int
    comment: Optional[str]


class TableAttributes(BaseModel):
    table: TableRef
    columns: list[ColumnItem]
