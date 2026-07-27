from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.deps import (
    get_conversation_light_service,
    get_conversation_service,
    get_prepared_workspace_context_service,
)
from app.auth.dependencies import get_current_principal
from app.core.conversation import ConversationService
from app.core.prepared_context import PreparedWorkspaceContextService
from app.core.config import get_settings
from app.guardrails.config.loader import load_config
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.integrations.fastapi import attach_governance_decision
from app.guardrails.runtime.preflight import PreflightGuard
from app.schema.contracts import ApiActor, ApiResponseEnvelope, build_response_envelope, resolve_request_id
from app.schema.conversation import (
    ConversationIndexSyncResponseData,
    ConversationIndexSyncRequestEnvelope,
    ConversationRequestEnvelope,
    ConversationSettingsRequestEnvelope,
    ConversationSettingsResponseData,
    ConversationSignalsListRequestEnvelope,
    ConversationSignalsRespondRequestEnvelope,
    ConversationSignalsResponseData,
    ConversationSearchResponseData,
    ConversationSearchRequestEnvelope,
    AssistantPreferenceState,
    AssistantSignalResponseData,
)

router = APIRouter(prefix="/workbench/conversation", tags=["Conversation"])


def _hydrate_prepared_workspace(
    body: ConversationRequestEnvelope,
    prepared_service: PreparedWorkspaceContextService,
) -> ConversationRequestEnvelope:
    context_id = (body.context.workspace_context_id or "").strip()
    if not context_id:
        return body
    hydrated = prepared_service.hydrate(context_id)
    if not hydrated:
        return body
    prepared = hydrated["prepared"]
    if (
        body.context.workspace_context_hash
        and body.context.workspace_context_hash != prepared.workspace_context_hash
    ):
        return body
    workspace = hydrated["workspace"]
    learning = hydrated.get("learning_context")
    updates: dict[str, Any] = {
        "workspace_context": workspace,
        "semantic_bundle_id": prepared.semantic_bundle_id,
        "semantic_bundle_hash": prepared.semantic_bundle_hash,
        "learning_context_id": prepared.learning_context_id,
        "learning_context_hash": prepared.learning_context_hash,
        "artifact_refs": prepared.artifact_refs,
        "prepared_context_hash": prepared.workspace_context_hash,
    }
    if learning is not None:
        updates["learning_context"] = learning
    return body.model_copy(
        update={"context": body.context.model_copy(update=updates)}
    )


def _apply_conversation_preflight(
    request: Request,
    body: ConversationRequestEnvelope,
) -> tuple[ConversationRequestEnvelope, GovernanceDecision]:
    normalized = body
    if not normalized.request_id:
        normalized = normalized.model_copy(update={"request_id": resolve_request_id(request)})

    principal = get_current_principal(request)
    trace_id = getattr(request.state, "trace_id", None) or normalized.context.trace_id or normalized.request_id
    normalized = normalized.model_copy(
        update={
            "actor": ApiActor(user_id=str(principal.user_id), role=principal.app_persona.value),
        }
    )
    guard = PreflightGuard(load_config(settings=get_settings()))
    payload, decision = guard.apply_to_request(
        normalized.model_dump(mode="json"),
        trace_id=str(trace_id),
        persona=principal.app_persona.value,
        strip_samples=False,
    )
    payload["warnings"] = [
        *payload.get("warnings", []),
        *(warning.model_dump() for warning in decision.warnings),
    ]
    guarded = ConversationRequestEnvelope.model_validate(payload)
    attach_governance_decision(request, decision)
    return guarded, decision


@router.post(
    "/invoke",
    summary="Invoke the governed conversation path",
    description=(
        "Routes conversation requests through deterministic governance first, then either "
        "the conversation agent or a controlled STTM handoff."
    ),
)
def invoke(
    request: Request,
    body: ConversationRequestEnvelope,
    service: Annotated[ConversationService, Depends(get_conversation_service)],
    prepared_service: Annotated[
        PreparedWorkspaceContextService,
        Depends(get_prepared_workspace_context_service),
    ],
) -> Any:
    body = _hydrate_prepared_workspace(body, prepared_service)
    normalized, decision = _apply_conversation_preflight(request, body)
    return service.invoke(normalized, governance_decision=decision)


