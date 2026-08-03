from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.deps import (
    get_conversation_memory_service,
    get_project_service,
    get_recommendation_action_service,
)
from app.auth.dependencies import get_current_principal
from app.core.conversation_memory import ConversationMemoryService
from app.core.project_service import ProjectService
from app.core.recommendation_actions import (
    RecommendationActionService,
    RecommendationBlockedError,
    RecommendationNotFoundError,
    RecommendationPermissionError,
    RecommendationStaleError,
    ensure_recommendation_apply_permission,
    workspace_hash,
)
from app.schema.recommendation_actions import (
    ApplicableRecommendation,
    RecommendationApplyRequest,
    RecommendationApplyResponse,
    RecommendationFeedbackRequest,
    RecommendationPreviewRequest,
    RecommendationPreviewResponse,
    RecommendationUndoRequest,
    RecommendationUndoResponse,
)


router = APIRouter(
    prefix="/workbench/recommendations",
    tags=["Applicable Recommendations"],
)


def _actor_id(request: Request) -> str:
    principal = get_current_principal(request)
    return principal.snowflake_user or str(principal.user_id)


def _require_edit(request: Request) -> None:
    try:
        ensure_recommendation_apply_permission(
            get_current_principal(request).permissions
        )
    except RecommendationPermissionError as exc:
        raise HTTPException(
            status_code=403,
            detail=str(exc),
        ) from exc


def _translate_action_error(exc: Exception) -> HTTPException:
    if isinstance(exc, RecommendationNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, RecommendationStaleError):
        return HTTPException(
            status_code=409,
            detail={
                "code": "stale_workspace",
                "message": str(exc),
                "regenerate_recommendation": True,
            },
        )
    return HTTPException(status_code=422, detail=str(exc))


def _workflow_rank(item: ApplicableRecommendation) -> tuple[int, int, float]:
    stage = str(item.workflow_stage or "").lower()
    kind = str(item.action_kind or "")
    topic = " ".join(
        [
            item.title,
            item.business_rationale or "",
            item.evidence_summary or "",
            str(item.action_payload.get("recommendation_category") or ""),
            str(item.action_payload.get("issue_type") or ""),
        ]
    ).lower()
    if stage in {
        "schema_browsed",
        "selection_changed",
        "target_selected",
        "source_set_completed",
        "join_completed",
        "derived_source_planning",
    }:
        rank = (
            1
            if kind == "add_source_table"
            else 2
            if "driving" in topic
            else 3
            if kind == "add_relationship"
            else 4
            if kind == "upsert_derived_source"
            else 5
        )
    elif stage in {
        "before_validation",
        "after_validation",
        "before_publish",
        "mapping_ready",
    }:
        rank = (
            1
            if kind == "apply_sql_repair" or "compil" in topic
            else 2
            if kind == "add_relationship" or "disconnect" in topic
            else 3
            if any(value in topic for value in ("grain", "duplicate", "fan-out", "fanout"))
            else 4
            if "quality" in topic
            else 5
            if kind == "bind_value" or "placeholder" in topic
            else 6
        )
    else:
        rank = (
            1
            if item.compatibility_tier == 1
            else 2
            if item.compatibility_tier in {2, 3}
            else 3
            if kind == "bind_value"
            else 4
            if kind in {"open_source_preparation", "add_source_table"}
            or item.missing_dependencies
            else 5
            if kind == "apply_transformation"
            else 6
        )
    return (
        rank,
        item.compatibility_tier or 99,
        -(item.confidence or 0.0),
    )


@router.get("", response_model=list[ApplicableRecommendation])
def list_applicable_recommendations(
    request: Request,
    project_id: str = Query(..., min_length=1),
    sttm_id: str = Query(..., min_length=1),
    context_key: str | None = None,
    scope_key: str | None = None,
    workflow_stage: str | None = None,
    target_columns: list[str] = Query(default=[]),
    limit: int = Query(default=50, ge=1, le=200),
    memory: Annotated[
        ConversationMemoryService, Depends(get_conversation_memory_service)
    ] = None,
    projects: Annotated[ProjectService, Depends(get_project_service)] = None,
    actions: Annotated[
        RecommendationActionService,
        Depends(get_recommendation_action_service),
    ] = None,
) -> list[ApplicableRecommendation]:
    principal = get_current_principal(request)
    actor_id = _actor_id(request)
    latest = projects._latest_snapshot(sttm_id)
    if latest is None:
        raise HTTPException(status_code=404, detail=f"STTM {sttm_id} was not found.")
    current_hash = workspace_hash(latest)
    rows = memory.find_fir_recommendations_for_context(
        selected_tables=[],
        project_id=project_id,
        sttm_id=sttm_id,
        user_id=actor_id,
        context_key=context_key,
        scope_key=scope_key,
        milestone=workflow_stage,
        limit=limit,
    )
    target_filter = {value.strip().upper() for value in target_columns if value}
    result: list[ApplicableRecommendation] = []
    for row in rows:
        recommendation_id = str(
            row.get("recommendation_id")
            or row.get("agent_recommendation_id")
            or ""
        )
        if not recommendation_id:
            continue
        item = actions.describe_record(
            row,
            recommendation_id=recommendation_id,
            expected_workspace_hash=current_hash,
        )
        item_target = str(
            item.target_entity.get("target_column")
            or item.target_entity.get("column")
            or ""
        ).upper()
        if target_filter and item_target not in target_filter:
            continue
        if not principal.permissions.can_edit:
            item = item.model_copy(
                update={
                    "can_apply": False,
                    "blocked_reasons": [
                        *item.blocked_reasons,
                        "Viewer users cannot apply recommendations.",
                    ],
                }
            )
        result.append(item)
    return sorted(result, key=_workflow_rank)


