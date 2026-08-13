from collections.abc import Generator
import logging
import time
from typing import Annotated, Optional

from fastapi import Depends, HTTPException, Query, Request

from app.auth.dependencies import get_current_principal
from app.auth.models import AppPersona
from app.core.config import Settings, get_settings
from app.core.auto_mapping_proxy import AutoMappingProxyClient
from app.core.bundle_curation import BundleCurationService
from app.core.datahub import DataHubAdapter
from app.core.snowflake import (
    SnowflakeClient,
    SnowflakeSessionLeasePool,
    get_oauth_cached_client,
    get_local_cached_client,
    using_local_dev_auth,
)
from app.core.snowflake_agent import SnowflakeAgentClient
from app.core.snowflake_analyst import SnowflakeAnalystClient
from app.core.dbt_conversion import DbtConversionService
from app.core.agent_artifact_jobs import AgentArtifactJobService
from app.core.derived_source import DerivedSourceService
from app.core.conversation import ConversationService
from app.core.conversation_memory import ConversationMemoryService
from app.core.learning_retrieval import LearningRetrievalService
from app.core.mapping_sql import MappingSqlService
from app.core.export_workbook import WorkbookExportService
from app.core.project_service import ProjectService
from app.core.recommendation_actions import RecommendationActionService
from app.core.prepared_context import PreparedWorkspaceContextService
from app.core.semantic_context import SemanticContextService
from app.core.semantic_model import SemanticModelService
from app.core.table_selection import TableSelectionService
from app.core.test_case_generation import TestCaseGenerationService
from app.core.sttm_builder import STTMBuilderService
from app.core.user import UserService
from app.core.warehouse_routing import WarehouseWorkload

logger = logging.getLogger(__name__)

_SPCS_USER_TOKEN_HEADER = "sf-context-current-user-token"
_FORWARDED_CALLER_ROLE_HEADER = "x-workbench-caller-role"


def _learning_session_lease(request: Request, settings: Settings):
    if not (
        settings.snowflake_session_lease_pool_v1
        and (settings.learning_parallel_v1 or settings.prepare_parallel_v1)
    ):
        return None
    pool = getattr(request.state, "snowflake_learning_lease_pool", None)
    if pool is None:
        user_token = _request_user_token(request, settings)
        pool = SnowflakeSessionLeasePool(
            settings=settings,
            user_token=user_token,
            role=_default_role_for_principal(request, settings),
            workload=WarehouseWorkload.PREPARATION,
            maximum=min(
                settings.snowflake_session_lease_limit_per_instance,
                settings.learning_parallel_workers,
            ),
        )
        request.state.snowflake_learning_lease_pool = pool
    return pool.lease


def _role_for_persona(persona: AppPersona, settings: Settings) -> str | None:
    if persona is AppPersona.ADMIN:
        return settings.app_role_admin or None
    if persona is AppPersona.PUBLISHER:
        return settings.app_role_publisher or None
    if persona is AppPersona.VIEWER:
        return settings.app_role_viewer or None
    return None


def _default_role_for_principal(request: Request, settings: Settings) -> str | None:
    principal = getattr(request.state, "current_principal", None)
    if principal is None:
        principal = get_current_principal(request)

    if settings.uses_custom_oauth:
        return principal.snowflake_role or _role_for_persona(principal.app_persona, settings)

    if not settings.spcs_execute_as_caller_enabled:
        return settings.snowflake_role or None

    forwarded_role = request.headers.get(_FORWARDED_CALLER_ROLE_HEADER, "").strip()
    if forwarded_role:
        return forwarded_role

    user_token = request.headers.get(_SPCS_USER_TOKEN_HEADER, "")
    if using_local_dev_auth(settings, user_token):
        return settings.snowflake_role or None

    return _role_for_persona(principal.app_persona, settings)


def _access_scope_for_request(request: Request) -> str:
    principal = get_current_principal(request)
    return "|".join(
        [
            str(principal.user_id),
            str(principal.app_persona.value),
            str(principal.snowflake_role or ""),
        ]
    )


