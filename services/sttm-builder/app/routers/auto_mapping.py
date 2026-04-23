from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import get_auto_mapping_service
from app.core.auto_mapping import AutoMappingService
from app.schema.auto_mapping import (
    AutoMappingRequest,
    AutoMappingResponse,
    MappingRefinementRequest,
    MappingRefinementResponse,
)

router = APIRouter(prefix="/auto-mapping", tags=["Auto Mapping"])


@router.post(
    "/suggest",
    response_model=AutoMappingResponse,
    summary="Suggest attribute mappings via the Cortex Auto-Map Agent",
    description=(
        "Sends the target table, target attributes, and source tables to the "
        "Snowflake Cortex Auto-Map Agent. The agent fetches DDL for each table and "
        "returns a mapping suggestion with confidence scores for every target attribute.\n\n"
        "Pass `thread_id` from a previous response to continue the same agent session."
    ),
)
def suggest_auto_mapping(
    body: AutoMappingRequest,
    service: Annotated[AutoMappingService, Depends(get_auto_mapping_service)],
) -> AutoMappingResponse:
    return service.suggest(
        target_table=body.target_table,
        target_attributes=body.target_attributes,
        source_tables=body.source_tables,
        thread_id=body.thread_id,
    )


@router.post(
    "/refine",
    response_model=MappingRefinementResponse,
    summary="Refine a single attribute mapping using feedback",
    description=(
        "Call this when a suggested mapping for a specific target attribute is incorrect. "
        "Provide the `thread_id` from the original suggest response, the attribute that "
        "needs correction, and free-text feedback. The agent re-examines only that "
        "attribute within the existing session context."
    ),
)
def refine_mapping(
    body: MappingRefinementRequest,
    service: Annotated[AutoMappingService, Depends(get_auto_mapping_service)],
) -> MappingRefinementResponse:
    return service.refine(
        thread_id=body.thread_id,
        target_attribute=body.target_attribute,
        feedback=body.feedback,
    )
