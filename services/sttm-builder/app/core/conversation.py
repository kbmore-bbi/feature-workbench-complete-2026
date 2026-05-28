import json
import logging
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from app.core.config import Settings
from app.core.conversation_memory import ConversationMemoryService
from app.core.exceptions import SnowflakeAgentError, SnowflakeQueryError
from app.core.sttm_builder import STTMBuilderService
from app.core.sttm_builder import (
    _extract_stream_message_text,
    _extract_stream_response_payload,
    _extract_stream_status,
    _extract_stream_suggestions,
    _extract_stream_text_delta,
)
from app.core.snowflake_agent import SnowflakeAgentClient
from app.guardrails.adapters.rag_source import SemanticContextRAGSource
from app.guardrails.config.loader import load_config
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.policies.agent_registry import AgentRegistry
from app.guardrails.policies.business_rules import BusinessRules
from app.guardrails.runtime.model_boundary import ModelBoundaryGuard
from app.guardrails.runtime.postflight import PostflightGuard
from app.guardrails.runtime.router import DeterministicRouter
from app.schema.contracts import ApiResponseEnvelope, build_response_envelope
from app.schema.conversation import (
    AssistantInferenceRecord,
    AssistantPreferenceState,
    AssistantSignal,
    AssistantSignalResponseData,
    AssistantSignalResponseInput,
    AssistantSignalStatus,
    AssistantSignalType,
    ConversationArtifact,
    ConversationIndexSyncRequestData,
    ConversationIndexSyncResponseData,
    ConversationIntentClass,
    ConversationOperation,
    ConversationRequestEnvelope,
    ConversationResponseData,
    ConversationRoute,
    ConversationSignalEvaluationData,
    ConversationSignalsResponseData,
    ConversationSearchRequestData,
    ConversationSearchResponseData,
    ConversationSettingsResponseData,
    ConversationStatus,
    EvidenceCitation,
    FeedbackInput,
)
from app.schema.sttm_builder import Interface, STTMBuilderEnvelopeRequest, STTMOperation

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class AgentRoutePlan:
    route: ConversationRoute
    intent_class: ConversationIntentClass
    reason: str
    confidence: float | None
    status: ConversationStatus
    message: str | None = None
    suggested_operation: str | None = None
    citations: list[EvidenceCitation] = field(default_factory=list)
    quick_replies: list[str] = field(default_factory=list)