@router.post(
    "/invoke/stream",
    summary="Invoke the governed conversation path as an SSE stream",
)
def invoke_stream(
    request: Request,
    body: ConversationRequestEnvelope,
    service: Annotated[ConversationService, Depends(get_conversation_service)],
    prepared_service: Annotated[
        PreparedWorkspaceContextService,
        Depends(get_prepared_workspace_context_service),
    ],
) -> StreamingResponse:
    body = _hydrate_prepared_workspace(body, prepared_service)
    normalized, decision = _apply_conversation_preflight(request, body)
    return StreamingResponse(
        service.invoke_stream(normalized, governance_decision=decision),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/search",
    summary="Query the conversation Cortex Search-backed RAG index",
)
def search(
    request: Request,
    body: ConversationSearchRequestEnvelope,
    service: Annotated[ConversationService, Depends(get_conversation_light_service)],
) -> ApiResponseEnvelope[ConversationSearchResponseData]:
    normalized = body
    if not normalized.request_id:
        normalized = normalized.model_copy(update={"request_id": resolve_request_id(request)})
    return build_response_envelope(
        operation=normalized.operation,
        request=request,
        request_id=normalized.request_id,
        actor=normalized.actor,
        context=normalized.context.model_dump(mode="json", exclude_none=True),
        data=service.search(normalized.data),
    )


@router.post(
    "/index/sync",
    summary="Rebuild structured RAG documents and ensure the Cortex Search service",
)
def sync_index(
    request: Request,
    body: ConversationIndexSyncRequestEnvelope,
    service: Annotated[ConversationService, Depends(get_conversation_light_service)],
) -> ApiResponseEnvelope[ConversationIndexSyncResponseData]:
    normalized = body
    if not normalized.request_id:
        normalized = normalized.model_copy(update={"request_id": resolve_request_id(request)})
    return build_response_envelope(
        operation=normalized.operation,
        request=request,
        request_id=normalized.request_id,
        actor=normalized.actor,
        context=normalized.context.model_dump(mode="json", exclude_none=True),
        data=service.sync_index(normalized.data),
    )


@router.post("/settings")
def settings(
    request: Request,
    body: ConversationSettingsRequestEnvelope,
    service: Annotated[ConversationService, Depends(get_conversation_light_service)],
) -> ApiResponseEnvelope[ConversationSettingsResponseData]:
    normalized = body
    if not normalized.request_id:
        normalized = normalized.model_copy(update={"request_id": resolve_request_id(request)})
    principal = get_current_principal(request)
    actor = ApiActor(user_id=str(principal.user_id), role=principal.app_persona.value)
    data = (
        service.update_assistant_settings(
            user_id=actor.user_id,
            settings=AssistantPreferenceState.model_validate(
                normalized.data.model_dump() if hasattr(normalized.data, "model_dump") else (normalized.data or {})
            ),
        )
        if normalized.operation == "conversation.settings.update"
        else service.get_assistant_settings(user_id=actor.user_id)
    )
    return build_response_envelope(
        operation=normalized.operation,
        request=request,
        request_id=normalized.request_id,
        actor=actor,
        context=normalized.context.model_dump(mode="json", exclude_none=True),
        data=data,
    )


@router.post("/signals")
def list_signals(
    request: Request,
    body: ConversationSignalsListRequestEnvelope,
    service: Annotated[ConversationService, Depends(get_conversation_light_service)],
) -> ApiResponseEnvelope[ConversationSignalsResponseData]:
    normalized = body
    if not normalized.request_id:
        normalized = normalized.model_copy(update={"request_id": resolve_request_id(request)})
    principal = get_current_principal(request)
    actor = ApiActor(user_id=str(principal.user_id), role=principal.app_persona.value)
    return build_response_envelope(
        operation=normalized.operation,
        request=request,
        request_id=normalized.request_id,
        actor=actor,
        context=normalized.context.model_dump(mode="json", exclude_none=True),
        data=service.list_signals(user_id=actor.user_id),
    )


@router.post("/signals/respond")
def respond_to_signal(
    request: Request,
    body: ConversationSignalsRespondRequestEnvelope,
    service: Annotated[ConversationService, Depends(get_conversation_light_service)],
) -> ApiResponseEnvelope[AssistantSignalResponseData]:
    normalized = body
    if not normalized.request_id:
        normalized = normalized.model_copy(update={"request_id": resolve_request_id(request)})
    principal = get_current_principal(request)
    actor = ApiActor(user_id=str(principal.user_id), role=principal.app_persona.value)
    return build_response_envelope(
        operation=normalized.operation,
        request=request,
        request_id=normalized.request_id,
        actor=actor,
        context=normalized.context.model_dump(mode="json", exclude_none=True),
        data=service.respond_to_signal(
            request_id=normalized.request_id,
            conversation_id=normalized.context.thread_id,
            user_id=actor.user_id,
            payload=normalized.data,
        ),
    )
