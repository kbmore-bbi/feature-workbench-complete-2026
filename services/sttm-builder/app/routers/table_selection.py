from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.api.deps import get_conversation_memory_service, get_table_selection_service
from app.auth.dependencies import get_current_principal
from app.core.conversation_memory import ConversationMemoryService
from app.core.table_selection import TableSelectionService
from app.schema.contracts import ApiRequestEnvelope, ApiResponseEnvelope, build_response_envelope
from app.schema.table_selection import (
    DatabaseItem,
    ListAttributesRequestData,
    ListDatabasesRequestData,
    ListSchemasRequestData,
    ListTablesRequestData,
    RelationshipItem,
    RelationshipRequest,
    RelationshipReviewRequest,
    SchemaItem,
    TableAttributes,
    TableItem,
)

router = APIRouter(prefix="/table-selection", tags=["Table Selection"])


@router.get("/databases", response_model=ApiResponseEnvelope[list[DatabaseItem]])
def get_databases(
    request: Request,
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return build_response_envelope(
        operation="table_selection.list_databases",
        request=request,
        data=svc.list_databases(),
    )


@router.post("/databases", response_model=ApiResponseEnvelope[list[DatabaseItem]])
def post_databases(
    body: ApiRequestEnvelope[ListDatabasesRequestData],
    request: Request,
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return build_response_envelope(
        operation="table_selection.list_databases",
        request=request,
        request_id=body.request_id,
        actor=body.actor,
        context=body.context,
        warnings=body.warnings,
        meta=body.meta,
        data=svc.list_databases(),
    )


@router.get("/schemas", response_model=ApiResponseEnvelope[list[SchemaItem]])
def get_schemas(
    request: Request,
    database: Annotated[str, Query(description="Snowflake database name")],
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return build_response_envelope(
        operation="table_selection.list_schemas",
        request=request,
        context={"database": database},
        data=svc.list_schemas(database),
    )


@router.post("/schemas", response_model=ApiResponseEnvelope[list[SchemaItem]])
def post_schemas(
    body: ApiRequestEnvelope[ListSchemasRequestData],
    request: Request,
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return build_response_envelope(
        operation="table_selection.list_schemas",
        request=request,
        request_id=body.request_id,
        actor=body.actor,
        context={**body.context, "database": body.data.database},
        warnings=body.warnings,
        meta=body.meta,
        data=svc.list_schemas(body.data.database),
    )


@router.get("/tables", response_model=ApiResponseEnvelope[list[TableItem]])
def get_tables(
    request: Request,
    database: Annotated[str, Query(description="Snowflake database name")],
    schema: Annotated[str, Query(description="Snowflake schema name")],
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return build_response_envelope(
        operation="table_selection.list_tables",
        request=request,
        context={"database": database, "schema": schema},
        data=svc.list_tables(database, schema),
    )


@router.post("/tables", response_model=ApiResponseEnvelope[list[TableItem]])
def post_tables(
    body: ApiRequestEnvelope[ListTablesRequestData],
    request: Request,
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return build_response_envelope(
        operation="table_selection.list_tables",
        request=request,
        request_id=body.request_id,
        actor=body.actor,
        context={
            **body.context,
            "database": body.data.database,
            "schema": body.data.schema,
        },
        warnings=body.warnings,
        meta=body.meta,
        data=svc.list_tables(body.data.database, body.data.schema),
    )


@router.get("/attributes", response_model=ApiResponseEnvelope[list[TableAttributes]])
def get_attributes(
    request: Request,
    tables: Annotated[
        list[str],
        Query(description="Fully-qualified table references in DATABASE.SCHEMA.TABLE format"),
    ],
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return build_response_envelope(
        operation="table_selection.list_attributes",
        request=request,
        context={"tables": tables},
        data=svc.list_attributes_for_tables(tables),
    )


@router.post("/attributes", response_model=ApiResponseEnvelope[list[TableAttributes]])
def post_attributes(
    body: ApiRequestEnvelope[ListAttributesRequestData],
    request: Request,
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    return build_response_envelope(
        operation="table_selection.list_attributes",
        request=request,
        request_id=body.request_id,
        actor=body.actor,
        context={**body.context, "tables": body.data.tables},
        warnings=body.warnings,
        meta=body.meta,
        data=svc.list_attributes_for_tables(body.data.tables),
    )


@router.post("/relationships", response_model=ApiResponseEnvelope[list[RelationshipItem]])
def get_relationships(
    body: ApiRequestEnvelope[RelationshipRequest] | RelationshipRequest,
    request: Request,
    svc: TableSelectionService = Depends(get_table_selection_service),
):
    if isinstance(body, RelationshipRequest):
        tables = body.tables
        request_id = None
        actor = None
        context: dict[str, object] = {}
        warnings = []
        meta: dict[str, object] = {}
    else:
        tables = body.data.tables
        request_id = body.request_id
        actor = body.actor
        context = body.context
        warnings = body.warnings
        meta = body.meta

    return build_response_envelope(
        operation="table_selection.list_relationships",
        request=request,
        request_id=request_id,
        actor=actor,
        context=context,
        warnings=warnings,
        meta=meta,
        data=svc.list_relationships_for_tables(tables),
    )


@router.post("/relationships/review", response_model=ApiResponseEnvelope[dict[str, bool]])
def review_relationship(
    body: ApiRequestEnvelope[RelationshipReviewRequest] | RelationshipReviewRequest,
    request: Request,
    memory: ConversationMemoryService = Depends(get_conversation_memory_service),
):
    payload = body if isinstance(body, RelationshipReviewRequest) else body.data
    principal = get_current_principal(request)
    relationship = payload.relationship
    request_id = None if isinstance(body, RelationshipReviewRequest) else body.request_id
    entity_ids = [
        relationship.left_table.qualified_name,
        relationship.right_table.qualified_name,
    ]
    memory.record_fir_event(
        event_type=f"semantic_relationship.{payload.outcome}",
        user_id=str(principal.user_id),
        session_id=None,
        request_id=request_id,
        page="builder",
        surface="SOURCE_SELECTION",
        entity_type="relationship",
        entity_ids=entity_ids,
        event_payload={
            "project_id": payload.project_id,
            "sttm_id": payload.sttm_id,
            "context_hash": payload.context_hash,
            "relationship": relationship.model_dump(mode="json"),
            "review_outcome": payload.outcome,
        },
        context_key=payload.context_hash,
        milestone="relationship_reviewed",
    )
    return build_response_envelope(
        operation="table_selection.relationship_review",
        request=request,
        request_id=request_id,
        context={"project_id": payload.project_id, "sttm_id": payload.sttm_id},
        data={"recorded": True},
    )
