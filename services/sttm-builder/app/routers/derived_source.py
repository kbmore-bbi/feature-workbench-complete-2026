from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import (
    get_derived_source_execution_service,
    get_derived_source_service,
)
from app.core.derived_source import DerivedSourceService
from app.schema.contracts import ApiRequestEnvelope, ApiResponseEnvelope, build_response_envelope
from app.schema.derived_source import (
    DerivedSourceDefinition,
    DerivedSourceRecord,
    DerivedSourceValidateRequest,
    DerivedSourceValidateResponse,
)

router = APIRouter(prefix="/derived-sources", tags=["Derived Sources"])


@router.get("", response_model=ApiResponseEnvelope[list[DerivedSourceRecord]])
def list_derived_sources(
    request: Request,
    service: Annotated[DerivedSourceService, Depends(get_derived_source_service)],
) -> ApiResponseEnvelope[list[DerivedSourceRecord]]:
    return build_response_envelope(
        operation="derived_source.list",
        request=request,
        data=service.list_sources(),
    )


@router.post("/validate", response_model=ApiResponseEnvelope[DerivedSourceValidateResponse])
def validate_derived_source_sql(
    body: ApiRequestEnvelope[DerivedSourceValidateRequest] | DerivedSourceValidateRequest,
    request: Request,
    service: Annotated[
        DerivedSourceService,
        Depends(get_derived_source_execution_service),
    ],
) -> ApiResponseEnvelope[DerivedSourceValidateResponse]:
    if isinstance(body, DerivedSourceValidateRequest):
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

    return build_response_envelope(
        operation="derived_source.validate",
        request=request,
        request_id=request_id,
        actor=actor,
        context=context,
        warnings=warnings,
        meta=meta,
        data=service.validate_sql(payload),
    )


@router.post("", response_model=ApiResponseEnvelope[DerivedSourceRecord])
def save_derived_source(
    body: ApiRequestEnvelope[DerivedSourceDefinition] | DerivedSourceDefinition,
    request: Request,
    service: Annotated[
        DerivedSourceService,
        Depends(get_derived_source_execution_service),
    ],
) -> ApiResponseEnvelope[DerivedSourceRecord]:
    if isinstance(body, DerivedSourceDefinition):
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

    return build_response_envelope(
        operation="derived_source.save",
        request=request,
        request_id=request_id,
        actor=actor,
        context=context,
        warnings=warnings,
        meta=meta,
        data=service.save_source(payload),
    )
