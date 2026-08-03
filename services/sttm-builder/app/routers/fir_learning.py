from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.api.deps import get_snowflake_client
from app.auth.dependencies import get_current_principal
from app.auth.models import AppPersona
from app.core.config import Settings, get_settings
from app.core.bundle_curation import BundleCurationError, BundleCurationService
from app.core.snowflake import SnowflakeClient
from app.core.target_mapping_patterns import TargetMappingPatternService
from app.schema.bundle_curation import BundleCurationPromotionRequest
from app.schema.contracts import ApiResponseEnvelope, build_response_envelope
from app.schema.fir_patterns import TargetMappingPatternQuery


router = APIRouter(prefix="/workbench/fir", tags=["FIR Learning"])


class TargetPatternFeedbackRequest(BaseModel):
    action: Literal["accept", "reject", "correct", "validate"]
    reason: str | None = None
    corrected_pattern: dict | None = None
    evidence_ids: list[str] = Field(default_factory=list)


class FIRLearningJobRunRequest(BaseModel):
    max_items: int | None = Field(default=None, ge=1, le=100)


class FIRLearningQueueRunRequest(BaseModel):
    asset_id: str | None = None
    max_jobs: int = Field(default=1, ge=1, le=10)
    max_items_per_job: int | None = Field(default=None, ge=1, le=100)


class FIRLearningRetryRequest(BaseModel):
    work_item_id: str | None = None


def _require_admin(request: Request):
    principal = get_current_principal(request)
    if principal.app_persona != AppPersona.ADMIN:
        raise HTTPException(status_code=403, detail="Admin permissions are required")
    return principal


