from fastapi import APIRouter, Depends

from app.api.deps import get_table_selection_service
from app.core.table_selection import TableSelectionService
from app.schema.table_selection import ColumnItem, DatabaseItem, SchemaItem, TableItem

router = APIRouter(prefix="/table-selection", tags=["table-selection"])


@router.get("/databases", response_model=list[DatabaseItem])
def get_databases(svc: TableSelectionService = Depends(get_table_selection_service)):
    return svc.list_databases()


@router.get("/databases/{db_name}/schemas", response_model=list[SchemaItem])
def get_schemas(db_name: str, svc: TableSelectionService = Depends(get_table_selection_service)):
    return svc.list_schemas(db_name)


@router.get(
    "/databases/{db_name}/schemas/{schema_name}/tables",
    response_model=list[TableItem],
)
def get_tables(
    db_name: str,
    schema_name: str,
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return svc.list_tables(db_name, schema_name)


@router.get(
    "/databases/{db_name}/schemas/{schema_name}/tables/{table_name}/columns",
    response_model=list[ColumnItem],
)
def get_columns(
    db_name: str,
    schema_name: str,
    table_name: str,
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return svc.list_columns(db_name, schema_name, table_name)
