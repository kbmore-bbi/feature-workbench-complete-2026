from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import get_mapping_sql_service
from app.core.exceptions import SnowflakeQueryError
from app.core.mapping_sql import MappingSqlService
from app.schema.contracts import ApiRequestEnvelope, ApiResponseEnvelope, build_response_envelope
from app.schema.mapping_sql import (
    MappingSqlPreviewRequest,
    MappingSqlPreviewResponse,
    MappingSqlReviewRequest,
    MappingSqlReviewResponse,
)

router = APIRouter(prefix="/workbench/mapping-sql", tags=["Mapping SQL"])


@router.post("/review", response_model=ApiResponseEnvelope[MappingSqlReviewResponse])
def review_mapping_sql(
    body: ApiRequestEnvelope[MappingSqlReviewRequest] | MappingSqlReviewRequest,
    request: Request,
    service: Annotated[MappingSqlService, Depends(get_mapping_sql_service)],
) -> ApiResponseEnvelope[MappingSqlReviewResponse]:
    if isinstance(body, MappingSqlReviewRequest):
        payload = body
        request_id = None
        actor = None
        context: dict[str, object] = {}
        warnings = []
        meta: dict[str, object] = {}
    else:
        payload = body.data
        request_id = body.request_id
        actor = body.actor
        context = body.context
        warnings = body.warnings
        meta = body.meta

    try:
        result = service.review(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return build_response_envelope(
        operation="mapping_sql.review",
        request=request,
        request_id=request_id,
        actor=actor,
        context=context,
        warnings=warnings,
        meta=meta,
        data=result,
    )


@router.post("/preview", response_model=ApiResponseEnvelope[MappingSqlPreviewResponse])
def preview_mapping_sql(
    body: ApiRequestEnvelope[MappingSqlPreviewRequest] | MappingSqlPreviewRequest,
    request: Request,
    service: Annotated[MappingSqlService, Depends(get_mapping_sql_service)],
) -> ApiResponseEnvelope[MappingSqlPreviewResponse]:
    if isinstance(body, MappingSqlPreviewRequest):
        payload = body
        request_id = None
        actor = None
        context: dict[str, object] = {}
        warnings = []
        meta: dict[str, object] = {}
    else:
        payload = body.data
        request_id = body.request_id
        actor = body.actor
        context = body.context
        warnings = body.warnings
        meta = body.meta

    try:
        result = service.preview(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise SnowflakeQueryError(
            "Snowflake could not run the mapping preview SQL: "
            f"{MappingSqlService._summarize_sql_error(exc)}"
        ) from exc

    return build_response_envelope(
        operation="mapping_sql.preview",
        request=request,
        request_id=request_id,
        actor=actor,
        context=context,
        warnings=warnings,
        meta=meta,
        data=result,
    )
