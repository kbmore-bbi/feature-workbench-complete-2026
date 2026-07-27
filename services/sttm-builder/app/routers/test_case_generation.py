from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_test_case_generation_service
from app.core.test_case_generation import (
    TEST_CASE_GENERATION_OPERATION,
    TestCaseGenerationService,
)
from app.schema.contracts import ApiRequestEnvelope, ApiResponseEnvelope, build_response_envelope
from app.schema.test_case_generation import TestCaseGenerationRequest, TestCaseGenerationResponse

router = APIRouter(prefix="/workbench/test-cases", tags=["Test Case Generation"])


def _normalize_body(
    body: ApiRequestEnvelope[TestCaseGenerationRequest] | TestCaseGenerationRequest,
) -> tuple[
    TestCaseGenerationRequest,
    str | None,
    object | None,
    dict[str, object],
    list,
    dict[str, object],
]:
    if isinstance(body, TestCaseGenerationRequest):
        return body, None, None, {}, [], {}
    return body.data, body.request_id, body.actor, body.context, body.warnings, body.meta


@router.post("", response_model=ApiResponseEnvelope[TestCaseGenerationResponse])
def generate_test_cases(
    body: ApiRequestEnvelope[TestCaseGenerationRequest] | TestCaseGenerationRequest,
    request: Request,
    service: Annotated[TestCaseGenerationService, Depends(get_test_case_generation_service)],
) -> ApiResponseEnvelope[TestCaseGenerationResponse]:
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
        operation=TEST_CASE_GENERATION_OPERATION,
        request=request,
        request_id=request_id,
        actor=actor,
        context=outcome.context,
        warnings=outcome.warnings,
        error=outcome.error,
        meta=outcome.meta,
        data=outcome.data,
    )
