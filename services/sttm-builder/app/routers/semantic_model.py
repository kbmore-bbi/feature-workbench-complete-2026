from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, Query, Request

from app.api.deps import get_semantic_model_service, get_snowflake_client
from app.core.exceptions import AuthorizationError, NotFoundError
from app.core.semantic_model import SemanticModelService
from app.core.snowflake import SnowflakeClient
from app.schema.contracts import ApiRequestEnvelope, ApiResponseEnvelope, build_response_envelope
from app.schema.semantic_model import (
    GenerateRequest,
    GenerateResponse,
    JobStatus,
    SemanticModelRecord,
)

router = APIRouter(prefix="/semantic-model", tags=["Semantic Model"])

@router.post(
    "/generate",
    response_model=ApiResponseEnvelope[GenerateResponse],
    summary="Legacy semantic generation endpoint (pipeline-owned)",
    description=(
        "Semantic generation is owned by AGT_SEMANTIC_MODEL_V2 and the scheduled "
        "publication pipeline. The application is a read-only registry consumer."
    ),
)
def generate(
    body: ApiRequestEnvelope[GenerateRequest] | GenerateRequest,
    request: Request,
) -> ApiResponseEnvelope[GenerateResponse]:
    _ = (body, request)
    raise AuthorizationError(
        "Semantic generation is pipeline-owned. Invoke AGT_SEMANTIC_MODEL_V2 through "
        "the scheduled semantic publication pipeline instead."
    )


@router.get(
    "/jobs/{job_id}",
    response_model=ApiResponseEnvelope[JobStatus],
    summary="Poll generation job status",
    description=(
        "Returns real-time progress for a generation job.\n\n"
        "`completed + skipped + failed_count` will equal `total` when the job is done."
    ),
)
def job_status(
    request: Request,
    job_id: str,
    service: Annotated[SemanticModelService, Depends(get_semantic_model_service)],
) -> ApiResponseEnvelope[JobStatus]:
    job = service.get_job(job_id)
    if not job:
        raise NotFoundError(f"Job '{job_id}' not found")
    return build_response_envelope(
        operation="semantic_model.job_status",
        request=request,
        context={"job_id": job_id},
        data=job,
    )


@router.get(
    "",
    response_model=ApiResponseEnvelope[SemanticModelRecord],
    summary="Fetch a stored semantic model",
    description=(
        "Direct table lookup — no generation is triggered.\n\n"
        "Use `scope=ATTRIBUTE` with `attribute_name` to fetch a single column's model."
    ),
)
def get_semantic_model(
    request: Request,
    scope: Annotated[Literal["SCHEMA", "TABLE", "ATTRIBUTE"], Query()],
    db_name: Annotated[str, Query()],
    schema_name: Annotated[str, Query()],
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    service: Annotated[SemanticModelService, Depends(get_semantic_model_service)],
    table_name: Annotated[Optional[str], Query()] = None,
    attribute_name: Annotated[Optional[str], Query()] = None,
) -> ApiResponseEnvelope[SemanticModelRecord]:
    record = service.get_record(
        session=client.session,
        scope=scope,
        db_name=db_name,
        schema_name=schema_name,
        table_name=table_name or "",
        attribute_name=attribute_name or "",
    )
    if not record:
        key = f"{db_name.upper()}.{schema_name.upper()}"
        if table_name:
            key += f".{table_name.upper()}"
        if attribute_name:
            key += f".{attribute_name.upper()}"
        raise NotFoundError(f"No semantic model found for {scope} {key}")
    return build_response_envelope(
        operation="semantic_model.get",
        request=request,
        context={
            "scope": scope,
            "db_name": db_name,
            "schema_name": schema_name,
            "table_name": table_name,
            "attribute_name": attribute_name,
        },
        data=SemanticModelRecord(**record),
    )
