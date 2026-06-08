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
from app.schema.common import TableRef
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
    MappingIntent,
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


@dataclass(slots=True)
class SignalCandidate:
    signal_key: str
    signal_type: AssistantSignalType
    layer: str
    source: str
    title: str
    message: str
    options: list[str]
    allow_free_text: bool
    requires_response: bool
    entity_type: str | None
    entity_ids: list[str]
    confidence: float | None
    attributes: dict[str, Any]
    inference_key: str
    inference_type: str
    inference_summary: str
    recommendation_type: str | None = None
    recommendation_message: str | None = None
    recommendation_attributes: dict[str, Any] | None = None
    recommendation_citations: list[EvidenceCitation] = field(default_factory=list)


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

    def _sanitize_conversation_request_semantic_context(
        self,
        req: ConversationRequestEnvelope,
    ) -> ConversationRequestEnvelope:
        resolved_bundle_id, resolved_view_name = self._sttm_builder.resolve_usable_semantic_context(
            semantic_bundle_id=req.context.semantic_bundle_id,
            semantic_view_name=req.context.semantic_view_name,
        )
        if (
            resolved_bundle_id == req.context.semantic_bundle_id
            and resolved_view_name == req.context.semantic_view_name
        ):
            return req
        return req.model_copy(
            update={
                "context": req.context.model_copy(
                    update={
                        "semantic_bundle_id": resolved_bundle_id,
                        "semantic_view_name": resolved_view_name,
                        "semantic_context": req.context.semantic_context
                        if resolved_bundle_id and resolved_view_name
                        else [],
                    }
                )
            }
        )

    def _sanitize_signal_semantic_context(
        self,
        data: ConversationSignalEvaluationData,
    ) -> ConversationSignalEvaluationData:
        resolved_bundle_id, resolved_view_name = self._sttm_builder.resolve_usable_semantic_context(
            semantic_bundle_id=data.semantic_bundle_id,
            semantic_view_name=data.semantic_view_name,
        )
        if (
            resolved_bundle_id == data.semantic_bundle_id
            and resolved_view_name == data.semantic_view_name
        ):
            return data
        return data.model_copy(
            update={
                "semantic_bundle_id": resolved_bundle_id,
                "semantic_view_name": resolved_view_name,
                "semantic_context": data.semantic_context if resolved_bundle_id and resolved_view_name else [],
            }
        )

    def invoke(
        self,
        req: ConversationRequestEnvelope,
        *,
        governance_decision: GovernanceDecision | None = None,
    ) -> Any:
        req = self._sanitize_conversation_request_semantic_context(req)
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
        req = self._sanitize_conversation_request_semantic_context(req)
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
        resolved_bundle_id, resolved_view_name = self._sttm_builder.resolve_usable_semantic_context(
            semantic_bundle_id=data.semantic_bundle_id,
            semantic_view_name=data.semantic_view_name,
        )
        hits = self._memory.search(
            query=data.query,
            limit=data.limit,
            folders=data.folders,
            semantic_bundle_id=resolved_bundle_id,
            semantic_view_name=resolved_view_name,
        )
        return ConversationSearchResponseData(
            hits=hits,
            search_service=self._settings.qualify_metadata_object_name(self._settings.snowflake_rag_search_service),
            source_table=self._settings.qualify_metadata_object_name(self._settings.snowflake_rag_documents_table),
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
            include_client_knowledge_docs=data.include_client_knowledge_docs,
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
            mapping_intent=None,
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
        resolved_mapping_intent = data.mapping_intent
        try:
            if not self._has_signal_context(data):
                return ConversationSignalsResponseData(
                    settings=settings,
                    signals=[],
                    inferences=[],
                    unread_count=0,
                    mapping_intent=data.mapping_intent,
                )
            context_key = self._build_signal_context_key(data)
            resolved_mapping_intent = data.mapping_intent or self._memory.get_mapping_intent(
                context_key=context_key,
                user_id=user_id,
            )
            if resolved_mapping_intent is not None:
                data = data.model_copy(update={"mapping_intent": resolved_mapping_intent})
            self._memory.record_fir_event(
                event_type=f"signal_evaluate.{data.activity_type}",
                user_id=user_id,
                session_id=data.session_id,
                request_id=request_id,
                page=data.page,
                surface=data.surface,
                entity_type="table_selection",
                entity_ids=self._signal_entity_ids(data),
                event_payload=data.model_dump(mode="json", exclude_none=True),
            )
            signal_result = self._evaluate_signal_candidates(
                request_id=request_id,
                conversation_id=conversation_id,
                user_id=user_id,
                settings=settings,
                data=data,
            )
            signals = self._memory.list_signals(user_id=user_id, limit=50)
            relevant_signals = self._filter_signals_for_context(signals, data)
            inference_id: str | None = None
            if signal_result is not None:
                signal_id, inference_id = signal_result
                prioritized = [item for item in relevant_signals if item.signal_id == signal_id]
                if prioritized:
                    relevant_signals = prioritized + [
                        item for item in relevant_signals if item.signal_id != signal_id
                    ]
            active_signals = relevant_signals[:1]
            active_inference_ids = {item.inference_id for item in active_signals if item.inference_id}
            if inference_id:
                active_inference_ids.add(inference_id)
            active_inferences = [
                item
                for item in self._memory.list_inferences(user_id=user_id, limit=50)
                if item.inference_id in active_inference_ids
            ]
            unread_count = sum(
                1 for item in active_signals if item.status == AssistantSignalStatus.NEW
            )
            logger.info(
                "conversation.evaluate_signals request_id=%s signal_count=%s inference_count=%s",
                request_id,
                len(active_signals),
                len(active_inferences),
            )
            return ConversationSignalsResponseData(
                settings=settings,
                signals=active_signals,
                inferences=active_inferences,
                unread_count=unread_count,
                mapping_intent=data.mapping_intent,
            )
        except Exception:  # pragma: no cover - fail-open runtime guard
            logger.exception(
                "conversation.evaluate_signals failed open request_id=%s session_id=%s",
                request_id,
                data.session_id,
            )
            return ConversationSignalsResponseData(
                settings=settings,
                signals=[],
                inferences=[],
                unread_count=0,
                mapping_intent=resolved_mapping_intent,
            )

    @staticmethod
    def _has_signal_context(data: ConversationSignalEvaluationData) -> bool:
        if data.source_tables:
            return True
        if data.selected_derived_sources:
            return True
        if data.target_table is not None:
            return True
        if data.relationships:
            return True
        mapping_summary = data.mapping_summary or {}
        try:
            selected_mapping_count = int(mapping_summary.get("selected_mapping_count") or 0)
            mapped_count = int(mapping_summary.get("mapped_count") or 0)
            unmapped_count = int(mapping_summary.get("unmapped_count") or 0)
        except (TypeError, ValueError):
            selected_mapping_count = mapped_count = unmapped_count = 0
        return any((selected_mapping_count, mapped_count, unmapped_count))

    @staticmethod
    def _filter_signals_for_context(
        signals: list[AssistantSignal],
        data: ConversationSignalEvaluationData,
    ) -> list[AssistantSignal]:
        expected_page = (data.page or "").strip().lower()
        expected_surface = (data.surface or "").strip().upper()
        selected_entity_ids = {
            f"{item.database}.{item.schema}.{item.table}".upper()
            for item in (data.source_tables or [])
        }
        if data.target_table is not None:
            selected_entity_ids.add(
                f"{data.target_table.database}.{data.target_table.schema}.{data.target_table.table}".upper()
            )
        selected_entity_ids.update(str(item).strip().upper() for item in (data.selected_derived_sources or []) if str(item).strip())
        filtered = list(signals)
        if selected_entity_ids:
            filtered = [
                item
                for item in filtered
                if not item.entity_ids
                or bool({entity.upper() for entity in item.entity_ids} & selected_entity_ids)
            ]
        if expected_surface:
            filtered = [
                item
                for item in filtered
                if not str(item.attributes.get("surface") or "").strip()
                or str(item.attributes.get("surface") or "").strip().upper() == expected_surface
            ]
        if expected_page:
            filtered = [
                item
                for item in filtered
                if not str(item.attributes.get("page") or "").strip()
                or str(item.attributes.get("page") or "").strip().lower() == expected_page
            ]
        return filtered

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
            self._apply_signal_learning(
                signal=target,
                payload=payload,
                user_id=user_id,
                session_id=None,
            )
        self._memory.record_fir_event(
            event_type=f"signal_response.{next_status.value}",
            user_id=user_id,
            session_id=None,
            request_id=request_id,
            page=str(target.attributes.get("page") or ""),
            surface=str(target.attributes.get("surface") or ""),
            entity_type=target.entity_type,
            entity_ids=target.entity_ids,
            event_payload={
                "signal_id": payload.signal_id,
                "option_selected": payload.option_selected,
                "rating": payload.rating,
                "comment": payload.comment,
                "feedback_type": payload.feedback_type,
            },
        )
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
        if self._should_bypass_relationship_fast_path(req.data.message or ""):
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
        context_key = (
            str(signal.attributes.get("context_key") or "").strip()
            if isinstance(signal.attributes, dict)
            else ""
        )
        entity_id = context_key or (signal.entity_ids[0] if signal.entity_ids else None)
        return FeedbackInput(
            category="recommendation" if signal.signal_type == AssistantSignalType.RECOMMENDATION else "general",
            rating=payload.rating,
            comment=payload.comment,
            target_request_id=None,
            signal_id=signal.signal_id,
            feedback_type=payload.feedback_type,
            option_selected=payload.option_selected,
            entity_type="fir_context" if context_key else signal.entity_type,
            entity_id=entity_id,
            selection_context={
                "entity_ids": signal.entity_ids,
                "source": signal.source,
                "context_key": context_key or None,
                "page": signal.attributes.get("page") if isinstance(signal.attributes, dict) else None,
                "surface": signal.attributes.get("surface") if isinstance(signal.attributes, dict) else None,
            },
        )

    def _build_signal_context_key(self, data: ConversationSignalEvaluationData) -> str:
        return self._memory.build_context_key(
            source_tables=data.source_tables or [],
            target_table=self._qualified_table_name(data.target_table),
            page=data.page,
            surface=data.surface,
            selected_derived_sources=data.selected_derived_sources or [],
        )

    @staticmethod
    def _signal_entity_ids(data: ConversationSignalEvaluationData) -> list[str]:
        entity_ids = [
            f"{item.database}.{item.schema}.{item.table}".upper()
            for item in (data.source_tables or [])
        ]
        if data.target_table is not None:
            entity_ids.append(
                f"{data.target_table.database}.{data.target_table.schema}.{data.target_table.table}".upper()
            )
        entity_ids.extend(
            str(item).strip().upper()
            for item in (data.selected_derived_sources or [])
            if str(item).strip()
        )
        seen: set[str] = set()
        deduped: list[str] = []
        for item in entity_ids:
            if item in seen:
                continue
            seen.add(item)
            deduped.append(item)
        return deduped[:8]

    def _build_fir_feature_snapshot(
        self,
        *,
        user_id: str | None,
        data: ConversationSignalEvaluationData,
        context_key: str,
        selected_tables: list[str],
        selected_pair: list[str],
        relationship_count: int,
        semantic_ready: bool,
        suspicious_join: bool,
    ) -> dict[str, Any]:
        page_key = (data.page or "builder").strip().lower() or "builder"
        surface_key = (data.surface or "SOURCE_SELECTION").strip().upper() or "SOURCE_SELECTION"
        mapping_summary = data.mapping_summary or {}
        mapped_count = int(mapping_summary.get("mapped_count") or 0)
        unmapped_count = int(mapping_summary.get("unmapped_count") or 0)
        target_label = (
            self._display_table_name(
                f"{data.target_table.database}.{data.target_table.schema}.{data.target_table.table}"
            )
            if data.target_table is not None
            else None
        )
        semantic_learnings = self._memory.list_semantic_learnings(
            entity_type="table_pair" if len(selected_pair) >= 2 else "table_selection",
            entity_ids=selected_pair if len(selected_pair) >= 2 else selected_tables[:4],
            limit=6,
        )
        feedback_summary = self._memory.get_feedback_summary_for_context(context_key=context_key, limit=100)
        recent_signal_summary = self._memory.get_recent_signal_summary(
            entity_type="table_pair" if len(selected_pair) >= 2 else "table_selection",
            entity_ids=selected_pair if len(selected_pair) >= 2 else selected_tables[:4],
            page=page_key,
            surface=surface_key,
            limit=20,
        )
        positive_feedback = int(feedback_summary.get("accepted_count") or 0)
        negative_feedback = int(feedback_summary.get("corrected_count") or 0)
        total_feedback = int(feedback_summary.get("feedback_count") or 0)
        total_signals = int(recent_signal_summary.get("signal_count") or 0)
        status_counts = recent_signal_summary.get("status_counts") if isinstance(recent_signal_summary.get("status_counts"), dict) else {}
        helpful_signals = int(status_counts.get("responded") or 0) + int(status_counts.get("acknowledged") or 0)
        relationship_story = self._build_business_relationship_story(
            data=data,
            selected_pair=selected_pair,
            target_label=target_label,
        )
        has_notes_source = any(
            any(token in item for token in ("NOTE", "AUDIT", "HISTORY"))
            for item in selected_tables
        )
        has_client_knowledge = bool(
            self._memory.search(
                query=" ".join(self._display_table_name(item) for item in selected_pair or selected_tables[:2]),
                limit=1,
                folders=["knowledge_notes", "historical_sql"],
                semantic_bundle_id=data.semantic_bundle_id,
                semantic_view_name=data.semantic_view_name,
            )
        )
        mapping_goal = (
            data.mapping_intent.business_goal.strip()
            if data.mapping_intent and data.mapping_intent.business_goal
            else ""
        )
        model_score = self._memory.get_latest_fir_model_score(context_key=context_key)
        feature_snapshot = {
            "context_key": context_key,
            "page": page_key,
            "surface": surface_key,
            "selected_table_count": len(selected_tables),
            "selected_pair": selected_pair,
            "target_label": target_label,
            "relationship_count": relationship_count,
            "join_exists": relationship_count > 0,
            "join_type": str((data.relationships or [{}])[0].get("join_type") or "").upper()
            if relationship_count > 0
            else None,
            "join_confidence": 0.82 if relationship_count > 0 and not suspicious_join else 0.56 if relationship_count > 0 else 0.32,
            "suspicious_join": suspicious_join,
            "semantic_ready": semantic_ready,
            "semantic_bundle_id": data.semantic_bundle_id,
            "semantic_view_name": data.semantic_view_name,
            "semantic_learning_count": len(semantic_learnings),
            "positive_feedback_count": positive_feedback,
            "negative_feedback_count": negative_feedback,
            "feedback_density": total_feedback,
            "recommendation_accept_rate": helpful_signals / total_signals if total_signals else None,
            "mapped_count": mapped_count,
            "unmapped_count": unmapped_count,
            "has_notes_source": has_notes_source,
            "has_client_knowledge": has_client_knowledge,
            "mapping_goal": mapping_goal or None,
            "mapping_intent_present": data.mapping_intent is not None,
            "relationship_story": relationship_story,
            "model_score": model_score,
            "ml_feedback_probability": float(model_score.get("feedback_needed_probability") or 0.0)
            if model_score
            else None,
            "ml_recommendation_probability": float(model_score.get("recommendation_helpfulness_probability") or 0.0)
            if model_score
            else None,
            "ml_recommendation_type": str(model_score.get("recommendation_type") or "").strip() or None
            if model_score
            else None,
            "ml_priority": float(model_score.get("recommendation_priority") or 0.0)
            if model_score
            else None,
        }
        self._memory.upsert_feature_snapshot(
            feature_key=f"fir_feature_snapshot|{context_key}",
            user_id=user_id,
            session_id=data.session_id,
            page=page_key,
            surface=surface_key,
            entity_type="fir_context",
            entity_ids=[context_key],
            features=feature_snapshot,
        )
        return feature_snapshot

    def _build_mapping_intent_candidate(
        self,
        *,
        data: ConversationSignalEvaluationData,
        feature_snapshot: dict[str, Any],
        selected_tables: list[str],
        context_key: str,
    ) -> SignalCandidate | None:
        if data.mapping_intent is not None or data.target_table is None:
            return None
        page_key = str(feature_snapshot.get("page") or "builder")
        if page_key not in {"builder", "mapping"}:
            return None
        target_label = str(feature_snapshot.get("target_label") or self._display_table_name(
            f"{data.target_table.database}.{data.target_table.schema}.{data.target_table.table}"
        ))
        business_object = target_label.replace("_", " ").title()
        return SignalCandidate(
            signal_key=f"mapping-intent|{context_key}",
            signal_type=AssistantSignalType.FEEDBACK,
            layer="feedback",
            source="conversation_agent",
            title="Tell me what this mapping should achieve",
            message=(
                f"I can give better source suggestions and transformation help for `{target_label}` "
                f"if I know the business outcome you want from this {business_object} mapping."
            ),
            options=["This is a new mapping", "I am updating an existing mapping", "Explain the likely business use", "I will type it manually"],
            allow_free_text=True,
            requires_response=True,
            entity_type="fir_context",
            entity_ids=[context_key, *selected_tables[:2]],
            confidence=0.73,
            attributes={
                "page": feature_snapshot.get("page"),
                "surface": feature_snapshot.get("surface"),
                "context_key": context_key,
                "feedback_class": "mapping_intent_capture",
                "grounding_needed": False,
                "current_understanding": (
                    f"I know the selected sources and target, but I do not yet know whether you are building a new `{target_label}` mapping "
                    "or updating an existing pattern."
                ),
            },
            inference_key=f"mapping_intent_missing|{context_key}",
            inference_type="mapping_intent_missing",
            inference_summary="The system needs business intent to improve source, transformation, and recommendation quality.",
        )

    def _build_business_relationship_story(
        self,
        *,
        data: ConversationSignalEvaluationData,
        selected_pair: list[str],
        target_label: str | None,
    ) -> str:
        pair_labels = [self._display_table_name(item) for item in selected_pair]
        if len(pair_labels) < 2:
            return "The current business relationship between the selected sources is still weakly understood."
        left_label, right_label = pair_labels[:2]
        if data.mapping_intent and data.mapping_intent.business_goal:
            goal = data.mapping_intent.business_goal.strip()
            return (
                f"The selected tables appear to contribute to a `{goal}` mapping, where `{left_label}` likely provides the base business record "
                f"and `{right_label}` adds supporting audit or detail context."
            )
        if target_label:
            return (
                f"The selected tables appear to work together to populate `{target_label}`. One source likely carries the main business record "
                f"while the other contributes supporting attributes, notes, or audit details."
            )
        return (
            f"The selected tables appear to describe related parts of the same business process, with `{left_label}` providing the core record "
            f"and `{right_label}` contributing supporting context."
        )

    def _apply_signal_learning(
        self,
        *,
        signal: AssistantSignal,
        payload: AssistantSignalResponseInput,
        user_id: str | None,
        session_id: str | None,
    ) -> None:
        if not isinstance(signal.attributes, dict):
            return
        context_key = str(signal.attributes.get("context_key") or "").strip()
        if not context_key:
            return
        option = str(payload.option_selected or "").strip().lower()
        rating = payload.rating
        feedback_class = str(signal.attributes.get("feedback_class") or signal.layer or "general")
        learning_summary = payload.comment or payload.option_selected or signal.title
        confidence = 0.88 if option in {"looks right", "this is a new mapping", "i am updating an existing mapping"} else 0.61
        self._memory.upsert_semantic_learning(
            learning_key=f"{feedback_class}|{context_key}|{option or rating or 'response'}",
            entity_type="fir_context",
            entity_ids=[context_key, *signal.entity_ids[:3]],
            learning_type=feedback_class,
            summary=learning_summary,
            confidence=confidence,
            source="user_feedback",
            attributes={
                "signal_id": signal.signal_id,
                "signal_type": signal.signal_type.value,
                "rating": rating,
                "option_selected": payload.option_selected,
                "page": signal.attributes.get("page"),
                "surface": signal.attributes.get("surface"),
            },
            user_id=user_id,
        )
        if feedback_class == "mapping_intent_capture":
            lifecycle = "unknown"
            if option.startswith("this is a new mapping"):
                lifecycle = "new"
            elif option.startswith("i am updating"):
                lifecycle = "update"
            intent = MappingIntent(
                business_goal=(payload.comment or signal.attributes.get("current_understanding") or "").strip()[:300],
                lifecycle=lifecycle,
                target_outcome=str(signal.attributes.get("target_table") or "").strip() or None,
                source="user_feedback",
                confidence=0.82,
            )
            self._memory.upsert_mapping_intent(
                context_key=context_key,
                user_id=user_id,
                session_id=session_id,
                target_table=str(signal.attributes.get("target_table") or "") or None,
                source_tables=signal.entity_ids,
                intent=intent,
                attributes={
                    "signal_id": signal.signal_id,
                    "option_selected": payload.option_selected,
                },
            )

    def _evaluate_signal_candidates(
        self,
        *,
        request_id: str | None,
        conversation_id: str | None,
        user_id: str | None,
        settings: AssistantPreferenceState,
        data: ConversationSignalEvaluationData,
    ) -> tuple[str, str] | None:
        data = self._sanitize_signal_semantic_context(data)
        selected_tables = [
            f"{item.database}.{item.schema}.{item.table}".upper()
            for item in (data.source_tables or [])
        ]
        if not selected_tables:
            return None
        context_key = self._build_signal_context_key(data)
        selected_pair = selected_tables[:2]
        relationship_count = len(data.relationships or [])
        semantic_ready = bool(data.semantic_bundle_id and data.semantic_view_name)
        suspicious_join = any(
            any(str(condition.get("operator") or "=").strip() != "=" for condition in join.get("conditions", []))
            for join in (data.relationships or [])
        )
        feature_snapshot = self._build_fir_feature_snapshot(
            user_id=user_id,
            data=data,
            context_key=context_key,
            selected_tables=selected_tables,
            selected_pair=selected_pair,
            relationship_count=relationship_count,
            semantic_ready=semantic_ready,
            suspicious_join=suspicious_join,
        )

        candidate = self._build_signal_candidate(
            settings=settings,
            data=data,
            context_key=context_key,
            feature_snapshot=feature_snapshot,
            selected_tables=selected_tables,
            selected_pair=selected_pair,
            relationship_count=relationship_count,
            semantic_ready=semantic_ready,
            suspicious_join=suspicious_join,
        )
        if candidate is None:
            return None

        candidate = self._llm_personalize_signal_candidate(
            candidate,
            data=data,
            context_hits=None,
        )
        self._memory.dismiss_conflicting_signals(
            keep_signal_key=candidate.signal_key,
            entity_type=candidate.entity_type,
            entity_ids=candidate.entity_ids,
            page=(candidate.attributes or {}).get("page") if isinstance(candidate.attributes, dict) else None,
            surface=(candidate.attributes or {}).get("surface") if isinstance(candidate.attributes, dict) else None,
            user_id=user_id,
        )
        inference_id = self._memory.record_inference(
            inference_key=candidate.inference_key,
            request_id=request_id,
            conversation_id=conversation_id,
            source=candidate.source,
            inference_type=candidate.inference_type,
            summary=candidate.inference_summary,
            confidence=candidate.confidence,
            entity_type=candidate.entity_type,
            entity_ids=candidate.entity_ids,
            attributes=candidate.attributes,
            status="open",
            user_id=user_id,
        )

        recommendation_id = None
        if candidate.recommendation_type and candidate.recommendation_message:
            recommendation_id = self._memory.record_recommendation(
                request_id=request_id,
                conversation_id=conversation_id or "",
                signal_id=None,
                recommendation_type=candidate.recommendation_type,
                message=candidate.recommendation_message,
                citations=candidate.recommendation_citations,
                entity_type=candidate.entity_type,
                entity_ids=candidate.entity_ids,
                confidence=candidate.confidence,
                attributes=candidate.recommendation_attributes or {},
                approval_required=False,
                status="completed",
                user_id=user_id,
            )

        signal_id = self._memory.upsert_signal(
            signal_key=candidate.signal_key,
            request_id=request_id,
            conversation_id=conversation_id,
            inference_id=inference_id,
            signal_type=candidate.signal_type,
            layer=candidate.layer,
            source=candidate.source,
            title=candidate.title,
            message=candidate.message,
            options=candidate.options,
            allow_free_text=candidate.allow_free_text,
            requires_response=candidate.requires_response,
            entity_type=candidate.entity_type,
            entity_ids=candidate.entity_ids,
            confidence=candidate.confidence,
            attributes=candidate.attributes,
            recommendation_id=recommendation_id,
            user_id=user_id,
        )
        return signal_id, inference_id

    def _build_signal_candidate(
        self,
        *,
        settings: AssistantPreferenceState,
        data: ConversationSignalEvaluationData,
        context_key: str,
        feature_snapshot: dict[str, Any],
        selected_tables: list[str],
        selected_pair: list[str],
        relationship_count: int,
        semantic_ready: bool,
        suspicious_join: bool,
    ) -> SignalCandidate | None:
        selected_labels = [self._display_table_name(item) for item in selected_tables]
        selected_pair_labels = selected_labels[:2]
        primary_relationship = next(
            (
                join
                for join in (data.relationships or [])
                if isinstance(join, dict) and join.get("left_table") and join.get("right_table")
            ),
            None,
        )
        page_key = str(feature_snapshot.get("page") or (data.page or "builder")).strip().lower() or "builder"
        surface_key = str(feature_snapshot.get("surface") or (data.surface or "SOURCE_SELECTION")).strip().upper() or "SOURCE_SELECTION"
        derived_key = "|".join(
            sorted(str(item).strip() for item in (data.selected_derived_sources or []) if str(item).strip())[:4]
        )
        target_label = (
            self._display_table_name(
                f"{data.target_table.database}.{data.target_table.schema}.{data.target_table.table}"
            )
            if data.target_table is not None
            else None
        )
        mapping_summary = data.mapping_summary or {}
        mapped_count = int(mapping_summary.get("mapped_count") or 0)
        unmapped_count = int(mapping_summary.get("unmapped_count") or 0)
        target_key = target_label or ""
        mapping_goal = str(feature_snapshot.get("mapping_goal") or "").strip()
        ml_feedback_probability = float(feature_snapshot.get("ml_feedback_probability") or 0.0)
        ml_recommendation_probability = float(feature_snapshot.get("ml_recommendation_probability") or 0.0)
        ml_recommendation_type = str(feature_snapshot.get("ml_recommendation_type") or "").strip()
        current_understanding = self._build_signal_understanding(
            selected_pair_labels=selected_pair_labels,
            target_label=target_label,
            relationship=primary_relationship,
            suspicious_join=suspicious_join,
            mapped_count=mapped_count,
            unmapped_count=unmapped_count,
            page_key=page_key,
            mapping_goal=mapping_goal or None,
        )
        relationship_story = str(feature_snapshot.get("relationship_story") or current_understanding).strip()

        intent_capture_candidate = self._build_mapping_intent_candidate(
            data=data,
            feature_snapshot=feature_snapshot,
            selected_tables=selected_tables,
            context_key=context_key,
        )
        if intent_capture_candidate is not None and settings.feedback_enabled:
            return intent_capture_candidate

        if settings.feedback_enabled and len(selected_pair) >= 2 and relationship_count > 0 and page_key == "mapping":
            inference_key = (
                f"mapping-understanding|{page_key}|{surface_key}|{'|'.join(selected_pair)}|{relationship_count}|"
                f"{mapped_count}|{unmapped_count}|{target_key}"
            )
            feedback_candidate = SignalCandidate(
                signal_key=f"mapping-feedback|{inference_key}",
                signal_type=AssistantSignalType.FEEDBACK,
                layer="feedback",
                source="conversation_agent",
                title="Check my understanding of how these sources support the target",
                message=(
                    f"{relationship_story} Before you keep mapping into `{target_label or selected_pair_labels[0]}`, "
                    "please check whether this matches the business outcome you expect."
                ),
                options=["Explain this relationship", "Looks right", "Needs correction", "I will type it manually"],
                allow_free_text=True,
                requires_response=True,
                entity_type="fir_context",
                entity_ids=[context_key, *selected_pair],
                confidence=0.82 if not suspicious_join else 0.67,
                attributes={
                    "page": page_key,
                    "surface": surface_key,
                    "target_table": target_key,
                    "context_key": context_key,
                    "action_type": "explain_relationship",
                    "feedback_class": "business_relationship_confirmation",
                    "grounding_needed": not feature_snapshot.get("semantic_learning_count"),
                    "current_understanding": current_understanding,
                    "suggested_prompt": (
                        "Explain the current understanding of how the selected sources contribute to the target mapping in plain business terms, "
                        "point out what looks reliable, and identify the single business assumption the user should confirm or correct."
                    ),
                },
                inference_key=inference_key,
                inference_type="target_semantics_confirmation",
                inference_summary=current_understanding,
            )
            if ml_recommendation_probability > ml_feedback_probability and ml_recommendation_type in {
                "multi_source_mapping_candidate",
                "source_suggestion",
                "transformation_pattern_confirmation",
            }:
                pass
            else:
                return feedback_candidate

        if settings.recommendations_enabled and len(selected_pair) >= 2 and relationship_count > 0:
            inference_key = (
                f"relationship-live|{page_key}|{surface_key}|{'|'.join(selected_pair)}|{relationship_count}|"
                f"{mapped_count}|{unmapped_count}|{target_key}"
            )
            if target_label and page_key == "mapping" and feature_snapshot.get("has_notes_source"):
                message = (
                    f"{relationship_story} This looks especially relevant if `{target_label}` needs note, audit, or review-driven fields that come from more than one source."
                )
            elif target_label and (mapped_count or unmapped_count):
                message = (
                    f"{relationship_story} Confirming that business meaning now should improve the next source-column and transformation suggestions for `{target_label}`."
                )
            elif mapped_count or unmapped_count:
                message = (
                    f"{relationship_story} If we confirm this understanding now, I can guide the remaining mapping more accurately."
                )
            else:
                message = (
                    f"{relationship_story} I can explain why this matters for the mapping you are building and what should be confirmed next."
                )
            return SignalCandidate(
                signal_key=f"recommendation-live|{inference_key}",
                signal_type=AssistantSignalType.RECOMMENDATION,
                layer="recommendation",
                source="conversation_agent",
                title="Use this source combination to improve the mapping",
                message=message,
                options=["Explain this relationship", "Looks right", "Needs correction", "I will type it manually"],
                allow_free_text=True,
                requires_response=False,
                entity_type="fir_context",
                entity_ids=[context_key, *selected_pair],
                confidence=0.78,
                attributes={
                    "page": page_key,
                    "surface": surface_key,
                    "target_table": target_key,
                    "context_key": context_key,
                    "action_type": "explain_relationship",
                    "recommendation_class": "multi_source_mapping_candidate",
                    "grounding_needed": not bool(feature_snapshot.get("has_client_knowledge")),
                    "current_understanding": current_understanding,
                    "suggested_prompt": (
                        "Explain the current understanding of how the selected sources contribute to the target mapping in simple business language, "
                        "including why the combination matters and what business check would improve mapping quality next."
                    ),
                },
                inference_key=inference_key,
                inference_type="multi_source_mapping_candidate",
                inference_summary=message,
                recommendation_type="multi_source_mapping_candidate",
                recommendation_message=message,
            )

        if settings.feedback_enabled and len(selected_pair) >= 2 and (suspicious_join or relationship_count == 0):
            if ml_feedback_probability < 0.45 and ml_recommendation_probability > 0.6:
                return None
            inference_key = (
                f"feedback|{page_key}|{surface_key}|{'|'.join(selected_pair)}|{relationship_count}|"
                f"{int(suspicious_join)}|{target_key}"
            )
            if suspicious_join:
                feedback_message = (
                    f"I found a possible relationship between `{selected_pair_labels[0]}` and `{selected_pair_labels[1]}`, "
                    "but I am not yet confident it reflects the business rule you want. Which description is closest?"
                )
                feedback_options = [
                    "Same business record, but the link should be different",
                    "These sources are related indirectly",
                    "This relationship looks right",
                    "I want to describe the relationship",
                ]
            else:
                feedback_message = (
                    f"I am not yet confident how `{selected_pair_labels[0]}` and `{selected_pair_labels[1]}` work together for your mapping goal. "
                    "Which answer would help me recommend the right source pattern?"
                )
                feedback_options = [
                    "They describe the same business object",
                    "One provides supporting audit or note context",
                    "They should not be joined directly",
                    "I want to describe the relationship",
                ]
            return SignalCandidate(
                signal_key=f"feedback-signal|{inference_key}",
                signal_type=AssistantSignalType.FEEDBACK,
                layer="feedback",
                source="conversation_agent",
                title="Help me understand how these sources fit the business process",
                message=feedback_message,
                options=feedback_options,
                allow_free_text=True,
                requires_response=True,
                entity_type="fir_context",
                entity_ids=[context_key, *selected_pair],
                confidence=0.64 if suspicious_join else 0.58,
                attributes={
                    "page": page_key,
                    "surface": surface_key,
                    "target_table": target_key,
                    "context_key": context_key,
                    "feedback_class": "semantic_gap_needs_feedback",
                    "grounding_needed": False,
                    "current_understanding": current_understanding,
                },
                inference_key=inference_key,
                inference_type="semantic_gap_needs_feedback",
                inference_summary=(
                    "Business confirmation is needed to improve relationship guidance and mapping help for the current table pair."
                ),
            )

        if (
            settings.recommendations_enabled
            and selected_tables
            and not semantic_ready
            and relationship_count == 0
        ):
            inference_key = (
                f"semantic-ready|{page_key}|{surface_key}|{'|'.join(selected_tables[:3])}|"
                f"{target_key}|{derived_key}"
            )
            if target_label:
                message = (
                    f"I can give better join explanations and mapping suggestions for "
                    f"`{selected_pair_labels[0]}`{f' and `{selected_pair_labels[1]}`' if len(selected_pair_labels) > 1 else ''} "
                    f"before you map into `{target_label}`."
                )
            else:
                message = (
                    f"I can give better join explanations and mapping suggestions for "
                    f"`{selected_pair_labels[0]}`{f' and `{selected_pair_labels[1]}`' if len(selected_pair_labels) > 1 else ''} "
                    "if I first build richer context for this selection."
                )
            return SignalCandidate(
                signal_key=f"recommend-semantic|{inference_key}",
                signal_type=AssistantSignalType.RECOMMENDATION,
                layer="recommendation",
                source="conversation_agent",
                title="Strengthen the business context for this mapping",
                message=(
                    f"{message} This helps me use the selected tables, prior semantic learnings, and business meaning more accurately."
                ),
                options=["Build stronger context", "Ask AI to explain first", "Not now"],
                allow_free_text=False,
                requires_response=False,
                entity_type="fir_context",
                entity_ids=[context_key, *(selected_pair if len(selected_pair) >= 2 else selected_tables[:3])],
                confidence=0.81,
                attributes={
                    "page": page_key,
                    "surface": surface_key,
                    "target_table": target_key,
                    "context_key": context_key,
                    "action_type": "refresh_semantic_context",
                    "recommendation_class": "source_suggestion",
                    "grounding_needed": True,
                    "current_understanding": current_understanding,
                    "suggested_prompt": (
                        "Explain in simple business terms what the selected sources appear to represent, what is still uncertain, "
                        "and why stronger context would improve source suggestions, relationship explanations, and mapping recommendations."
                    ),
                },
                inference_key=inference_key,
                inference_type="source_suggestion",
                inference_summary="The current selection needs richer context before join and mapping guidance can be more reliable.",
            )
        return None

    def _llm_personalize_signal_candidate(
        self,
        candidate: SignalCandidate,
        *,
        data: ConversationSignalEvaluationData,
        context_hits: list[dict[str, Any]] | None,
    ) -> SignalCandidate:
        if not self._agent_name:
            return candidate
        should_ground = bool(candidate.attributes.get("grounding_needed")) or (candidate.confidence or 0.0) < 0.7
        resolved_context_hits = context_hits
        if resolved_context_hits is None and should_ground:
            resolved_context_hits = self._load_signal_context_hits(candidate, data=data)
        if resolved_context_hits is None:
            resolved_context_hits = []
        if candidate.signal_type == AssistantSignalType.FEEDBACK:
            instruction = (
                "Write a short assistant question that checks whether the system's current understanding is correct. "
                "If the system is unsure, say that clearly and ask for help in plain language."
            )
            examples = (
                'Example title: Help me confirm this relationship\n'
                'Example message: I think these tables are connected for your mapping, but I am not fully sure the business key is right. '
                'Can you tell me whether this relationship looks correct, needs a different key, or should not be used?\n'
                'Example options: ["Looks right", "Needs correction", "Explain first", "I will type it manually"]\n'
            )
        else:
            instruction = (
                "Write a short next-step recommendation that explains what would help the user map more accurately. "
                "If the context suggests a likely business purpose for the join or mapping, say that plainly."
            )
            examples = (
                'Example title: Check this join before you map more columns\n'
                'Example message: I found a likely relationship for the tables you selected. It looks like this join could help connect the income record to its note details before mapping into the target table. If we confirm that business meaning now, I can give better source-column and transformation suggestions.\n'
                'Example options: ["Explain this relationship", "Looks right", "Needs correction", "Not now"]\n'
            )
        prompt = (
            "You are generating a single lightweight UI notification for a data-migration workbench.\n"
            "Return JSON only with keys: title, message, options, current_understanding.\n"
            "Keep it short, helpful, and grounded only in the provided context.\n"
            "Write for a business or mapping user, not a backend engineer.\n"
            "Do not use internal platform wording like semantic bundle, trace, inference, or guardrails unless unavoidable.\n"
            "Focus on what will help the user map correctly, validate a join, or teach the assistant more.\n"
            "When possible, explain why the relationship matters for the user’s mapping goal or target table, not just that a join exists.\n"
            "Do not invent tables, joins, or actions. No markdown.\n"
            f"Notification style instruction: {instruction}\n"
            f"{examples}"
            f"Signal type: {candidate.signal_type.value}\n"
            f"Layer: {candidate.layer}\n"
            f"Entity ids: {json.dumps(candidate.entity_ids)}\n"
            f"Surface: {data.surface or 'SOURCE_SELECTION'}\n"
            f"Activity type: {data.activity_type}\n"
            f"Source tables: {json.dumps([f'{item.database}.{item.schema}.{item.table}' for item in (data.source_tables or [])])}\n"
            f"Selected derived sources: {json.dumps(data.selected_derived_sources or [])}\n"
            f"Driving table: {json.dumps(data.driving_table.model_dump(mode='json') if data.driving_table else None)}\n"
            f"Target table: {json.dumps(data.target_table.model_dump(mode='json') if data.target_table else None)}\n"
            f"Relationship summary: {json.dumps(data.relationships or [])}\n"
            f"Mapping summary: {json.dumps(data.mapping_summary or {})}\n"
            f"Existing title: {candidate.title}\n"
            f"Existing message: {candidate.message}\n"
            f"Existing options: {json.dumps(candidate.options)}\n"
            f"Existing current understanding: {candidate.attributes.get('current_understanding') if isinstance(candidate.attributes, dict) else ''}\n"
            f"Relationships count: {len(data.relationships or [])}\n"
            f"Semantic bundle id: {data.semantic_bundle_id or ''}\n"
            f"Semantic view name: {data.semantic_view_name or ''}\n"
            f"Mapping intent: {json.dumps(data.mapping_intent.model_dump(mode='json') if data.mapping_intent else None)}\n"
            f"Relevant knowledge hits: {json.dumps(resolved_context_hits)}\n"
        )
        try:
            raw_text, _, _ = self._agent.run_detailed(
                [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
                agent=self._agent_name,
                request_timeout=3.0,
            )
            parsed = json.loads(raw_text)
            if isinstance(parsed, dict):
                title = str(parsed.get("title") or candidate.title).strip() or candidate.title
                message = str(parsed.get("message") or candidate.message).strip() or candidate.message
                options_raw = parsed.get("options")
                options = (
                    [str(item).strip() for item in options_raw if str(item).strip()]
                    if isinstance(options_raw, list)
                    else candidate.options
                )
                attributes = dict(candidate.attributes)
                current_understanding = str(
                    parsed.get("current_understanding") or attributes.get("current_understanding") or ""
                ).strip()
                if current_understanding:
                    attributes["current_understanding"] = current_understanding
                return SignalCandidate(
                    signal_key=candidate.signal_key,
                    signal_type=candidate.signal_type,
                    layer=candidate.layer,
                    source=candidate.source,
                    title=title,
                    message=message,
                    options=options[:4] if options else candidate.options,
                    allow_free_text=candidate.allow_free_text,
                    requires_response=candidate.requires_response,
                    entity_type=candidate.entity_type,
                    entity_ids=candidate.entity_ids,
                    confidence=candidate.confidence,
                    attributes=attributes,
                    inference_key=candidate.inference_key,
                    inference_type=candidate.inference_type,
                    inference_summary=candidate.inference_summary,
                    recommendation_type=candidate.recommendation_type,
                    recommendation_message=message if candidate.recommendation_message else candidate.recommendation_message,
                    recommendation_attributes=candidate.recommendation_attributes,
                    recommendation_citations=candidate.recommendation_citations,
                )
        except Exception:
            logger.info("signal.llm_personalization_fallback", exc_info=True)
        return candidate

    def _build_signal_understanding(
        self,
        *,
        selected_pair_labels: list[str],
        target_label: str | None,
        relationship: dict[str, Any] | None,
        suspicious_join: bool,
        mapped_count: int,
        unmapped_count: int,
        page_key: str,
        mapping_goal: str | None = None,
    ) -> str:
        left_label = selected_pair_labels[0] if selected_pair_labels else "the first selected table"
        right_label = selected_pair_labels[1] if len(selected_pair_labels) > 1 else "the second selected table"
        if relationship:
            join_type = str(relationship.get("join_type") or "INNER").upper()
            conditions = relationship.get("conditions") or []
            condition_text = ", ".join(
                f"{item.get('left_column') or 'left column'} {item.get('operator') or '='} {item.get('right_column') or 'right column'}"
                for item in conditions
                if isinstance(item, dict)
            )
            if not condition_text:
                condition_text = "the current join conditions"
            summary = (
                f"I currently think {left_label} and {right_label} should be joined with a {join_type} join using {condition_text}."
            )
        else:
            summary = f"I do not yet have a trusted join between {left_label} and {right_label}."

        if mapping_goal:
            summary += f" I believe this relationship matters because you appear to be building a mapping for {mapping_goal}."
        elif target_label and page_key == "mapping":
            summary += f" For the current mapping into {target_label}, I think this join is part of how the selected sources feed the target rows."
        elif target_label:
            summary += f" I believe this relationship matters for mapping into {target_label}."

        if suspicious_join:
            summary += " One concern is that the current condition does not look like a typical equality-based business key, so it may need correction."

        if page_key == "mapping":
            if unmapped_count > 0:
                summary += f" There are still {unmapped_count} unmapped target columns, so confirming this relationship should improve the next mapping suggestions."
            elif mapped_count > 0:
                summary += f" I can already see {mapped_count} mapped columns, so validating this join now should help confirm the remaining mapping logic."

        return summary

    def _load_signal_context_hits(
        self,
        candidate: SignalCandidate,
        *,
        data: ConversationSignalEvaluationData,
    ) -> list[dict[str, Any]]:
        try:
            exact_hits = (
                self._memory.find_relationships_for_tables(
                    table_names=candidate.entity_ids[:2],
                    semantic_bundle_id=data.semantic_bundle_id,
                    limit=2,
                )
                if len(candidate.entity_ids) >= 2
                else []
            )
            query_parts = [self._display_table_name(item) for item in candidate.entity_ids[:3]]
            if data.target_table is not None:
                query_parts.append(
                    self._display_table_name(
                        f"{data.target_table.database}.{data.target_table.schema}.{data.target_table.table}"
                    )
                )
            query = " ".join(part for part in query_parts if part).strip()
            search_hits = (
                self._memory.search(
                    query=query,
                    limit=3,
                    folders=[
                        "semantic",
                        "derived_sources",
                        "relationships",
                        "inferences",
                        "feedback",
                        "recommendations",
                        "knowledge_notes",
                        "historical_sql",
                        "conversations",
                    ],
                    semantic_bundle_id=data.semantic_bundle_id,
                    semantic_view_name=data.semantic_view_name,
                )
                if query
                else []
            )
            merged: list[dict[str, Any]] = []
            seen_doc_ids: set[str] = set()
            for hit in [*exact_hits, *search_hits]:
                if hit.doc_id in seen_doc_ids:
                    continue
                seen_doc_ids.add(hit.doc_id)
                merged.append(
                    {
                        "doc_id": hit.doc_id,
                        "folder": hit.doc_folder,
                        "type": hit.doc_type,
                        "title": hit.title,
                        "snippet": hit.snippet,
                        "score": hit.score,
                    }
                )
            return merged[:4]
        except Exception:
            logger.info("signal.context_hits_fallback", exc_info=True)
            return []

    @staticmethod
    def _display_table_name(qualified_name: str) -> str:
        parts = [part for part in qualified_name.split(".") if part]
        if len(parts) >= 2:
            return ".".join(parts[-2:])
        return qualified_name

    @staticmethod
    def _qualified_table_name(table: TableRef | None) -> str | None:
        if table is None:
            return None
        return f"{table.database}.{table.schema}.{table.table}"

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
                "simple business terms",
                "looks reliable for mapping",
                "what looks reliable",
                "specific assumption",
                "current understanding so far",
            )
        )

    @classmethod
    def _should_bypass_relationship_fast_path(cls, message: str) -> bool:
        lowered = " ".join((message or "").strip().lower().split())
        return any(
            phrase in lowered
            for phrase in (
                "please explain this in simple business terms",
                "please ask me what looks wrong",
                "show how it supports the target mapping",
                "point out exactly what the user should confirm or correct",
                "this is your current understanding so far",
                "what is still uncertain",
                "tell me what looks reliable",
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
