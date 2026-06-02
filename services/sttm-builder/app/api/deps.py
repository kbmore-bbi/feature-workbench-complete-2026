from collections.abc import Generator
from typing import Annotated, Optional

from fastapi import Depends, Query, Request

from app.auth.models import AppPersona
from app.core.config import Settings, get_settings
from app.core.datahub import DataHubAdapter
from app.core.snowflake import (
    SnowflakeClient,
    build_caller_token,
    get_local_cached_client,
    using_local_dev_auth,
)
from app.core.snowflake_agent import SnowflakeAgentClient
from app.core.snowflake_analyst import SnowflakeAnalystClient
from app.core.derived_source import DerivedSourceService
from app.core.conversation import ConversationService
from app.core.conversation_memory import ConversationMemoryService
from app.core.semantic_context import SemanticContextService
from app.core.semantic_model import SemanticModelService
from app.core.table_selection import TableSelectionService
from app.core.sttm_builder import STTMBuilderService
from app.core.user import UserService

_SPCS_USER_TOKEN_HEADER = "sf-context-current-user-token"


def _default_role_for_principal(request: Request, settings: Settings) -> str | None:
    user_token = request.headers.get(_SPCS_USER_TOKEN_HEADER, "")
    if using_local_dev_auth(settings, user_token):
        return settings.snowflake_role or None

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
    if using_local_dev_auth(settings, user_token) and settings.local_dev_uses_externalbrowser:
        client = get_local_cached_client(settings, effective_role)
        yield client
        return

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


def get_snowflake_analyst_client(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SnowflakeAnalystClient:
    """Returns a Cortex Analyst client authenticated with the caller's Snowflake context."""
    user_token = request.headers.get(_SPCS_USER_TOKEN_HEADER, "")
    if using_local_dev_auth(settings, user_token):
        context = client.get_rest_session_context()
        return SnowflakeAnalystClient(
            token=context.token,
            host=context.host,
            auth_mode="snowflake_token",
        )

    return SnowflakeAnalystClient(
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


def get_semantic_model_service(
    settings: Annotated[Settings, Depends(get_settings)],
) -> SemanticModelService:
    return SemanticModelService(settings)


def get_datahub_adapter(
    settings: Annotated[Settings, Depends(get_settings)],
) -> DataHubAdapter:
    return DataHubAdapter(settings)


def get_semantic_context_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    semantic_model_service: Annotated[SemanticModelService, Depends(get_semantic_model_service)],
    datahub_adapter: Annotated[DataHubAdapter, Depends(get_datahub_adapter)],
) -> SemanticContextService:
    table_selection_service = TableSelectionService(client, settings)
    derived_source_service = DerivedSourceService(client.session, settings)
    return SemanticContextService(
        session=client.session,
        settings=settings,
        semantic_model_service=semantic_model_service,
        table_selection_service=table_selection_service,
        derived_source_service=derived_source_service,
        datahub_adapter=datahub_adapter,
    )


def get_sttm_builder_service(
    agent_client: Annotated[SnowflakeAgentClient, Depends(get_snowflake_agent_client)],
    analyst_client: Annotated[SnowflakeAnalystClient, Depends(get_snowflake_analyst_client)],
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    semantic_model_service: Annotated[SemanticModelService, Depends(get_semantic_model_service)],
    semantic_context_service: Annotated[SemanticContextService, Depends(get_semantic_context_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> STTMBuilderService:
    return STTMBuilderService(
        agent_client,
        analyst_client=analyst_client,
        settings=settings,
        session=client.session,
        semantic_model_service=semantic_model_service,
        semantic_context_service=semantic_context_service,
    )


def get_conversation_memory_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ConversationMemoryService:
    return ConversationMemoryService(client.session, settings)


def get_conversation_service(
    agent_client: Annotated[SnowflakeAgentClient, Depends(get_snowflake_agent_client)],
    sttm_builder_service: Annotated[STTMBuilderService, Depends(get_sttm_builder_service)],
    conversation_memory: Annotated[ConversationMemoryService, Depends(get_conversation_memory_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ConversationService:
    return ConversationService(
        agent_client,
        sttm_builder_service=sttm_builder_service,
        memory_service=conversation_memory,
        settings=settings,
    )


def get_user_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserService:
    return UserService(client, settings)
