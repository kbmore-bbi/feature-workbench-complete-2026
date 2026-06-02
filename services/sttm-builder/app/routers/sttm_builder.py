from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.auth.dependencies import get_current_principal
from app.core.config import Settings, get_settings
from app.api.deps import get_sttm_builder_service
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
) -> STTMBuilderResponse:
    normalized, decision = _apply_sttm_preflight(request, body)
    return service.invoke(normalized, governance_decision=decision)


@router.post(
    "/invoke/stream",
    summary="Invoke the STTM Builder orchestration agent as an SSE stream",
)
def invoke_stream(
    request: Request,
    body: STTMBuilderEnvelopeRequest | STTMBuilderRequest,
    service: Annotated[STTMBuilderService, Depends(get_sttm_builder_service)],
) -> StreamingResponse:
    normalized, decision = _apply_sttm_preflight(request, body)
    return StreamingResponse(
        service.invoke_stream(normalized, governance_decision=decision),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
