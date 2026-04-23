from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_user_service
from app.core.user import UserService
from app.schema.user import UserRolesResponse

router = APIRouter(prefix="/user", tags=["User"])


@router.get(
    "/roles",
    response_model=UserRolesResponse,
    summary="List Snowflake roles available to the current user",
    description=(
        "Returns all Snowflake roles granted to the authenticated user and the role "
        "currently active on this session. "
        "Accessible by every application role — use the returned role names as the "
        "`role` query parameter on subsequent requests to switch context."
    ),
)
def list_user_roles(
    service: Annotated[UserService, Depends(get_user_service)],
) -> UserRolesResponse:
    return service.list_roles()
