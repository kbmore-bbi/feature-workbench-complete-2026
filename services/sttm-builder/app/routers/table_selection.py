from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_table_selection_service
from app.core.table_selection import TableSelectionService
from app.schema.table_selection import DatabaseItem, RelationshipItem, RelationshipRequest, TableAttributes, TableItem
from app.schema.table_selection import SchemaItem

router = APIRouter(prefix="/table-selection", tags=["Table Selection"])


@router.get("/databases", response_model=list[DatabaseItem])
def get_databases(svc: TableSelectionService = Depends(get_table_selection_service)):
    return svc.list_databases()


@router.get("/schemas", response_model=list[SchemaItem])
def get_schemas(
    database: Annotated[str, Query(description="Snowflake database name")],
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return svc.list_schemas(database)


@router.get("/tables", response_model=list[TableItem])
def get_tables(
    database: Annotated[str, Query(description="Snowflake database name")],
    schema: Annotated[str, Query(description="Snowflake schema name")],
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return svc.list_tables(database, schema)


@router.get("/attributes", response_model=list[TableAttributes])
def get_attributes(
    tables: Annotated[
        list[str],
        Query(description="Fully-qualified table references in DATABASE.SCHEMA.TABLE format"),
    ],
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return svc.list_attributes_for_tables(tables)


@router.post("/relationships", response_model=list[RelationshipItem])
def get_relationships(
    body: RelationshipRequest,
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return svc.list_relationships_for_tables(body.tables)
