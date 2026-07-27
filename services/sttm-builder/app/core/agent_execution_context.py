from __future__ import annotations

import logging
from typing import Any

from app.core.conversation_memory import ConversationMemoryService
from app.schema.sttm_builder import (
    AgentExecutionContextV2,
    Interface,
    STTMBuilderEnvelopeRequest,
)
from app.schema.workspace_context import WorkbenchContextSnapshotV2

logger = logging.getLogger(__name__)


_ACTION_BY_INTENT = {
    Interface.AUTO_MAP: ("auto_map.requested", "before_auto_map"),
    Interface.TRANSFORM: ("transformation.requested", "transformation_review"),
    Interface.CHAT: ("assistant.requested", "assistant_request"),
}


def _rank_agent_recommendations(
    intent: Interface,
    recommendations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if intent == Interface.TRANSFORM:
        order = {
            "correction_warning": 0,
            "transformation_pattern": 1,
            "preprocessing_rule": 2,
            "column_mapping_hint": 3,
        }
    else:
        order = {
            "correction_warning": 0,
            "mapping_precedent": 1,
            "value_binding": 2,
            "constant_mapping": 2,
            "column_mapping_hint": 3,
            "mapping_insight": 3,
            "relationship_hint": 4,
            "derived_source_suggestion": 5,
            "transformation_pattern": 6,
        }
    return sorted(
        recommendations,
        key=lambda item: (
            order.get(str(item.get("type") or item.get("recommendation_type") or "").lower(), 50),
            -float(item.get("score") or item.get("priority") or 0),
            -float(item.get("confidence") or 0),
        ),
    )[:10]


def _relationship_payload(req: STTMBuilderEnvelopeRequest) -> list[dict[str, Any]]:
    return [
        item.model_dump(mode="json") if hasattr(item, "model_dump") else dict(item)
        for item in (req.context.relationships or [])
    ]


def _build_snapshot(req: STTMBuilderEnvelopeRequest) -> WorkbenchContextSnapshotV2:
    action, milestone = _ACTION_BY_INTENT[req.data.intent]
    existing = req.context.workspace_context
    payload = existing.model_dump(mode="json") if existing is not None else {}
    payload.update(
        {
            "context_version": "2.0",
            "context_hash": "",
            "context_key": "",
            "snapshot_id": existing.snapshot_id if existing is not None else None,
            "action": action,
            "milestone": milestone,
            "page": payload.get("page") or "sttm_builder",
            "surface": req.context.surface.value,
            "project_id": req.context.project_id or payload.get("project_id"),
            "sttm_id": req.context.sttm_id or payload.get("sttm_id"),
            "source_tables": [table.model_dump(mode="json") for table in (req.context.source_tables or [])],
            "driving_table": req.context.driving_table.model_dump(mode="json")
            if req.context.driving_table
            else None,
            "target_table": req.context.target_table.model_dump(mode="json")
            if req.context.target_table
            else None,
            "selected_columns_by_table": req.context.selected_columns_by_table or {},
            "relationships": _relationship_payload(req),
            "mapping_intent": req.context.mapping_intent,
        }
    )
    semantic = dict(payload.get("semantic") or {})
    semantic.update(
        {
            "bundle_id": req.context.semantic_bundle_id,
            "bundle_label": req.context.semantic_bundle_label,
            "view_name": req.context.semantic_view_name,
        }
    )
    payload["semantic"] = semantic
    existing_derived = {item.get("id"): item for item in payload.get("derived_sources") or [] if isinstance(item, dict)}
    payload["derived_sources"] = [
        existing_derived.get(source_id, {"id": source_id})
        for source_id in (req.context.selected_derived_sources or [])
    ]
    return WorkbenchContextSnapshotV2.model_validate(payload)


def attach_agent_execution_context(
    req: STTMBuilderEnvelopeRequest,
    memory: ConversationMemoryService,
) -> STTMBuilderEnvelopeRequest:
    """Persist one canonical snapshot and attach shared FIR context to a request."""
    snapshot = _build_snapshot(req)
    snapshot_id = snapshot.snapshot_id
    if not snapshot_id:
        try:
            snapshot_id = memory.save_workspace_snapshot(
                session_id=req.context.session_id,
                thread_id=req.context.thread_id,
                context_hash=snapshot.context_hash,
                context_key=snapshot.context_key,
                action=snapshot.action,
                milestone=snapshot.milestone,
                snapshot_payload=snapshot.model_dump(mode="json"),
                context_version=snapshot.context_version,
                page=snapshot.page,
                surface=snapshot.surface,
                project_id=snapshot.project_id,
                sttm_id=snapshot.sttm_id,
                semantic_bundle_id=snapshot.semantic.bundle_id,
                semantic_bundle_hash=snapshot.semantic.bundle_hash,
                user_id=req.actor.user_id if req.actor else None,
            )
            snapshot = snapshot.model_copy(update={"snapshot_id": snapshot_id})
            memory.record_fir_event(
                event_type=snapshot.action or "agent.requested",
                user_id=req.actor.user_id if req.actor else None,
                session_id=req.context.session_id,
                request_id=req.request_id,
                page=snapshot.page,
                surface=snapshot.surface,
                entity_type="workspace_context",
                entity_ids=[item for item in (snapshot.project_id, snapshot.sttm_id) if item],
                event_payload={
                    "project_id": snapshot.project_id,
                    "sttm_id": snapshot.sttm_id,
                    "source_tables": [table.qualified_name for table in snapshot.source_tables],
                    "target_table": snapshot.target_table.qualified_name if snapshot.target_table else None,
                    "derived_source_ids": snapshot.selected_derived_source_ids(),
                },
                context_key=snapshot.context_key,
                snapshot_id=snapshot_id,
                milestone=snapshot.milestone,
            )
        except Exception as exc:
            logger.warning("Unable to persist FIR runtime snapshot: %s", exc)

    learning = req.context.learning_context
    recommendations = _rank_agent_recommendations(
        req.data.intent,
        list(learning.fir_recommendations) if learning else [],
    )
    fir_learnings = list(learning.fir_learnings) if learning else []
    recommendation_ids = [
        str(item.get("recommendation_id"))
        for item in recommendations
        if item.get("recommendation_id")
    ]
    inference_ids = [item.learning_id for item in fir_learnings]
    evidence_ids = sorted(
        {
            str(evidence_id)
            for item in recommendations
            for evidence_id in (item.get("evidence_ids") or [])
            if evidence_id
        }
    )
    confidences = [
        float(value)
        for value in [
            *[item.confidence for item in fir_learnings],
            *[item.get("confidence") for item in recommendations],
        ]
        if isinstance(value, (int, float))
    ]
    execution = AgentExecutionContextV2(
        snapshot_id=snapshot_id,
        context_key=snapshot.context_key,
        scope_key=snapshot.scope_key,
        scope_type=snapshot.scope_type,
        checkpoint=snapshot.checkpoint,
        action=snapshot.action,
        milestone=snapshot.milestone,
        project_id=snapshot.project_id,
        sttm_id=snapshot.sttm_id,
        shared_intent=req.context.mapping_intent,
        semantic_bundle_summary=snapshot.semantic.model_dump(mode="json"),
        relationships=snapshot.relationships,
        derived_lineage=req.context.derived_source_lineage or [],
        curated_inferences=[item.model_dump(mode="json") for item in fir_learnings],
        exact_fir_recommendations=recommendations,
        retrieved_inference_ids=inference_ids,
        retrieved_recommendation_ids=recommendation_ids,
        confidence=sum(confidences) / len(confidences) if confidences else None,
        evidence_ids=evidence_ids,
        linked_project_ids=list(learning.linked_project_ids) if learning else [],
        linked_mapping_ids=list(learning.linked_mapping_ids) if learning else [],
        linked_project_patterns=list(learning.linked_project_patterns) if learning else [],
        linked_mapping_precedents=list(learning.linked_mapping_precedents) if learning else [],
        target_mapping_patterns=list(learning.target_mapping_patterns) if learning else [],
        curated_relationships=list(learning.curated_relationships) if learning else [],
        retrieval_explanations=list(learning.retrieval_explanations) if learning else [],
        used_inference_ids=list(learning.used_inference_ids) if learning else [],
        used_recommendation_ids=list(learning.used_recommendation_ids) if learning else [],
    )
    if learning:
        learning = learning.model_copy(
            update={
                "context_key": snapshot.context_key,
                "fir_recommendations": recommendations,
                "retrieved_inference_ids": inference_ids,
                "retrieved_recommendation_ids": recommendation_ids,
            }
        )
    return req.model_copy(
        update={
            "context": req.context.model_copy(
                update={
                    "workspace_context": snapshot,
                    "execution_context": execution,
                    "learning_context": learning,
                }
            )
        }
    )
