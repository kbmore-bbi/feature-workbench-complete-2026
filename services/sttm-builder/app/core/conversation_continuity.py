"""Durable logical conversations spanning multiple Cortex thread segments."""

from __future__ import annotations

import json
import hashlib
import math
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.core.config import Settings
from app.core.conversation_memory import ConversationMemoryService


def estimate_tokens(value: Any) -> int:
    """Conservative tokenizer-independent estimate for rollover decisions."""

    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, default=str, separators=(",", ":"), sort_keys=True)
    return max(1, math.ceil(len(text.encode("utf-8")) / 3.6))


@dataclass(frozen=True)
class ConversationPreparation:
    logical_conversation_id: str
    segment_id: str
    segment_number: int
    physical_thread_id: str | None
    checkpoint_artifact_id: str | None = None
    checkpoint_message: str | None = None
    recent_turns: list[dict[str, Any]] = field(default_factory=list)
    rolled_over: bool = False
    rollover_reason: str | None = None
    estimated_tokens: int = 0
    rollover_context_tokens: int = 0


class ConversationContinuityService:
    def __init__(
        self,
        memory: ConversationMemoryService,
        settings: Settings,
    ) -> None:
        self._memory = memory
        self._settings = settings

    @staticmethod
    def _value(row: dict[str, Any], key: str, default: Any = None) -> Any:
        return row.get(key, row.get(key.lower(), default))

    def prepare(
        self,
        *,
        context: Any,
        packed_request: str,
        request_id: str | None,
        user_id: str | None,
        force_rollover_reason: str | None = None,
    ) -> ConversationPreparation:
        ensure_storage = getattr(self._memory, "ensure_storage_exists", None)
        if callable(ensure_storage):
            ensure_storage()
        requested_logical_id = getattr(context, "logical_conversation_id", None)
        requested_thread_id = getattr(context, "thread_id", None)
        if str(requested_thread_id or "").startswith("local-"):
            requested_thread_id = None
        resolved_by_thread = None
        if not requested_logical_id and requested_thread_id:
            resolved_by_thread = self._memory.load_conversation_segment_by_thread(
                requested_thread_id,
                user_id=user_id,
            )
        logical_id = (
            requested_logical_id
            or (
                self._value(resolved_by_thread, "LOGICAL_CONVERSATION_ID")
                if resolved_by_thread
                else None
            )
            or requested_thread_id
            or f"logical_{uuid.uuid4().hex[:20]}"
        )
        active = self._memory.load_active_conversation_segment(
            logical_id,
            user_id=user_id,
        )
        request_tokens = estimate_tokens(packed_request)

        if active is None:
            segment_number = 1
            segment_id = self._memory.create_conversation_segment(
                logical_conversation_id=logical_id,
                physical_thread_id=requested_thread_id,
                segment_number=segment_number,
                previous_segment_id=None,
                rollover_reason=None,
                checkpoint_artifact_id=None,
                semantic_bundle_hash=getattr(context, "semantic_bundle_hash", None),
                learning_context_hash=getattr(context, "learning_context_hash", None),
                user_id=user_id,
            )
            return ConversationPreparation(
                logical_conversation_id=logical_id,
                segment_id=segment_id,
                segment_number=segment_number,
                physical_thread_id=requested_thread_id,
                estimated_tokens=request_tokens,
            )

        prior_tokens = int(self._value(active, "ESTIMATED_CONTEXT_TOKENS", 0) or 0)
        turn_count = int(self._value(active, "TURN_COUNT", 0) or 0)
        projected_tokens = prior_tokens + request_tokens
        context_limit = max(1, int(self._settings.agent_context_limit_tokens))
        soft_limit = int(context_limit * self._settings.agent_thread_rollover_ratio)
        hard_limit = int(context_limit * self._settings.agent_thread_hard_ratio)

        rollover_reason = force_rollover_reason
        if rollover_reason is None and projected_tokens >= hard_limit:
            rollover_reason = "hard_context_threshold"
        elif rollover_reason is None and projected_tokens >= soft_limit:
            rollover_reason = "soft_context_threshold"
        elif (
            rollover_reason is None
            and turn_count >= self._settings.agent_max_turns_per_segment
        ):
            rollover_reason = "turn_threshold"

        active_segment_id = str(self._value(active, "SEGMENT_ID"))
        active_segment_number = int(self._value(active, "SEGMENT_NUMBER", 1) or 1)
        active_thread_id = str(self._value(active, "PHYSICAL_THREAD_ID", "") or "") or None
        if not rollover_reason:
            return ConversationPreparation(
                logical_conversation_id=logical_id,
                segment_id=active_segment_id,
                segment_number=active_segment_number,
                physical_thread_id=active_thread_id,
                estimated_tokens=projected_tokens,
            )

        recent_turns = self._memory.load_recent_turns(
            logical_id,
            limit=max(1, int(self._settings.agent_recent_turns_to_keep)),
            user_id=user_id,
        )
        checkpoint = self._build_checkpoint(
            context=context,
            recent_turns=recent_turns,
            rollover_reason=rollover_reason,
            previous_segment=active_segment_number,
        )
        checkpoint_id = self._memory.record_agent_artifact(
            request_id=request_id,
            session_id=getattr(context, "session_id", None),
            thread_id=active_thread_id,
            logical_conversation_id=logical_id,
            thread_segment=active_segment_number,
            agent_name="conversation_continuity",
            artifact_type="thread_checkpoint",
            payload=checkpoint,
            artifact_status="active",
            semantic_bundle_id=getattr(context, "semantic_bundle_id", None),
            semantic_bundle_hash=getattr(context, "semantic_bundle_hash", None),
            summary=(
                f"Conversation checkpoint before segment {active_segment_number + 1}; "
                f"reason={rollover_reason}."
            ),
            created_by=user_id,
            project_id=getattr(context, "project_id", None),
            mapping_id=getattr(context, "sttm_id", None),
            access_fingerprint=hashlib.sha256(
                str(user_id or "").encode("utf-8")
            ).hexdigest(),
            keywords=["conversation", "checkpoint", rollover_reason],
        )
        next_segment_number = active_segment_number + 1
        next_segment_id = self._memory.create_conversation_segment(
            logical_conversation_id=logical_id,
            physical_thread_id=None,
            segment_number=next_segment_number,
            previous_segment_id=active_segment_id,
            rollover_reason=rollover_reason,
            checkpoint_artifact_id=checkpoint_id,
            semantic_bundle_hash=getattr(context, "semantic_bundle_hash", None),
            learning_context_hash=getattr(context, "learning_context_hash", None),
            user_id=user_id,
        )
        self._memory.close_conversation_segment(
            active_segment_id,
            rollover_reason=rollover_reason,
            next_segment_id=next_segment_id,
        )
        return ConversationPreparation(
            logical_conversation_id=logical_id,
            segment_id=next_segment_id,
            segment_number=next_segment_number,
            physical_thread_id=None,
            checkpoint_artifact_id=checkpoint_id,
            checkpoint_message=self._checkpoint_prompt(checkpoint, checkpoint_id),
            recent_turns=recent_turns,
            rolled_over=True,
            rollover_reason=rollover_reason,
            estimated_tokens=request_tokens + estimate_tokens(checkpoint),
            rollover_context_tokens=estimate_tokens(checkpoint),
        )

    def complete(
        self,
        preparation: ConversationPreparation,
        *,
        physical_thread_id: str,
        user_text: str,
        assistant_text: str,
    ) -> None:
        self._memory.bind_conversation_thread(
            preparation.segment_id,
            physical_thread_id,
        )
        self._memory.note_conversation_segment_usage(
            preparation.segment_id,
            added_tokens=(
                preparation.rollover_context_tokens
                + estimate_tokens(user_text)
                + estimate_tokens(assistant_text)
            ),
            added_turns=2,
        )

    @staticmethod
    def _build_checkpoint(
        *,
        context: Any,
        recent_turns: list[dict[str, Any]],
        rollover_reason: str,
        previous_segment: int,
    ) -> dict[str, Any]:
        workspace = getattr(context, "workspace_context", None)
        workspace_payload = (
            workspace.model_dump(mode="json", exclude_none=True)
            if hasattr(workspace, "model_dump")
            else workspace
        )
        learning = getattr(context, "learning_context", None)
        linked_precedents: list[Any] = []
        if learning is not None:
            linked_precedents = list(
                getattr(learning, "similar_mappings", None)
                or getattr(learning, "precedents", None)
                or []
            )
        return {
            "checkpoint_version": "1.0",
            "rollover_reason": rollover_reason,
            "previous_segment": previous_segment,
            "workflow": {
                "surface": str(getattr(context, "surface", "") or ""),
                "project_id": getattr(context, "project_id", None),
                "mapping_id": getattr(context, "sttm_id", None),
                "routing_hint": getattr(context, "routing_hint", None),
            },
            "workspace_state": workspace_payload,
            "semantic_context": {
                "bundle_id": getattr(context, "semantic_bundle_id", None),
                "bundle_hash": getattr(context, "semantic_bundle_hash", None),
            },
            "learning_context": {
                "context_id": getattr(context, "learning_context_id", None),
                "context_hash": getattr(context, "learning_context_hash", None),
                "linked_precedent_refs": linked_precedents,
            },
            "artifact_refs": list(getattr(context, "artifact_refs", None) or []),
            "recent_turns": recent_turns,
        }

    @staticmethod
    def _checkpoint_prompt(checkpoint: dict[str, Any], artifact_id: str) -> str:
        workflow = checkpoint.get("workflow") or {}
        semantic = checkpoint.get("semantic_context") or {}
        learning = checkpoint.get("learning_context") or {}
        return (
            "Continue the existing logical workbench conversation from a durable "
            f"checkpoint artifact ({artifact_id}). Preserve confirmed workspace state "
            "and decisions. Current workflow: "
            f"surface={workflow.get('surface')}, project={workflow.get('project_id')}, "
            f"mapping={workflow.get('mapping_id')}. Context handles: "
            f"semantic_bundle={semantic.get('bundle_id')}#{semantic.get('bundle_hash')}, "
            f"learning_context={learning.get('context_id')}#{learning.get('context_hash')}. "
            "Use the supplied recent turns for conversational continuity; do not ask the "
            "user to restart or repeat large SQL/YAML."
        )
