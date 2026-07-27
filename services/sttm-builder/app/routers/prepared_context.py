from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import get_prepared_workspace_context_service
from app.core.prepared_context import PreparedWorkspaceContextService
from app.schema.contracts import (
    ApiRequestEnvelope,
    ApiResponseEnvelope,
    build_response_envelope,
)
from app.schema.prepared_context import (
    PreparedWorkspaceContextRequest,
    PreparedWorkspaceContextResponse,
)

router = APIRouter(prefix="/workbench/context", tags=["Prepared Workspace Context"])


@router.post(
    "/prepare",
    response_model=ApiResponseEnvelope[PreparedWorkspaceContextResponse],
)
def prepare_workspace_context(
    body: (
        ApiRequestEnvelope[PreparedWorkspaceContextRequest]
        | PreparedWorkspaceContextRequest
    ),
    request: Request,
    service: Annotated[
        PreparedWorkspaceContextService,
        Depends(get_prepared_workspace_context_service),
    ],
) -> ApiResponseEnvelope[PreparedWorkspaceContextResponse]:
    payload = body if isinstance(body, PreparedWorkspaceContextRequest) else body.data
    result = service.prepare(payload)
    return build_response_envelope(
        operation="workbench.context.prepare",
        request=request,
        request_id=(None if isinstance(body, PreparedWorkspaceContextRequest) else body.request_id),
        data=result,
    )


@router.get(
    "/{workspace_context_id}",
    response_model=ApiResponseEnvelope[PreparedWorkspaceContextResponse],
)
def get_workspace_context(
    workspace_context_id: str,
    request: Request,
    service: Annotated[
        PreparedWorkspaceContextService,
        Depends(get_prepared_workspace_context_service),
    ],
) -> ApiResponseEnvelope[PreparedWorkspaceContextResponse]:
    result = service.get(workspace_context_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Prepared workspace context not found")
    result.cache_status = "l2"
    return build_response_envelope(
        operation="workbench.context.get",
        request=request,
        data=result,
    )
