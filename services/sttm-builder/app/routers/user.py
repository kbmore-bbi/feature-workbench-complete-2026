from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_user_service
from app.core.user import UserService
from app.schema.contracts import ApiResponseEnvelope, build_response_envelope
from app.schema.user import UserRolesResponse

router = APIRouter(prefix="/user", tags=["User"])


@router.get(
    "/roles",
    response_model=ApiResponseEnvelope[UserRolesResponse],
    summary="List Snowflake roles available to the current user",
    description=(
        "Returns all Snowflake roles granted to the authenticated user and the role "
        "currently active on this session. "
        "Accessible by every application role — use the returned role names as the "
        "`role` query parameter on subsequent requests to switch context."
    ),
)
def list_user_roles(
    request: Request,
    service: Annotated[UserService, Depends(get_user_service)],
) -> ApiResponseEnvelope[UserRolesResponse]:
    return build_response_envelope(
        operation="user.list_roles",
        request=request,
        data=service.list_roles(),
    )