def _request_user_token(request: Request, settings: Settings) -> str:
    if settings.local_dev_auth_enabled:
        return request.headers.get(_SPCS_USER_TOKEN_HEADER, "")
    if settings.uses_custom_oauth:
        return _custom_oauth_principal(request).snowflake_user_token
    return request.headers.get(_SPCS_USER_TOKEN_HEADER, "")


def _custom_oauth_principal(request: Request):
    principal = getattr(request.state, "current_principal", None)
    if principal is None:
        principal = get_current_principal(request)
        request.state.current_principal = principal
    if principal.auth_source != "custom_oauth" or not principal.snowflake_user_token:
        raise HTTPException(
            status_code=401,
            detail="A signed-in Snowflake OAuth session is required.",
        )
    return principal


def _get_snowflake_client_for_workload(
    request: Request,
    settings: Settings,
    *,
    role: str | None,
    workload: WarehouseWorkload,
) -> Generator[SnowflakeClient, None, None]:
    user_token = _request_user_token(request, settings)
    effective_role = role or _default_role_for_principal(request, settings)
    started = time.perf_counter()
    logger.info(
        "Opening Snowflake session for %s with role=%s workload=%s local_dev=%s",
        request.url.path,
        effective_role or "<default>",
        workload.value,
        using_local_dev_auth(settings, user_token),
    )
    # Session construction is substantially more expensive than metadata SQL.
    # Reuse a user/role-scoped Snowpark client for every local auth mode, not
    # only external-browser auth.
    if using_local_dev_auth(settings, user_token):
        client = get_local_cached_client(settings, effective_role, workload)
        getattr(request.state, "workbench_timings_ms", {})["session"] = (
            time.perf_counter() - started
        ) * 1000
        yield client
        return

    # The cache key contains only a token fingerprint plus the effective role
    # and Snowflake context. It is therefore safe for both custom OAuth and
    # SPCS execute-as-caller tokens, and never mixes caller identities.
    if user_token.strip():
        client = get_oauth_cached_client(
            settings,
            user_token,
            effective_role,
            workload,
        )
        getattr(request.state, "workbench_timings_ms", {})["session"] = (
            time.perf_counter() - started
        ) * 1000
        yield client
        return

    client = SnowflakeClient(
        settings=settings,
        user_token=user_token,
        role=effective_role,
        workload=workload,
    )
    getattr(request.state, "workbench_timings_ms", {})["session"] = (
        time.perf_counter() - started
    ) * 1000
    try:
        yield client
    finally:
        client.close()


def get_snowflake_client(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    role: Annotated[Optional[str], Query(description="Snowflake role to activate for this session")] = None,
) -> Generator[SnowflakeClient, None, None]:
    """Acquire the CONTROL warehouse for metadata and durable state."""

    yield from _get_snowflake_client_for_workload(
        request,
        settings,
        role=role,
        workload=WarehouseWorkload.CONTROL,
    )


