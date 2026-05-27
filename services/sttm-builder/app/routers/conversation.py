from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.deps import get_conversation_service
from app.auth.dependencies import get_current_principal
from app.core.conversation import ConversationService
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
    ConversationSearchResponseData,
    ConversationSearchRequestEnvelope,
)

router = APIRouter(prefix="/workbench/conversation", tags=["Conversation"])


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
) -> Any:
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
) -> StreamingResponse:
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
    service: Annotated[ConversationService, Depends(get_conversation_service)],
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
    service: Annotated[ConversationService, Depends(get_conversation_service)],
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
