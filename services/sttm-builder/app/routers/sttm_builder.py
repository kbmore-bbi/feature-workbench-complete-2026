from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.api.deps import get_sttm_builder_service
from app.core.sttm_builder import STTMBuilderService
from app.schema.workbench import WorkbenchInfoResponse
from app.schema.sttm_builder import STTMBuilderRequest, STTMBuilderResponse

router = APIRouter(prefix="/workbench", tags=["STTM Builder"])


@router.get(
    "/info",
    response_model=WorkbenchInfoResponse,
    summary="Get basic workbench metadata",
)
def info(
    settings: Annotated[Settings, Depends(get_settings)],
) -> WorkbenchInfoResponse:
    return WorkbenchInfoResponse(
        name=settings.app_name,
        environment=settings.app_env,
        version=settings.app_version,
        api_base_path="/api/v1",
        health_path="/healthz",
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
    body: STTMBuilderRequest,
    service: Annotated[STTMBuilderService, Depends(get_sttm_builder_service)],
) -> STTMBuilderResponse:
    return service.invoke(body)
