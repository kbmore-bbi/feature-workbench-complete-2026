from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.api.deps import get_agent_artifact_job_service, get_dbt_conversion_service
from app.auth.dependencies import get_current_principal
from app.core.agent_artifact_jobs import AgentArtifactJobService
from app.core.dbt_conversion import DBT_CONVERSION_OPERATION, DbtConversionService
from app.schema.contracts import ApiRequestEnvelope, ApiResponseEnvelope, build_response_envelope
from app.schema.dbt_conversion import DbtConversionRequest, DbtConversionResponse

router = APIRouter(prefix="/workbench/dbt-conversion", tags=["DBT Conversion"])


def _user_id(request: Request) -> str:
    principal = get_current_principal(request)
    return principal.snowflake_user or str(principal.user_id)


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


@router.post("/jobs", status_code=status.HTTP_202_ACCEPTED)
def start_dbt_conversion_job(
    body: ApiRequestEnvelope[DbtConversionRequest] | DbtConversionRequest,
    request: Request,
    service: Annotated[DbtConversionService, Depends(get_dbt_conversion_service)],
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
        job_type="dbt_conversion",
        request_id=request_id,
        requested_by=_user_id(request),
        project_id=payload.project_id,
        sttm_id=payload.sttm_id,
        payload=payload.model_dump(mode="json"),
        runner=run,
    )


@router.get("/jobs/{job_id}")
def get_dbt_conversion_job(
    job_id: str,
    request: Request,
    jobs: Annotated[AgentArtifactJobService, Depends(get_agent_artifact_job_service)],
):
    job = jobs.get(job_id, requested_by=_user_id(request))
    if job is None or job.get("job_type") != "dbt_conversion":
        raise HTTPException(status_code=404, detail="DBT conversion job was not found")
    return job


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
