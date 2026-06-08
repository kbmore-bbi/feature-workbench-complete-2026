from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.deps import get_dbt_conversion_service
from app.core.dbt_conversion import DBT_CONVERSION_OPERATION, DbtConversionService
from app.schema.contracts import ApiRequestEnvelope, ApiResponseEnvelope, build_response_envelope
from app.schema.dbt_conversion import DbtConversionRequest, DbtConversionResponse

router = APIRouter(prefix="/workbench/dbt-conversion", tags=["DBT Conversion"])


def _normalize_body(
    body: ApiRequestEnvelope[DbtConversionRequest] | DbtConversionRequest,
) -> tuple[
    DbtConversionRequest,
    str | None,
    object | None,
    dict[str, object],
    list,
    dict[str, object],
]:
    if isinstance(body, DbtConversionRequest):
        return body, None, None, {}, [], {}
    return body.data, body.request_id, body.actor, body.context, body.warnings, body.meta


@router.post("", response_model=ApiResponseEnvelope[DbtConversionResponse])
def generate_dbt_conversion(
    body: ApiRequestEnvelope[DbtConversionRequest] | DbtConversionRequest,
    request: Request,
    service: Annotated[DbtConversionService, Depends(get_dbt_conversion_service)],
) -> ApiResponseEnvelope[DbtConversionResponse]:
    payload, request_id, actor, context, warnings, meta = _normalize_body(body)
    outcome = service.generate(
        payload,
        request_id=request_id,
        actor=actor,
        context=context,
        warnings=warnings,
        meta=meta,
    )
    return build_response_envelope(
        operation=DBT_CONVERSION_OPERATION,
        request=request,
        request_id=request_id,
        actor=actor,
        context=outcome.context,
        warnings=outcome.warnings,
        error=outcome.error,
        meta=outcome.meta,
        data=outcome.data,
    )


@router.post("/stream")
def stream_dbt_conversion(
    body: ApiRequestEnvelope[DbtConversionRequest] | DbtConversionRequest,
    service: Annotated[DbtConversionService, Depends(get_dbt_conversion_service)],
) -> StreamingResponse:
    payload, request_id, actor, context, warnings, meta = _normalize_body(body)
    return StreamingResponse(
        service.generate_stream(
            payload,
            request_id=request_id,
            actor=actor,
            context=context,
            warnings=warnings,
            meta=meta,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