class ConversationService:
    def __init__(
        self,
        agent_client: SnowflakeAgentClient,
        *,
        sttm_builder_service: STTMBuilderService,
        memory_service: ConversationMemoryService,
        settings: Settings,
    ) -> None:
        self._agent = agent_client
        self._sttm_builder = sttm_builder_service
        self._memory = memory_service
        self._settings = settings
        self._guardrails_config = load_config(settings=settings)
        self._router = DeterministicRouter(self._guardrails_config)
        self._model_guard = ModelBoundaryGuard(self._guardrails_config)
        self._postflight_guard = PostflightGuard(self._guardrails_config)
        self._agent_registry = AgentRegistry(self._guardrails_config)
        self._business_rules = BusinessRules(self._guardrails_config)
        self._rag_source = SemanticContextRAGSource(self._guardrails_config)

        agent_name = settings.resolved_workbench_conversation_agent.strip()
        self._agent_name = agent_name

    def invoke(
        self,
        req: ConversationRequestEnvelope,
        *,
        governance_decision: GovernanceDecision | None = None,
    ) -> Any:
        decision = governance_decision or GovernanceDecision(
            trace_id=req.context.trace_id or req.request_id or "conversation-trace",
            request_id=req.request_id,
            operation=req.operation.value,
        )
        payload = req.model_dump(mode="json", exclude_none=True)
        conversation_id = req.context.thread_id or f"conv_{req.request_id or uuid.uuid4().hex[:12]}"
        decision.merge_meta(conversation_id=conversation_id)

        fast_response = self._build_fast_response(req, decision, conversation_id=conversation_id)
        if fast_response is not None:
            return fast_response

        if req.operation == ConversationOperation.FEEDBACK:
            self._business_rules.validate_feedback(payload.get("data") or {})
            feedback = req.data.feedback
            if feedback is not None:
                self._memory.record_feedback(
                    request_id=req.request_id,
                    conversation_id=conversation_id,
                    feedback=feedback,
                    user_id=req.actor.user_id if req.actor else None,
                )
                self._memory.sync_rag_documents(
                    include_conversation_docs=False,
                    include_feedback_docs=True,
                    include_recommendation_docs=False,
                    include_semantic_docs=False,
                    include_relationship_docs=False,
                )
            return self._finalize_conversation_response(
                req,
                decision,
                route=ConversationRoute.CONVERSATION,
                status=ConversationStatus.COMPLETED,
                intent_class=ConversationIntentClass.FEEDBACK_CAPTURE,
                agent=None,
                message="Feedback recorded for review.",
                artifact=ConversationArtifact(
                    conversation_id=conversation_id,
                    review_recorded=True,
                    raw_feedback=(payload.get("data") or {}).get("feedback"),
                ),
                citations=[],
            )

        route_plan = self._plan_route(req, decision)
        decision.merge_meta(
            route=route_plan.route.value,
            intent_class=route_plan.intent_class.value,
            route_reason=route_plan.reason,
            route_confidence=route_plan.confidence,
            suggested_operation=route_plan.suggested_operation,
        )

        if route_plan.route == ConversationRoute.STTM_BUILDER:
            handoff_request = self._build_handoff_request(req, route_plan)
            decision.merge_meta(
                route="sttm_builder",
                handoff_operation=handoff_request.operation.value,
                target_agent="sttm_builder",
            )
            return self._sttm_builder.invoke(handoff_request, governance_decision=decision)

        if route_plan.status == ConversationStatus.NEEDS_INPUT and route_plan.message:
            return self._finalize_conversation_response(
                req,
                decision,
                route=ConversationRoute.CONVERSATION,
                status=ConversationStatus.NEEDS_INPUT,
                intent_class=route_plan.intent_class,
                agent="workbench_conversation",
                message=route_plan.message,
                artifact=ConversationArtifact(
                    route_reason=route_plan.reason,
                    route_confidence=route_plan.confidence,
                    suggested_operation=route_plan.suggested_operation,
                    quick_replies=route_plan.quick_replies,
                ),
                citations=route_plan.citations,
            )

        if route_plan.route == ConversationRoute.CONVERSATION and route_plan.message:
            return self._finalize_conversation_response(
                req,
                decision,
                route=ConversationRoute.CONVERSATION,
                status=route_plan.status,
                intent_class=route_plan.intent_class,
                agent="workbench_conversation",
                message=route_plan.message,
                artifact=ConversationArtifact(
                    route_reason=route_plan.reason,
                    route_confidence=route_plan.confidence,
                    suggested_operation=route_plan.suggested_operation,
                    quick_replies=route_plan.quick_replies,
                ),
                citations=route_plan.citations,
            )

        self._agent_registry.assert_call_allowed(
            agent_id="workbench_conversation",
            caller="backend_router",
            operation=req.operation.value,
        )
        if not self._agent_name:
            return self._finalize_conversation_response(
                req,
                decision,
                route=ConversationRoute.CONVERSATION,
                status=ConversationStatus.NEEDS_INPUT,
                intent_class=route_plan.intent_class,
                agent="workbench_conversation",
                message="The conversation agent is not configured yet. Please set SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT.",
                artifact=ConversationArtifact(
                    route_reason=route_plan.reason,
                    route_confidence=route_plan.confidence,
                    suggested_operation=route_plan.suggested_operation,
                ),
                citations=[],
            )

        citations = self._resolve_citations(req)
        user_text = self._build_agent_payload(
            req,
            route_plan.intent_class.value,
            citations,
            execution_mode="response_generation",
            route_plan=route_plan,
            allow_search=not citations,
        )
        self._model_guard.assert_model_target_allowed(
            operation=req.operation.value,
            target="agent",
            decision=decision,
        )
        raw_text, _, raw_payload = self._agent.run_detailed(
            [{"role": "user", "content": [{"type": "text", "text": user_text}]}],
            agent=self._agent_name,
        )
        response_data = self._parse_agent_response(
            req=req,
            raw_text=raw_text,
            raw_payload=raw_payload,
            route=ConversationRoute.CONVERSATION.value,
            intent_class=route_plan.intent_class.value,
            default_citations=citations,
        )
        response_data.artifact = response_data.artifact.model_copy(
            update={
                "route_reason": route_plan.reason,
                "route_confidence": route_plan.confidence,
                "suggested_operation": route_plan.suggested_operation,
            }
        )
        decision.merge_meta(target_agent="workbench_conversation", rag_source_ids=response_data.artifact.source_ids)
        return self._finalize_conversation_response(
            req,
            decision,
            route=ConversationRoute.CONVERSATION,
            status=response_data.status,
            intent_class=response_data.intent_class,
            agent=response_data.agent,
            message=response_data.message,
            artifact=response_data.artifact,
            citations=response_data.citations,
        )

    def invoke_stream(
        self,
        req: ConversationRequestEnvelope,
        *,
        governance_decision: GovernanceDecision | None = None,
    ) -> Iterator[str]:
        def emit(event: str, data: dict[str, Any]) -> str:
            return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"

        def iterator() -> Iterator[str]:
            decision = governance_decision or GovernanceDecision(
                trace_id=req.context.trace_id or req.request_id or f"conversation-stream-{uuid.uuid4().hex[:8]}",
                request_id=req.request_id,
                operation=req.operation.value,
            )
            payload = req.model_dump(mode="json", exclude_none=True)
            conversation_id = req.context.thread_id or f"conv_{req.request_id or uuid.uuid4().hex[:12]}"
            decision.merge_meta(conversation_id=conversation_id)

            fast_response = self._build_fast_response(req, decision, conversation_id=conversation_id)
            if fast_response is not None:
                yield emit("final", fast_response.model_dump(mode="json"))
                return

            if req.operation == ConversationOperation.FEEDBACK:
                response = self.invoke(req, governance_decision=decision)
                yield emit("final", response.model_dump(mode="json"))
                return

            route_plan = self._plan_route(req, decision)
            decision.merge_meta(
                route=route_plan.route.value,
                intent_class=route_plan.intent_class.value,
                route_reason=route_plan.reason,
                route_confidence=route_plan.confidence,
                suggested_operation=route_plan.suggested_operation,
            )

            if route_plan.route == ConversationRoute.STTM_BUILDER:
                handoff_request = self._build_handoff_request(req, route_plan)
                yield from self._sttm_builder.invoke_stream(handoff_request, governance_decision=decision)
                return

            if route_plan.status == ConversationStatus.NEEDS_INPUT and route_plan.message:
                response = self._finalize_conversation_response(
                    req,
                    decision,
                    route=ConversationRoute.CONVERSATION,
                    status=ConversationStatus.NEEDS_INPUT,
                    intent_class=route_plan.intent_class,
                    agent="workbench_conversation",
                    message=route_plan.message,
                    artifact=ConversationArtifact(
                        conversation_id=conversation_id,
                        route_reason=route_plan.reason,
                        route_confidence=route_plan.confidence,
                        suggested_operation=route_plan.suggested_operation,
                        quick_replies=route_plan.quick_replies,
                    ),
                    citations=route_plan.citations,
                )
                yield emit("final", response.model_dump(mode="json"))
                return

            if route_plan.route == ConversationRoute.CONVERSATION and route_plan.message:
                response = self._finalize_conversation_response(
                    req,
                    decision,
                    route=ConversationRoute.CONVERSATION,
                    status=route_plan.status,
                    intent_class=route_plan.intent_class,
                    agent="workbench_conversation",
                    message=route_plan.message,
                    artifact=ConversationArtifact(
                        conversation_id=conversation_id,
                        route_reason=route_plan.reason,
                        route_confidence=route_plan.confidence,
                        suggested_operation=route_plan.suggested_operation,
                        quick_replies=route_plan.quick_replies,
                    ),
                    citations=route_plan.citations,
                )
                yield emit("final", response.model_dump(mode="json"))
                return

            citations = self._resolve_citations(req)
            if citations:
                yield emit(
                    "status",
                    {
                        "phase": "rag_retrieval_completed",
                        "message": f"Retrieved {len(citations)} evidence item(s) for the conversation request.",
                        "conversation_id": conversation_id,
                    },
                )
            if not self._agent_name:
                response = self._finalize_conversation_response(
                    req,
                    decision,
                    route=ConversationRoute.CONVERSATION,
                    status=ConversationStatus.NEEDS_INPUT,
                    intent_class=route_plan.intent_class,
                    agent="workbench_conversation",
                    message="The conversation agent is not configured yet. Please set SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT.",
                    artifact=ConversationArtifact(
                        conversation_id=conversation_id,
                        route_reason=route_plan.reason,
                        route_confidence=route_plan.confidence,
                        suggested_operation=route_plan.suggested_operation,
                    ),
                    citations=citations,
                )
                yield emit("final", response.model_dump(mode="json"))
                return

            user_text = self._build_agent_payload(
                req,
                route_plan.intent_class.value,
                citations,
                execution_mode="response_generation",
                route_plan=route_plan,
                allow_search=not citations,
            )
            self._model_guard.assert_model_target_allowed(
                operation=req.operation.value,
                target="agent",
                decision=decision,
            )
            raw_payload: dict[str, Any] | None = None
            text_parts: list[str] = []
            try:
                for event_name, payload_item in self._agent.stream_events(
                    [{"role": "user", "content": [{"type": "text", "text": user_text}]}],
                    agent=self._agent_name,
                    thread_id=req.context.thread_id,
                    parent_message_id=req.context.parent_message_id,
                ):
                    delta = _extract_stream_text_delta(event_name, payload_item)
                    if delta:
                        text_parts.append(delta)
                        yield emit("delta", {"text": delta})
                    suggestions = _extract_stream_suggestions(payload_item)
                    if suggestions:
                        yield emit("suggestions", {"items": suggestions})
                    status_message = _extract_stream_status(event_name, payload_item)
                    if status_message and self._should_emit_stream_status(status_message):
                        yield emit("status", {"phase": "agent_progress", "message": status_message})
                    response_payload = _extract_stream_response_payload(event_name, payload_item)
                    if response_payload is not None:
                        raw_payload = response_payload
            except Exception as exc:
                logger.exception("Streaming conversation agent request failed")
                yield emit(
                    "error",
                    {"message": str(exc), "code": "SNOWFLAKE_AGENT_STREAM_ERROR"},
                )
                return

            raw_text = _extract_stream_message_text(raw_payload) or "".join(text_parts).strip()
            response_data = self._parse_agent_response(
                req=req,
                raw_text=raw_text,
                raw_payload=raw_payload,
                route=ConversationRoute.CONVERSATION.value,
                intent_class=route_plan.intent_class.value,
                default_citations=citations,
            )
            response_data.artifact = response_data.artifact.model_copy(
                update={
                    "route_reason": route_plan.reason,
                    "route_confidence": route_plan.confidence,
                    "suggested_operation": route_plan.suggested_operation,
                }
            )
            response = self._finalize_conversation_response(
                req,
                decision,
                route=ConversationRoute.CONVERSATION,
                status=response_data.status,
                intent_class=response_data.intent_class,
                agent=response_data.agent,
                message=response_data.message,
                artifact=response_data.artifact,
                citations=response_data.citations,
            )
            yield emit("final", response.model_dump(mode="json"))

        return iterator()

    def search(self, data: ConversationSearchRequestData) -> ConversationSearchResponseData:
        hits = self._memory.search(
            query=data.query,
            limit=data.limit,
            folders=data.folders,
            semantic_bundle_id=data.semantic_bundle_id,
            semantic_view_name=data.semantic_view_name,
        )
        return ConversationSearchResponseData(
            hits=hits,
            search_service=self._settings.snowflake_rag_search_service,
            source_table=self._settings.snowflake_rag_documents_table,
        )

    def sync_index(self, data: ConversationIndexSyncRequestData) -> ConversationIndexSyncResponseData:
        counts = self._memory.sync_all(
            rebuild_search_service=data.rebuild_search_service,
            include_conversation_docs=data.include_conversation_docs,
            include_feedback_docs=data.include_feedback_docs,
            include_inference_docs=data.include_inference_docs,
            include_recommendation_docs=data.include_recommendation_docs,
            include_semantic_docs=data.include_semantic_docs,
            include_relationship_docs=data.include_relationship_docs,
        )
        counts.setdefault("inference_count", 0)
        return ConversationIndexSyncResponseData(**counts)

    def get_assistant_settings(self, *, user_id: str | None) -> ConversationSettingsResponseData:
        settings = self._memory.get_assistant_settings(user_id=user_id)
        return ConversationSettingsResponseData(settings=settings)

    def update_assistant_settings(
        self,
        *,
        user_id: str | None,
        settings: AssistantPreferenceState,
    ) -> ConversationSettingsResponseData:
        saved = self._memory.save_assistant_settings(user_id=user_id, settings=settings)
        return ConversationSettingsResponseData(settings=saved)

    def list_signals(self, *, user_id: str | None) -> ConversationSignalsResponseData:
        settings = self._memory.get_assistant_settings(user_id=user_id)
        signals = self._memory.list_signals(user_id=user_id)
        inferences = self._memory.list_inferences(user_id=user_id)
        unread_count = sum(1 for item in signals if item.status == AssistantSignalStatus.NEW)
        return ConversationSignalsResponseData(
            settings=settings,
            signals=signals,
            inferences=inferences,
            unread_count=unread_count,
        )

    def evaluate_signals(
        self,
        *,
        request_id: str | None,
        conversation_id: str | None,
        user_id: str | None,
        data: ConversationSignalEvaluationData,
    ) -> ConversationSignalsResponseData:
        settings = self._memory.get_assistant_settings(user_id=user_id)
        self._evaluate_signal_candidates(
            request_id=request_id,
            conversation_id=conversation_id,
            user_id=user_id,
            settings=settings,
            data=data,
        )
        return self.list_signals(user_id=user_id)

    def respond_to_signal(
        self,
        *,
        request_id: str | None,
        conversation_id: str | None,
        user_id: str | None,
        payload: AssistantSignalResponseInput,
    ) -> AssistantSignalResponseData:
        signals = self._memory.list_signals(user_id=user_id, include_resolved=True, limit=50)
        target = next((item for item in signals if item.signal_id == payload.signal_id), None)
        if target is None:
            raise SnowflakeQueryError(f"Signal '{payload.signal_id}' was not found.")

        next_status = AssistantSignalStatus(payload.status)
        feedback_recorded = False
        if next_status == AssistantSignalStatus.RESPONDED:
            self._memory.record_feedback(
                request_id=request_id,
                conversation_id=conversation_id or "",
                feedback=self._build_signal_feedback(target, payload),
                user_id=user_id,
            )
            if target.signal_type == AssistantSignalType.RECOMMENDATION and target.recommendation_id:
                self._memory.update_recommendation_review(
                    recommendation_id=target.recommendation_id,
                    rating=payload.rating,
                    comment=payload.comment,
                    status="reviewed",
                )
            feedback_recorded = True
        self._memory.update_signal_status(signal_id=payload.signal_id, status=next_status)
        return AssistantSignalResponseData(
            signal_id=payload.signal_id,
            status=next_status,
            feedback_recorded=feedback_recorded,
        )

    def _build_handoff_request(
        self,
        req: ConversationRequestEnvelope,
        route_plan: AgentRoutePlan,
    ) -> STTMBuilderEnvelopeRequest:
        if req.data.handoff_request is not None:
            self._business_rules.validate_handoff_payload(req.data.model_dump(mode="json", exclude_none=True))
            return req.data.handoff_request

        return STTMBuilderEnvelopeRequest.model_validate(
            {
                "contract_version": "1.0",
                "request_id": req.request_id,
                # Free-text conversation handoffs must remain chat-shaped. The STTM builder
                # can then decide how to branch internally with the existing context.
                "operation": STTMOperation.CHAT.value,
                "context": {
                    "thread_id": None,
                    "parent_message_id": None,
                    "trace_id": req.context.trace_id,
                    "surface": req.context.surface or "SOURCE_SELECTION",
                    "semantic_level_requested": req.context.semantic_level_requested or "L1_CONTEXT",
                    "source_tables": [
                        item.model_dump(mode="json") if hasattr(item, "model_dump") else item
                        for item in (req.context.source_tables or [])
                    ],
                    "driving_table": req.context.driving_table.model_dump(mode="json")
                    if req.context.driving_table is not None
                    else None,
                    "target_table": req.context.target_table.model_dump(mode="json")
                    if req.context.target_table is not None
                    else None,
                    "selected_derived_sources": req.context.selected_derived_sources,
                    "semantic_bundle_id": req.context.semantic_bundle_id,
                    "semantic_bundle_label": req.context.semantic_bundle_label,
                    "semantic_view_name": req.context.semantic_view_name,
                    "derived_source_lineage": req.context.derived_source_lineage,
                    "semantic_context": req.context.semantic_context,
                    "relationships": req.context.relationships,
                    "selected_columns_by_table": req.context.selected_columns_by_table,
                    "datahub_context": req.context.datahub_context,
                },
                "data": {
                    "intent": Interface.CHAT.value,
                    "message": req.data.message,
                    "attributes": None,
                },
                "meta": {
                    "guardrails": {
                        "conversation_handoff": True,
                        "intent_class": route_plan.intent_class.value,
                        "suggested_operation": route_plan.suggested_operation or STTMOperation.CHAT.value,
                    }
                },
            }
        )

    def _plan_route(
        self,
        req: ConversationRequestEnvelope,
        decision: GovernanceDecision,
    ) -> AgentRoutePlan:
        started = time.perf_counter()
        payload = req.model_dump(mode="json", exclude_none=True)
        fallback = self._router.decide(
            operation=req.operation.value,
            payload=payload,
            surface=req.context.surface,
        )
        fallback_route = (
            ConversationRoute.STTM_BUILDER
            if fallback.route == "sttm_builder"
            else ConversationRoute.CONVERSATION
        )
        fallback_intent = ConversationIntentClass(fallback.intent_class)

        if req.operation not in {ConversationOperation.ASK, ConversationOperation.RECOMMEND}:
            return AgentRoutePlan(
                route=fallback_route,
                intent_class=fallback_intent,
                reason=fallback.reason,
                confidence=None,
                status=ConversationStatus.COMPLETED,
            )

        if not self._agent_name:
            return AgentRoutePlan(
                route=fallback_route,
                intent_class=fallback_intent,
                reason=f"fallback:{fallback.reason}",
                confidence=None,
                status=ConversationStatus.COMPLETED,
            )

        planner_payload = self._build_agent_payload(
            req,
            fallback.intent_class,
            [],
            execution_mode="route_planning",
            route_plan=None,
            allow_search=False,
        )
        self._model_guard.assert_model_target_allowed(
            operation=req.operation.value,
            target="agent",
            decision=decision,
        )
        try:
            raw_text, _, raw_payload = self._agent.run_detailed(
                [{"role": "user", "content": [{"type": "text", "text": planner_payload}]}],
                agent=self._agent_name,
            )
        except SnowflakeAgentError:
            logger.warning("Conversation route planning failed; falling back to deterministic router.", exc_info=True)
            return AgentRoutePlan(
                route=fallback_route,
                intent_class=fallback_intent,
                reason=f"fallback:{fallback.reason}",
                confidence=None,
                status=ConversationStatus.COMPLETED,
            )

        try:
            planned = self._parse_route_plan(
                req=req,
                raw_text=raw_text,
                raw_payload=raw_payload,
                fallback=fallback,
            )
        except Exception:
            logger.warning("Conversation route planning response was invalid; falling back to deterministic router.", exc_info=True)
            planned = AgentRoutePlan(
                route=fallback_route,
                intent_class=fallback_intent,
                reason=f"fallback:{fallback.reason}",
                confidence=None,
                status=ConversationStatus.COMPLETED,
            )

        planned = self._enforce_route_policy(
            req=req,
            planned=planned,
            fallback_route=fallback_route,
            fallback_intent=fallback_intent,
        )

        if planned.route == ConversationRoute.STTM_BUILDER:
            self._agent_registry.assert_delegate_allowed(
                agent_id="workbench_conversation",
                downstream_agent="sttm_builder",
            )
        logger.info(
            "conversation.route_planning request_id=%s route=%s intent=%s elapsed_ms=%.1f",
            req.request_id,
            planned.route.value,
            planned.intent_class.value,
            (time.perf_counter() - started) * 1000,
        )
        return planned

    def _build_fast_response(
        self,
        req: ConversationRequestEnvelope,
        decision: GovernanceDecision,
        *,
        conversation_id: str,
    ) -> ApiResponseEnvelope[ConversationResponseData] | None:
        if req.operation == ConversationOperation.FEEDBACK:
            return None

        relationship_response = self._build_selected_relationship_response(
            req,
            decision,
            conversation_id=conversation_id,
        )
        if relationship_response is not None:
            return relationship_response

        return None

    def _build_selected_relationship_response(
        self,
        req: ConversationRequestEnvelope,
        decision: GovernanceDecision,
        *,
        conversation_id: str,
    ) -> ApiResponseEnvelope[ConversationResponseData] | None:
        message = (req.data.message or "").strip().lower()
        if not self._is_relationship_question(message):
            return None

        selected_tables = self._selected_table_names(req)
        if len(selected_tables) < 2:
            return None

        relationship_hits = self._memory.find_relationships_for_tables(
            table_names=selected_tables,
            semantic_bundle_id=req.context.semantic_bundle_id,
            limit=2,
        )
        if not relationship_hits:
            return None

        primary = relationship_hits[0]
        relationship_text = primary.snippet or ""
        join_type = self._extract_relationship_line(relationship_text, "Join type") or "INNER"
        conditions = self._extract_relationship_line(relationship_text, "Conditions") or "[]"
        left_table = self._extract_relationship_line(relationship_text, "Left table") or selected_tables[0]
        right_table = self._extract_relationship_line(relationship_text, "Right table") or selected_tables[1]
        citations = [
            EvidenceCitation(
                source_id=item.doc_id,
                source_type=item.doc_folder,
                snippet=item.snippet,
                score=item.score,
            )
            for item in relationship_hits
        ]
        response_message = self._build_relationship_response_message(
            req.data.message or "",
            left_table=left_table,
            right_table=right_table,
            join_type=join_type,
            conditions=conditions,
        )
        return self._finalize_conversation_response(
            req,
            decision,
            route=ConversationRoute.CONVERSATION,
            status=ConversationStatus.COMPLETED,
            intent_class=ConversationIntentClass.RAG_LOOKUP,
            agent="workbench_conversation",
            message=response_message,
            artifact=ConversationArtifact(
                conversation_id=conversation_id,
                source_ids=[item.doc_id for item in relationship_hits],
                quick_replies=[
                    "Explain what this relationship means",
                    "Recommend if this relationship is safe for mapping",
                    "Look for alternative join paths",
                ],
                route_reason="fast_path:selected_relationship",
                route_confidence=0.99,
            ),
            citations=citations,
        )

    def _enforce_route_policy(
        self,
        *,
        req: ConversationRequestEnvelope,
        planned: AgentRoutePlan,
        fallback_route: ConversationRoute,
        fallback_intent: ConversationIntentClass,
    ) -> AgentRoutePlan:
        if planned.route != ConversationRoute.STTM_BUILDER:
            return planned

        if req.operation == ConversationOperation.HANDOFF_STTM or req.data.handoff_request is not None:
            return planned

        surface = (req.context.surface or "").strip().upper()
        if surface in {"MAPPING", "DERIVED_SOURCE"}:
            return planned

        if planned.suggested_operation in {STTMOperation.AUTO_MAP.value, STTMOperation.TRANSFORM.value}:
            return planned

        if planned.suggested_operation not in {None, "", STTMOperation.CHAT.value}:
            return planned

        conversation_intent = fallback_intent
        if conversation_intent == ConversationIntentClass.STTM_HANDOFF:
            conversation_intent = (
                ConversationIntentClass.RECOMMENDATION
                if req.operation == ConversationOperation.RECOMMEND
                else ConversationIntentClass.RAG_LOOKUP
            )

        return AgentRoutePlan(
            route=ConversationRoute.CONVERSATION,
            intent_class=conversation_intent,
            reason=f"policy_override:conversation_first:{planned.reason}",
            confidence=planned.confidence,
            status=planned.status,
            message=planned.message,
            suggested_operation=planned.suggested_operation,
            citations=planned.citations,
            quick_replies=planned.quick_replies,
        )

    def _build_agent_payload(
        self,
        req: ConversationRequestEnvelope,
        intent_class: str,
        citations: list[EvidenceCitation],
        *,
        execution_mode: str,
        route_plan: AgentRoutePlan | None,
        allow_search: bool,
    ) -> str:
        selected_table_names = self._selected_table_names(req)
        context_payload: dict[str, Any] = {
            "trace_id": req.context.trace_id,
            "surface": req.context.surface,
            "semantic_level_requested": req.context.semantic_level_requested,
            "source_tables": [
                item.model_dump(mode="json") if hasattr(item, "model_dump") else item
                for item in (req.context.source_tables or [])
            ],
            "selected_table_names": selected_table_names,
            "driving_table": req.context.driving_table.model_dump(mode="json")
            if req.context.driving_table is not None
            else None,
            "target_table": req.context.target_table.model_dump(mode="json")
            if req.context.target_table is not None
            else None,
            "semantic_bundle_id": req.context.semantic_bundle_id,
            "semantic_view_name": req.context.semantic_view_name,
        }
        if execution_mode != "route_planning":
            context_payload.update(
                {
                    "semantic_bundle_label": req.context.semantic_bundle_label,
                    "selected_columns_by_table": req.context.selected_columns_by_table,
                    "relationship_count": len(req.context.relationships or []),
                }
            )

        payload = {
            "contract_version": req.contract_version,
            "request_id": req.request_id,
            "operation": req.operation.value,
            "context": context_payload,
            "data": {
                "execution_mode": execution_mode,
                "intent_class": intent_class,
                "message": req.data.message,
                "requested_sources": req.data.requested_sources,
                "evidence": [item.model_dump(mode="json") for item in citations],
                "capability_summary": self._build_capability_summary(selected_table_names),
            },
            "meta": {
                "guardrails": {
                    "allowed_routes": [
                        ConversationRoute.CONVERSATION.value,
                        ConversationRoute.STTM_BUILDER.value,
                    ],
                    "semantic_surface": req.context.surface,
                    "route_plan": {
                        "route": route_plan.route.value,
                        "intent_class": route_plan.intent_class.value,
                        "reason": route_plan.reason,
                        "confidence": route_plan.confidence,
                        "suggested_operation": route_plan.suggested_operation,
                    }
                    if route_plan
                    else None,
                    "search_allowed": allow_search,
                    "selected_tables_only": bool(req.context.source_tables),
                }
            },
        }
        return json.dumps(payload, separators=(",", ":"))

    @staticmethod
    def _build_capability_summary(selected_table_names: list[str]) -> str:
        summary = (
            "You can answer workbench help questions, explain selected tables and relationships, "
            "give recommendations, capture feedback, and hand off execution-oriented STTM work "
            "such as mapping, transform, and semantic build requests to AGT_STTM_BUILDER."
        )
        if selected_table_names:
            summary += f" Current selected tables: {', '.join(selected_table_names[:3])}."
        return summary

    def _parse_route_plan(
        self,
        *,
        req: ConversationRequestEnvelope,
        raw_text: str,
        raw_payload: dict[str, Any] | None,
        fallback: Any,
    ) -> AgentRoutePlan:
        parsed = self._load_agent_payload(raw_text=raw_text, raw_payload=raw_payload)
        data = parsed.get("data") if isinstance(parsed.get("data"), dict) else parsed
        route_value = str(data.get("route") or "").strip().lower()
        if route_value not in {ConversationRoute.CONVERSATION.value, ConversationRoute.STTM_BUILDER.value}:
            route_value = ConversationRoute.STTM_BUILDER.value if fallback.route == "sttm_builder" else ConversationRoute.CONVERSATION.value

        intent_value = str(data.get("intent_class") or fallback.intent_class).strip().lower()
        try:
            intent_class = ConversationIntentClass(intent_value)
        except ValueError:
            intent_class = ConversationIntentClass(fallback.intent_class)

        status_value = str(data.get("status") or "completed").strip().lower()
        try:
            status = ConversationStatus(status_value)
        except ValueError:
            status = ConversationStatus.COMPLETED

        confidence_raw = data.get("route_confidence")
        confidence = None
        if isinstance(confidence_raw, (int, float, str)) and str(confidence_raw).strip():
            try:
                confidence = float(confidence_raw)
            except ValueError:
                confidence = None
        reason = str(data.get("route_reason") or data.get("reason") or fallback.reason).strip()
        message = str(data.get("message") or "").strip() or None
        suggested_operation = str(data.get("suggested_operation") or "").strip() or None
        citations = [
            EvidenceCitation(
                source_id=str(item.get("source_id") or item.get("id") or "unknown"),
                source_type=str(item.get("source_type") or item.get("type") or "semantic_context"),
                snippet=str(item.get("snippet") or "") or None,
            )
            for item in (data.get("citations") or data.get("evidence") or [])
            if isinstance(item, dict)
        ]
        quick_replies = [str(item).strip() for item in (data.get("quick_replies") or []) if str(item).strip()]

        if req.context.surface and req.context.surface.strip().upper() in {"MAPPING", "DERIVED_SOURCE"}:
            route_value = ConversationRoute.STTM_BUILDER.value
            reason = reason or "surface"

        return AgentRoutePlan(
            route=ConversationRoute(route_value),
            intent_class=intent_class,
            reason=reason or fallback.reason,
            confidence=confidence,
            status=status,
            message=message,
            suggested_operation=suggested_operation,
            citations=citations,
            quick_replies=quick_replies,
        )

    @staticmethod
    def _load_agent_payload(
        *,
        raw_text: str,
        raw_payload: dict[str, Any] | None,
    ) -> dict[str, Any]:
        parsed: dict[str, Any] | None = None
        try:
            loaded = json.loads(raw_text)
        except json.JSONDecodeError:
            loaded = None
        if loaded is None and isinstance(raw_text, str):
            stripped = raw_text.strip()
            candidates: list[str] = []
            if "```" in stripped:
                segments = stripped.split("```")
                for segment in segments:
                    candidate = segment.strip()
                    if not candidate:
                        continue
                    if candidate.startswith("json"):
                        candidate = candidate[4:].strip()
                    candidates.append(candidate)
            candidates.append(stripped)
            for candidate in candidates:
                start = candidate.find("{")
                end = candidate.rfind("}")
                if start == -1 or end <= start:
                    continue
                try:
                    loaded = json.loads(candidate[start : end + 1])
                    break
                except json.JSONDecodeError:
                    continue
        if isinstance(loaded, dict):
            parsed = loaded
        if parsed is None and isinstance(raw_payload, dict):
            parsed = raw_payload
        return parsed or {}

    def _parse_agent_response(
        self,
        *,
        req: ConversationRequestEnvelope,
        raw_text: str,
        raw_payload: dict[str, Any] | None,
        route: str,
        intent_class: str,
        default_citations: list[EvidenceCitation],
    ) -> ConversationResponseData:
        parsed = self._load_agent_payload(raw_text=raw_text, raw_payload=raw_payload)

        data = parsed.get("data") or parsed
        citations = [
            EvidenceCitation(
                source_id=str(item.get("source_id") or item.get("id") or "unknown"),
                source_type=str(item.get("source_type") or item.get("type") or "semantic_context"),
                snippet=str(item.get("snippet") or "") or None,
            )
            for item in (data.get("citations") or data.get("evidence") or [])
            if isinstance(item, dict)
        ]
        if not citations:
            citations = default_citations
        artifact = ConversationArtifact(
            conversation_id=req.context.thread_id or req.request_id,
            source_ids=[item.source_id for item in citations],
            quick_replies=[str(item) for item in (data.get("quick_replies") or []) if str(item).strip()],
        )
        message = str(data.get("message") or raw_text).strip()
        status_value = str(data.get("status") or "completed").strip().lower()
        try:
            status = ConversationStatus(status_value)
        except ValueError:
            status = ConversationStatus.COMPLETED
        return ConversationResponseData(
            status=status,
            route=ConversationRoute.CONVERSATION if route == "conversation" else ConversationRoute.STTM_BUILDER,
            intent_class=ConversationIntentClass(intent_class),
            agent=str(data.get("agent") or "workbench_conversation"),
            message=message,
            artifact=artifact,
            citations=citations,
        )

    def _finalize_conversation_response(
        self,
        req: ConversationRequestEnvelope,
        decision: GovernanceDecision,
        *,
        route: ConversationRoute,
        status: ConversationStatus,
        intent_class: ConversationIntentClass,
        agent: str | None,
        message: str | None,
        artifact: ConversationArtifact,
        citations: list[EvidenceCitation],
    ) -> ApiResponseEnvelope[ConversationResponseData]:
        conversation_id = req.context.thread_id or f"conv_{req.request_id or uuid.uuid4().hex[:12]}"
        user_id = req.actor.user_id if req.actor else None
        guardrails_meta = {
            "route": route.value if hasattr(route, "value") else str(route),
            "approval_required": decision.approval_required,
            "approval": decision.approval.model_dump(mode="json"),
            "trust_labels": decision.trust.labels(),
        }
        user_turn_id = self._memory.record_turn(
            conversation_id=conversation_id,
            request_id=req.request_id,
            trace_id=decision.trace_id,
            role="user",
            route=route.value if hasattr(route, "value") else str(route),
            intent_class=intent_class.value,
            message=req.data.message,
            citations=[],
            guardrails_meta=guardrails_meta,
            user_id=user_id,
        )
        if decision.approval_required and status == ConversationStatus.COMPLETED:
            status = ConversationStatus.APPROVAL_REQUIRED
        assistant_turn_id = self._memory.record_turn(
            conversation_id=conversation_id,
            request_id=req.request_id,
            trace_id=decision.trace_id,
            role="assistant",
            route=(ConversationRoute.APPROVAL_REQUIRED if decision.approval_required else route).value,
            intent_class=intent_class.value,
            message=message,
            citations=citations,
            guardrails_meta=guardrails_meta,
            user_id=user_id,
        )
        if intent_class == ConversationIntentClass.RECOMMENDATION:
            recommendation_id = self._memory.record_recommendation(
                request_id=req.request_id,
                conversation_id=conversation_id,
                signal_id=artifact.signal_id,
                recommendation_type="conversation",
                message=message,
                citations=citations,
                entity_type="table_selection" if req.context.source_tables else None,
                entity_ids=self._selected_table_names(req),
                confidence=artifact.route_confidence,
                attributes={"route_reason": artifact.route_reason} if artifact.route_reason else {},
                approval_required=decision.approval_required,
                status=status.value,
                user_id=user_id,
            )
            self._memory.sync_rag_documents(
                include_conversation_docs=False,
                include_feedback_docs=False,
                include_inference_docs=False,
                include_recommendation_docs=True,
                include_semantic_docs=False,
                include_relationship_docs=False,
            )
        else:
            recommendation_id = None
            self._memory.sync_rag_documents(
                include_conversation_docs=True,
                include_feedback_docs=False,
                include_inference_docs=False,
                include_recommendation_docs=False,
                include_semantic_docs=False,
                include_relationship_docs=False,
            )
        if status == ConversationStatus.NEEDS_INPUT and message:
            signal_id = self._emit_agent_feedback_signal(
                request_id=req.request_id,
                conversation_id=conversation_id,
                user_id=user_id,
                message=message,
                quick_replies=artifact.quick_replies,
                selected_tables=self._selected_table_names(req),
            )
            artifact = artifact.model_copy(update={"feedback_requested": True, "signal_id": signal_id})
        elif recommendation_id and not artifact.signal_id:
            artifact = artifact.model_copy(update={"signal_id": recommendation_id})
        response_context = req.context.model_dump(mode="json", exclude_none=True)
        if not response_context.get("thread_id"):
            response_context["thread_id"] = conversation_id

        envelope = build_response_envelope(
            operation=req.operation.value,
            request_id=req.request_id,
            context=response_context,
            data=ConversationResponseData(
                status=status,
                route=ConversationRoute.APPROVAL_REQUIRED if decision.approval_required else route,
                intent_class=intent_class,
                agent=agent,
                message=message,
                approval_required=decision.approval_required,
                artifact=artifact.model_copy(
                    update={
                        "conversation_id": conversation_id,
                        "turn_ids": [user_turn_id, assistant_turn_id],
                    }
                ),
                citations=citations,
            ),
        )
        return self._postflight_guard.finalize_conversation_envelope(envelope, decision)

    def _resolve_citations(self, req: ConversationRequestEnvelope) -> list[EvidenceCitation]:
        started = time.perf_counter()
        hits: list[EvidenceCitation] = []
        message = req.data.message or ""
        requested_sources = [item.strip() for item in (req.data.requested_sources or []) if item and item.strip()]

        if req.data.intent_class == ConversationIntentClass.FEEDBACK_CAPTURE:
            return []

        def append_hits(folder_list: list[str] | None, limit: int) -> None:
            nonlocal hits
            if len(hits) >= 3:
                return
            search_hits = self._memory.search(
                query=message,
                limit=limit,
                folders=folder_list,
                semantic_bundle_id=req.context.semantic_bundle_id,
                semantic_view_name=req.context.semantic_view_name,
            )
            seen_ids = {item.source_id for item in hits}
            for item in search_hits:
                if item.doc_id in seen_ids:
                    continue
                hits.append(
                    EvidenceCitation(
                        source_id=item.doc_id,
                        source_type=item.doc_folder,
                        snippet=item.snippet,
                        score=item.score,
                    )
                )
                seen_ids.add(item.doc_id)
                if len(hits) >= 3:
                    break

        try:
            if requested_sources:
                append_hits([requested_sources[0]], limit=2)
                append_hits(requested_sources[1:], limit=3)
            else:
                append_hits(None, limit=3)
        except SnowflakeQueryError:
            logger.warning("Cortex Search retrieval unavailable; falling back to semantic context only.", exc_info=True)

        if hits:
            logger.info(
                "conversation.citations request_id=%s source=search hit_count=%s elapsed_ms=%.1f",
                req.request_id,
                len(hits),
                (time.perf_counter() - started) * 1000,
            )
            return hits

        fallback_hits = [
            EvidenceCitation(
                source_id=chunk.source_id,
                source_type=chunk.source_type,
                snippet=chunk.text[:400],
            )
            for chunk in self._rag_source.retrieve(req.context.model_dump(mode="json", exclude_none=True))
        ]
        logger.info(
            "conversation.citations request_id=%s source=fallback hit_count=%s elapsed_ms=%.1f",
            req.request_id,
            len(fallback_hits),
            (time.perf_counter() - started) * 1000,
        )
        return fallback_hits

    @staticmethod
    def _selected_table_names(req: ConversationRequestEnvelope) -> list[str]:
        return [
            f"{item.database}.{item.schema}.{item.table}".upper()
            for item in (req.context.source_tables or [])
        ]

    def _emit_agent_feedback_signal(
        self,
        *,
        request_id: str | None,
        conversation_id: str,
        user_id: str | None,
        message: str,
        quick_replies: list[str],
        selected_tables: list[str],
    ) -> str:
        inference_key = f"agent-uncertainty|{conversation_id}|{request_id or ''}|{message.strip().lower()}"
        inference_id = self._memory.record_inference(
            inference_key=inference_key,
            request_id=request_id,
            conversation_id=conversation_id,
            source="conversation_agent",
            inference_type="agent_uncertainty",
            summary=message,
            confidence=0.52,
            entity_type="table_selection" if selected_tables else None,
            entity_ids=selected_tables,
            attributes={"quick_replies": quick_replies},
            status="open",
            user_id=user_id,
        )
        return self._memory.upsert_signal(
            signal_key=f"signal|{inference_key}",
            request_id=request_id,
            conversation_id=conversation_id,
            inference_id=inference_id,
            signal_type=AssistantSignalType.FEEDBACK,
            layer="feedback",
            source="conversation_agent",
            title="AI assistant needs business input",
            message=message,
            options=quick_replies,
            allow_free_text=True,
            requires_response=True,
            entity_type="table_selection" if selected_tables else None,
            entity_ids=selected_tables,
            confidence=0.52,
            attributes={"origin": "conversation_agent"},
            recommendation_id=None,
            user_id=user_id,
        )

    def _build_signal_feedback(
        self,
        signal: AssistantSignal,
        payload: AssistantSignalResponseInput,
    ) -> FeedbackInput:
        entity_id = signal.entity_ids[0] if signal.entity_ids else None
        return FeedbackInput(
            category="recommendation" if signal.signal_type == AssistantSignalType.RECOMMENDATION else "general",
            rating=payload.rating,
            comment=payload.comment,
            target_request_id=None,
            signal_id=signal.signal_id,
            feedback_type=payload.feedback_type,
            option_selected=payload.option_selected,
            entity_type=signal.entity_type,
            entity_id=entity_id,
            selection_context={"entity_ids": signal.entity_ids, "source": signal.source},
        )

    def _evaluate_signal_candidates(
        self,
        *,
        request_id: str | None,
        conversation_id: str | None,
        user_id: str | None,
        settings: AssistantPreferenceState,
        data: ConversationSignalEvaluationData,
    ) -> None:
        selected_tables = [
            f"{item.database}.{item.schema}.{item.table}".upper()
            for item in (data.source_tables or [])
        ]
        selected_pair = selected_tables[:2]
        relationship_count = len(data.relationships or [])
        semantic_ready = bool(data.semantic_bundle_id and data.semantic_view_name)
        relationship_hits = (
            self._memory.find_relationships_for_tables(
                table_names=selected_pair,
                semantic_bundle_id=data.semantic_bundle_id,
                limit=1,
            )
            if len(selected_pair) >= 2
            else []
        )

        if settings.recommendations_enabled and len(selected_pair) >= 2 and relationship_hits:
            hit = relationship_hits[0]
            snippet = (hit.snippet or "").strip()
            inference_key = f"relationship|{hit.doc_id}|{data.activity_type}"
            inference_id = self._memory.record_inference(
                inference_key=inference_key,
                request_id=request_id,
                conversation_id=conversation_id,
                source="rule_engine",
                inference_type="selected_table_relationship",
                summary=snippet[:400] or f"Known relationship between {selected_pair[0]} and {selected_pair[1]}",
                confidence=hit.score if hit.score is not None else 0.86,
                entity_type="table_pair",
                entity_ids=selected_pair,
                attributes={
                    "semantic_bundle_id": data.semantic_bundle_id,
                    "semantic_view_name": data.semantic_view_name,
                    "doc_id": hit.doc_id,
                },
                status="open",
                user_id=user_id,
            )
            recommendation_message = (
                f"I found an existing relationship for `{selected_pair[0]}` and `{selected_pair[1]}`. "
                "Validate this join before mapping and confirm whether the business meaning looks right."
            )
            recommendation_id = self._memory.record_recommendation(
                request_id=request_id,
                conversation_id=conversation_id or "",
                signal_id=None,
                recommendation_type="relationship_validation",
                message=recommendation_message,
                citations=[
                    EvidenceCitation(
                        source_id=hit.doc_id,
                        source_type=hit.doc_folder,
                        snippet=hit.snippet,
                        score=hit.score,
                    )
                ],
                entity_type="table_pair",
                entity_ids=selected_pair,
                confidence=hit.score if hit.score is not None else 0.86,
                attributes={"doc_type": hit.doc_type},
                approval_required=False,
                status="completed",
                user_id=user_id,
            )
            self._memory.upsert_signal(
                signal_key=f"recommendation|{hit.doc_id}|{data.activity_type}",
                request_id=request_id,
                conversation_id=conversation_id,
                inference_id=inference_id,
                signal_type=AssistantSignalType.RECOMMENDATION,
                layer="recommendation",
                source="rule_engine",
                title="Recommended next validation step",
                message=recommendation_message,
                options=["Explain this relationship", "Looks right", "Needs correction", "I will type it manually"],
                allow_free_text=True,
                requires_response=False,
                entity_type="table_pair",
                entity_ids=selected_pair,
                confidence=hit.score if hit.score is not None else 0.86,
                attributes={"doc_id": hit.doc_id},
                recommendation_id=recommendation_id,
                user_id=user_id,
            )

        if settings.feedback_enabled and len(selected_pair) >= 2:
            suspicious_join = any(
                any(str(condition.get("operator") or "=").strip() != "=" for condition in join.get("conditions", []))
                for join in (data.relationships or [])
            )
            if suspicious_join or (relationship_count == 0 and not relationship_hits):
                summary = (
                    "The current table pairing either has no confirmed join yet or uses a non-equality condition. "
                    "Business confirmation will help mature the semantic view."
                )
                inference_key = f"feedback|{'|'.join(selected_pair)}|{relationship_count}|{int(suspicious_join)}"
                inference_id = self._memory.record_inference(
                    inference_key=inference_key,
                    request_id=request_id,
                    conversation_id=conversation_id,
                    source="rule_engine",
                    inference_type="business_relationship_confirmation",
                    summary=summary,
                    confidence=0.64 if suspicious_join else 0.58,
                    entity_type="table_pair",
                    entity_ids=selected_pair,
                    attributes={"activity_type": data.activity_type, "surface": data.surface},
                    status="open",
                    user_id=user_id,
                )
                self._memory.upsert_signal(
                    signal_key=f"feedback-signal|{inference_key}",
                    request_id=request_id,
                    conversation_id=conversation_id,
                    inference_id=inference_id,
                    signal_type=AssistantSignalType.FEEDBACK,
                    layer="feedback",
                    source="rule_engine",
                    title="Help improve these table semantics",
                    message=(
                        "Are these selected tables truly related for business mapping, or should the join logic be adjusted?"
                    ),
                    options=[
                        "These tables are related",
                        "The join should be equality-based",
                        "These tables are not directly related",
                        "I will type the correct relationship",
                    ],
                    allow_free_text=True,
                    requires_response=True,
                    entity_type="table_pair",
                    entity_ids=selected_pair,
                    confidence=0.64 if suspicious_join else 0.58,
                    attributes={"surface": data.surface or "SOURCE_SELECTION"},
                    recommendation_id=None,
                    user_id=user_id,
                )

        if settings.recommendations_enabled and selected_tables and not semantic_ready:
            inference_key = f"semantic-ready|{'|'.join(selected_tables[:3])}|{data.surface or ''}"
            inference_id = self._memory.record_inference(
                inference_key=inference_key,
                request_id=request_id,
                conversation_id=conversation_id,
                source="rule_engine",
                inference_type="semantic_refresh_recommended",
                summary="The current selection does not yet have an analyst-ready semantic bundle.",
                confidence=0.81,
                entity_type="table_selection",
                entity_ids=selected_tables[:3],
                attributes={"surface": data.surface or "SOURCE_SELECTION"},
                status="open",
                user_id=user_id,
            )
            self._memory.upsert_signal(
                signal_key=f"recommend-semantic|{inference_key}",
                request_id=request_id,
                conversation_id=conversation_id,
                inference_id=inference_id,
                signal_type=AssistantSignalType.RECOMMENDATION,
                layer="recommendation",
                source="rule_engine",
                title="Refresh semantic context",
                message="Generate an analyst-ready semantic bundle now so recommendations, joins, and mapping guidance stay grounded in the current selection.",
                options=["Refresh semantic context", "Ask AI to explain first", "Dismiss"],
                allow_free_text=False,
                requires_response=False,
                entity_type="table_selection",
                entity_ids=selected_tables[:3],
                confidence=0.81,
                attributes={"surface": data.surface or "SOURCE_SELECTION"},
                recommendation_id=None,
                user_id=user_id,
            )

    @staticmethod
    def _is_relationship_question(message: str) -> bool:
        lowered = (message or "").strip().lower()
        return any(token in lowered for token in ("relationship", "join", "how are", "connected", "related"))

    @staticmethod
    def _is_relationship_explanation_question(message: str) -> bool:
        lowered = " ".join((message or "").strip().lower().split())
        return any(
            phrase in lowered
            for phrase in (
                "what this relationship means",
                "what does this relationship mean",
                "explain this relationship",
                "explain the relationship",
                "meaning of this relationship",
            )
        )

    def _build_relationship_response_message(
        self,
        message: str,
        *,
        left_table: str,
        right_table: str,
        join_type: str,
        conditions: str,
    ) -> str:
        if self._is_relationship_explanation_question(message):
            return self._build_relationship_explanation(
                left_table=left_table,
                right_table=right_table,
                join_type=join_type,
                conditions=conditions,
            )

        return (
            "Here’s the relationship I found for the selected tables:\n\n"
            f"- Left table: `{left_table}`\n"
            f"- Right table: `{right_table}`\n"
            f"- Join type: `{join_type}`\n"
            f"- Conditions: `{conditions}`\n\n"
            "If you want, I can next explain what this relationship means in business terms, "
            "or recommend whether it looks safe enough for mapping."
        )

    @staticmethod
    def _build_relationship_explanation(
        *,
        left_table: str,
        right_table: str,
        join_type: str,
        conditions: str,
    ) -> str:
        try:
            parsed_conditions = json.loads(conditions) if conditions else []
        except json.JSONDecodeError:
            parsed_conditions = []

        if parsed_conditions and isinstance(parsed_conditions, list):
            first = parsed_conditions[0] if isinstance(parsed_conditions[0], dict) else {}
            left_column = str(first.get("left_column") or "left key")
            operator = str(first.get("operator") or "=")
            right_column = str(first.get("right_column") or "right key")
            join_sentence = (
                f"This links `{left_table}` to `{right_table}` by comparing "
                f"`{left_column}` on the left with `{right_column}` on the right using `{operator}`."
            )
        else:
            operator = ""
            join_sentence = (
                f"This links `{left_table}` to `{right_table}` using a `{join_type}` join."
            )

        if operator == "=":
            interpretation = (
                "In plain terms, the join is looking for matching values between the two tables, "
                "which is the normal pattern for a business key or foreign-key style relationship."
            )
            caution = (
                "If those columns truly represent the same business entity, this is usually a good starting point for mapping."
            )
        elif operator == "!=":
            interpretation = (
                "In plain terms, the join is looking for rows where those two values do not match. "
                "That is unusual for a standard relationship and usually does not represent a clean business key join."
            )
            caution = (
                "I would treat this as a weak or suspicious join candidate and verify whether the intended relationship should actually be equality-based."
            )
        else:
            interpretation = (
                f"In plain terms, the relationship depends on the `{operator}` comparison rather than a simple equality match."
            )
            caution = (
                "That can be valid, but it usually needs a closer business review before using it in mappings."
            )

        return (
            f"{join_sentence}\n\n"
            f"{interpretation}\n\n"
            f"{caution}\n\n"
            "If you want, I can next recommend whether this looks safe for mapping or search for alternative join paths."
        )

    @staticmethod
    def _extract_relationship_line(text: str, label: str) -> str | None:
        prefix = f"{label}:"
        for line in text.splitlines():
            if line.startswith(prefix):
                return line.split(":", 1)[1].strip() or None
        return None

    @staticmethod
    def _should_emit_stream_status(status_message: str) -> bool:
        lowered = status_message.strip().lower()
        if not lowered:
            return False
        suppressed_tokens = (
            "reviewing",
            "rethinking",
            "planning",
            "forming the answer",
            "completed",
            "success",
        )
        return not any(token in lowered for token in suppressed_tokens)