@router.post(
    "/{recommendation_id}/preview",
    response_model=RecommendationPreviewResponse,
)
def preview_recommendation(
    recommendation_id: str,
    body: RecommendationPreviewRequest,
    request: Request,
    actions: Annotated[
        RecommendationActionService,
        Depends(get_recommendation_action_service),
    ],
) -> RecommendationPreviewResponse:
    try:
        preview = actions.preview(
            recommendation_id,
            actor_id=_actor_id(request),
            sttm_id=body.sttm_id,
            workspace_snapshot=body.workspace_snapshot,
            expected_workspace_hash=body.expected_workspace_hash,
            action_id=body.action_id,
        )
    except (
        RecommendationNotFoundError,
        RecommendationStaleError,
        RecommendationBlockedError,
    ) as exc:
        raise _translate_action_error(exc) from exc
    if not get_current_principal(request).permissions.can_edit:
        reason = "Viewer users cannot apply recommendations."
        return preview.model_copy(
            update={
                "can_apply": False,
                "blocked_reasons": [*preview.blocked_reasons, reason],
                "recommendation": preview.recommendation.model_copy(
                    update={
                        "can_apply": False,
                        "blocked_reasons": [
                            *preview.recommendation.blocked_reasons,
                            reason,
                        ],
                    }
                ),
            }
        )
    return preview


@router.post(
    "/{recommendation_id}/apply",
    response_model=RecommendationApplyResponse,
)
def apply_recommendation(
    recommendation_id: str,
    body: RecommendationApplyRequest,
    request: Request,
    actions: Annotated[
        RecommendationActionService,
        Depends(get_recommendation_action_service),
    ],
) -> RecommendationApplyResponse:
    _require_edit(request)
    try:
        return actions.apply(
            recommendation_id,
            actor_id=_actor_id(request),
            sttm_id=body.sttm_id,
            workspace_snapshot=body.workspace_snapshot,
            expected_workspace_hash=body.expected_workspace_hash,
            idempotency_key=body.idempotency_key,
            action_id=body.action_id,
            confirmed=body.confirmed,
        )
    except (
        RecommendationNotFoundError,
        RecommendationStaleError,
        RecommendationBlockedError,
    ) as exc:
        raise _translate_action_error(exc) from exc


@router.post(
    "/{recommendation_id}/undo",
    response_model=RecommendationUndoResponse,
)
def undo_recommendation(
    recommendation_id: str,
    body: RecommendationUndoRequest,
    request: Request,
    actions: Annotated[
        RecommendationActionService,
        Depends(get_recommendation_action_service),
    ],
) -> RecommendationUndoResponse:
    _require_edit(request)
    try:
        return actions.undo(
            recommendation_id=recommendation_id,
            actor_id=_actor_id(request),
            sttm_id=body.sttm_id,
            action_history_id=body.action_history_id,
            expected_workspace_hash=body.expected_workspace_hash,
            idempotency_key=body.idempotency_key,
        )
    except (
        RecommendationNotFoundError,
        RecommendationStaleError,
        RecommendationBlockedError,
    ) as exc:
        raise _translate_action_error(exc) from exc


@router.post("/{recommendation_id}/feedback")
def record_recommendation_feedback(
    recommendation_id: str,
    body: RecommendationFeedbackRequest,
    request: Request,
    actions: Annotated[
        RecommendationActionService,
        Depends(get_recommendation_action_service),
    ],
) -> dict[str, str]:
    _require_edit(request)
    try:
        outcome_id = actions.record_feedback(
            recommendation_id,
            actor_id=_actor_id(request),
            outcome=body.outcome,
            idempotency_key=body.idempotency_key,
            sttm_id=body.sttm_id,
            context_key=body.context_key,
            snapshot_id=body.snapshot_id,
            reason=body.reason,
            correction=body.correction,
        )
    except (
        RecommendationNotFoundError,
        RecommendationStaleError,
        RecommendationBlockedError,
    ) as exc:
        raise _translate_action_error(exc) from exc
    return {
        "status": "recorded",
        "recommendation_id": recommendation_id,
        "outcome_id": outcome_id,
    }
