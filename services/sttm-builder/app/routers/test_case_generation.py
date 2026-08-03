from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps import get_agent_artifact_job_service, get_test_case_generation_service
from app.auth.dependencies import get_current_principal
from app.core.agent_artifact_jobs import AgentArtifactJobService
from app.core.test_case_generation import (
    TEST_CASE_GENERATION_OPERATION,
    TestCaseGenerationService,
)
from app.schema.contracts import ApiRequestEnvelope, ApiResponseEnvelope, build_response_envelope
from app.schema.test_case_generation import TestCaseGenerationRequest, TestCaseGenerationResponse

router = APIRouter(prefix="/workbench/test-cases", tags=["Test Case Generation"])


def _user_id(request: Request) -> str:
    principal = get_current_principal(request)
    return principal.snowflake_user or str(principal.user_id)


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


@router.post("/jobs", status_code=status.HTTP_202_ACCEPTED)
def start_test_case_job(
    body: ApiRequestEnvelope[TestCaseGenerationRequest] | TestCaseGenerationRequest,
    request: Request,
    service: Annotated[TestCaseGenerationService, Depends(get_test_case_generation_service)],
    jobs: Annotated[AgentArtifactJobService, Depends(get_agent_artifact_job_service)],
):
    payload, request_id, actor, context, warnings, meta = _normalize_body(body)

    def run() -> dict:
        outcome = service.generate(
            payload,
            request_id=request_id,
            actor=actor,
            context=context,
            warnings=warnings,
            meta=meta,
        )
        return {
            "data": outcome.data.model_dump(mode="json") if outcome.data else None,
            "context": outcome.context,
            "warnings": [item.model_dump(mode="json") for item in outcome.warnings],
            "error": outcome.error.model_dump(mode="json") if outcome.error else None,
            "meta": outcome.meta,
        }

    return jobs.start(
        job_type="test_case_generation",
        request_id=request_id,
        requested_by=_user_id(request),
        project_id=payload.project_id,
        sttm_id=payload.sttm_id,
        payload=payload.model_dump(mode="json"),
        runner=run,
    )


@router.get("/jobs/{job_id}")
def get_test_case_job(
    job_id: str,
    request: Request,
    jobs: Annotated[AgentArtifactJobService, Depends(get_agent_artifact_job_service)],
):
    job = jobs.get(job_id, requested_by=_user_id(request))
    if job is None or job.get("job_type") != "test_case_generation":
        raise HTTPException(status_code=404, detail="Test-case generation job was not found")
    return job