def get_agent_snowflake_client(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Generator[SnowflakeClient, None, None]:
    yield from _get_snowflake_client_for_workload(
        request,
        settings,
        role=None,
        workload=WarehouseWorkload.AGENT,
    )


def get_execution_snowflake_client(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Generator[SnowflakeClient, None, None]:
    yield from _get_snowflake_client_for_workload(
        request,
        settings,
        role=None,
        workload=WarehouseWorkload.EXECUTION,
    )


def get_automap_snowflake_client(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Generator[SnowflakeClient, None, None]:
    yield from _get_snowflake_client_for_workload(
        request,
        settings,
        role=None,
        workload=WarehouseWorkload.AUTOMAP,
    )


def get_preparation_snowflake_client(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Generator[SnowflakeClient, None, None]:
    """A separately tagged preparation session; it remains on XS unless enabled."""
    yield from _get_snowflake_client_for_workload(
        request,
        settings,
        role=None,
        workload=WarehouseWorkload.PREPARATION,
    )


def get_snowflake_agent_client(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_agent_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SnowflakeAgentClient:
    """Returns a Cortex Agent client authenticated with the caller's Snowflake context."""
    user_token = _request_user_token(request, settings)
    if using_local_dev_auth(settings, user_token):
        context = client.get_rest_session_context()
        return SnowflakeAgentClient(
            token=context.token,
            host=context.host,
            auth_mode="snowflake_token",
        )

    if settings.uses_custom_oauth:
        principal = _custom_oauth_principal(request)
        role = principal.snowflake_role or _role_for_persona(principal.app_persona, settings)
        host = settings.rest_snowflake_host or client.get_rest_session_context().host
        return SnowflakeAgentClient(
            token=principal.snowflake_user_token,
            host=host,
            auth_mode="oauth_bearer",
            role=role,
            warehouse=client.warehouse or None,
        )

    context = client.get_rest_session_context()
    return SnowflakeAgentClient(
        token=context.token,
        host=context.host,
        auth_mode="snowflake_token",
    )


def get_snowflake_analyst_client(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_agent_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SnowflakeAnalystClient:
    """Returns a Cortex Analyst client authenticated with the caller's Snowflake context."""
    user_token = _request_user_token(request, settings)
    if using_local_dev_auth(settings, user_token):
        context = client.get_rest_session_context()
        return SnowflakeAnalystClient(
            token=context.token,
            host=context.host,
            auth_mode="snowflake_token",
        )

    if settings.uses_custom_oauth:
        principal = _custom_oauth_principal(request)
        role = principal.snowflake_role or _role_for_persona(principal.app_persona, settings)
        host = settings.rest_snowflake_host or client.get_rest_session_context().host
        return SnowflakeAnalystClient(
            token=principal.snowflake_user_token,
            host=host,
            auth_mode="oauth_bearer",
            role=role,
            warehouse=client.warehouse or None,
        )

    context = client.get_rest_session_context()
    return SnowflakeAnalystClient(
        token=context.token,
        host=context.host,
        auth_mode="snowflake_token",
    )


def get_table_selection_service(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> TableSelectionService:
    return TableSelectionService(client, settings, _access_scope_for_request(request))


def get_derived_source_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> DerivedSourceService:
    return DerivedSourceService(client.session, settings)


def get_derived_source_execution_service(
    client: Annotated[SnowflakeClient, Depends(get_execution_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> DerivedSourceService:
    """Derived-source SQL validation/save path on the execution warehouse."""

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
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    semantic_model_service: Annotated[SemanticModelService, Depends(get_semantic_model_service)],
    datahub_adapter: Annotated[DataHubAdapter, Depends(get_datahub_adapter)],
) -> SemanticContextService:
    access_scope = _access_scope_for_request(request)
    table_selection_service = TableSelectionService(client, settings, access_scope)
    derived_source_service = DerivedSourceService(client.session, settings)
    return SemanticContextService(
        session=client.session,
        settings=settings,
        semantic_model_service=semantic_model_service,
        table_selection_service=table_selection_service,
        derived_source_service=derived_source_service,
        datahub_adapter=datahub_adapter,
        access_scope=access_scope,
    )


def get_prepared_workspace_context_service(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    semantic_context_service: Annotated[
        SemanticContextService, Depends(get_semantic_context_service)
    ],
) -> PreparedWorkspaceContextService:
    access_scope = _access_scope_for_request(request)
    session_lease = _learning_session_lease(request, settings)

    def refresh_semantic_on_lease(refresh_request):
        if session_lease is None:
            return semantic_context_service.refresh_bundle(refresh_request)
        with session_lease() as leased_client:
            leased_service = SemanticContextService(
                session=leased_client.session,
                settings=settings,
                semantic_model_service=SemanticModelService(settings),
                table_selection_service=TableSelectionService(
                    leased_client,
                    settings,
                    access_scope,
                ),
                derived_source_service=DerivedSourceService(
                    leased_client.session,
                    settings,
                ),
                datahub_adapter=DataHubAdapter(settings),
                access_scope=access_scope,
            )
            return leased_service.refresh_bundle(refresh_request)

    return PreparedWorkspaceContextService(
        session=client.session,
        settings=settings,
        semantic_service=semantic_context_service,
        learning_service=LearningRetrievalService(
            client.session,
            settings,
            access_scope,
            session_lease=session_lease,
        ),
        access_scope=access_scope,
        semantic_refresh=(
            refresh_semantic_on_lease
            if settings.snowflake_session_lease_pool_v1
            and settings.prepare_parallel_v1
            else None
        ),
    )


def get_sttm_builder_service(
    request: Request,
    agent_client: Annotated[SnowflakeAgentClient, Depends(get_snowflake_agent_client)],
    analyst_client: Annotated[SnowflakeAnalystClient, Depends(get_snowflake_analyst_client)],
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    agent_session_client: Annotated[SnowflakeClient, Depends(get_agent_snowflake_client)],
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
        access_scope=_access_scope_for_request(request),
        query_session=agent_session_client.session,
    )


def get_auto_mapping_proxy_client(
    settings: Annotated[Settings, Depends(get_settings)],
) -> AutoMappingProxyClient:
    return AutoMappingProxyClient(settings)


def get_conversation_memory_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ConversationMemoryService:
    return ConversationMemoryService(client.session, settings)


def get_project_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    conversation_memory: Annotated[ConversationMemoryService, Depends(get_conversation_memory_service)],
) -> ProjectService:
    return ProjectService(
        session=client.session,
        settings=settings,
        memory_service=conversation_memory,
    )


def get_recommendation_action_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    project_service: Annotated[ProjectService, Depends(get_project_service)],
    conversation_memory: Annotated[
        ConversationMemoryService, Depends(get_conversation_memory_service)
    ],
    derived_source_service: Annotated[
        DerivedSourceService, Depends(get_derived_source_execution_service)
    ],
) -> RecommendationActionService:
    return RecommendationActionService(
        session=client.session,
        settings=settings,
        project_service=project_service,
        memory_service=conversation_memory,
        derived_source_service=derived_source_service,
    )


def get_bundle_curation_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BundleCurationService:
    return BundleCurationService(client.session, settings)


def get_conversation_service(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
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
        learning_service=LearningRetrievalService(
            client.session, settings, _access_scope_for_request(request)
        ),
    )


def get_conversation_light_service(
    conversation_memory: Annotated[ConversationMemoryService, Depends(get_conversation_memory_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ConversationService:
    """Conversation memory/FIR service without agent or STTM Builder dependencies.

    Settings, signal, and search endpoints used to instantiate the full agent stack,
    which forced Snowflake Agent/Analyst/STTM dependencies onto lightweight UI polling.
    """
    return ConversationService(
        None,
        sttm_builder_service=None,
        memory_service=conversation_memory,
        settings=settings,
    )


def get_mapping_sql_service(
    analyst_client: Annotated[SnowflakeAnalystClient, Depends(get_snowflake_analyst_client)],
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> MappingSqlService:
    return MappingSqlService(
        session=client.session,
        analyst_client=analyst_client,
        settings=settings,
    )


def get_mapping_sql_execution_service(
    analyst_client: Annotated[SnowflakeAnalystClient, Depends(get_snowflake_analyst_client)],
    client: Annotated[SnowflakeClient, Depends(get_execution_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> MappingSqlService:
    return MappingSqlService(
        session=client.session,
        analyst_client=analyst_client,
        settings=settings,
    )


def get_dbt_conversion_service(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    agent_client: Annotated[SnowflakeAgentClient, Depends(get_snowflake_agent_client)],
    conversation_memory: Annotated[ConversationMemoryService, Depends(get_conversation_memory_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> DbtConversionService:
    return DbtConversionService(
        agent_client=agent_client,
        settings=settings,
        learning_service=LearningRetrievalService(
            client.session, settings, _access_scope_for_request(request)
        ),
        memory_service=conversation_memory,
    )


def get_agent_artifact_job_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AgentArtifactJobService:
    return AgentArtifactJobService(client.session, settings)


def get_test_case_generation_service(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    agent_client: Annotated[SnowflakeAgentClient, Depends(get_snowflake_agent_client)],
    conversation_memory: Annotated[ConversationMemoryService, Depends(get_conversation_memory_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> TestCaseGenerationService:
    return TestCaseGenerationService(
        agent_client=agent_client,
        settings=settings,
        learning_service=LearningRetrievalService(
            client.session, settings, _access_scope_for_request(request)
        ),
        memory_service=conversation_memory,
    )


def get_workbook_export_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
) -> WorkbookExportService:
    return WorkbookExportService(session=client.session)


def get_user_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserService:
    return UserService(client, settings)
