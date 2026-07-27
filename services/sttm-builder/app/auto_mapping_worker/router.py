import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_sttm_builder_service
from app.core.sttm_builder import STTMBuilderService
from app.schema.contracts import resolve_request_id
from app.schema.sttm_builder import (
    STTMBuilderEnvelopeRequest,
    STTMBuilderRequest,
    STTMBuilderResponse,
    normalize_sttm_builder_invoke_body,
)

router = APIRouter(prefix="/api/v1/auto-mapping", tags=["Auto Mapping Worker"])
logger = logging.getLogger(__name__)


@router.post(
    "/invoke",
    response_model=STTMBuilderResponse,
    summary="Run auto-mapping in parallel inside the private worker service",
)
async def invoke(
    request: Request,
    body: STTMBuilderEnvelopeRequest | STTMBuilderRequest,
    service: Annotated[STTMBuilderService, Depends(get_sttm_builder_service)],
) -> STTMBuilderResponse:
    normalized = normalize_sttm_builder_invoke_body(body)
    if not normalized.request_id:
        normalized = normalized.model_copy(update={"request_id": resolve_request_id(request)})
    logger.info(
        "Auto-mapping worker received request_id=%s attributes=%s source_tables=%s",
        normalized.request_id,
        len(normalized.data.attributes or []),
        len(normalized.context.source_tables or []),
    )
    return await service.invoke_auto_map_parallel(normalized)