@router.post("/jobs/{job_id}/approve-generated")
def approve_generated_learning(
    request: Request,
    job_id: str,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponseEnvelope[dict]:
    """Temporarily bulk-approve only complete, supported output from one FIR job.

    This endpoint is intentionally admin-only and job-scoped. It does not approve
    low-confidence, contradicted, evidence-free, or actionless output.
    """
    principal = _require_admin(request)
    jobs_table = settings.qualify_metadata_object_name("TBL_FIR_LEARNING_JOBS")
    work_items_table = settings.qualify_metadata_object_name(
        "TBL_FIR_LEARNING_WORK_ITEMS"
    )
    patterns_table = settings.qualify_metadata_object_name(
        "TBL_FIR_TARGET_MAPPING_PATTERNS"
    )
    inferences_table = settings.qualify_metadata_object_name(
        "TBL_WORKBENCH_INFERENCES"
    )
    fir_table = settings.qualify_metadata_object_name("TBL_AGENT_FIR_360")
    recommendations_table = settings.qualify_metadata_object_name(
        "TBL_FIR_AGENT_RECOMMENDATIONS"
    )
    versions_table = settings.qualify_metadata_object_name(
        "TBL_SEMANTIC_BUNDLE_VERSIONS"
    )
    quote = TargetMappingPatternService._quote
    job_rows = client.session.sql(
        f"""
        SELECT ASSET_ID, STATUS
        FROM {jobs_table}
        WHERE LEARNING_JOB_ID = {quote(job_id)}
        LIMIT 1
        """
    ).collect()
    if not job_rows:
        raise HTTPException(status_code=404, detail="FIR learning job not found")
    asset_id = str(job_rows[0]["ASSET_ID"] or "")
    job_status = str(job_rows[0]["STATUS"] or "").lower()
    if job_status != "completed":
        raise HTTPException(
            status_code=409,
            detail="Only a completed FIR learning job can be approved.",
        )

    client.session.sql(
        f"""
        UPDATE {patterns_table}
        SET VALIDATION_STATUS = 'validated', UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE PATTERN_ID IN (
            SELECT PAYLOAD:pattern_id::STRING
            FROM {work_items_table}
            WHERE LEARNING_JOB_ID = {quote(job_id)}
        )
          AND STATUS = 'active'
          AND VALIDATION_STATUS IN ('extracted', 'enriched', 'accepted')
          AND COALESCE(CONTRADICTION_COUNT, 0) = 0
          AND COALESCE(CONFIDENCE, 0) >= 0.55
        """
    ).collect()
    client.session.sql(
        f"""
        UPDATE {inferences_table} inference
        SET VALIDATION_STATUS = 'validated', UPDATED_AT = CURRENT_TIMESTAMP()
        FROM {fir_table} fir
        WHERE inference.INFERENCE_ID = fir.INFERENCE_ID
          AND fir.SOURCE_TYPE = 'document_upload'
          AND fir.FEEDBACK_PAYLOAD:sql_asset_id::STRING = {quote(asset_id)}
          AND inference.STATUS = 'active'
          AND COALESCE(LOWER(inference.VALIDATION_STATUS), 'unvalidated')
              IN ('unvalidated', 'extracted', 'enriched')
          AND COALESCE(inference.CONFIDENCE, 0) >= 0.55
          AND COALESCE(ARRAY_SIZE(inference.EVIDENCE_IDS), 0) > 0
          AND COALESCE(ARRAY_SIZE(inference.CONTRADICTIONS), 0) = 0
        """
    ).collect()
    client.session.sql(
        f"""
        UPDATE {recommendations_table} recommendation
        SET VALIDATION_STATUS = 'validated', UPDATED_AT = CURRENT_TIMESTAMP()
        FROM {fir_table} fir
        WHERE recommendation.FIR_RECORD_ID = fir.FIR_RECORD_ID
          AND fir.SOURCE_TYPE = 'document_upload'
          AND fir.FEEDBACK_PAYLOAD:sql_asset_id::STRING = {quote(asset_id)}
          AND recommendation.STATUS IN ('draft', 'active')
          AND COALESCE(LOWER(recommendation.VALIDATION_STATUS), 'unvalidated')
              IN ('unvalidated', 'extracted', 'enriched')
          AND COALESCE(recommendation.CONFIDENCE, 0) >= 0.55
          AND COALESCE(ARRAY_SIZE(recommendation.EVIDENCE_IDS), 0) > 0
          AND COALESCE(ARRAY_SIZE(recommendation.ACTION_CONTRACT), 0) > 0
        """
    ).collect()

    count_rows = client.session.sql(
        f"""
        SELECT
          (
            SELECT COUNT(*)
            FROM {patterns_table}
            WHERE PATTERN_ID IN (
                SELECT PAYLOAD:pattern_id::STRING
                FROM {work_items_table}
                WHERE LEARNING_JOB_ID = {quote(job_id)}
            )
              AND VALIDATION_STATUS = 'validated'
          ) AS PATTERN_COUNT,
          (
            SELECT COUNT(*)
            FROM {inferences_table} inference
            JOIN {fir_table} fir
              ON inference.INFERENCE_ID = fir.INFERENCE_ID
            WHERE fir.FEEDBACK_PAYLOAD:sql_asset_id::STRING = {quote(asset_id)}
              AND inference.VALIDATION_STATUS = 'validated'
          ) AS INFERENCE_COUNT,
          (
            SELECT COUNT(*)
            FROM {recommendations_table} recommendation
            JOIN {fir_table} fir
              ON recommendation.FIR_RECORD_ID = fir.FIR_RECORD_ID
            WHERE fir.FEEDBACK_PAYLOAD:sql_asset_id::STRING = {quote(asset_id)}
              AND recommendation.VALIDATION_STATUS IN ('validated', 'promoted')
          ) AS RECOMMENDATION_COUNT
        """
    ).collect()
    counts = count_rows[0] if count_rows else {}

    promoted_bundle_versions: list[str] = []
    curation_service = BundleCurationService(client.session, settings)
    version_rows = client.session.sql(
        f"""
        SELECT BUNDLE_VERSION_ID, WORKSPACE_CONTEXT_HASH, BASE_BUNDLE_HASH
        FROM {versions_table}
        WHERE SQL_ASSET_ID = {quote(asset_id)} AND STATUS = 'draft'
        """
    ).collect()
    actor_id = principal.snowflake_user or str(principal.user_id)
    for version in version_rows:
        version_id = str(version["BUNDLE_VERSION_ID"])
        try:
            curation_service.promote(
                version_id,
                BundleCurationPromotionRequest(
                    expected_workspace_hash=str(
                        version["WORKSPACE_CONTEXT_HASH"] or ""
                    ),
                    expected_bundle_hash=str(version["BASE_BUNDLE_HASH"] or ""),
                    approve_all_validated=True,
                    confirmed=True,
                ),
                actor_id=actor_id,
            )
            promoted_bundle_versions.append(version_id)
        except BundleCurationError:
            # A draft can legitimately remain unpromoted when its target,
            # semantic evidence, or context hashes are unresolved.
            continue

    return build_response_envelope(
        operation="fir.learning.job.approve_generated",
        request=request,
        data={
            "job_id": job_id,
            "asset_id": asset_id,
            "approved_patterns": int(counts["PATTERN_COUNT"] or 0),
            "approved_inferences": int(counts["INFERENCE_COUNT"] or 0),
            "approved_recommendations": int(counts["RECOMMENDATION_COUNT"] or 0),
            "promoted_bundle_version_ids": promoted_bundle_versions,
            "policy": (
                "confidence>=0.55, evidence required, no contradictions, "
                "and an action contract required for recommendations"
            ),
        },
    )


@router.get("/jobs")
def list_learning_jobs(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    asset_id: str | None = None,
    project_id: str | None = None,
    status: list[str] = Query(default=[]),
    limit: int = Query(default=100, ge=1, le=500),
) -> ApiResponseEnvelope[dict]:
    get_current_principal(request)
    jobs = TargetMappingPatternService(client.session, settings).list_jobs(
        asset_id=asset_id,
        project_id=project_id,
        statuses=status,
        limit=limit,
    )
    return build_response_envelope(
        operation="fir.learning.jobs.list",
        request=request,
        data={
            "jobs": [job.model_dump(mode="json") for job in jobs],
            "count": len(jobs),
        },
    )


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
    source_columns: list[str] = Query(default=[]),
    crm_family: str | None = None,
    relationship_paths: list[str] = Query(default=[]),
    derived_outputs: list[str] = Query(default=[]),
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
        source_columns=source_columns,
        source_column_profiles=[],
        crm_family=crm_family,
        relationship_paths=relationship_paths,
        derived_outputs=derived_outputs,
        workspace_context_id=workspace_context_id,
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


@router.post("/patterns/search")
def search_target_mapping_patterns(
    request: Request,
    body: TargetMappingPatternQuery,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponseEnvelope[dict]:
    get_current_principal(request)
    if not body.target_table:
        raise HTTPException(status_code=422, detail="target_table is required")
    candidates = TargetMappingPatternService(
        client.session, settings
    ).retrieve_candidates(
        target_table=body.target_table,
        target_columns=body.target_columns,
        source_tables=body.source_tables,
        source_columns=body.source_columns,
        source_column_profiles=body.source_column_profiles,
        crm_family=body.crm_family,
        relationship_paths=body.relationship_paths,
        derived_outputs=body.derived_outputs,
        workspace_context_id=body.workspace_context_id,
        project_id=body.project_id,
        limit=body.limit,
    )
    return build_response_envelope(
        operation="fir.target_mapping_patterns.search",
        request=request,
        data={
            "candidate_count": len(candidates),
            "candidates": [
                candidate.model_dump(mode="json") for candidate in candidates
            ],
        },
    )
@router.get("/knowledge-graph")
def get_mapping_knowledge_graph(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    target_table: str = Query(..., min_length=1),
    target_columns: list[str] = Query(default=[]),
    project_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> ApiResponseEnvelope[dict]:
    get_current_principal(request)
    graph = TargetMappingPatternService(
        client.session, settings
    ).retrieve_knowledge_graph(
        target_table=target_table,
        target_columns=target_columns,
        project_id=project_id,
        limit=limit,
    )
    return build_response_envelope(
        operation="fir.mapping_knowledge_graph.get",
        request=request,
        data=graph,
    )


@router.post("/admin/process-now")
def process_learning_queue_now(
    request: Request,
    body: FIRLearningQueueRunRequest,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponseEnvelope[dict]:
    principal = _require_admin(request)
    jobs = TargetMappingPatternService(client.session, settings).process_queue(
        worker_id=f"admin:{principal.user_id}",
        asset_id=body.asset_id,
        max_jobs=body.max_jobs,
        max_items_per_job=body.max_items_per_job,
    )
    return build_response_envelope(
        operation="fir.learning.queue.process_now",
        request=request,
        data={
            "jobs": [job.model_dump(mode="json") for job in jobs],
            "processed_job_count": len(jobs),
        },
    )


@router.post("/admin/jobs/{job_id}/pause")
def pause_learning_job(
    request: Request,
    job_id: str,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponseEnvelope[dict]:
    _require_admin(request)
    try:
        job = TargetMappingPatternService(client.session, settings).pause_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return build_response_envelope(
        operation="fir.learning.job.pause",
        request=request,
        data=job.model_dump(mode="json"),
    )


@router.post("/admin/jobs/{job_id}/resume")
def resume_paused_learning_job(
    request: Request,
    job_id: str,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponseEnvelope[dict]:
    _require_admin(request)
    try:
        job = TargetMappingPatternService(client.session, settings).resume_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return build_response_envelope(
        operation="fir.learning.job.admin_resume",
        request=request,
        data=job.model_dump(mode="json"),
    )


@router.post("/admin/jobs/{job_id}/retry")
def retry_learning_job(
    request: Request,
    job_id: str,
    body: FIRLearningRetryRequest,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponseEnvelope[dict]:
    _require_admin(request)
    try:
        job = TargetMappingPatternService(
            client.session, settings
        ).retry_dead_letters(
            job_id,
            work_item_id=body.work_item_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return build_response_envelope(
        operation="fir.learning.job.retry",
        request=request,
        data=job.model_dump(mode="json"),
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
