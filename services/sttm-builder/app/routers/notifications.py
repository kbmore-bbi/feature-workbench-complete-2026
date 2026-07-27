"""Unified FIR recommendation retrieval and outcome APIs."""
from __future__ import annotations

import json
import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.api.deps import get_snowflake_client
from app.auth.dependencies import get_current_principal
from app.core.config import Settings, get_settings
from app.core.conversation_memory import ConversationMemoryService
from app.core.snowflake import SnowflakeClient
from app.schema.workspace_context import WorkbenchContextSnapshotV2

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Recommendations"])


class RecommendationEvaluateRequest(BaseModel):
    workspace_context: WorkbenchContextSnapshotV2
    checkpoint: str | None = None
    project_id: str | None = None
    limit: int = Field(default=12, ge=1, le=50)
    include_search_fallback: bool = True
    include_evidence: bool = False


class RecommendationOutcomeRequest(BaseModel):
    outcome_type: Literal[
        "shown",
        "opened",
        "explained",
        "applied",
        "used",
        "accepted",
        "corrected",
        "rejected",
        "validated",
        "published",
        "dismissed",
    ]
    context_key: str | None = None
    snapshot_id: str | None = None
    request_id: str | None = None
    artifact_id: str | None = None
    user_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class RecommendationShownOutcome(RecommendationOutcomeRequest):
    recommendation_id: str = Field(min_length=1)
    outcome_type: Literal["shown"] = "shown"


class RecommendationOutcomeBatchRequest(BaseModel):
    items: list[RecommendationShownOutcome] = Field(min_length=1, max_length=50)


