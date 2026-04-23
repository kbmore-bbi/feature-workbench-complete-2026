from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class DatabaseItem(BaseModel):
    database_name: str
    created: datetime


class SchemaItem(BaseModel):
    schema_name: str
    created: datetime


class TableItem(BaseModel):
    table_name: str
    table_type: str
    row_count: Optional[int]


class ColumnItem(BaseModel):
    column_name: str
    data_type: str
    is_nullable: str
    ordinal_position: int
    comment: Optional[str]
