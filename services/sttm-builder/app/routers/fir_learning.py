from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.api.deps import get_snowflake_client
from app.auth.dependencies import get_current_principal
from app.core.config import Settings, get_settings
from app.core.snowflake import SnowflakeClient
from app.core.target_mapping_patterns import TargetMappingPatternService
from app.schema.contracts import ApiResponseEnvelope, build_response_envelope


router = APIRouter(prefix="/workbench/fir", tags=["FIR Learning"])


class TargetPatternFeedbackRequest(BaseModel):
    action: Literal["accept", "reject", "correct", "validate"]
    reason: str | None = None
    corrected_pattern: dict | None = None
    evidence_ids: list[str] = Field(default_factory=list)


class FIRLearningJobRunRequest(BaseModel):
    max_items: int | None = Field(default=None, ge=1, le=100)


@router.get("/jobs/{job_id}")
def get_learning_job(
    request: Request,
    job_id: str,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponseEnvelope[dict]:
    get_current_principal(request)
    job = TargetMappingPatternService(client.session, settings).get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="FIR learning job not found")
    return build_response_envelope(
        operation="fir.learning.job.get",
        request=request,
        data=job.model_dump(mode="json"),
    )


@router.post("/jobs/{job_id}/resume")
def resume_learning_job(
    request: Request,
    job_id: str,
    body: FIRLearningJobRunRequest,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponseEnvelope[dict]:
    """Process the next bounded, idempotent set of durable FIR work items."""
    principal = get_current_principal(request)
    try:
        job = TargetMappingPatternService(
            client.session, settings
        ).process_learning_job(
            job_id,
            worker_id=(
                f"api:{getattr(principal, 'user_id', None) or 'authenticated'}"
            ),
            max_items=body.max_items,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return build_response_envelope(
        operation="fir.learning.job.resume",
        request=request,
        data=job.model_dump(mode="json"),
    )


@router.get("/patterns")
def get_target_mapping_patterns(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    target_table: str = Query(..., min_length=1),
    target_columns: list[str] = Query(default=[]),
    source_tables: list[str] = Query(default=[]),
    workspace_context_id: str | None = None,
    project_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> ApiResponseEnvelope[dict]:
    get_current_principal(request)
    candidates = TargetMappingPatternService(
        client.session, settings
    ).retrieve_candidates(
        target_table=target_table,
        target_columns=target_columns,
        source_tables=source_tables,
        project_id=project_id,
        limit=limit,
    )
    return build_response_envelope(
        operation="fir.target_mapping_patterns.get",
        request=request,
        data={
            "workspace_context_id": workspace_context_id,
            "target_table": target_table,
            "candidate_count": len(candidates),
            "candidates": [
                candidate.model_dump(mode="json") for candidate in candidates
            ],
        },
    )


@router.post("/patterns/{pattern_id}/feedback")
def record_target_mapping_pattern_feedback(
    request: Request,
    pattern_id: str,
    body: TargetPatternFeedbackRequest,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponseEnvelope[dict]:
    principal = get_current_principal(request)
    service = TargetMappingPatternService(client.session, settings)
    actor = (
        getattr(principal, "user_id", None)
        or getattr(principal, "email", None)
        or ""
    )
    corrected = None
    if body.action == "correct":
        if not body.corrected_pattern:
            raise HTTPException(
                status_code=422,
                detail="corrected_pattern is required for a correction",
            )
        try:
            corrected = service.record_correction(
                original_pattern_id=pattern_id,
                corrected_pattern=body.corrected_pattern,
                actor=actor,
                reason=body.reason,
                evidence_ids=body.evidence_ids,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return build_response_envelope(
            operation="fir.target_mapping_pattern.feedback",
            request=request,
            data={
                "pattern_id": pattern_id,
                "action": body.action,
                "validation_status": "validated",
                "corrected_pattern_id": corrected.pattern_id,
                "evidence_ids": body.evidence_ids,
            },
        )
    status = {
        "accept": "accepted",
        "validate": "validated",
        "reject": "rejected",
        "correct": "rejected",
    }[body.action]
    table = settings.qualify_table_name(
        settings.snowflake_target_mapping_patterns_table
    )
    quote = TargetMappingPatternService._quote
    rows = client.session.sql(
        f"""
        UPDATE {table}
        SET VALIDATION_STATUS = {quote(status)},
            STATUS = {quote('inactive' if body.action in {'reject', 'correct'} else 'active')},
            PATTERN_PAYLOAD = OBJECT_INSERT(
                OBJECT_INSERT(
                    PATTERN_PAYLOAD,
                    'feedback_reason',
                    {quote(body.reason or '')},
                    TRUE
                ),
                'feedback_actor',
            {quote(actor)},
                TRUE
            ),
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE PATTERN_ID = {quote(pattern_id)}
        """
    ).collect()
    if not rows:
        # Snowpark UPDATE returns a count row; retain an explicit lookup so an
        # unknown ID cannot appear successfully reviewed.
        exists = client.session.sql(
            f"SELECT PATTERN_ID FROM {table} WHERE PATTERN_ID = {quote(pattern_id)} LIMIT 1"
        ).collect()
        if not exists:
            raise HTTPException(status_code=404, detail="Target mapping pattern not found")
    return build_response_envelope(
        operation="fir.target_mapping_pattern.feedback",
        request=request,
        data={
            "pattern_id": pattern_id,
            "action": body.action,
            "validation_status": status,
            "corrected_pattern_received": body.corrected_pattern is not None,
            "evidence_ids": body.evidence_ids,
        },
    )
