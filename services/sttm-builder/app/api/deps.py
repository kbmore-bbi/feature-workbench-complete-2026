from collections.abc import Generator
from typing import Annotated, Optional

from fastapi import Depends, Query, Request

from app.auth.models import AppPersona
from app.core.config import Settings, get_settings
from app.core.snowflake import SnowflakeClient
from app.core.snowflake import build_caller_token
from app.core.snowflake_agent import SnowflakeAgentClient
from app.core.table_selection import TableSelectionService
from app.core.user import UserService
from app.core.sttm_builder import STTMBuilderService

_SPCS_USER_TOKEN_HEADER = "sf-context-current-user-token"


def _default_role_for_principal(request: Request, settings: Settings) -> str | None:
    # Delay the import to avoid a module cycle between auth and API deps.
    from app.auth.dependencies import get_current_principal

    principal = get_current_principal(request)
    if principal.app_persona is AppPersona.ADMIN:
        return settings.app_role_admin
    if principal.app_persona is AppPersona.PUBLISHER:
        return settings.app_role_publisher
    if principal.app_persona is AppPersona.VIEWER:
        return settings.app_role_viewer
    return None


def get_snowflake_client(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    role: Annotated[Optional[str], Query(description="Snowflake role to activate for this session")] = None,
) -> Generator[SnowflakeClient, None, None]:
    """
    Opens a Snowflake session under the calling user's identity via SPCS caller's rights.
    Requires the Sf-Context-Current-User-Token header injected by the SPCS ingress.
    If `role` is provided it is activated on the session.
    """
    user_token = request.headers.get(_SPCS_USER_TOKEN_HEADER, "")
    effective_role = role or _default_role_for_principal(request, settings)
    client = SnowflakeClient(
        settings=settings,
        user_token=user_token,
        role=effective_role,
    )
    try:
        yield client
    finally:
        client.close()


def get_snowflake_agent_client(
    request: Request,
) -> SnowflakeAgentClient:
    """Returns a Cortex Agent client authenticated with the caller's Snowflake context."""
    user_token = request.headers.get(_SPCS_USER_TOKEN_HEADER, "")
    return SnowflakeAgentClient(token=build_caller_token(user_token))


def get_table_selection_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
) -> TableSelectionService:
    return TableSelectionService(client)


def get_sttm_builder_service(
    agent_client: Annotated[SnowflakeAgentClient, Depends(get_snowflake_agent_client)],
) -> STTMBuilderService:
    return STTMBuilderService(agent_client)


def get_user_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserService:
    return UserService(client, settings)
