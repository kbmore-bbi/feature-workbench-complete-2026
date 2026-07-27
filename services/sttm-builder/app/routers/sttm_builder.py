import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.auth.dependencies import get_current_principal
from app.core.auto_mapping_proxy import AutoMappingProxyClient
from app.core.config import Settings, get_settings
from app.api.deps import (
    get_auto_mapping_proxy_client,
    get_prepared_workspace_context_service,
    get_sttm_builder_service,
)
from app.core.prepared_context import (
    PreparedWorkspaceContextService,
    merge_workspace_overlay,
)
from app.core.sttm_builder import STTMBuilderService
from app.guardrails.config.loader import load_config
from app.guardrails.integrations.fastapi import attach_governance_decision
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.runtime.preflight import PreflightGuard
from app.schema.contracts import ApiResponseEnvelope, build_response_envelope, resolve_request_id
from app.schema.workbench import WorkbenchInfoResponse
from app.schema.sttm_builder import (
    STTMBuilderEnvelopeRequest,
    STTMBuilderRequest,
    STTMBuilderResponse,
    normalize_sttm_builder_invoke_body,
)

router = APIRouter(prefix="/workbench", tags=["STTM Builder"])
logger = logging.getLogger(__name__)


def _hydrate_prepared_workspace(
    body: STTMBuilderEnvelopeRequest,
    prepared_service: PreparedWorkspaceContextService,
) -> STTMBuilderEnvelopeRequest:
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
    updates = {
        "workspace_context": merge_workspace_overlay(
            hydrated["workspace"],
            body.context.workspace_context,
        ),
        "semantic_bundle_id": prepared.semantic_bundle_id,
        "semantic_bundle_hash": prepared.semantic_bundle_hash,
        "learning_context_id": prepared.learning_context_id,
        "learning_context_hash": prepared.learning_context_hash,
        "artifact_refs": prepared.artifact_refs,
        "learning_context": hydrated.get("learning_context"),
        "prepared_context_hash": prepared.workspace_context_hash,
    }
    return body.model_copy(
        update={"context": body.context.model_copy(update=updates)}
    )


def _apply_sttm_preflight(
    request: Request,
    body: STTMBuilderEnvelopeRequest | STTMBuilderRequest,
) -> tuple[STTMBuilderEnvelopeRequest, GovernanceDecision]:
    normalized = normalize_sttm_builder_invoke_body(body)
    if not normalized.request_id:
        normalized = normalized.model_copy(update={"request_id": resolve_request_id(request)})

    principal = get_current_principal(request)
    trace_id = getattr(request.state, "trace_id", None) or normalized.context.trace_id or normalized.request_id
    guard = PreflightGuard(load_config(settings=get_settings()))
    payload, decision = guard.apply_to_sttm_request(
        normalized.model_dump(mode="json"),
        trace_id=str(trace_id),
        persona=principal.app_persona.value,
    )
    payload["warnings"] = [
        *payload.get("warnings", []),
        *(warning.model_dump() for warning in decision.warnings),
    ]
    guarded = STTMBuilderEnvelopeRequest.model_validate(payload)
    attach_governance_decision(request, decision)
    return guarded, decision


@router.get(
    "/info",
    response_model=ApiResponseEnvelope[WorkbenchInfoResponse],
    summary="Get basic workbench metadata",
)
def info(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponseEnvelope[WorkbenchInfoResponse]:
    return build_response_envelope(
        operation="workbench.info",
        request=request,
        data=WorkbenchInfoResponse(
        name=settings.app_name,
        environment=settings.app_env,
        version=settings.app_version,
        api_base_path="/api/v1",
        health_path="/healthz",
        ),
    )


@router.post(
    "/invoke",
    response_model=STTMBuilderResponse,
    summary="Invoke the STTM Builder orchestration agent",
    description=(
        "Sends a request to STTM_BUILDER_AGENT, which routes it to the appropriate "
        "sub-agent based on the `interface` field.\n\n"
        "**Interfaces**\n"
        "- `AUTO_MAP` — button-triggered mapping. Provide `attributes` (list of target "
        "attributes, each with optional current source mapping) and `source_tables` (pool of "
        "available source tables). Add `message` to include refinement context.\n"
        "- `TRANSFORM` — transformation rule generation. Same structured fields as AUTO_MAP.\n"
        "- `CHAT` — free-text `message`. The orchestration agent decides which sub-agent to "
        "call; the response always includes a `message` summarising the action or asking a "
        "follow-up.\n\n"
        "Pass `thread_id` from a previous response to continue the same agent session."
    ),
)
def invoke(
    request: Request,
    body: STTMBuilderEnvelopeRequest | STTMBuilderRequest,
    service: Annotated[STTMBuilderService, Depends(get_sttm_builder_service)],
    auto_mapping_proxy: Annotated[AutoMappingProxyClient, Depends(get_auto_mapping_proxy_client)],
    prepared_service: Annotated[
        PreparedWorkspaceContextService,
        Depends(get_prepared_workspace_context_service),
    ],
) -> STTMBuilderResponse:
    if isinstance(body, STTMBuilderEnvelopeRequest):
        body = _hydrate_prepared_workspace(body, prepared_service)
    normalized, decision = _apply_sttm_preflight(request, body)
    if auto_mapping_proxy.should_delegate(normalized):
        prepared = service.prepare_auto_map_request(normalized)
        return auto_mapping_proxy.invoke(request, prepared)
    return service.invoke(normalized, governance_decision=decision)


@router.post(
    "/invoke/stream",
    summary="Invoke the STTM Builder orchestration agent as an SSE stream",
)
def invoke_stream(
    request: Request,
    body: STTMBuilderEnvelopeRequest | STTMBuilderRequest,
    service: Annotated[STTMBuilderService, Depends(get_sttm_builder_service)],
    auto_mapping_proxy: Annotated[AutoMappingProxyClient, Depends(get_auto_mapping_proxy_client)],
    prepared_service: Annotated[
        PreparedWorkspaceContextService,
        Depends(get_prepared_workspace_context_service),
    ],
) -> StreamingResponse:
    if isinstance(body, STTMBuilderEnvelopeRequest):
        body = _hydrate_prepared_workspace(body, prepared_service)
    normalized, decision = _apply_sttm_preflight(request, body)
    if auto_mapping_proxy.should_delegate(normalized):
        return StreamingResponse(
            auto_mapping_proxy.invoke_stream(
                request,
                normalized,
                prepare_request=service.prepare_auto_map_request,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    return StreamingResponse(
        service.invoke_stream(normalized, governance_decision=decision),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
