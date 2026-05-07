from collections.abc import Generator
from typing import Annotated, Optional

from fastapi import Depends, Query, Request

from app.auth.models import AppPersona
from app.core.config import Settings, get_settings
from app.core.snowflake import (
    SnowflakeClient,
    build_caller_token,
    using_local_dev_auth,
)
from app.core.snowflake_agent import SnowflakeAgentClient
from app.core.derived_source import DerivedSourceService
from app.core.semantic_model import SemanticModelService
from app.core.table_selection import TableSelectionService
from app.core.sttm_builder import STTMBuilderService
from app.core.user import UserService

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
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SnowflakeAgentClient:
    """Returns a Cortex Agent client authenticated with the caller's Snowflake context."""
    user_token = request.headers.get(_SPCS_USER_TOKEN_HEADER, "")
    if using_local_dev_auth(settings, user_token):
        context = client.get_rest_session_context()
        return SnowflakeAgentClient(
            token=context.token,
            host=context.host,
            auth_mode="snowflake_token",
        )

    return SnowflakeAgentClient(
        token=build_caller_token(user_token),
        host=settings.resolved_snowflake_host or None,
    )


def get_table_selection_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> TableSelectionService:
    return TableSelectionService(client, settings)


def get_derived_source_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> DerivedSourceService:
    return DerivedSourceService(client.session, settings)


def get_sttm_builder_service(
    agent_client: Annotated[SnowflakeAgentClient, Depends(get_snowflake_agent_client)],
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    semantic_model_service: Annotated[SemanticModelService, Depends(get_semantic_model_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> STTMBuilderService:
    return STTMBuilderService(
        agent_client,
        settings=settings,
        session=client.session,
        semantic_model_service=semantic_model_service,
    )


def get_user_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserService:
    return UserService(client, settings)


def get_semantic_model_service(
    settings: Annotated[Settings, Depends(get_settings)],
) -> SemanticModelService:
    return SemanticModelService(settings)