def _normalize_json(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return default
    return value


def _default_actions(rec: dict[str, Any]) -> list[dict[str, Any]]:
    rec_id = str(rec.get("recommendation_id") or "")
    if rec.get("question_id") or rec.get("recommendation_type") == "feedback_question":
        return [
            {
                "id": "confirm",
                "label": "Yes, that is correct",
                "action": "confirm",
                "payload": {"recommendation_id": rec_id},
                "requires_confirmation": False,
                "requires_comment": False,
            },
            {
                "id": "correct",
                "label": "Needs correction",
                "action": "correct",
                "payload": {"recommendation_id": rec_id},
                "requires_confirmation": False,
                "requires_comment": True,
            },
            {
                "id": "explain",
                "label": "Explain first",
                "action": "open_assistant_explanation",
                "payload": {"recommendation_id": rec_id},
                "requires_confirmation": False,
                "requires_comment": False,
            },
        ]
    return [
        {
            "id": "explain",
            "label": "Explain",
            "action": "open_assistant_explanation",
            "payload": {"recommendation_id": rec_id},
            "requires_confirmation": False,
            "requires_comment": False,
        },
        {
            "id": "dismiss",
            "label": "Dismiss",
            "action": "dismiss",
            "payload": {"recommendation_id": rec_id},
            "requires_confirmation": False,
            "requires_comment": False,
        },
    ]


def _load_evidence(
    client: SnowflakeClient,
    settings: Settings,
    recommendation_ids: list[str],
) -> dict[str, list[dict[str, Any]]]:
    if not recommendation_ids:
        return {}
    literals = ", ".join(
        "'" + value.replace("'", "''") + "'" for value in recommendation_ids
    )
    view = settings.qualify_metadata_object_name("VW_FIR_RECOMMENDATION_EVIDENCE")
    try:
        rows = client.session.sql(
            f"""
            SELECT AGENT_RECOMMENDATION_ID, EVIDENCE_ID, SOURCE_TYPE, TITLE, SUMMARY,
                   REDACTED_EXCERPT, DOCUMENT_LOCATION, POLARITY, EVIDENCE_WEIGHT, CREATED_AT
            FROM {view}
            WHERE AGENT_RECOMMENDATION_ID IN ({literals})
            ORDER BY EVIDENCE_WEIGHT DESC, CREATED_AT DESC
            """
        ).collect()
    except Exception:
        logger.debug("Readable FIR evidence lookup failed", exc_info=True)
        return {}
    result: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        item = row.as_dict() if hasattr(row, "as_dict") else dict(row)
        rec_id = str(item.pop("AGENT_RECOMMENDATION_ID", "") or "")
        if not rec_id or not item.get("EVIDENCE_ID"):
            continue
        result.setdefault(rec_id, []).append(
            {str(key).lower(): value for key, value in item.items()}
        )
    return result


def _load_checkpoint_definition(
    client: SnowflakeClient,
    settings: Settings,
    checkpoint: str | None,
) -> dict[str, Any]:
    if not checkpoint:
        return {
            "eligible_goals": [],
            "recommendation_categories": [],
            "max_inline_items": 5,
            "max_interruptive_questions": 1,
            "display_surfaces": ["inline", "inbox", "assistant"],
        }
    table = settings.qualify_metadata_object_name("TBL_FIR_CHECKPOINT_DEFINITIONS")
    escaped = checkpoint.strip().lower().replace("'", "''")
    try:
        rows = client.session.sql(
            f"""
            SELECT ELIGIBLE_GOALS, RECOMMENDATION_CATEGORIES,
                   MAX_INLINE_ITEMS, MAX_INTERRUPTIVE_QUESTIONS,
                   DISPLAY_SURFACES
            FROM {table}
            WHERE CHECKPOINT_ID = '{escaped}'
              AND STATUS = 'active'
            LIMIT 1
            """
        ).collect()
    except Exception:
        logger.debug("FIR checkpoint definition lookup failed", exc_info=True)
        rows = []
    if not rows:
        return {
            "eligible_goals": [],
            "recommendation_categories": [],
            "max_inline_items": 5,
            "max_interruptive_questions": 1,
            "display_surfaces": ["inline", "inbox", "assistant"],
        }
    row = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
    return {
        "eligible_goals": _normalize_json(row.get("ELIGIBLE_GOALS"), []),
        "recommendation_categories": _normalize_json(
            row.get("RECOMMENDATION_CATEGORIES"), []
        ),
        "max_inline_items": int(row.get("MAX_INLINE_ITEMS") or 5),
        "max_interruptive_questions": int(
            row.get("MAX_INTERRUPTIVE_QUESTIONS") or 1
        ),
        "display_surfaces": _normalize_json(row.get("DISPLAY_SURFACES"), []),
    }


def _canonical_recommendation_category(item: dict[str, Any]) -> str:
    checkpoint = str(
        item.get("milestone") or item.get("checkpoint") or ""
    ).strip().lower()
    question_id = str(item.get("question_id") or "").strip().upper()
    recommendation_type = str(
        item.get("recommendation_type") or ""
    ).strip().lower()
    by_type = {
        "table_suggestion": "source_discovery",
        "relationship_hint": "relationship",
        "derived_source_suggestion": "derived_source",
        "column_mapping_hint": "column_mapping",
        "mapping_insight": "column_mapping",
        "transformation_pattern": "transformation",
        "preprocessing_rule": "transformation",
        "correction_warning": "validation",
        "business_rule": "query_shaping",
        "project_context": "target_context",
    }
    explicit_category = str(
        item.get("recommendation_category") or ""
    ).strip().lower()
    # Untyped legacy checkpoints should not relabel a validation or publish
    # warning as source discovery merely because it matched the same table.
    if not question_id and (explicit_category or recommendation_type in by_type):
        return explicit_category or by_type[recommendation_type]

    if checkpoint in {"schema_browsed", "selection_changed"}:
        if question_id == "Q6":
            return "relationship"
        return "source_discovery"
    if checkpoint in {"source_set_completed", "join_completed"}:
        return "query_shaping" if question_id == "Q9" else "relationship"
    if checkpoint == "target_selected":
        return "derived_source" if question_id == "Q7" else "target_context"
    if checkpoint.startswith("derived_source"):
        return "query_shaping" if question_id == "Q9" else "derived_source"
    if checkpoint == "source_query_review":
        return "relationship" if question_id == "Q6" else "query_shaping"
    if checkpoint in {"mapping_ready", "before_auto_map"}:
        if question_id == "Q6":
            return "relationship"
        if question_id == "Q7":
            return "derived_source"
        return "column_mapping"
    if checkpoint == "on_auto_map_review":
        return "query_shaping" if question_id == "Q9" else "column_mapping"
    if checkpoint == "on_transformation_review":
        return "transformation"
    if checkpoint in {"before_validation", "after_validation"}:
        if question_id == "Q6":
            return "relationship"
        if question_id == "Q9":
            return "query_shaping"
        return "validation"
    if checkpoint == "before_publish":
        return "relationship" if question_id == "Q6" else "publish"
    if checkpoint == "sttm_published":
        return "query_shaping" if question_id == "Q9" else "publish"

    return (
        by_type.get(recommendation_type)
        or explicit_category
        or "analysis"
    )


_TOPIC_ORDER = {
    "source_entity_meaning": 10,
    "target_meaning": 20,
    "relationships": 30,
    "derived_query_shaping": 40,
    "precedent_corrections": 50,
    "value_bindings": 60,
    "unresolved_mappings": 70,
    "transformations": 80,
    "sql_errors": 90,
    "data_quality": 100,
    "lineage_impact": 110,
    "publish_readiness": 120,
    "general": 900,
}


def _recommendation_topic(item: dict[str, Any]) -> str:
    payload = item.get("agent_payload") if isinstance(item.get("agent_payload"), dict) else {}
    explicit = str(item.get("topic") or payload.get("topic") or "").strip().lower()
    if explicit in _TOPIC_ORDER:
        return explicit
    category = _canonical_recommendation_category(item)
    recommendation_type = str(item.get("recommendation_type") or "").strip().lower()
    question_id = str(item.get("question_id") or "").strip().upper()
    checkpoint = str(item.get("milestone") or item.get("checkpoint") or "").strip().lower()
    if category in {"source_discovery", "entity_meaning"}:
        return "source_entity_meaning"
    if category == "target_context":
        return "target_meaning"
    if category == "relationship" or question_id == "Q6":
        return "relationships"
    if category in {"derived_source", "query_shaping"} or question_id in {"Q7", "Q9"}:
        return "derived_query_shaping"
    if recommendation_type in {"correction_warning", "mapping_precedent"}:
        return "precedent_corrections"
    if recommendation_type in {"value_binding", "constant_mapping"}:
        return "value_bindings"
    if category == "column_mapping":
        return "unresolved_mappings"
    if category == "transformation":
        return "transformations"
    if category == "validation":
        text = " ".join(
            str(item.get(key) or "") for key in ("display_message", "evidence_summary", "title")
        ).lower()
        return "data_quality" if any(token in text for token in ("duplicate", "null", "grain", "count", "quality")) else "sql_errors"
    if category in {"lineage", "impact"}:
        return "lineage_impact"
    if category == "publish" or checkpoint in {"before_publish", "sttm_published"}:
        return "publish_readiness"
    return "general"


def _entity_label(item: dict[str, Any]) -> str:
    payload = item.get("agent_payload") if isinstance(item.get("agent_payload"), dict) else {}
    for value in (
        item.get("entity_label"),
        payload.get("entity_label"),
        payload.get("target_column"),
        payload.get("source_column"),
        payload.get("table_name"),
        payload.get("subject"),
        item.get("scope_key"),
    ):
        token = str(value or "").strip()
        if token:
            return token
    return "Current mapping"


def _apply_checkpoint_policy(
    items: list[dict[str, Any]],
    definition: dict[str, Any],
    requested_limit: int,
    *,
    respect_inline_limit: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    eligible_goals = {
        str(value).strip().upper()
        for value in definition.get("eligible_goals") or []
        if str(value).strip()
    }
    eligible_categories = {
        str(value).strip().lower()
        for value in definition.get("recommendation_categories") or []
        if str(value).strip()
    }
    eligible_items = []
    for item in items:
        category = _canonical_recommendation_category(item)
        item["recommendation_category"] = category
        question_id = str(item.get("question_id") or "").strip().upper()
        if category and eligible_categories and category not in eligible_categories:
            continue
        if question_id and eligible_goals and question_id not in eligible_goals:
            continue
        topic = _recommendation_topic(item)
        item["topic"] = topic
        item["entity_label"] = item.get("entity_label") or _entity_label(item)
        item["display_rank"] = int(item.get("display_rank") or _TOPIC_ORDER.get(topic, 900))
        eligible_items.append(item)

    eligible_items.sort(
        key=lambda item: (
            int(item.get("display_rank") or 900),
            0 if item.get("blocking") else 1,
            -int(item.get("recommendation_priority") or 0),
            -float(item.get("confidence") or 0),
        )
    )

    visible_limit = requested_limit
    if respect_inline_limit:
        visible_limit = min(
            requested_limit,
            int(definition.get("max_inline_items") or requested_limit),
        )
    visible_items = eligible_items[: max(1, visible_limit)]
    max_questions = max(
        0, int(definition.get("max_interruptive_questions") or 0)
    )
    if "assistant" not in {
        str(surface).strip().lower()
        for surface in definition.get("display_surfaces") or []
    }:
        max_questions = 0
    questions = [
        item
        for item in visible_items
        if item.get("question_id")
        or item.get("recommendation_type") == "feedback_question"
    ][:max_questions]
    return visible_items, questions


def _runtime_scope_is_active(
    client: SnowflakeClient,
    settings: Settings,
    *,
    project_id: str,
    sttm_id: str | None,
) -> bool:
    """Reject archived/superseded/import-incomplete scopes before FIR lookup."""
    project_table = settings.qualify_table_name(settings.snowflake_projects_table)
    sttm_table = settings.qualify_table_name(settings.snowflake_sttm_table)
    project_literal = "'" + project_id.replace("'", "''") + "'"
    sttm_predicate = ""
    if sttm_id:
        sttm_literal = "'" + sttm_id.replace("'", "''") + "'"
        sttm_predicate = f"""
          AND EXISTS (
              SELECT 1 FROM {sttm_table} s
              WHERE TO_VARCHAR(s.STTM_ID) = {sttm_literal}
                AND TO_VARCHAR(s.PROJECT_ID) = TO_VARCHAR(p.PROJECT_ID)
                AND COALESCE(s.STATUS, 'DRAFT') NOT IN
                    ('SUPERSEDED', 'IMPORTING', 'IMPORT_FAILED')
                AND COALESCE(s.RUNTIME_SUPPRESSED, FALSE) = FALSE
          )
        """
    try:
        rows = client.session.sql(
            f"""
            SELECT 1
            FROM {project_table} p
            WHERE TO_VARCHAR(p.PROJECT_ID) = {project_literal}
              AND COALESCE(p.STATUS, 'ACTIVE') <> 'ARCHIVED'
              AND COALESCE(p.RUNTIME_SUPPRESSED, FALSE) = FALSE
              {sttm_predicate}
            LIMIT 1
            """
        ).collect()
        return bool(rows)
    except Exception:
        logger.warning("Recommendation runtime-scope validation failed", exc_info=True)
        return False


def _format_recommendations(
    recommendations: list[dict[str, Any]],
    evidence_by_recommendation: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for rec in recommendations:
        rec_id = str(rec.get("recommendation_id") or "")
        if not rec_id:
            continue
        actions = _normalize_json(rec.get("action_contract"), [])
        if rec.get("question_id"):
            actions = _default_actions(rec)
        elif not isinstance(actions, list) or not actions:
            actions = _default_actions(rec)
        content_version = int(rec.get("content_version") or 1)
        current_understanding = str(
            (rec.get("agent_payload") or {}).get("current_understanding")
            or rec.get("display_context")
            or ""
        ).strip()
        display_message = str(rec.get("display_message") or "").strip()
        if rec.get("question_id") and not current_understanding and display_message:
            current_understanding = display_message
            question_id = str(rec.get("question_id") or "").strip().upper()
            display_message = {
                "Q1": "This is my current understanding of the selected table. Is it correct, or should I update it?",
                "Q2": "Does this attribute meaning match how your business uses the column?",
                "Q3": "Is this business criticality accurate for your mapping?",
                "Q5": "Does this freshness expectation match the operational requirement?",
                "Q6": "This is the relationship pattern I found for the selected sources. Is this the join behavior you intend?",
                "Q7": "Does this lineage and derived-source purpose match what you are building?",
                "Q8": "Does this published mapping impact match your expected downstream use?",
                "Q9": "Should this query-shaping pattern be reused for the current source set?",
                "Q10": "Is this the remaining knowledge gap you want the workbench to resolve?",
            }.get(
                question_id,
                "Please confirm this current understanding or correct it.",
            )
        title_source = str(
            (rec.get("agent_payload") or {}).get("subject")
            or (rec.get("agent_payload") or {}).get("title")
            or current_understanding
            or display_message
        ).strip()
        title = " ".join(title_source.replace("\n", " ").split())
        title = title.split(". ", 1)[0].rstrip(".?!:;")
        if len(title) > 110:
            title = title[:107].rsplit(" ", 1)[0] + "..."
        if not title:
            title = str(rec.get("recommendation_category") or "Mapping recommendation").replace("_", " ").title()
        topic = _recommendation_topic(rec)
        entity_label = _entity_label(rec)
        urgency = str(
            rec.get("urgency")
            or (rec.get("agent_payload") or {}).get("urgency")
            or ("high" if int(rec.get("recommendation_priority") or 0) >= 80 else "normal")
        ).lower()
        blocking = bool(
            rec.get("blocking")
            or (rec.get("agent_payload") or {}).get("blocking")
            or topic == "sql_errors"
        )
        reason_now = str(
            rec.get("reason_now")
            or (rec.get("agent_payload") or {}).get("reason_now")
            or f"Relevant during {str(rec.get('milestone') or rec.get('checkpoint') or 'the current step').replace('_', ' ')}."
        ).strip()
        display_rank = _TOPIC_ORDER.get(topic, 900)
        dedupe_key = f"{topic}:{entity_label.strip().lower()}:{content_version}"
        formatted = {
            **rec,
            "checkpoint": rec.get("milestone"),
            "actions": actions,
            "evidence": evidence_by_recommendation.get(rec_id, []),
            "display_message": display_message,
            "current_understanding": current_understanding,
            "title": title,
            "topic": topic,
            "entity_label": entity_label,
            "reason_now": reason_now,
            "display_rank": display_rank,
            "urgency": urgency,
            "blocking": blocking,
        }
        existing = deduped.get(dedupe_key)
        if not existing or float(formatted.get("confidence") or 0) > float(
            existing.get("confidence") or 0
        ):
            deduped[dedupe_key] = formatted
    return sorted(
        deduped.values(),
        key=lambda item: (
            int(item.get("display_rank") or 900),
            0 if item.get("blocking") else 1,
            -int(item.get("recommendation_priority") or 0),
            -float(item.get("confidence") or 0),
        ),
    )


@router.post("/recommendations/evaluate")
async def evaluate_recommendations(
    request: Request,
    body: RecommendationEvaluateRequest,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    """Return one optional feedback question and all applicable recommendations."""
    snapshot = body.workspace_context
    principal = get_current_principal(request)
    user_id = principal.snowflake_user or str(principal.user_id)
    checkpoint = body.checkpoint or snapshot.checkpoint or snapshot.milestone or snapshot.action
    project_id = body.project_id or snapshot.project_id
    mapping_scoped = str(snapshot.scope_type or "").lower() in {"mapping", "column"}
    if mapping_scoped and (not project_id or not snapshot.sttm_id):
        return {
            "checkpoint": checkpoint,
            "context_key": snapshot.context_key,
            "scope_key": snapshot.scope_key,
            "primary_question": None,
            "items": [],
            "total": 0,
            "retrieval_mode": "none",
        }
    if project_id and not _runtime_scope_is_active(
        client,
        settings,
        project_id=project_id,
        sttm_id=snapshot.sttm_id,
    ):
        return {
            "checkpoint": checkpoint,
            "context_key": snapshot.context_key,
            "scope_key": snapshot.scope_key,
            "primary_question": None,
            "items": [],
            "total": 0,
            "retrieval_mode": "suppressed",
        }
    selected_tables = [table.qualified_name.upper() for table in snapshot.source_tables]
    target_fqn = snapshot.target_table.qualified_name.upper() if snapshot.target_table else None
    schema_fqn = None
    if snapshot.browsing_context and snapshot.browsing_context.database and snapshot.browsing_context.schema:
        schema_fqn = (
            f"{snapshot.browsing_context.database}.{snapshot.browsing_context.schema}".upper()
        )
    memory = ConversationMemoryService(client.session, settings)
    recommendations = memory.find_fir_recommendations_for_context(
        selected_tables=selected_tables,
        target_table=target_fqn,
        project_id=project_id,
        sttm_id=snapshot.sttm_id,
        user_id=user_id,
        context_key=snapshot.context_key,
        source_set_hash=snapshot.source_set_hash,
        derived_set_hash=snapshot.derived_set_hash,
        milestone=checkpoint,
        scope_key=snapshot.scope_key,
        scope_type=snapshot.scope_type,
        schema_fqn=schema_fqn,
        candidate_tables=(
            snapshot.browsing_context.visible_candidate_tables
            if snapshot.browsing_context
            else []
        ),
        allow_search_fallback=body.include_search_fallback,
        limit=body.limit,
    )
    rec_ids = [
        str(item.get("recommendation_id"))
        for item in recommendations
        if item.get("recommendation_id")
    ]
    items = _format_recommendations(
        recommendations,
        (
            _load_evidence(client, settings, rec_ids)
            if body.include_evidence
            else {}
        ),
    )
    checkpoint_definition = (
        recommendations[0].get("checkpoint_definition")
        if recommendations
        else None
    ) or _load_checkpoint_definition(client, settings, checkpoint)
    items, questions = _apply_checkpoint_policy(
        items,
        checkpoint_definition,
        body.limit,
    )
    return {
        "checkpoint": checkpoint,
        "checkpoint_definition": checkpoint_definition,
        "context_key": snapshot.context_key,
        "scope_key": snapshot.scope_key,
        "primary_question": questions[0] if questions else None,
        "items": items,
        "total": len(items),
        "retrieval_mode": items[0].get("retrieval_mode") if items else "none",
    }


@router.get("/recommendations")
async def list_recommendations(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    context_key: str | None = Query(None),
    scope_key: str | None = Query(None),
    project_id: str | None = Query(None),
    sttm_id: str | None = Query(None),
    checkpoint: str | None = Query(None),
    limit: int = Query(20, ge=1, le=50),
):
    """List recommendations for the persistent Recommendations tab."""
    if not context_key and not scope_key and not project_id:
        raise HTTPException(status_code=400, detail="context_key, scope_key, or project_id is required")
    principal = get_current_principal(request)
    user_id = principal.snowflake_user or str(principal.user_id)
    if project_id and not _runtime_scope_is_active(
        client, settings, project_id=project_id, sttm_id=sttm_id
    ):
        return {"checkpoint_definition": {}, "items": [], "total": 0}
    memory = ConversationMemoryService(client.session, settings)
    items = memory.find_fir_recommendations_for_context(
        selected_tables=[],
        project_id=project_id,
        sttm_id=sttm_id,
        user_id=user_id,
        context_key=context_key,
        scope_key=scope_key,
        milestone=checkpoint,
        limit=limit,
    )
    rec_ids = [str(item.get("recommendation_id")) for item in items if item.get("recommendation_id")]
    formatted = _format_recommendations(
        items,
        _load_evidence(client, settings, rec_ids),
    )
    checkpoint_definition = _load_checkpoint_definition(client, settings, checkpoint)
    formatted, _ = _apply_checkpoint_policy(
        formatted,
        checkpoint_definition,
        limit,
        respect_inline_limit=False,
    )
    return {
        "checkpoint_definition": checkpoint_definition,
        "items": formatted,
        "total": len(formatted),
    }


@router.get("/recommendations/{recommendation_id}")
async def get_recommendation(
    recommendation_id: str,
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    table = settings.qualify_metadata_object_name("TBL_FIR_AGENT_RECOMMENDATIONS")
    escaped = recommendation_id.replace("'", "''")
    principal = get_current_principal(request)
    user_id = (principal.snowflake_user or str(principal.user_id)).replace("'", "''")
    rows = client.session.sql(
        f"""
        SELECT *
        FROM {table}
        WHERE AGENT_RECOMMENDATION_ID = '{escaped}'
          AND (COALESCE(USER_ID, '') = '' OR USER_ID = '{user_id}')
        LIMIT 1
        """
    ).collect()
    if not rows:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    raw = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
    rec = {
        "recommendation_id": raw.get("AGENT_RECOMMENDATION_ID"),
        "recommendation_type": raw.get("RECOMMENDATION_TYPE"),
        "recommendation_category": raw.get("RECOMMENDATION_CATEGORY"),
        "display_message": raw.get("DISPLAY_MESSAGE"),
        "evidence_summary": raw.get("EVIDENCE_SUMMARY"),
        "confidence": raw.get("CONFIDENCE"),
        "checkpoint": raw.get("MILESTONE"),
        "actions": _normalize_json(raw.get("ACTION_CONTRACT"), []),
        "agent_payload": _normalize_json(raw.get("AGENT_PAYLOAD"), {}),
        "question_id": raw.get("QUESTION_ID"),
        "content_version": raw.get("CONTENT_VERSION") or 1,
        "group_key": raw.get("GROUP_KEY"),
    }
    formatted = _format_recommendations(
        [rec],
        _load_evidence(client, settings, [recommendation_id]),
    )
    return formatted[0] if formatted else rec


@router.post("/recommendations/{recommendation_id}/outcomes")
async def record_recommendation_outcome(
    recommendation_id: str,
    body: RecommendationOutcomeRequest,
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    memory = ConversationMemoryService(client.session, settings)
    memory.record_fir_recommendation_outcome(
        recommendation_id=recommendation_id,
        outcome_type=body.outcome_type,
        context_key=body.context_key,
        snapshot_id=body.snapshot_id,
        request_id=body.request_id,
        artifact_id=body.artifact_id,
        user_id=(
            get_current_principal(request).snowflake_user
            or str(get_current_principal(request).user_id)
        ),
        payload=body.payload,
    )
    return {"status": "recorded", "recommendation_id": recommendation_id}


@router.post("/recommendations/outcomes/batch")
async def record_recommendation_outcomes_batch(
    body: RecommendationOutcomeBatchRequest,
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    memory = ConversationMemoryService(client.session, settings)
    principal = get_current_principal(request)
    user_id = principal.snowflake_user or str(principal.user_id)
    outcome_ids = memory.record_fir_recommendation_outcomes_batch([
        {**item.model_dump(mode="python"), "user_id": user_id}
        for item in body.items
    ])
    return {"status": "recorded", "recorded": len(outcome_ids)}


# Compatibility adapter used by older clients.
@router.get("/notifications/pending")
async def get_pending_notifications(
    request: Request,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    context_key: str = Query(..., min_length=1),
    project_id: str | None = Query(None),
    sttm_id: str | None = Query(None),
    limit: int = Query(5, ge=1, le=20),
):
    principal = get_current_principal(request)
    user_id = principal.snowflake_user or str(principal.user_id)
    if project_id and not _runtime_scope_is_active(
        client, settings, project_id=project_id, sttm_id=sttm_id
    ):
        return {"notifications": [], "total": 0}
    memory = ConversationMemoryService(client.session, settings)
    items = memory.find_fir_recommendations_for_context(
        selected_tables=[],
        context_key=context_key,
        project_id=project_id,
        sttm_id=sttm_id,
        user_id=user_id,
        limit=limit,
    )
    return {"notifications": items, "total": len(items)}
