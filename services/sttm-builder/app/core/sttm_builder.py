import asyncio
import hashlib
import json
import logging
import queue
import re
import threading
import time
import uuid
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

from pydantic import ValidationError
from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.agent_execution_context import attach_agent_execution_context
from app.core.conversation_memory import ConversationMemoryService
from app.core.conversation_continuity import (
    ConversationContinuityService,
    ConversationPreparation,
)
from app.core.exceptions import (
    AppError,
    ContextPrecedentUnavailableError,
    SemanticAssetNotFoundError,
    SemanticRelationshipInvalidError,
    SnowflakeAgentError,
)
from app.guardrails.config.loader import load_config
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.runtime.model_boundary import ModelBoundaryGuard
from app.guardrails.runtime.postflight import PostflightGuard
from app.core.semantic_context import SemanticContextService
from app.core.semantic_model import SemanticModelService
from app.core.snowflake_agent import SnowflakeAgentClient
from app.core.snowflake_analyst import SnowflakeAnalystClient, SnowflakeAnalystResponse


_ANALYST_RESPONSE_CACHE_TTL_SECONDS = 120.0
_ANALYST_RESPONSE_CACHE_LOCK = threading.Lock()
_ANALYST_RESPONSE_CACHE: dict[str, tuple[float, "STTMBuilderResponse"]] = {}
from app.schema.contracts import ApiError, ApiWarning
from app.schema.common import AttributeRef, TableRef
from app.schema.semantic_context import SemanticContextRefreshRequest, SemanticLevel, SemanticSurface
from app.schema.semantic_context import SemanticBundleStatus
from app.schema.sttm_builder import (
    AttributeMapping,
    Interface,
    SemanticContextItem,
    SourceMappingResult,
    STTMAgentRequestEnvelope,
    STTMAgentResponseEnvelope,
    STTMArtifactType,
    STTMBuilderEnvelopeRequest,
    STTMBuilderResponse,
    STTMStatus,
    STTMOperation,
    SubAgent,
    TransformationRule,
    TransformationResult,
    ValueBinding,
    _coerce_api_error,
)

logger = logging.getLogger(__name__)
_local_chat_threads: dict[str, list[dict[str, Any]]] = {}
_SEMANTIC_LEVEL_ORDER = {
    SemanticLevel.L0_RELATIONSHIP: 0,
    SemanticLevel.L1_CONTEXT: 1,
    SemanticLevel.L2_ANALYST_READY: 2,
    SemanticLevel.L3_MAPPING_ENRICHED: 3,
    SemanticLevel.FULL_REGISTRY: 4,  # Highest level - full semantic views
}

_INTENT_ROUTE_DIRECT = "direct_answer"
_INTENT_ROUTE_RAG = "rag_answer"
_INTENT_ROUTE_ANALYST = "analyst_sql_or_derived_source"
_INTENT_ROUTE_SOURCE_MAPPING = "source_mapping"
_INTENT_ROUTE_TRANSFORMATION = "transformation_rule"
_INTENT_ROUTE_DBT = "dbt_conversion"
_INTENT_ROUTE_TESTS = "test_cases"
_INTENT_ROUTE_COCO = "coco_deep_agent"
_INTENT_ROUTE_ALLOWED = {
    _INTENT_ROUTE_DIRECT,
    _INTENT_ROUTE_RAG,
    _INTENT_ROUTE_ANALYST,
    _INTENT_ROUTE_SOURCE_MAPPING,
    _INTENT_ROUTE_TRANSFORMATION,
    _INTENT_ROUTE_DBT,
    _INTENT_ROUTE_TESTS,
    _INTENT_ROUTE_COCO,
}
_LEGACY_CONVERSATION_ROUTE_MAP = {
    "quick_answer": _INTENT_ROUTE_DIRECT,
    "clarification": _INTENT_ROUTE_DIRECT,
    "rag_lookup": _INTENT_ROUTE_RAG,
    "recommendation": _INTENT_ROUTE_RAG,
    "feedback_capture": _INTENT_ROUTE_DIRECT,
}


def classify_sttm_intent_route(req: STTMBuilderEnvelopeRequest) -> str:
    """Fast deterministic route hint before AGT_STTM_BUILDER sees the payload."""
    explicit = (req.data.intent_route or req.context.routing_hint or "").strip().lower()
    if explicit:
        mapped = _LEGACY_CONVERSATION_ROUTE_MAP.get(explicit, explicit)
        if mapped in _INTENT_ROUTE_ALLOWED:
            return mapped
    if req.data.intent == Interface.AUTO_MAP:
        return _INTENT_ROUTE_SOURCE_MAPPING
    if req.data.intent == Interface.TRANSFORM:
        return _INTENT_ROUTE_TRANSFORMATION

    text = (req.data.message or "").strip().lower()
    surface = req.context.surface
    checked_rows = (
        req.context.workspace_context.checked_mapping_row_ids
        if req.context.workspace_context is not None
        else []
    )

    if any(token in text for token in ("coco", "deep agent", "code agent", "edit code", "deploy")):
        return _INTENT_ROUTE_COCO
    if any(token in text for token in ("dbt", "model.sql", "schema.yml", "schema yaml")):
        return _INTENT_ROUTE_DBT
    if any(token in text for token in ("test case", "test cases", "data test", "unit test")):
        return _INTENT_ROUTE_TESTS
    if surface == SemanticSurface.MAPPING and (
        checked_rows
        or any(token in text for token in ("map", "mapping", "source column", "confidence", "why low", "remap", "preprocessing", "pre-processing", "preprocess", "pre-process", "transformation rule", "transform rule"))
    ):
        if any(token in text for token in ("preprocessing", "pre-processing", "rule", "cast", "case ", "preprocess", "pre-process", "transform", "convert", "expression")):
            return _INTENT_ROUTE_TRANSFORMATION
        return _INTENT_ROUTE_SOURCE_MAPPING
    if any(token in text for token in (
        "tell me about", "what can you", "what about", "do you see",
        "describe", "overview", "explain the", "information about",
        "what do you know", "any insight", "any recommendation",
        "why", "explain", "prior", "history", "recommend", "relationship", "semantic", "meaning",
    )):
        return _INTENT_ROUTE_RAG
    if any(token in text for token in ("derived source", "cte", "join the", "generate sql", "write sql", "validate sql")):
        return _INTENT_ROUTE_ANALYST
    if "query" in text and not any(token in text for token in ("tell", "about", "see", "know", "explain")):
        return _INTENT_ROUTE_ANALYST
    return _INTENT_ROUTE_DIRECT


def _iter_agent_events_with_heartbeat(
    events: Iterator[tuple[str, Any]],
    *,
    heartbeat_seconds: float = 10.0,
) -> Iterator[tuple[str, Any]]:
    """Consume a blocking Cortex SSE iterator without leaving ingress idle."""
    event_queue: queue.Queue[tuple[str, Any]] = queue.Queue()
    completed = object()

    def consume() -> None:
        try:
            for item in events:
                event_queue.put(("event", item))
        except BaseException as exc:  # re-raised on the request thread
            event_queue.put(("error", exc))
        finally:
            event_queue.put(("completed", completed))

    threading.Thread(target=consume, daemon=True).start()
    started = time.monotonic()
    while True:
        try:
            kind, value = event_queue.get(timeout=heartbeat_seconds)
        except queue.Empty:
            yield "__heartbeat__", {
                "elapsed_seconds": round(time.monotonic() - started, 1),
            }
            continue
        if kind == "event":
            yield value
        elif kind == "error":
            raise value
        else:
            return


class STTMBuilderService:
    """
    Drives the STTM_BUILDER_AGENT orchestration agent.

    The agent routes each request to the appropriate sub-agent
    (SOURCE_MAPPING_AGENT or TRANSFORMATION_AGENT) based on the interface
    tag embedded in the prompt. This service enriches the request with
    semantic context before calling the agent.
    """

    def __init__(
        self,
        agent_client: SnowflakeAgentClient,
        *,
        analyst_client: SnowflakeAnalystClient,
        settings: Settings,
        session: Session,
        semantic_model_service: SemanticModelService,
        semantic_context_service: SemanticContextService,
        access_scope: str = "default",
        query_session: Session | None = None,
    ) -> None:
        self._agent = agent_client
        self._analyst = analyst_client
        self._settings = settings
        self._session = session
        # Durable state and semantic/FIR caches stay on CONTROL via ``session``.
        # Factual assistant/Analyst SQL uses the independently routed AGENT
        # session so routine chat never activates the EXECUTION warehouse.
        self._query_session = query_session or session
        self._semantic_model_service = semantic_model_service
        self._semantic_context_service = semantic_context_service
        self._guardrails_config = load_config(settings=settings)
        self._model_guard = ModelBoundaryGuard(self._guardrails_config)
        self._postflight_guard = PostflightGuard(self._guardrails_config)

        from app.core.learning_retrieval import LearningRetrievalService
        self._learning_service = LearningRetrievalService(
            session,
            settings,
            access_scope=access_scope,
        )
        self._conversation_memory = ConversationMemoryService(session, settings)
        self._conversation_continuity = ConversationContinuityService(
            self._conversation_memory,
            settings,
        )

        builder_agent_name = settings.resolved_sttm_builder_agent.strip()
        if not builder_agent_name:
            raise SnowflakeAgentError(
                "Could not resolve the STTM builder agent. Set "
                "SNOWFLAKE_STTM_BUILDER_AGENT or provide the metadata "
                "database/schema configuration."
            )
        self._agent_name = builder_agent_name

        source_mapping_agent_name = settings.resolved_source_mapping_agent.strip()
        if not source_mapping_agent_name:
            raise SnowflakeAgentError(
                "Could not resolve the source mapping agent. Set "
                "SNOWFLAKE_SOURCE_MAPPING_AGENT or provide the metadata "
                "database/schema configuration."
            )
        self._source_mapping_agent_name = source_mapping_agent_name

    @staticmethod
    def _with_intent_route(req: STTMBuilderEnvelopeRequest) -> STTMBuilderEnvelopeRequest:
        route = classify_sttm_intent_route(req)
        return req.model_copy(
            update={
                "context": req.context.model_copy(update={"routing_hint": route}),
                "data": req.data.model_copy(update={"intent_route": route}),
            }
        )

    def invoke(
        self,
        req: STTMBuilderEnvelopeRequest,
        *,
        governance_decision: GovernanceDecision | None = None,
    ) -> STTMBuilderResponse:
        req = self._with_intent_route(req)
        req = self._sanitize_request_semantic_context(req)
        decision = governance_decision or self._build_governance_decision(req)
        started_at = time.perf_counter()
        req, semantic_refresh = self._with_semantic_context(req)
        req = attach_agent_execution_context(req, self._conversation_memory)
        req = self._with_learning_context(req)
        req = attach_agent_execution_context(req, self._conversation_memory)
        req = self._govern_request_for_model(req, decision)
        semantic_context_ms = (time.perf_counter() - started_at) * 1000

        if self._should_use_analyst(req, semantic_refresh):
            logger.info(
                "Answering STTM chat request with Cortex Analyst: request_id=%s surface=%s level=%s semantic_view=%s",
                req.request_id,
                req.context.surface.value,
                req.context.semantic_level_requested.value,
                getattr(semantic_refresh, "semantic_view_name", None),
            )
            response = self._invoke_analyst(req, semantic_refresh, decision)
            response.meta = self._merge_agent_meta(
                response.meta,
                {
                    "timings_ms": {
                        "semantic_context": round(semantic_context_ms, 1),
                        "total": round((time.perf_counter() - started_at) * 1000, 1),
                    },
                    "routing": {
                        "bypassed_agent_orchestrator": True,
                        "reason": "oauth_safe_direct_analyst_path",
                    },
                },
            )
            artifact_id = self._persist_response_artifact(req, response)
            self._attach_response_artifact_descriptor(
                response,
                artifact_id=artifact_id,
                artifact_type=str(
                    response.data.artifact_type.value
                    if response.data is not None
                    else "analyst_answer"
                ),
            )
            return response

        user_text = self._build_agent_payload(req)
        continuity = self._prepare_conversation_continuity(req, user_text)
        messages = self._messages_with_continuity(user_text, continuity)
        local_thread_id = None
        self._model_guard.assert_model_target_allowed(
            operation=req.operation.value,
            target="agent",
            decision=decision,
        )
        logger.info(
            "Sending STTM agent payload: request_id=%s operation=%s chars=%s surface=%s level=%s bundle=%s agent=%s",
            req.request_id,
            req.operation.value,
            len(user_text),
            req.context.surface.value,
            req.context.semantic_level_requested.value,
            req.context.semantic_bundle_id,
            self._resolved_agent_name(req),
        )

        thread_id_to_use = (
            None
            if self._should_reset_thread(req)
            else (
                continuity.physical_thread_id
                if continuity is not None
                else req.context.thread_id
            )
        )
        parent_message_id_to_use = None if thread_id_to_use is None else req.context.parent_message_id

        agent_started_at = time.perf_counter()
        try:
            raw_text, thread_id, raw_payload = self._agent.run_detailed(
                messages,
                agent=self._resolved_agent_name(req),
                thread_id=thread_id_to_use,
                parent_message_id=parent_message_id_to_use,
            )
        except SnowflakeAgentError as exc:
            if not self._should_retry_without_thread(exc, thread_id_to_use):
                raise
            logger.warning(
                "Checkpointing logical conversation after expired Cortex thread: "
                "request_id=%s thread_id=%s",
                req.request_id,
                thread_id_to_use,
            )
            continuity = self._prepare_conversation_continuity(
                req,
                user_text,
                force_rollover_reason="expired_cortex_thread",
            )
            messages = self._messages_with_continuity(user_text, continuity)
            raw_text, thread_id, raw_payload = self._agent.run_detailed(
                messages,
                agent=self._resolved_agent_name(req),
                thread_id=None,
                parent_message_id=None,
            )
        agent_ms = (time.perf_counter() - agent_started_at) * 1000
        parent_message_id = _extract_assistant_message_id(raw_payload)
        response_thread_id = local_thread_id or thread_id
        response_meta = {
            "logical_conversation_id": (
                continuity.logical_conversation_id if continuity else None
            ),
            "thread_segment": continuity.segment_number if continuity else None,
            "thread_rolled_over": continuity.rolled_over if continuity else False,
            "rollover_reason": continuity.rollover_reason if continuity else None,
            "timings_ms": {
                "semantic_context": round(semantic_context_ms, 1),
                "agent": round(agent_ms, 1),
                "total": round((time.perf_counter() - started_at) * 1000, 1),
            },
            "agent_payload": {
                "characters": len(user_text),
                "sha256": hashlib.sha256(user_text.encode("utf-8")).hexdigest(),
                "semantic_item_count": len(req.context.semantic_context or []),
                "target_attribute_count": len(req.data.attributes or []),
            },
        }

        if req.data.intent == Interface.CHAT:
            (
                sub_agent,
                result,
                message,
                warnings,
                error,
                meta,
                status,
                artifact_type,
                artifact,
                semantic_level_achieved,
                semantic_refresh_status,
            ) = self._parse_chat_response(raw_text, raw_payload)
            warnings = self._normalize_response_warnings(warnings)
            final_chat_message = self._sanitize_final_chat_message(message or raw_text.strip())
            if local_thread_id:
                self._store_local_chat_history(
                    thread_id=local_thread_id,
                    messages=messages,
                    assistant_text=final_chat_message or "",
            )
            artifact_type, artifact = self._coerce_chat_artifact(
                req,
                artifact_type=artifact_type,
                artifact=artifact,
            )
            response = STTMBuilderResponse.from_invocation(
                req,
                thread_id=response_thread_id,
                parent_message_id=None if local_thread_id else parent_message_id,
                agent=sub_agent,
                result=result,
                message=final_chat_message,
                status=status,
                artifact_type=artifact_type or (
                    STTMArtifactType.SEMANTIC_CONTEXT
                    if semantic_refresh and sub_agent is None and result is None
                    else STTMArtifactType.NONE
                ),
                artifact=artifact if artifact is not None else self._semantic_refresh_to_dict(semantic_refresh),
                semantic_level_achieved=semantic_level_achieved or (
                    semantic_refresh.achieved_level if semantic_refresh else None
                ),
                semantic_refresh_status=semantic_refresh_status or (
                    None if semantic_refresh is None else {
                        "bundle_id": semantic_refresh.bundle_id,
                        "bundle_hash": semantic_refresh.bundle_hash,
                        "bundle_label": semantic_refresh.bundle_label,
                        "requested_level": semantic_refresh.requested_level,
                        "achieved_level": semantic_refresh.achieved_level,
                        "status": semantic_refresh.status,
                        "semantic_view_name": semantic_refresh.semantic_view_name,
                        "promoted": semantic_refresh.promoted,
                        "cache_hit": semantic_refresh.cache_hit,
                        "stale_reason": None,
                    }
                ),
                warnings=warnings,
                error=error,
                meta=self._merge_agent_meta(
                    {**(meta or {}), **response_meta},
                    raw_payload=raw_payload,
                    artifact_type=artifact_type,
                    artifact=artifact,
                ),
            )
            response = self._execute_requested_analyst_delegation(
                req,
                response,
                semantic_refresh=semantic_refresh,
                decision=decision,
            )
            finalized = self._postflight_guard.finalize_sttm_response(response, decision)
            final_visible_text = self._visible_response_text(finalized)
            artifact_id = self._persist_response_artifact(
                req,
                finalized,
                continuity=continuity,
            )
            self._attach_response_artifact_descriptor(
                finalized,
                artifact_id=artifact_id,
                artifact_type=str(
                    finalized.data.artifact_type.value
                    if finalized.data is not None
                    else "chat"
                ),
            )
            self._complete_conversation_continuity(
                continuity,
                physical_thread_id=response_thread_id,
                user_text=user_text,
                assistant_text=final_visible_text,
            )
            self._persist_continuity_turns(
                req,
                continuity,
                assistant_text=final_visible_text,
            )
            if local_thread_id and final_visible_text != (final_chat_message or ""):
                self._store_local_chat_history(
                    thread_id=local_thread_id,
                    messages=messages,
                    assistant_text=final_visible_text,
                )
            return finalized

        if local_thread_id and req.data.intent == Interface.CHAT:
            self._store_local_chat_history(
                thread_id=local_thread_id,
                messages=messages,
                assistant_text=message or raw_text.strip(),
            )

        (
            sub_agent,
            result,
            message,
            warnings,
            error,
            meta,
            status,
            artifact_type,
            artifact,
            semantic_level_achieved,
            semantic_refresh_status,
        ) = self._parse_envelope(raw_text)
        warnings = self._normalize_response_warnings(warnings)
        response = STTMBuilderResponse.from_invocation(
            req,
            thread_id=response_thread_id,
            parent_message_id=None if local_thread_id else parent_message_id,
            agent=sub_agent,
            result=result,
            message=message,
            status=status,
            artifact_type=artifact_type or self._artifact_type_for_response(sub_agent, semantic_refresh),
            artifact=artifact if artifact is not None else self._semantic_refresh_to_dict(semantic_refresh),
            semantic_level_achieved=semantic_level_achieved or (
                semantic_refresh.achieved_level if semantic_refresh else None
            ),
            semantic_refresh_status=semantic_refresh_status or (
                None if semantic_refresh is None else {
                    "bundle_id": semantic_refresh.bundle_id,
                    "bundle_hash": semantic_refresh.bundle_hash,
                    "bundle_label": semantic_refresh.bundle_label,
                    "requested_level": semantic_refresh.requested_level,
                    "achieved_level": semantic_refresh.achieved_level,
                    "status": semantic_refresh.status,
                    "semantic_view_name": semantic_refresh.semantic_view_name,
                    "promoted": semantic_refresh.promoted,
                    "cache_hit": semantic_refresh.cache_hit,
                    "stale_reason": None,
                }
            ),
            warnings=warnings,
            error=error,
            meta=self._merge_agent_meta(
                {**(meta or {}), **response_meta},
                raw_payload=raw_payload,
                artifact_type=artifact_type,
                artifact=artifact,
            ),
        )
        finalized = self._postflight_guard.finalize_sttm_response(response, decision)
        artifact_id = self._persist_response_artifact(
            req,
            finalized,
            continuity=continuity,
        )
        self._attach_response_artifact_descriptor(
            finalized,
            artifact_id=artifact_id,
            artifact_type=str(
                finalized.data.artifact_type.value
                if finalized.data is not None
                else req.data.intent.value.lower()
            ),
        )
        self._complete_conversation_continuity(
            continuity,
            physical_thread_id=response_thread_id,
            user_text=user_text,
            assistant_text=message or raw_text,
        )
        self._persist_continuity_turns(
            req,
            continuity,
            assistant_text=message or raw_text,
        )
        return finalized

    def _persist_response_artifact(
        self,
        req: STTMBuilderEnvelopeRequest,
        response: STTMBuilderResponse,
        *,
        continuity: ConversationPreparation | None = None,
    ) -> str | None:
        """Persist attributable runtime output without adding request-path retrieval."""
        try:
            response_payload = response.model_dump(mode="json", exclude_none=True)
            used_inference_ids: set[str] = set()
            used_recommendation_ids: set[str] = set()
            learning = req.context.learning_context
            result = response_payload.get("data", {}).get("result") or response_payload.get("result") or {}
            candidates: list[dict[str, Any]] = []
            if isinstance(result, dict):
                mappings = result.get("mappings")
                if isinstance(mappings, dict):
                    candidates.extend(item for item in mappings.values() if isinstance(item, dict))
                rules = result.get("rules")
                if isinstance(rules, list):
                    candidates.extend(item for item in rules if isinstance(item, dict))
            for item in candidates:
                used_inference_ids.update(str(value) for value in item.get("used_inference_ids") or [] if value)
                used_recommendation_ids.update(str(value) for value in item.get("used_recommendation_ids") or [] if value)
            workspace = req.context.workspace_context
            execution = req.context.execution_context
            context_key = (execution.context_key if execution else None) or (workspace.context_key if workspace else "")
            snapshot_id = (execution.snapshot_id if execution else None) or (workspace.snapshot_id if workspace else None)
            artifact_type = str(
                response_payload.get("data", {}).get("artifact_type")
                or response_payload.get("artifact_type")
                or req.data.intent.value.lower()
            )
            agent_name = str(
                response_payload.get("data", {}).get("agent")
                or response_payload.get("agent")
                or self._resolved_agent_name(req)
            )
            artifact_id = self._conversation_memory.record_agent_artifact(
                request_id=req.request_id,
                session_id=req.context.session_id,
                thread_id=response.thread_id,
                agent_name=agent_name,
                artifact_type=artifact_type,
                payload=response_payload,
                artifact_status="completed" if response.error is None else "failed",
                entity_type="sttm",
                entity_ids=[value for value in (req.context.project_id, req.context.sttm_id) if value],
                semantic_bundle_id=req.context.semantic_bundle_id,
                semantic_bundle_hash=(
                    req.context.semantic_bundle_hash
                    or (workspace.semantic.bundle_hash if workspace else None)
                ),
                summary=str(response.message or "")[:1000],
                created_by=req.actor.user_id if req.actor else None,
                logical_conversation_id=(
                    continuity.logical_conversation_id
                    if continuity is not None
                    else req.context.logical_conversation_id
                ),
                thread_segment=(
                    continuity.segment_number
                    if continuity is not None
                    else req.context.physical_thread_segment
                ),
                project_id=req.context.project_id,
                mapping_id=req.context.sttm_id,
                access_fingerprint=hashlib.sha256(
                    str(req.actor.user_id if req.actor else "").encode("utf-8")
                ).hexdigest(),
                context_key=context_key,
                snapshot_id=snapshot_id,
                retrieved_inference_ids=(
                    execution.retrieved_inference_ids if execution else
                    learning.retrieved_inference_ids if learning else []
                ),
                retrieved_recommendation_ids=(
                    execution.retrieved_recommendation_ids if execution else
                    learning.retrieved_recommendation_ids if learning else []
                ),
                used_inference_ids=sorted(used_inference_ids),
                used_recommendation_ids=sorted(used_recommendation_ids),
            )
            for recommendation_id in used_recommendation_ids:
                self._conversation_memory.record_fir_recommendation_outcome(
                    recommendation_id=recommendation_id,
                    outcome_type="used",
                    context_key=context_key,
                    snapshot_id=snapshot_id,
                    request_id=req.request_id,
                    artifact_id=artifact_id,
                    user_id=req.actor.user_id if req.actor else None,
                    payload={"agent_name": agent_name, "artifact_type": artifact_type},
                )
            return artifact_id
        except Exception as exc:  # pragma: no cover - FIR audit cannot block an agent response
            logger.warning("Could not persist FIR-attributed agent artifact for %s: %s", req.request_id, exc)
            return None

    @staticmethod
    def _attach_response_artifact_descriptor(
        response: STTMBuilderResponse,
        *,
        artifact_id: str | None,
        artifact_type: str,
    ) -> None:
        """Expose the durable handle without copying the artifact body into metadata."""

        if not artifact_id:
            return
        descriptors = list(response.meta.get("artifact_refs") or [])
        descriptor = {
            "artifact_id": artifact_id,
            "artifact_type": artifact_type,
            "summary": str(response.message or "")[:240],
        }
        if not any(
            isinstance(item, dict) and item.get("artifact_id") == artifact_id
            for item in descriptors
        ):
            descriptors.append(descriptor)
        response.meta = {**response.meta, "artifact_refs": descriptors}

    async def invoke_auto_map_parallel(
        self,
        req: STTMBuilderEnvelopeRequest,
        *,
        governance_decision: GovernanceDecision | None = None,
        max_concurrency: int | None = None,
    ) -> STTMBuilderResponse:
        if req.data.intent != Interface.AUTO_MAP:
            return self.invoke(req, governance_decision=governance_decision)

        attributes = list(req.data.attributes or [])
        logger.info(
            "Auto-map worker invoking source-mapping agent once for request_id=%s "
            "batch_attributes=%s",
            req.request_id,
            len(attributes),
        )
        response = await asyncio.to_thread(
            self.invoke,
            req,
            governance_decision=governance_decision,
        )
        transformation_started = time.perf_counter()
        response = await self._apply_complex_transformation_stage(
            req,
            response,
            governance_decision=governance_decision,
        )
        transformation_ms = (time.perf_counter() - transformation_started) * 1000
        response.meta = {
            **(response.meta or {}),
            "auto_mapping_worker": {
                **((response.meta or {}).get("auto_mapping_worker") or {}),
                "delegated": True,
                "batch_size": len(attributes),
                "batch_strategy": "single_agent_batch_call",
                "legacy_per_attribute_parallelism": False,
                "requested_max_concurrency": max_concurrency
                or self._settings.auto_mapping_worker_max_concurrency,
                "selective_transformation_stage_ms": round(transformation_ms, 1),
            },
        }
        return response

    async def _apply_complex_transformation_stage(
        self,
        req: STTMBuilderEnvelopeRequest,
        response: STTMBuilderResponse,
        *,
        governance_decision: GovernanceDecision | None,
    ) -> STTMBuilderResponse:
        result = response.data.result if response.data else response.result
        if not isinstance(result, SourceMappingResult):
            return response
        attributes_by_target: dict[str, TargetAttributeItem] = {}
        for attribute in req.data.attributes or []:
            attributes_by_target[attribute.target_attribute.upper()] = attribute
            attributes_by_target[
                f"{attribute.target_table.qualified_name}.{attribute.target_attribute}".upper()
            ] = attribute
        complex_targets: list[str] = []
        for target, mapping in result.mappings.items():
            classification = mapping.transformation_classification
            rule_type = str(mapping.preprocessing_rule_type or "").upper()
            novel = mapping.precedent_decision in {"override_precedent", "unresolved", None}
            if novel and (classification == "complex" or rule_type == "CUSTOM"):
                complex_targets.append(target)
        if not complex_targets:
            return response

        transform_attributes = []
        for target in complex_targets:
            original = attributes_by_target.get(target.upper()) or attributes_by_target.get(
                target.rsplit(".", 1)[-1].upper()
            )
            mapping = result.mappings[target]
            if original is None:
                continue
            source_mappings: list[AttributeRef] = []
            for source in mapping.source_attributes:
                qualifier, separator, column = source.rpartition(".")
                parts = qualifier.split(".") if separator else []
                if len(parts) == 3 and column:
                    source_mappings.append(
                        AttributeRef(
                            table=TableRef(database=parts[0], schema=parts[1], table=parts[2]),
                            attribute=column,
                        )
                    )
            transform_attributes.append(
                original.model_copy(update={"source_mappings": source_mappings or None})
            )
        if not transform_attributes:
            return response

        transform_req = req.model_copy(
            update={
                "operation": STTMOperation.TRANSFORM,
                "context": req.context.model_copy(
                    update={
                        "routing_hint": _INTENT_ROUTE_TRANSFORMATION,
                        "prepared_context_hash": None,
                    }
                ),
                "data": req.data.model_copy(
                    update={
                        "intent": Interface.TRANSFORM,
                        "intent_route": _INTENT_ROUTE_TRANSFORMATION,
                        "attributes": transform_attributes,
                        "message": (
                            "Generate only attribute-level expressions for the novel complex "
                            "mappings selected by AGT_SOURCE_MAPPING. Preserve compiler-owned joins."
                        ),
                    }
                ),
                "meta": {**req.meta, "auto_map_stage": "complex_transformation"},
            }
        )
        transform_response = await asyncio.to_thread(
            self.invoke,
            transform_req,
            governance_decision=governance_decision,
        )
        transform_result = (
            transform_response.data.result
            if transform_response.data
            else transform_response.result
        )
        if not isinstance(transform_result, TransformationResult):
            return response.model_copy(
                update={
                    "warnings": [
                        *response.warnings,
                        ApiWarning(
                            code="AUTO_MAP_TRANSFORMATION_STAGE_SKIPPED",
                            message="The complex transformation stage returned no validated rules.",
                        ),
                    ]
                }
            )
        rule_by_target = {
            rule.target_attribute.rsplit(".", 1)[-1].upper(): rule
            for rule in transform_result.rules
        }
        merged = dict(result.mappings)
        for target in complex_targets:
            rule = rule_by_target.get(target.rsplit(".", 1)[-1].upper())
            if rule is None:
                continue
            current = merged[target]
            merged[target] = current.model_copy(
                update={
                    "preprocessing_rule": rule.rule,
                    "preprocessing_rule_type": "Custom",
                    "preprocessing_nl_rule": rule.description,
                    "transformation_classification": "complex",
                    "used_inference_ids": sorted(
                        {*current.used_inference_ids, *rule.used_inference_ids}
                    ),
                    "used_recommendation_ids": sorted(
                        {*current.used_recommendation_ids, *rule.used_recommendation_ids}
                    ),
                }
            )
        merged_result = SourceMappingResult(mappings=merged)
        merged_data = response.data.model_copy(update={"result": merged_result}) if response.data else None
        return response.model_copy(
            update={
                "data": merged_data,
                "result": merged_result,
                "warnings": [*response.warnings, *transform_response.warnings],
                "meta": {
                    **response.meta,
                    "transformation_stage": {
                        "target_count": len(transform_attributes),
                        "agent": "AGT_TRANSFORMATION_RULE",
                    },
                },
            }
        )

    def prepare_auto_map_request(
        self,
        req: STTMBuilderEnvelopeRequest,
    ) -> STTMBuilderEnvelopeRequest:
        """Resolve and validate one semantic bundle before worker fan-out.

        Also enriches the request with comprehensive learning context from FIR.
        """
        req = self._with_intent_route(req)
        if req.data.intent != Interface.AUTO_MAP:
            return req
        sanitized = self._sanitize_request_semantic_context(req)
        semantic_started = time.perf_counter()
        selected_relationships = list(sanitized.context.relationships or [])
        try:
            prepared, semantic_refresh = self._with_semantic_context(sanitized)
        except SemanticRelationshipInvalidError as exc:
            # Cortex Analyst requires a provably unique right-hand relationship,
            # while source mapping can still reason over an explicit selected join.
            # Build the table/column semantic context without publishing the join,
            # then restore the join for AGT_SOURCE_MAPPING and FIR evidence.
            semantic_only = sanitized.model_copy(
                update={
                    "context": sanitized.context.model_copy(
                        update={"relationships": []}
                    )
                }
            )
            prepared, semantic_refresh = self._with_semantic_context(semantic_only)
            prepared = prepared.model_copy(
                update={
                    "context": prepared.context.model_copy(
                        update={"relationships": selected_relationships}
                    ),
                    "warnings": [
                        *prepared.warnings,
                        ApiWarning(
                            code="AUTO_MAP_RELATIONSHIP_NOT_PUBLISHED",
                            message=(
                                "Selected joins were passed directly to source mapping, "
                                "but were omitted from the Cortex Analyst semantic view "
                                f"because uniqueness could not be proven: {exc}"
                            ),
                            field="context.relationships",
                        ),
                    ],
                    "meta": {
                        **prepared.meta,
                        "auto_map_relationship_mode": "direct_selected_relationships",
                    },
                }
            )
        if semantic_refresh is None and not self._should_bypass_semantic_refresh(prepared):
            raise SemanticAssetNotFoundError(
                "Auto-map requires selected source/target tables with published semantic assets."
            )

        semantic_ms = (time.perf_counter() - semantic_started) * 1000
        prepared = attach_agent_execution_context(prepared, self._conversation_memory)
        learning_started = time.perf_counter()
        prepared = self._with_learning_context(prepared)
        learning_ms = (time.perf_counter() - learning_started) * 1000
        prepared = attach_agent_execution_context(prepared, self._conversation_memory)
        execution = prepared.context.execution_context
        settings = getattr(self, "_settings", None)
        return prepared.model_copy(
            update={
                "meta": {
                    **prepared.meta,
                    "agent_spec_hashes": {
                        "AGT_SOURCE_MAPPING": getattr(
                            settings, "agent_spec_source_mapping_sha256", ""
                        ),
                        "AGT_TRANSFORMATION_RULE": getattr(
                            settings, "agent_spec_transformation_rule_sha256", ""
                        ),
                    },
                    "context_diagnostics": {
                        "context_hash": prepared.context.prepared_context_hash,
                        "semantic_bundle_id": prepared.context.semantic_bundle_id,
                        "semantic_bundle_label": prepared.context.semantic_bundle_label,
                        "semantic_view_name": prepared.context.semantic_view_name,
                        "retrieved_evidence_ids": execution.evidence_ids if execution else [],
                        "retrieved_recommendation_ids": (
                            execution.retrieved_recommendation_ids if execution else []
                        ),
                        "retrieved_precedent_ids": (
                            prepared.context.learning_context.linked_mapping_ids
                            if prepared.context.learning_context
                            else []
                        ),
                        "timings_ms": {
                            "semantic_refresh": round(semantic_ms, 2),
                            "precedent_and_fir_retrieval": round(learning_ms, 2),
                        },
                    },
                }
            }
        )

    def _with_learning_context(
        self,
        req: STTMBuilderEnvelopeRequest,
    ) -> STTMBuilderEnvelopeRequest:
        """Enrich request with comprehensive learning context from FIR."""
        if req.context.prepared_context_hash and req.context.learning_context is not None:
            return req
        try:
            project_id = req.context.project_id or ""
            source_tables = [
                f"{t.database}.{t.schema}.{t.table}"
                for t in (req.context.source_tables or [])
            ]
            target_table = ""
            if req.context.target_table:
                t = req.context.target_table
                target_table = f"{t.database}.{t.schema}.{t.table}"
            target_columns = [
                attr.target_attribute
                for attr in (req.data.attributes or [])
            ]
            workspace = req.context.workspace_context
            target_agent = {
                Interface.AUTO_MAP: "AGT_SOURCE_MAPPING",
                Interface.TRANSFORM: "AGT_TRANSFORMATION_RULE",
                Interface.CHAT: "AGT_STTM_BUILDER",
            }[req.data.intent]

            learning_context = self._learning_service.get_comprehensive_learning_context(
                project_id=project_id,
                source_tables=source_tables,
                target_table=target_table,
                target_columns=target_columns,
                mapping_intent=req.context.mapping_intent,
                sttm_id=req.context.sttm_id,
                context_key=workspace.context_key if workspace else None,
                source_set_hash=workspace.source_set_hash if workspace else None,
                derived_set_hash=workspace.derived_set_hash if workspace else None,
                milestone=workspace.milestone if workspace else None,
                target_agent=target_agent,
            )

            if req.context.omit_linked_precedent:
                linked_ids = set(learning_context.linked_mapping_ids)
                learning_context = learning_context.model_copy(
                    update={
                        "similar_mappings": [
                            item
                            for item in learning_context.similar_mappings
                            if item.sttm_id not in linked_ids
                        ],
                        "linked_project_ids": [],
                        "linked_mapping_ids": [],
                        "linked_project_patterns": [],
                        "linked_mapping_precedents": [],
                        "mapping_precedents": [],
                        "retrieval_explanations": [
                            *learning_context.retrieval_explanations,
                            {
                                "source": "shadow_control",
                                "status": "linked_precedent_omitted",
                                "reason": (
                                    "Requested non-publishing shadow inference for measuring "
                                    "agent performance without exact linked-mapping reuse."
                                ),
                            },
                        ],
                    }
                )

            relation_graph = self._add_precedent_value_bindings(
                req.context.relation_graph,
                learning_context,
            )

            context_payload = learning_context.model_dump(mode="json", exclude_none=True)
            graph_payload = (
                relation_graph.model_dump(mode="json", exclude_none=True)
                if relation_graph is not None
                else None
            )
            prepared_context_hash = hashlib.sha256(
                json.dumps(
                    {
                        "semantic_bundle_id": req.context.semantic_bundle_id,
                        "semantic_bundle_label": req.context.semantic_bundle_label,
                        "omit_linked_precedent": req.context.omit_linked_precedent,
                        "replay_exact_precedent": req.context.replay_exact_precedent,
                        "relation_graph": graph_payload,
                        "learning_context": context_payload,
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                    default=str,
                ).encode("utf-8")
            ).hexdigest()
            return req.model_copy(
                update={
                    "context": req.context.model_copy(
                        update={
                            "learning_context": learning_context,
                            "relation_graph": relation_graph,
                            "prepared_context_hash": prepared_context_hash,
                        }
                    ),
                    "meta": {
                        **req.meta,
                        "prepared_context_hash": prepared_context_hash,
                        "learning_context_prepared": True,
                        "shadow_without_linked_precedent": req.context.omit_linked_precedent,
                    },
                }
            )
        except ContextPrecedentUnavailableError:
            raise
        except Exception as exc:
            logger.warning("Failed to enrich request with learning context: %s", exc)
            return req

    @staticmethod
    def _add_precedent_value_bindings(
        relation_graph: Any,
        learning_context: Any,
    ) -> Any:
        """Materialize linked-precedent placeholders as graph Value contracts.

        Historical mapping rows can use Values both as whole-target constants
        and inside multi-source expressions. The compiler and mapping agents
        share the relation graph as their legal namespace, so keeping those
        placeholders only inside precedent SQL makes the context incomplete.
        """
        if relation_graph is None or learning_context is None:
            return relation_graph
        existing = list(relation_graph.value_bindings)
        seen_values = {str(item.value).strip() for item in existing if item.value}
        additions: list[ValueBinding] = []
        placeholder_pattern = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*")
        for precedent in learning_context.mapping_precedents:
            for mapping in precedent.mappings:
                expressions = (
                    mapping.get("constant_value"),
                    mapping.get("preprocessing_rule"),
                )
                for expression in expressions:
                    for placeholder in placeholder_pattern.findall(str(expression or "")):
                        if placeholder in seen_values:
                            continue
                        seen_values.add(placeholder)
                        additions.append(
                            ValueBinding(
                                binding_id=(
                                    f"precedent:{precedent.precedent_sttm_id}:"
                                    f"{placeholder[1:]}"
                                ),
                                value=placeholder,
                                data_type="VARCHAR",
                                is_placeholder=True,
                                allow_project_specific_value=False,
                                resolution_status="placeholder_contract",
                            )
                        )
        if not additions:
            return relation_graph
        return relation_graph.model_copy(
            update={"value_bindings": [*existing, *additions]}
        )

    @staticmethod
    def _status_event(phase: str, message: str, **extra: Any) -> dict[str, Any]:
        """Build a status event payload with phase and message."""
        return {"phase": phase, "message": message, **extra}

    def invoke_stream(
        self,
        req: STTMBuilderEnvelopeRequest,
        *,
        governance_decision: GovernanceDecision | None = None,
    ) -> Iterator[str]:
        req = self._with_intent_route(req)
        req = self._sanitize_request_semantic_context(req)
        def emit(event: str, data: dict[str, Any]) -> str:
            return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"

        def out_event(legacy: str, v2: str) -> str:
            settings = getattr(self, "_settings", None)
            return v2 if bool(getattr(settings, "assistant_streaming_v2", False)) else legacy

        def iterator() -> Iterator[str]:
            decision = governance_decision or self._build_governance_decision(req)
            reusing_prefetched_context = self._should_reuse_prefetched_semantic_context(req)
            bypassing_semantic_refresh = self._should_bypass_semantic_refresh(req)

            # Phase 1: Initial preparation status. Do not imply that semantic
            # and FIR context are being rebuilt when the caller supplied the
            # reusable handles and payload.
            yield emit(
                out_event("status", "context.resolved"),
                self._status_event(
                    phase="preparing",
                    message=(
                        "Using the prepared workspace context."
                        if bypassing_semantic_refresh or reusing_prefetched_context
                        else "Preparing context for your request..."
                    ),
                ),
            )

            # Phase 2: Semantic context resolution
            if not bypassing_semantic_refresh and not reusing_prefetched_context:
                yield emit(
                    out_event("status", "activity.started"),
                    self._status_event(
                        phase="semantic",
                        message="Building semantic context from your selected tables...",
                    ),
                )

            try:
                req_with_context, semantic_refresh = self._with_semantic_context(req)
            except AppError as exc:
                yield emit(
                    "error",
                    self._stream_error_envelope(
                        req,
                        title=exc.message,
                        status=exc.status_code,
                        code=exc.code.value,
                    ),
                )
                return
            except Exception:
                logger.exception(
                    "Streaming semantic context resolution failed: request_id=%s operation=%s",
                    req.request_id,
                    req.operation.value,
                )
                yield emit(
                    "error",
                    self._stream_error_envelope(
                        req,
                        title="Semantic context resolution failed",
                        status=502,
                        code="SEMANTIC_CONTEXT_STREAM_ERROR",
                    ),
                )
                return
            try:
                req_with_context = self._govern_request_for_model(req_with_context, decision)
            except Exception:
                logger.exception(
                    "Streaming model-governance preparation failed: request_id=%s operation=%s",
                    req_with_context.request_id,
                    req_with_context.operation.value,
                )
                yield emit(
                    "error",
                    self._stream_error_envelope(
                        req_with_context,
                        title="Model request preparation failed",
                        status=502,
                        code="MODEL_REQUEST_PREPARATION_ERROR",
                    ),
                )
                return
            if semantic_refresh is not None:
                yield emit(
                    out_event("status", "activity.completed"),
                    self._status_event(
                        phase="semantic",
                        message=self._semantic_refresh_status_message(semantic_refresh),
                        bundle_id=semantic_refresh.bundle_id,
                        bundle_label=semantic_refresh.bundle_label,
                        semantic_level=semantic_refresh.achieved_level,
                        status=semantic_refresh.status,
                        semantic_view_name=semantic_refresh.semantic_view_name,
                    ),
                )

            # Phase 3: Learning context retrieval (for auto-map and source mapping)
            if req_with_context.data.intent == Interface.AUTO_MAP:
                yield emit(
                    out_event("status", "activity.started"),
                    self._status_event(
                        phase="learning",
                        message="Loading learning context from FIR...",
                    ),
                )

            if self._should_use_analyst(req_with_context, semantic_refresh):
                logger.info(
                    "Answering streaming STTM chat request with Cortex Analyst: request_id=%s surface=%s level=%s semantic_view=%s",
                    req_with_context.request_id,
                    req_with_context.context.surface.value,
                    req_with_context.context.semantic_level_requested.value,
                    getattr(semantic_refresh, "semantic_view_name", None),
                )
                yield emit(
                    out_event("status", "activity.started"),
                    {
                        "phase": "analyst_started",
                        "message": "Cortex Analyst is generating SQL from the saved source and target semantic bundle.",
                        "semantic_view_name": semantic_refresh.semantic_view_name,
                    },
                )
                try:
                    analyst_question = self._build_analyst_question(req_with_context)
                    text_parts: list[str] = []
                    sql_parts: list[str] = []
                    suggestion_parts: dict[int, list[str]] = {}
                    analyst_warnings: list[dict[str, Any]] = []
                    analyst_metadata: dict[str, Any] = {}
                    analyst_request_id: str | None = None
                    verified_query_used: dict[str, Any] | None = None
                    raw_events: list[dict[str, Any]] = []
                    status_labels = {
                        "interpreting_question": "Interpreting the business question.",
                        "generating_sql": "Generating SQL from the prepared semantic context.",
                        "validating_sql": "Validating the generated SQL.",
                        "generating_suggestions": "Preparing relevant follow-up suggestions.",
                    }
                    for analyst_event, analyst_payload in self._analyst.stream_events(
                        question=analyst_question,
                        semantic_view=semantic_refresh.semantic_view_name,
                        semantic_model_yaml=(
                            None
                            if semantic_refresh.semantic_view_name
                            else getattr(semantic_refresh, "semantic_model_yaml", None)
                        ),
                    ):
                        if not isinstance(analyst_payload, dict):
                            continue
                        raw_events.append(
                            {"event": analyst_event, "data": analyst_payload}
                        )
                        request_id = analyst_payload.get("request_id")
                        if isinstance(request_id, str):
                            analyst_request_id = request_id
                        if analyst_event == "status":
                            status = str(
                                analyst_payload.get("status")
                                or analyst_payload.get("message")
                                or ""
                            ).strip()
                            yield emit(
                                out_event("status", "activity.progress"),
                                {
                                    "phase": "analyst_processing",
                                    "message": status_labels.get(
                                        status.lower().replace(" ", "_"),
                                        "Cortex Analyst is processing the prepared semantic model.",
                                    ),
                                    "upstream_status": status or None,
                                },
                            )
                            continue
                        if analyst_event in {"error", "response.error"}:
                            raise SnowflakeAgentError(
                                str(
                                    analyst_payload.get("message")
                                    or analyst_payload.get("error")
                                    or "Cortex Analyst stream failed."
                                )
                            )
                        if analyst_event == "warnings":
                            warnings = analyst_payload.get("warnings")
                            if isinstance(warnings, list):
                                analyst_warnings.extend(
                                    warning for warning in warnings if isinstance(warning, dict)
                                )
                            continue
                        if analyst_event == "response_metadata":
                            metadata = analyst_payload.get("response_metadata")
                            if isinstance(metadata, dict):
                                analyst_metadata.update(metadata)
                            continue

                        content = analyst_payload.get("content")
                        if not isinstance(content, dict):
                            content = analyst_payload
                        content_type = str(content.get("type") or "").lower()
                        text_delta = content.get("text_delta")
                        statement_delta = content.get("statement_delta")
                        if isinstance(text_delta, str) and text_delta:
                            text_parts.append(text_delta)
                            yield emit(
                                out_event("delta", "response.text.delta"),
                                {"text": text_delta},
                            )
                        if isinstance(statement_delta, str) and statement_delta:
                            sql_parts.append(statement_delta)
                            yield emit(
                                out_event("delta", "response.sql.delta"),
                                {"text": statement_delta},
                            )
                        suggestions_delta = content.get("suggestions_delta")
                        if isinstance(suggestions_delta, dict):
                            index = int(suggestions_delta.get("index") or 0)
                            suggestion_delta = suggestions_delta.get("suggestion_delta")
                            if isinstance(suggestion_delta, str) and suggestion_delta:
                                suggestion_parts.setdefault(index, []).append(suggestion_delta)
                                yield emit(
                                    out_event("suggestions", "suggestions.delta"),
                                    {
                                        "index": index,
                                        "text": suggestion_delta,
                                        "items": [
                                            "".join(suggestion_parts[key])
                                            for key in sorted(suggestion_parts)
                                        ],
                                    },
                                )
                        verified = content.get("verified_query_used")
                        if isinstance(verified, dict):
                            verified_query_used = verified
                        if (
                            content_type == "text"
                            and isinstance(content.get("text"), str)
                            and not text_delta
                        ):
                            text_parts.append(content["text"])
                            yield emit(
                                out_event("delta", "response.text.delta"),
                                {"text": content["text"]},
                            )
                        if (
                            content_type == "sql"
                            and isinstance(content.get("statement"), str)
                            and not statement_delta
                        ):
                            sql_parts.append(content["statement"])
                            yield emit(
                                out_event("delta", "response.sql.delta"),
                                {"text": content["statement"]},
                            )
                    analyst_response = SnowflakeAnalystResponse(
                        request_id=analyst_request_id,
                        text="".join(text_parts).strip() or None,
                        sql="".join(sql_parts).strip() or None,
                        suggestions=[
                            "".join(suggestion_parts[key]).strip()
                            for key in sorted(suggestion_parts)
                            if "".join(suggestion_parts[key]).strip()
                        ],
                        warnings=analyst_warnings,
                        response_metadata=analyst_metadata,
                        raw_message={"stream_events": raw_events},
                        verified_query_used=verified_query_used,
                    )
                    response = self._invoke_analyst(
                        req_with_context,
                        semantic_refresh,
                        decision,
                        analyst_response_override=analyst_response,
                    )
                except Exception:
                    logger.exception("Streaming Cortex Analyst request failed")
                    yield emit(
                        out_event("error", "response.failed"),
                        self._stream_error_envelope(
                            req_with_context,
                            title="Cortex Analyst request failed",
                            status=502,
                            code="SNOWFLAKE_ANALYST_STREAM_ERROR",
                        ),
                    )
                    return
                response.meta = self._merge_agent_meta(
                    response.meta,
                    {
                        "routing": {
                            "bypassed_agent_orchestrator": True,
                            "reason": "oauth_safe_direct_analyst_path",
                        },
                    },
                )
                yield emit(
                    out_event("final", "response.completed"),
                    response.model_dump(mode="json"),
                )
                return

            user_text = self._build_agent_payload(req_with_context)
            continuity = self._prepare_conversation_continuity(
                req_with_context,
                user_text,
            )
            messages = self._messages_with_continuity(user_text, continuity)
            local_thread_id = None
            if continuity is not None and continuity.checkpoint_artifact_id:
                yield emit(
                    out_event("thread_checkpointed", "thread.checkpointed"),
                    {
                        "logical_conversation_id": continuity.logical_conversation_id,
                        "segment": continuity.segment_number,
                        "artifact_id": continuity.checkpoint_artifact_id,
                    },
                )
            if continuity is not None and continuity.rolled_over:
                yield emit(
                    out_event("thread_rolled_over", "thread.rolled_over"),
                    {
                        "logical_conversation_id": continuity.logical_conversation_id,
                        "segment": continuity.segment_number,
                        "reason": continuity.rollover_reason,
                    },
                )
            self._model_guard.assert_model_target_allowed(
                operation=req_with_context.operation.value,
                target="agent",
                decision=decision,
            )
            thread_id_to_use = (
                None
                if self._should_reset_thread(req_with_context)
                else (
                    continuity.physical_thread_id
                    if continuity is not None
                    else req_with_context.context.thread_id
                )
            )
            parent_message_id_to_use = (
                None if thread_id_to_use is None else req_with_context.context.parent_message_id
            )
            # Phase 4: Sending request to AI agent
            yield emit(
                out_event("status", "activity.started"),
                self._status_event(
                    phase="invoking",
                    message="Sending request to AI agent...",
                    bundle_id=req_with_context.context.semantic_bundle_id,
                    semantic_level=req_with_context.context.semantic_level_requested,
                ),
            )

            yield emit(
                out_event("status", "activity.progress"),
                self._status_event(
                    phase="processing",
                    message=(
                        "AI is analyzing your tables and generating mapping suggestions..."
                        if req_with_context.data.intent == Interface.AUTO_MAP
                        else "AI is analyzing your request..."
                    ),
                    bundle_id=req_with_context.context.semantic_bundle_id,
                    semantic_level=req_with_context.context.semantic_level_requested,
                ),
            )

            final_payload: dict[str, Any] | None = None
            resolved_thread_id = thread_id_to_use
            resolved_parent_message_id = parent_message_id_to_use
            text_parts: list[str] = []
            visible_text = _StructuredAnswerDeltaFilter()

            try:
                def consume_stream(active_thread_id: str | None) -> Iterator[tuple[str, Any]]:
                    return self._agent.stream_events(
                        messages,
                        agent=self._resolved_agent_name(req_with_context),
                        thread_id=active_thread_id,
                        parent_message_id=resolved_parent_message_id if active_thread_id else None,
                    )

                try:
                    stream_iterator = _iter_agent_events_with_heartbeat(
                        consume_stream(thread_id_to_use)
                    )
                    for event_name, payload in stream_iterator:
                        if event_name == "__heartbeat__":
                            elapsed = payload.get("elapsed_seconds", 0)
                            # Vary the message based on elapsed time for better UX
                            if elapsed < 5:
                                heartbeat_message = "AI is analyzing your tables..."
                            elif elapsed < 15:
                                heartbeat_message = "Still working on your request..."
                            else:
                                heartbeat_message = "This is taking a bit longer than usual. Please wait..."
                            yield emit(
                                out_event("status", "activity.progress"),
                                self._status_event(
                                    phase="processing",
                                    message=heartbeat_message,
                                    **payload,
                                ),
                            )
                            continue
                        potential_thread = _find_nested_string(payload, "thread_id")
                        if potential_thread:
                            resolved_thread_id = potential_thread
                        metadata = _extract_stream_message_metadata(event_name, payload)
                        if metadata and metadata["role"] == "assistant":
                            resolved_parent_message_id = metadata["message_id"]

                        delta = _extract_stream_text_delta(event_name, payload)
                        if delta:
                            text_parts.append(delta)
                            visible_delta = visible_text.push(delta)
                            if visible_delta:
                                yield emit(
                                    out_event("delta", "response.text.delta"),
                                    {"text": visible_delta},
                                )

                        suggestions = _extract_stream_suggestions(payload)
                        if suggestions:
                            yield emit(
                                out_event("suggestions", "suggestions.delta"),
                                {"items": suggestions},
                            )

                        status_message = _extract_stream_status(event_name, payload)
                        if status_message:
                            yield emit(
                                out_event("status", "activity.progress"),
                                {"phase": "agent_progress", "message": status_message},
                            )

                        response_payload = _extract_stream_response_payload(event_name, payload)
                        if response_payload is not None:
                            final_payload = response_payload
                except SnowflakeAgentError as exc:
                    if not self._should_retry_without_thread(exc, thread_id_to_use):
                        raise
                    logger.warning(
                        "Retrying Cortex Agent stream without thread after HTTP 400: request_id=%s thread_id=%s",
                        req_with_context.request_id,
                        thread_id_to_use,
                    )
                    continuity = self._prepare_conversation_continuity(
                        req_with_context,
                        user_text,
                        force_rollover_reason="expired_cortex_thread",
                    )
                    messages = self._messages_with_continuity(user_text, continuity)
                    resolved_thread_id = None
                    resolved_parent_message_id = None
                    text_parts = []
                    visible_text = _StructuredAnswerDeltaFilter()
                    final_payload = None
                    yield emit(
                        out_event("thread_rolled_over", "thread.rolled_over"),
                        {
                            "logical_conversation_id": (
                                continuity.logical_conversation_id
                                if continuity is not None
                                else req_with_context.context.logical_conversation_id
                            ),
                            "segment": continuity.segment_number if continuity else None,
                            "reason": "expired_cortex_thread",
                            "message": (
                                "The prior Cortex thread expired; the logical "
                                "conversation was checkpointed and continued."
                            ),
                        },
                    )
                    stream_iterator = _iter_agent_events_with_heartbeat(consume_stream(None))
                    for event_name, payload in stream_iterator:
                        if event_name == "__heartbeat__":
                            elapsed = payload.get("elapsed_seconds", 0)
                            if elapsed < 5:
                                heartbeat_message = "AI is analyzing your tables..."
                            elif elapsed < 15:
                                heartbeat_message = "Still working on your request..."
                            else:
                                heartbeat_message = "This is taking a bit longer than usual. Please wait..."
                            yield emit(
                                out_event("status", "activity.progress"),
                                self._status_event(
                                    phase="processing",
                                    message=heartbeat_message,
                                    **payload,
                                ),
                            )
                            continue
                        potential_thread = _find_nested_string(payload, "thread_id")
                        if potential_thread:
                            resolved_thread_id = potential_thread
                        metadata = _extract_stream_message_metadata(event_name, payload)
                        if metadata and metadata["role"] == "assistant":
                            resolved_parent_message_id = metadata["message_id"]

                        delta = _extract_stream_text_delta(event_name, payload)
                        if delta:
                            text_parts.append(delta)
                            visible_delta = visible_text.push(delta)
                            if visible_delta:
                                yield emit(
                                    out_event("delta", "response.text.delta"),
                                    {"text": visible_delta},
                                )

                        suggestions = _extract_stream_suggestions(payload)
                        if suggestions:
                            yield emit(
                                out_event("suggestions", "suggestions.delta"),
                                {"items": suggestions},
                            )

                        status_message = _extract_stream_status(event_name, payload)
                        if status_message:
                            yield emit(
                                out_event("status", "activity.progress"),
                                {"phase": "agent_progress", "message": status_message},
                            )

                        response_payload = _extract_stream_response_payload(event_name, payload)
                        if response_payload is not None:
                            final_payload = response_payload
            except Exception as exc:
                logger.exception("Streaming STTM agent request failed")
                yield emit(
                    out_event("error", "response.failed"),
                    self._stream_error_envelope(
                        req_with_context,
                        title="Cortex Agent request failed",
                        status=502,
                        code="SNOWFLAKE_AGENT_STREAM_ERROR",
                    ),
                )
                return

            # Phase 5: Finalizing response
            yield emit(
                out_event("status", "activity.completed"),
                self._status_event(
                    phase="finalizing",
                    message=(
                        "Preparing mapping suggestions..."
                        if req_with_context.data.intent == Interface.AUTO_MAP
                        else "Preparing response..."
                    ),
                ),
            )

            raw_payload = final_payload
            raw_text = _extract_stream_message_text(final_payload) or "".join(text_parts).strip()
            resolved_parent_message_id = _extract_assistant_message_id(final_payload) or resolved_parent_message_id
            response_thread_id = local_thread_id or resolved_thread_id or str(uuid.uuid4())
            if local_thread_id and req_with_context.data.intent == Interface.CHAT:
                self._store_local_chat_history(
                    thread_id=local_thread_id,
                    messages=messages,
                    assistant_text=raw_text,
                )
            response = self._build_chat_response(
                req_with_context,
                raw_text=raw_text,
                raw_payload=raw_payload,
                thread_id=response_thread_id,
                parent_message_id=None if local_thread_id else resolved_parent_message_id,
                semantic_refresh=semantic_refresh,
            )
            analyst_delegation = self._analyst_delegation(response)
            if analyst_delegation is not None:
                yield emit(
                    out_event("status", "tool.started"),
                    self._status_event(
                        phase="analyst_execution",
                        message="Querying the selected data with Cortex Analyst.",
                    ),
                )
                response = self._execute_requested_analyst_delegation(
                    req_with_context,
                    response,
                    semantic_refresh=semantic_refresh,
                    decision=decision,
                )
                yield emit(
                    out_event("status", "tool.completed"),
                    self._status_event(
                        phase="analyst_execution",
                        message="Cortex Analyst returned the data result.",
                    ),
                )
            response = self._postflight_guard.finalize_sttm_response(response, decision)
            response.meta = self._merge_agent_meta(
                response.meta,
                {
                    "logical_conversation_id": (
                        continuity.logical_conversation_id if continuity else None
                    ),
                    "thread_segment": continuity.segment_number if continuity else None,
                    "thread_rolled_over": continuity.rolled_over if continuity else False,
                    "rollover_reason": continuity.rollover_reason if continuity else None,
                },
            )
            response_artifact_id = self._persist_response_artifact(
                req_with_context,
                response,
                continuity=continuity,
            )
            response_artifact_type = str(
                response.data.artifact_type.value
                if response.data is not None
                else req_with_context.data.intent.value.lower()
            )
            self._attach_response_artifact_descriptor(
                response,
                artifact_id=response_artifact_id,
                artifact_type=response_artifact_type,
            )
            final_visible_text = self._visible_response_text(response)
            self._complete_conversation_continuity(
                continuity,
                physical_thread_id=response_thread_id,
                user_text=user_text,
                assistant_text=final_visible_text,
            )
            self._persist_continuity_turns(
                req_with_context,
                continuity,
                assistant_text=final_visible_text,
            )
            if local_thread_id and final_visible_text != raw_text:
                self._store_local_chat_history(
                    thread_id=local_thread_id,
                    messages=messages,
                    assistant_text=final_visible_text,
                )
            if continuity is not None and continuity.checkpoint_artifact_id:
                yield emit(
                    out_event("artifact_created", "artifact.created"),
                    {
                        "artifact_id": continuity.checkpoint_artifact_id,
                        "artifact_type": "thread_checkpoint",
                    },
                )
            if response_artifact_id:
                yield emit(
                    out_event("artifact_created", "artifact.created"),
                    {
                        "artifact_id": response_artifact_id,
                        "artifact_type": response_artifact_type,
                    },
                )
            yield emit(
                out_event("final", "response.completed"),
                response.model_dump(mode="json"),
            )

        def guarded_iterator() -> Iterator[str]:
            """Keep an application failure from looking like a successful empty SSE response.

            StreamingResponse sends the HTTP headers before this generator has finished.
            Without this outer boundary, an exception in any final response enrichment step
            closes the socket with HTTP 200 and the browser can only report an unexplained EOF.
            """
            try:
                yield from iterator()
            except Exception:
                logger.exception(
                    "Unhandled STTM stream failure: request_id=%s operation=%s",
                    req.request_id,
                    req.operation.value,
                )
                yield emit(
                    out_event("error", "response.failed"),
                    self._stream_error_envelope(
                        req,
                        title="The assistant stream ended unexpectedly",
                        status=502,
                        code="STTM_STREAM_INCOMPLETE",
                    ),
                )

        return guarded_iterator()

    @staticmethod
    def _stream_error_envelope(
        req: STTMBuilderEnvelopeRequest,
        *,
        title: str,
        status: int,
        code: str,
    ) -> dict[str, Any]:
        return {
            "contract_version": "1.0",
            "request_id": req.request_id,
            "operation": req.operation.value,
            "data": None,
            "warnings": [],
            "error": {
                "type": "about:blank",
                "title": title,
                "status": status,
                "detail": title,
                "code": code,
            },
            "message": title,
        }

    @staticmethod
    def _build_governance_decision(req: STTMBuilderEnvelopeRequest) -> GovernanceDecision:
        guardrails_meta = dict(req.meta.get("guardrails") or {})
        return GovernanceDecision(
            trace_id=str(req.context.trace_id or guardrails_meta.get("trace_id") or uuid.uuid4()),
            request_id=req.request_id,
            operation=req.operation.value,
            persona=guardrails_meta.get("persona"),
            redaction_count=int(guardrails_meta.get("redaction_count") or 0),
            detected_pii=list(guardrails_meta.get("detected_pii") or []),
        )

    @staticmethod
    def _govern_request_for_model(
        req: STTMBuilderEnvelopeRequest,
        decision: GovernanceDecision,
    ) -> STTMBuilderEnvelopeRequest:
        guardrails_meta = dict(req.meta.get("guardrails") or {})
        policy = dict(guardrails_meta.get("policy") or {})
        if policy.get("allow_sample_rows", False):
            return req

        payload = req.model_dump(mode="python")
        context = dict(payload.get("context") or {})
        for key in ("semantic_context", "datahub_context", "derived_source_lineage"):
            if key in context:
                from app.guardrails.adapters.snowflake import strip_sample_data

                context[key] = strip_sample_data(context[key])
        payload["context"] = context
        decision.add_warning(
            "MODEL_CONTEXT_SANITIZED",
            "Sample data was removed from model-facing context after semantic enrichment.",
        )
        return STTMBuilderEnvelopeRequest.model_validate(payload)

    def _with_semantic_context(
        self,
        req: STTMBuilderEnvelopeRequest,
    ) -> tuple[STTMBuilderEnvelopeRequest, Any | None]:
        if self._should_bypass_semantic_refresh(req):
            return req, self._prefetched_semantic_refresh(req)
        if self._should_reuse_prefetched_semantic_context(req):
            return req, self._prefetched_semantic_refresh(req)
        source_tables = req.context.source_tables or []
        selected_derived_sources = req.context.selected_derived_sources or []
        target_table = req.context.target_table
        if not source_tables and not selected_derived_sources and target_table is None:
            return req, None
        route = req.data.intent_route or req.context.routing_hint or classify_sttm_intent_route(req)
        should_resolve = (
            bool(source_tables or selected_derived_sources or target_table is not None)
            or req.data.intent in {Interface.AUTO_MAP, Interface.TRANSFORM}
            or route in {
                _INTENT_ROUTE_RAG,
                _INTENT_ROUTE_ANALYST,
                _INTENT_ROUTE_SOURCE_MAPPING,
                _INTENT_ROUTE_TRANSFORMATION,
            }
            or req.context.surface in {
                SemanticSurface.DERIVED_SOURCE,
                SemanticSurface.MAPPING,
            }
            or self._is_derived_source_request(req)
            or self._is_analyst_sql_text((req.data.message or "").lower())
        )
        if should_resolve:
            return self._refresh_semantic_context_for_explicit_resolve(req)
        return req, None

    def _refresh_semantic_context_for_explicit_resolve(
        self,
        req: STTMBuilderEnvelopeRequest,
    ) -> tuple[STTMBuilderEnvelopeRequest, Any]:
        """Create/refresh a bundle only on explicit semantic-context endpoints, never on chat."""
        source_tables = req.context.source_tables or []
        selected_derived_sources = req.context.selected_derived_sources or []
        requested_level = self._determine_semantic_level(req)
        semantic_refresh = self._semantic_context_service.refresh_bundle(
            SemanticContextRefreshRequest(
                selected_source_tables=source_tables,
                selected_derived_sources=selected_derived_sources,
                target_table=req.context.target_table,
                relationships=[
                    item.model_dump(mode="json") if hasattr(item, "model_dump") else item
                    for item in (req.context.relationships or [])
                ],
                selected_columns_by_table=req.context.selected_columns_by_table or {},
                requested_level=requested_level,
                force=False,
            ),
        )
        normalized_semantic_context = self._normalize_nested_semantic_context(
            semantic_context=semantic_refresh.semantic_context,
            semantic_view_name=semantic_refresh.semantic_view_name,
            semantic_bundle_id=semantic_refresh.bundle_id,
        )
        workspace_context = req.context.workspace_context
        if workspace_context is not None:
            summary = semantic_refresh.summary
            workspace_context = workspace_context.model_copy(
                update={
                    "semantic": workspace_context.semantic.model_copy(
                        update={
                            "bundle_id": semantic_refresh.bundle_id,
                            "bundle_hash": semantic_refresh.bundle_hash,
                            "bundle_label": semantic_refresh.bundle_label,
                            "level": semantic_refresh.achieved_level,
                            "status": semantic_refresh.status,
                            "view_name": semantic_refresh.semantic_view_name,
                            "composed_model_hash": getattr(summary, "composed_model_hash", None),
                            "asset_versions": getattr(summary, "asset_versions", {}) or {},
                        }
                    )
                }
            )
        context = req.context.model_copy(
            update={
                "semantic_context": [
                    SemanticContextItem.model_validate(item)
                    for item in normalized_semantic_context
                ],
                "semantic_bundle_id": semantic_refresh.bundle_id,
                "semantic_bundle_label": semantic_refresh.bundle_label,
                "semantic_view_name": semantic_refresh.semantic_view_name,
                "semantic_level_requested": semantic_refresh.achieved_level,
                "derived_source_lineage": [
                    item.model_dump(mode="json") for item in semantic_refresh.lineage
                ],
                "datahub_context": semantic_refresh.datahub_context,
                "workspace_context": workspace_context,
            }
        )
        return req.model_copy(update={"context": context}), semantic_refresh

    def _prefetched_semantic_refresh(self, req: STTMBuilderEnvelopeRequest) -> Any | None:
        if not req.context.semantic_bundle_id:
            return None
        requested_level = req.context.semantic_level_requested or SemanticLevel.FULL_REGISTRY
        workspace_semantic = (
            req.context.workspace_context.semantic
            if req.context.workspace_context is not None
            else None
        )
        semantic_model_yaml: str | None = None
        bundle_hash = (
            workspace_semantic.bundle_hash
            if workspace_semantic is not None
            else ""
        ) or ""
        bundle_label = req.context.semantic_bundle_label
        if not req.context.semantic_view_name:
            bundle = self._semantic_context_service.get_bundle(bundle_id=req.context.semantic_bundle_id)
            if bundle:
                candidate_yaml = bundle.get("semantic_model_yaml")
                if isinstance(candidate_yaml, str) and candidate_yaml.strip():
                    semantic_model_yaml = candidate_yaml
                bundle_hash = str(bundle.get("bundle_hash") or bundle_hash or "")
                bundle_label = str(bundle.get("bundle_label") or bundle_label or "")
        return SimpleNamespace(
            bundle_id=req.context.semantic_bundle_id,
            bundle_hash=bundle_hash,
            bundle_label=bundle_label,
            requested_level=requested_level,
            achieved_level=requested_level,
            status=SemanticBundleStatus.READY,
            semantic_view_name=req.context.semantic_view_name,
            semantic_model_yaml=semantic_model_yaml,
            lineage=[],
            datahub_context=req.context.datahub_context,
            promoted=False,
            cache_hit=True,
            summary={},
        )

    def resolve_usable_semantic_context(
        self,
        *,
        semantic_bundle_id: str | None,
        semantic_view_name: str | None,
    ) -> tuple[str | None, str | None]:
        resolved_bundle_id = (semantic_bundle_id or "").strip()
        resolved_view_name = (semantic_view_name or "").strip()
        if not resolved_bundle_id:
            return None, None
        if resolved_view_name:
            return resolved_bundle_id, resolved_view_name
        bundle = self._semantic_context_service.get_bundle(bundle_id=resolved_bundle_id)
        if not bundle:
            return None, None
        bundle_view_name = str(bundle.get("semantic_view_name") or "").strip()
        if not bundle_view_name:
            bundle_yaml = str(bundle.get("semantic_model_yaml") or "").strip()
            if bundle_yaml:
                return resolved_bundle_id, None
            return None, None
        return resolved_bundle_id, bundle_view_name

    def _sanitize_request_semantic_context(
        self,
        req: STTMBuilderEnvelopeRequest,
    ) -> STTMBuilderEnvelopeRequest:
        resolved_bundle_id, resolved_view_name = self.resolve_usable_semantic_context(
            semantic_bundle_id=req.context.semantic_bundle_id,
            semantic_view_name=req.context.semantic_view_name,
        )
        normalized_semantic_context = self._normalize_nested_semantic_context(
            semantic_context=req.context.semantic_context,
            semantic_view_name=resolved_view_name,
            semantic_bundle_id=resolved_bundle_id,
        )
        if (
            resolved_bundle_id == req.context.semantic_bundle_id
            and resolved_view_name == req.context.semantic_view_name
            and normalized_semantic_context == [
                item.model_dump(mode="json") if hasattr(item, "model_dump") else item
                for item in (req.context.semantic_context or [])
            ]
        ):
            return req
        return req.model_copy(
            update={
                "context": req.context.model_copy(
                    update={
                        "semantic_bundle_id": resolved_bundle_id,
                        "semantic_view_name": resolved_view_name,
                        "semantic_context": [
                            SemanticContextItem.model_validate(item)
                            for item in normalized_semantic_context
                        ],
                    }
                )
            }
        )

    @staticmethod
    def _normalize_nested_semantic_context(
        *,
        semantic_context: Any,
        semantic_view_name: str | None,
        semantic_bundle_id: str | None,
    ) -> list[dict[str, Any]]:
        if not isinstance(semantic_context, list):
            return []

        normalized_items: list[dict[str, Any]] = []
        for item in semantic_context:
            if hasattr(item, "model_dump"):
                item_dict = item.model_dump(mode="json")
            elif isinstance(item, dict):
                item_dict = dict(item)
            else:
                continue

            semantic_model = item_dict.get("semantic_model")
            if isinstance(semantic_model, dict):
                normalized_model = dict(semantic_model)
                nested_view = normalized_model.get("semantic_view")
                if isinstance(nested_view, dict):
                    normalized_view = dict(nested_view)
                    if semantic_view_name:
                        normalized_view["name"] = semantic_view_name
                        if semantic_bundle_id:
                            normalized_view["bundle_id"] = semantic_bundle_id
                        normalized_model["semantic_view"] = normalized_view
                    else:
                        normalized_model.pop("semantic_view", None)
                elif not semantic_view_name:
                    normalized_model.pop("semantic_view", None)
                item_dict["semantic_model"] = normalized_model

            normalized_items.append(item_dict)

        return normalized_items

    def _current_semantic_view_is_usable(
        self,
        req: STTMBuilderEnvelopeRequest,
    ) -> bool:
        resolved_bundle_id, resolved_view_name = self.resolve_usable_semantic_context(
            semantic_bundle_id=req.context.semantic_bundle_id,
            semantic_view_name=req.context.semantic_view_name,
        )
        return bool(resolved_bundle_id and resolved_view_name)

    @staticmethod
    def _should_reuse_prefetched_semantic_context(req: STTMBuilderEnvelopeRequest) -> bool:
        if not req.context.semantic_bundle_id:
            return False
        semantic_context = req.context.semantic_context or []
        if not semantic_context:
            return False
        if req.data.intent not in {
            Interface.AUTO_MAP,
            Interface.CHAT,
            Interface.TRANSFORM,
        }:
            return False
        requested_level = req.context.semantic_level_requested or SemanticLevel.FULL_REGISTRY
        minimum_level = (
            SemanticLevel.L3_MAPPING_ENRICHED
            if req.context.surface == SemanticSurface.MAPPING
            else SemanticLevel.L2_ANALYST_READY
        )
        return _SEMANTIC_LEVEL_ORDER.get(requested_level, 0) >= _SEMANTIC_LEVEL_ORDER.get(
            minimum_level,
            0,
        )

    @staticmethod
    def _should_bypass_semantic_refresh(req: STTMBuilderEnvelopeRequest) -> bool:
        return (
            req.data.intent == Interface.AUTO_MAP
            and req.context.surface == SemanticSurface.MAPPING
            and bool(req.context.semantic_bundle_id)
            and bool(req.context.semantic_context)
        )

    def _build_chat_response(
        self,
        req: STTMBuilderEnvelopeRequest,
        *,
        raw_text: str,
        raw_payload: dict[str, Any] | None,
        thread_id: str,
        parent_message_id: int | None,
        semantic_refresh: Any | None,
    ) -> STTMBuilderResponse:
        (
            sub_agent,
            result,
            message,
            warnings,
            error,
            meta,
            status,
            artifact_type,
            artifact,
            semantic_level_achieved,
            semantic_refresh_status,
        ) = self._parse_chat_response(raw_text, raw_payload)
        warnings = self._normalize_response_warnings(warnings)
        artifact_type, artifact = self._coerce_chat_artifact(
            req,
            artifact_type=artifact_type,
            artifact=artifact,
        )
        return STTMBuilderResponse.from_invocation(
            req,
            thread_id=thread_id,
            parent_message_id=parent_message_id,
            agent=sub_agent,
            result=result,
            message=self._sanitize_final_chat_message(message or raw_text.strip()),
            status=status,
            artifact_type=artifact_type or (
                STTMArtifactType.SEMANTIC_CONTEXT
                if semantic_refresh and sub_agent is None and result is None
                else STTMArtifactType.NONE
            ),
            artifact=artifact if artifact is not None else self._semantic_refresh_to_dict(semantic_refresh),
            semantic_level_achieved=semantic_level_achieved or (
                semantic_refresh.achieved_level if semantic_refresh else None
            ),
            semantic_refresh_status=semantic_refresh_status or (
                None if semantic_refresh is None else {
                    "bundle_id": semantic_refresh.bundle_id,
                    "bundle_hash": semantic_refresh.bundle_hash,
                    "bundle_label": semantic_refresh.bundle_label,
                    "requested_level": semantic_refresh.requested_level,
                    "achieved_level": semantic_refresh.achieved_level,
                    "status": semantic_refresh.status,
                    "semantic_view_name": semantic_refresh.semantic_view_name,
                    "promoted": semantic_refresh.promoted,
                    "cache_hit": semantic_refresh.cache_hit,
                    "stale_reason": None,
                }
            ),
            warnings=warnings,
            error=error,
            meta=self._merge_agent_meta(
                meta,
                raw_payload=raw_payload,
                artifact_type=artifact_type,
                artifact=artifact,
            ),
        )

    @staticmethod
    def _semantic_refresh_to_dict(semantic_refresh: Any | None) -> dict[str, Any] | None:
        if semantic_refresh is None:
            return None
        if hasattr(semantic_refresh, "model_dump"):
            return semantic_refresh.model_dump(mode="json")

        data: dict[str, Any] = {}
        for key in (
            "bundle_id",
            "bundle_hash",
            "bundle_label",
            "requested_level",
            "achieved_level",
            "status",
            "semantic_view_name",
            "semantic_model_yaml",
            "lineage",
            "datahub_context",
            "promoted",
            "cache_hit",
            "summary",
        ):
            if not hasattr(semantic_refresh, key):
                continue
            value = getattr(semantic_refresh, key)
            if hasattr(value, "model_dump"):
                value = value.model_dump(mode="json")
            elif isinstance(value, list):
                value = [
                    item.model_dump(mode="json") if hasattr(item, "model_dump") else item
                    for item in value
                ]
            elif hasattr(value, "value"):
                value = value.value
            data[key] = value
        return data

    @staticmethod
    def _visible_response_text(response: STTMBuilderResponse) -> str:
        """Return the finalized user-visible answer for conversation memory.

        The orchestrator response may be replaced by a delegated Analyst result.
        Persisting the pre-delegation text would make a follow-up turn forget the
        answer the user actually saw.
        """

        if response.message:
            return str(response.message).strip()
        if response.data is not None and response.data.message:
            return str(response.data.message).strip()
        artifact = response.data.artifact if response.data is not None else None
        if isinstance(artifact, dict) and artifact.get("answer_text"):
            return str(artifact["answer_text"]).strip()
        return ""

    @staticmethod
    def _normalize_response_warnings(warnings: list[Any] | None) -> list[ApiWarning]:
        normalized: list[ApiWarning] = []
        for index, warning in enumerate(warnings or []):
            if isinstance(warning, ApiWarning):
                normalized.append(warning)
                continue
            if isinstance(warning, dict):
                code = str(warning.get("code") or "AGENT_WARNING").strip() or "AGENT_WARNING"
                message = str(warning.get("message") or warning.get("detail") or warning).strip()
                if not message:
                    continue
                field_value = warning.get("field")
                normalized.append(
                    ApiWarning(
                        code=code,
                        message=message,
                        field=str(field_value) if field_value else None,
                    )
                )
                continue
            text = str(warning).strip()
            if not text:
                continue
            normalized.append(
                ApiWarning(
                    code=f"AGENT_WARNING_{index + 1}",
                    message=text,
                )
            )
        return normalized

    @staticmethod
    def _artifact_type_for_response(
        sub_agent: SubAgent | None,
        semantic_refresh: Any | None,
    ) -> STTMArtifactType:
        if sub_agent == SubAgent.SOURCE_MAPPING_AGENT:
            return STTMArtifactType.SOURCE_MAPPING
        if sub_agent == SubAgent.TRANSFORMATION_AGENT:
            return STTMArtifactType.TRANSFORMATION_RULES
        if semantic_refresh is not None:
            return STTMArtifactType.SEMANTIC_CONTEXT
        return STTMArtifactType.NONE

    @classmethod
    def _should_reset_thread(cls, req: STTMBuilderEnvelopeRequest) -> bool:
        if req.data.intent != Interface.CHAT:
            return True
        return False

    def _resolved_agent_name(self, req: STTMBuilderEnvelopeRequest) -> str:
        if req.data.intent == Interface.AUTO_MAP:
            return self._source_mapping_agent_name
        return self._agent_name

    def _prepare_conversation_continuity(
        self,
        req: STTMBuilderEnvelopeRequest,
        user_text: str,
        *,
        force_rollover_reason: str | None = None,
    ) -> ConversationPreparation | None:
        if req.data.intent != Interface.CHAT:
            return None
        try:
            return self._conversation_continuity.prepare(
                context=req.context,
                packed_request=user_text,
                request_id=req.request_id,
                user_id=req.actor.user_id if req.actor else None,
                force_rollover_reason=force_rollover_reason,
            )
        except Exception as exc:
            # Durable conversation memory improves continuity but must never
            # prevent the orchestrator from answering. This also keeps older
            # deployments usable while the conversation-segment DDL is being
            # bootstrapped or a configured metadata namespace is unavailable.
            if not getattr(self, "_continuity_warning_emitted", False):
                logger.warning(
                    "Conversation continuity is unavailable; continuing this "
                    "request without durable thread preparation: %s",
                    exc,
                )
                self._continuity_warning_emitted = True
            return None

    @staticmethod
    def _messages_with_continuity(
        user_text: str,
        continuity: ConversationPreparation | None,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        if continuity is not None and continuity.checkpoint_message:
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": continuity.checkpoint_message}
                    ],
                }
            )
            for turn in continuity.recent_turns:
                role = str(turn.get("role") or "user").lower()
                if role not in {"user", "assistant"}:
                    continue
                content = str(turn.get("content") or "").strip()
                if content:
                    messages.append(
                        {
                            "role": role,
                            "content": [{"type": "text", "text": content}],
                        }
                    )
        messages.append(
            {"role": "user", "content": [{"type": "text", "text": user_text}]}
        )
        return messages

    def _complete_conversation_continuity(
        self,
        continuity: ConversationPreparation | None,
        *,
        physical_thread_id: str | None,
        user_text: str,
        assistant_text: str,
    ) -> None:
        if continuity is None or not physical_thread_id:
            return
        self._conversation_continuity.complete(
            continuity,
            physical_thread_id=physical_thread_id,
            user_text=user_text,
            assistant_text=assistant_text,
        )

    def _persist_continuity_turns(
        self,
        req: STTMBuilderEnvelopeRequest,
        continuity: ConversationPreparation | None,
        *,
        assistant_text: str,
    ) -> None:
        """Persist compact user/assistant turns for restart-safe continuation.

        The complete packed agent request may contain semantic YAML, SQL, and FIR
        evidence. Those values are stored as content-addressed artifacts and context
        handles; the durable conversation log intentionally keeps only the user's
        visible message and the assistant's visible response.
        """

        if continuity is None:
            return
        try:
            user_message = str(req.data.message or "").strip()
            assistant_message = str(assistant_text or "").strip()
            common = {
                "conversation_id": continuity.logical_conversation_id,
                "request_id": req.request_id,
                "trace_id": req.context.trace_id,
                "route": str(req.context.routing_hint or "conversation"),
                "intent_class": req.data.intent.value,
                "citations": [],
                "guardrails_meta": {
                    "logical_conversation_id": continuity.logical_conversation_id,
                    "physical_thread_segment": continuity.segment_number,
                    "semantic_bundle_id": req.context.semantic_bundle_id,
                    "semantic_bundle_hash": req.context.semantic_bundle_hash,
                    "learning_context_id": req.context.learning_context_id,
                    "learning_context_hash": req.context.learning_context_hash,
                },
                "user_id": req.actor.user_id if req.actor else None,
            }
            if user_message:
                self._conversation_memory.record_turn(
                    role="user",
                    message=user_message,
                    **common,
                )
            if assistant_message:
                self._conversation_memory.record_turn(
                    role="assistant",
                    message=assistant_message,
                    **common,
                )
        except Exception as exc:  # pragma: no cover - continuity audit cannot block UX
            logger.warning(
                "Could not persist durable conversation turns for %s: %s",
                req.request_id,
                exc,
            )

    def _prepare_agent_messages(
        self,
        req: STTMBuilderEnvelopeRequest,
        user_text: str,
    ) -> tuple[list[dict[str, Any]], str | None]:
        user_message = {"role": "user", "content": [{"type": "text", "text": user_text}]}
        if not self._should_use_local_chat_history(req):
            return [user_message], None

        local_thread_id = req.context.thread_id or f"local-{uuid.uuid4()}"
        if self._should_reset_thread(req):
            _local_chat_threads.pop(local_thread_id, None)
        history = list(_local_chat_threads.get(local_thread_id, []))
        return [*history, user_message], local_thread_id

    def _store_local_chat_history(
        self,
        *,
        thread_id: str,
        messages: list[dict[str, Any]],
        assistant_text: str,
    ) -> None:
        stored_messages = list(messages)
        if assistant_text.strip():
            stored_messages.append(
                {
                    "role": "assistant",
                    "content": [{"type": "text", "text": assistant_text.strip()}],
                }
            )
        _local_chat_threads[thread_id] = stored_messages[-60:]

    def _should_use_local_chat_history(self, req: STTMBuilderEnvelopeRequest) -> bool:
        return self._settings.local_dev_auth_enabled and req.data.intent == Interface.CHAT

    def _run_agent_detailed(
        self,
        *,
        messages: list[dict[str, Any]],
        agent_name: str,
        thread_id: str | None,
        parent_message_id: int | None,
    ) -> tuple[str, str, dict[str, Any] | None]:
        try:
            return self._agent.run_detailed(
                messages,
                agent=agent_name,
                thread_id=thread_id,
                parent_message_id=parent_message_id,
            )
        except SnowflakeAgentError as exc:
            if not self._should_retry_without_thread(exc, thread_id):
                raise
            logger.warning(
                "Retrying Cortex Agent request without thread after HTTP 400: agent=%s thread_id=%s",
                agent_name,
                thread_id,
            )
            return self._agent.run_detailed(
                messages,
                agent=agent_name,
                thread_id=None,
                parent_message_id=None,
            )

    def _invoke_single_auto_map_attribute(
        self,
        req: STTMBuilderEnvelopeRequest,
    ) -> dict[str, Any]:
        user_text = self._build_agent_payload(req)
        messages, _ = self._prepare_agent_messages(req, user_text)
        started_at = time.perf_counter()
        raw_text, _, raw_payload = self._run_agent_detailed(
            messages=messages,
            agent_name=self._source_mapping_agent_name,
            thread_id=None,
            parent_message_id=None,
        )
        (
            sub_agent,
            result,
            message,
            warnings,
            error,
            meta,
            status,
            artifact_type,
            artifact,
            semantic_level_achieved,
            semantic_refresh_status,
        ) = self._parse_envelope(raw_text)
        if sub_agent != SubAgent.SOURCE_MAPPING_AGENT:
            raise SnowflakeAgentError(
                f"Expected SOURCE_MAPPING_AGENT response, received {sub_agent}"
            )
        if error is not None or status == STTMStatus.FAILED:
            error_message = (
                (error.detail or error.title)
                if error is not None
                else "Auto-map agent failed"
            )
            raise SnowflakeAgentError(
                error_message
            )
        if not isinstance(result, SourceMappingResult):
            raise SnowflakeAgentError("Auto-map agent returned no mapping result.")

        merged_meta = self._merge_agent_meta(
            {
                **(meta or {}),
                "timings_ms": {
                    "agent": round((time.perf_counter() - started_at) * 1000, 1),
                },
            },
            raw_payload=raw_payload,
            artifact_type=artifact_type,
            artifact=artifact,
        )
        return {
            "result": result,
            "message": message,
            "warnings": self._normalize_response_warnings(warnings),
            "meta": merged_meta,
            "semantic_level_achieved": semantic_level_achieved,
            "semantic_refresh_status": semantic_refresh_status,
        }

    @staticmethod
    def _should_retry_without_thread(
        exc: SnowflakeAgentError,
        thread_id: str | None,
    ) -> bool:
        if not thread_id:
            return False
        message = str(exc)
        return "Cortex Agent returned HTTP 400" in message

    @staticmethod
    def _semantic_refresh_status_message(semantic_refresh: Any) -> str:
        if semantic_refresh.cache_hit:
            return "Saved semantic assets resolved from the workbench registry."
        if semantic_refresh.status == SemanticBundleStatus.PARTIAL:
            return "Saved semantic assets are partially available. Continuing with the resolved registry context."
        if semantic_refresh.promoted and semantic_refresh.semantic_view_name:
            return (
                f"Semantic view {semantic_refresh.semantic_view_name} is ready from the registry."
            )
        return "Saved semantic context is ready from the registry."

    @staticmethod
    def _determine_semantic_level(req: STTMBuilderEnvelopeRequest) -> SemanticLevel:
        # The registry now stores AGT_SEMANTIC_MODEL_V2 output as the canonical
        # high-context asset. Runtime bundle composition is a read-only merge of
        # those assets, so any selected-table bundle should be treated as the
        # richest available semantic context rather than promoted through levels.
        if (
            req.context.source_tables
            or req.context.target_table is not None
            or req.context.selected_derived_sources
        ):
            return SemanticLevel.L3_MAPPING_ENRICHED
        requested = req.context.semantic_level_requested
        if requested != SemanticLevel.L1_CONTEXT:
            return requested
        if req.context.surface == SemanticSurface.MAPPING:
            return SemanticLevel.L3_MAPPING_ENRICHED
        text = (req.data.message or "").lower()
        if req.context.surface == SemanticSurface.DERIVED_SOURCE:
            return SemanticLevel.L2_ANALYST_READY
        if STTMBuilderService._is_derived_source_generation_text(text):
            return SemanticLevel.L2_ANALYST_READY
        if STTMBuilderService._is_analyst_sql_text(text):
            return SemanticLevel.L2_ANALYST_READY
        return SemanticLevel.L1_CONTEXT

    @staticmethod
    def _is_analyst_sql_text(text: str) -> bool:
        return any(
            token in text
            for token in (
                "sql",
                "query",
                "count",
                "sum",
                "average",
                "avg",
                "group by",
                "how many",
                "total ",
                "top ",
                "trend",
                "revenue",
                "show rows",
                "show records",
            )
        )

    @staticmethod
    def _is_derived_source_generation_text(text: str) -> bool:
        text = text.lower()
        subject_tokens = ("derived source", "derived sources", "derived table", "cte", "ctes")
        migration_source_tokens = (
            "reusable household-level source",
            "reusable household level source",
            "reusable source for",
            "migration source",
        )
        recommendation_tokens = ("advice", "advise", "recommend", "best", "which", "what should")
        explicit_generation_tokens = (
            "generate sql", "generate query", "generate those", "generate all",
            "build query", "build those", "write sql", "write query",
            "create it", "create this", "create those", "create now",
        )
        if any(token in text for token in recommendation_tokens) and not any(
            token in text for token in explicit_generation_tokens
        ):
            return False
        generation_tokens = (
            "create",
            "build",
            "generate",
            "write",
            "save",
            "make",
            "implement",
        )
        direct_tokens = (
            "generate sql",
            "generate query",
            "write sql",
            "write query",
            "build query",
            "create query",
        )
        if any(token in text for token in direct_tokens):
            return True
        if any(token in text for token in migration_source_tokens) and any(
            token in text for token in ("prepare", "create", "build", "generate", "make")
        ):
            return True
        if any(subject in text for subject in subject_tokens) and any(
            token in text for token in generation_tokens
        ):
            return True
        return any(token in text for token in ("generate those", "build those", "create those"))

    @classmethod
    def _is_derived_source_request(cls, req: STTMBuilderEnvelopeRequest) -> bool:
        if req.data.intent != Interface.CHAT:
            return False
        text = (req.data.message or "").lower()
        if req.context.surface == SemanticSurface.DERIVED_SOURCE:
            return True
        return cls._is_derived_source_generation_text(text)

    @classmethod
    def _coerce_chat_artifact(
        cls,
        req: STTMBuilderEnvelopeRequest,
        *,
        artifact_type: STTMArtifactType | None,
        artifact: dict[str, Any] | None,
    ) -> tuple[STTMArtifactType | None, dict[str, Any] | None]:
        if artifact is None or not cls._is_derived_source_request(req):
            return artifact_type, artifact
        def enrich_derived_contract(value: dict[str, Any]) -> dict[str, Any]:
            enriched = dict(value)
            business_request = (req.data.message or "").strip()
            enriched.setdefault("purpose", business_request or "Reusable derived source")
            enriched.setdefault("business_description", business_request)
            preview_rows = enriched.get("preview_rows")
            output_names: list[str] = []
            if isinstance(preview_rows, list) and preview_rows and isinstance(preview_rows[0], dict):
                output_names = [str(name) for name in preview_rows[0]]
            enriched.setdefault(
                "output_columns",
                [{"name": name, "data_type": "UNKNOWN"} for name in output_names],
            )
            enriched.setdefault(
                "column_semantics",
                [
                    {
                        "name": name,
                        "business_meaning": name.replace("_", " ").title(),
                        "semantic_source": "analyst_output_contract",
                    }
                    for name in output_names
                ],
            )
            return enriched

        if artifact_type == STTMArtifactType.ANALYST_ANSWER and artifact.get("sql_text"):
            enriched_artifact = enrich_derived_contract(artifact)
            enriched_artifact.setdefault("draft_kind", "analyst_generated")
            enriched_artifact.setdefault("open_in_builder", True)
            if suggestion := cls._suggest_derived_source_name(req.data.message or ""):
                enriched_artifact.setdefault("source_name_suggestion", suggestion)
            return STTMArtifactType.DERIVED_SOURCE_DRAFT, enriched_artifact
        if artifact_type == STTMArtifactType.DERIVED_SOURCE_DRAFT:
            enriched_artifact = enrich_derived_contract(artifact)
            enriched_artifact.setdefault("open_in_builder", True)
            if suggestion := cls._suggest_derived_source_name(req.data.message or ""):
                enriched_artifact.setdefault("source_name_suggestion", suggestion)
            return artifact_type, enriched_artifact
        return artifact_type, artifact

    @staticmethod
    def _suggest_derived_source_name(message: str) -> str | None:
        lowered = message.lower()
        phrase_map = [
            (r"\bmetadata mapping report\b", "metadata_mapping_report"),
            (r"\bbusiness attributes?\b", "business_attributes"),
            (r"\bproject status\b", "project_status"),
            (r"\bsource columns?\b", "source_columns"),
            (r"\battribute types?\b", "attribute_types"),
            (r"\btransformation logic\b", "transformation_logic"),
            (r"\bcalculation rules?\b", "calculation_rules"),
            (r"\bcustomer\b", "customer"),
            (r"\border[s]?\b", "orders"),
            (r"\brevenue\b", "revenue"),
        ]
        parts: list[str] = []
        for pattern, replacement in phrase_map:
            if re.search(pattern, lowered) and replacement not in parts:
                parts.append(replacement)

        if not parts:
            cleaned = lowered
            for token in (
                "derived source",
                "derived table",
                "create",
                "generate",
                "build",
                "show",
                "with",
                "that",
                "sql",
                "query",
            ):
                cleaned = cleaned.replace(token, " ")
            stop_words = {
                "a",
                "an",
                "the",
                "all",
                "and",
                "for",
                "their",
                "this",
                "from",
                "into",
                "using",
                "along",
                "include",
                "including",
                "about",
            }
            tokens = [
                token
                for token in re.split(r"[^a-z0-9]+", cleaned)
                if token and token not in stop_words
            ]
            parts = tokens[:5]

        cleaned = "_".join(parts).strip("_")
        if not cleaned:
            return None
        return cleaned[:64]

    @staticmethod
    def _sanitize_final_chat_message(message: str | None) -> str | None:
        if not isinstance(message, str):
            return message

        normalized = message.strip()
        if not normalized:
            return None

        derived_heading_match = re.search(
            r"(?im)^(?:#{1,3}\s*)?derived source\b",
            normalized,
        )
        if derived_heading_match and derived_heading_match.start() > 0:
            anchored = normalized[derived_heading_match.start() :].strip()
            if anchored:
                return anchored

        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", normalized) if part.strip()]
        if len(paragraphs) < 2:
            return normalized

        intro_pattern = re.compile(
            r"^(thank you|thanks|i['’]ll|i will|let me|now i['’]ll|perfect!? now|to answer|i can help)\b",
            re.IGNORECASE,
        )
        heading_pattern = re.compile(
            r"^(derived source\b|summary\b|query logic\b|purpose\b|use cases\b|what this bundle\b|selected tables\b|here['’]s\b|#{1,3}\s)",
            re.IGNORECASE,
        )

        kept: list[str] = []
        dropping = True
        for paragraph in paragraphs:
            first_line = next(
                (line.strip() for line in paragraph.splitlines() if line.strip()),
                "",
            )
            if dropping and intro_pattern.match(first_line):
                continue
            if dropping and heading_pattern.match(first_line):
                dropping = False
            elif dropping:
                dropping = False
            kept.append(paragraph)

        cleaned = "\n\n".join(kept).strip()
        return cleaned or normalized

    @staticmethod
    def _should_use_analyst(
        req: STTMBuilderEnvelopeRequest,
        semantic_refresh: Any | None,
    ) -> bool:
        """Return whether transport may intentionally bypass the orchestrator.

        Normal sidebar chat must always reach AGT_STTM_BUILDER.  Analyst is one
        of that agent's tools, not a frontend/backend keyword route.  The old
        keyword path bypassed the orchestrator for derived-source and broad SQL
        words, which made relationship/readiness/recommendation questions look
        like underspecified data questions.

        Keep a narrowly scoped escape hatch for internal, explicitly governed
        callers.  Browser requests never set it.
        """
        if req.data.intent != Interface.CHAT or semantic_refresh is None:
            return False
        if semantic_refresh.achieved_level not in {
            SemanticLevel.L2_ANALYST_READY,
            SemanticLevel.L3_MAPPING_ENRICHED,
            SemanticLevel.FULL_REGISTRY,
        }:
            return False
        if not (
            semantic_refresh.semantic_view_name
            or getattr(semantic_refresh, "semantic_model_yaml", None)
        ):
            return False
        return bool(req.meta.get("allow_direct_analyst_bypass"))

    @staticmethod
    def _analyst_delegation(
        response: STTMBuilderResponse,
    ) -> dict[str, Any] | None:
        """Return a validated orchestrator-requested Analyst delegation.

        Routing remains an AGT_STTM_BUILDER decision. This method deliberately
        does not inspect the user's words or infer intent in application code;
        it only executes the typed tool request returned by the orchestrator
        when a dynamic Analyst tool was unavailable in that agent run.
        """

        meta = response.meta if isinstance(response.meta, dict) else {}
        delegation = meta.get("delegation")
        if not isinstance(delegation, dict):
            return None
        if str(delegation.get("tool") or "").strip().upper() != "CORTEX_ANALYST":
            return None
        if delegation.get("requires_actual_rows") is not True:
            return None
        question = str(delegation.get("question") or "").strip()
        if not question:
            return None
        return {
            "tool": "CORTEX_ANALYST",
            "requires_actual_rows": True,
            "question": question,
            "reason": str(delegation.get("reason") or "").strip() or None,
        }

    def _execute_requested_analyst_delegation(
        self,
        req: STTMBuilderEnvelopeRequest,
        response: STTMBuilderResponse,
        *,
        semantic_refresh: Any | None,
        decision: GovernanceDecision,
    ) -> STTMBuilderResponse:
        delegation = self._analyst_delegation(response)
        if delegation is None:
            return response

        if semantic_refresh is None or not (
            getattr(semantic_refresh, "semantic_view_name", None)
            or getattr(semantic_refresh, "semantic_model_yaml", None)
        ):
            response.meta = self._merge_agent_meta(
                response.meta,
                {
                    "delegation": {
                        **delegation,
                        "status": "unavailable",
                        "detail": (
                            "The prepared workspace has no executable Analyst "
                            "semantic model for this selection."
                        ),
                    }
                },
            )
            return response

        delegated_req = req.model_copy(
            update={
                "data": req.data.model_copy(
                    update={"message": delegation["question"]}
                )
            }
        )
        analyst_response = self._invoke_analyst(
            delegated_req,
            semantic_refresh,
            decision,
        )
        analyst_response.meta = self._merge_agent_meta(
            analyst_response.meta,
            {
                "delegation": {
                    **delegation,
                    "status": "completed",
                    "decided_by": "AGT_STTM_BUILDER",
                    "executed_by": "CORTEX_ANALYST",
                },
                "orchestrator_thread_id": response.thread_id,
                "orchestrator_parent_message_id": response.parent_message_id,
            },
        )
        return analyst_response

    def _invoke_analyst(
        self,
        req: STTMBuilderEnvelopeRequest,
        semantic_refresh: Any,
        decision: GovernanceDecision | None = None,
        *,
        analyst_response_override: SnowflakeAnalystResponse | None = None,
    ) -> STTMBuilderResponse:
        effective_decision = decision or self._build_governance_decision(req)
        self._model_guard.assert_model_target_allowed(
            operation=req.operation.value,
            target="analyst",
            decision=effective_decision,
        )
        analyst_question = self._build_analyst_question(req)
        cache_key = hashlib.sha256(
            json.dumps(
                {
                    "actor": req.actor.model_dump(mode="json") if req.actor else None,
                    "bundle_id": getattr(semantic_refresh, "bundle_id", None),
                    "bundle_hash": getattr(semantic_refresh, "bundle_hash", None),
                    "semantic_view": getattr(semantic_refresh, "semantic_view_name", None),
                    "question": " ".join(analyst_question.lower().split()),
                },
                sort_keys=True,
                separators=(",", ":"),
                default=str,
            ).encode("utf-8")
        ).hexdigest()
        if not self._is_derived_source_request(req):
            with _ANALYST_RESPONSE_CACHE_LOCK:
                cached = _ANALYST_RESPONSE_CACHE.get(cache_key)
                if cached and time.monotonic() - cached[0] <= _ANALYST_RESPONSE_CACHE_TTL_SECONDS:
                    cached_response = cached[1].model_copy(deep=True)
                    thread_id = req.context.thread_id or cached_response.thread_id
                    cached_meta = dict(cached_response.meta)
                    cached_meta["analyst_cache"] = {
                        "status": "hit",
                        "age_ms": round((time.monotonic() - cached[0]) * 1000, 1),
                    }
                    return cached_response.model_copy(
                        update={
                            "request_id": req.request_id,
                            "operation": req.operation,
                            "actor": req.actor,
                            "context": req.context.model_copy(
                                update={
                                    "thread_id": thread_id,
                                    "parent_message_id": req.context.parent_message_id,
                                }
                            ),
                            "thread_id": thread_id,
                            "parent_message_id": req.context.parent_message_id,
                            "meta": cached_meta,
                        }
                    )
                if cached:
                    _ANALYST_RESPONSE_CACHE.pop(cache_key, None)
        analyst_response = analyst_response_override or self._analyst.ask(
            question=analyst_question,
            semantic_view=semantic_refresh.semantic_view_name,
            semantic_model_yaml=(
                None
                if semantic_refresh.semantic_view_name
                else getattr(semantic_refresh, "semantic_model_yaml", None)
            ),
        )
        self._model_guard.guard_sql(analyst_response.sql, effective_decision)
        preview_rows = (
            []
            if any(warning.code == "UNSAFE_SQL_ARTIFACT" for warning in effective_decision.warnings)
            else self._preview_sql_rows(analyst_response.sql)
        )
        warnings = [
            ApiWarning(code="ANALYST_WARNING", message=warning.get("message", "Cortex Analyst warning"))
            for warning in analyst_response.warnings
            if isinstance(warning, dict)
        ]
        artifact_type = STTMArtifactType.ANALYST_ANSWER
        artifact = {
            "answer_text": analyst_response.text,
            "sql_text": analyst_response.sql,
            "preview_rows": preview_rows,
            "semantic_view_name": semantic_refresh.semantic_view_name,
            "semantic_model_source": (
                "physical_view"
                if semantic_refresh.semantic_view_name
                else "registry_composed_yaml"
            ),
            "semantic_sql_used": bool(analyst_response.sql),
            "fallback_to_standard_sql": not bool(analyst_response.sql),
            "suggestions": analyst_response.suggestions,
            "request_id": analyst_response.request_id,
        }
        if analyst_response.verified_query_used:
            artifact["verified_query_used"] = analyst_response.verified_query_used
        if self._is_derived_source_request(req) and analyst_response.sql:
            artifact_type = STTMArtifactType.DERIVED_SOURCE_DRAFT
            artifact["draft_kind"] = "analyst_generated"
            artifact["open_in_builder"] = True
            if suggestion := self._suggest_derived_source_name(req.data.message or ""):
                artifact["source_name_suggestion"] = suggestion

        response_message = self._analyst_result_message(
            req,
            preview_rows,
        ) or analyst_response.text or (
            "Cortex Analyst generated SQL for the current semantic view."
            if analyst_response.sql
            else "Cortex Analyst could not generate an answer for this request."
        )
        meta = {
            "analyst": {
                "request_id": analyst_response.request_id,
                "response_metadata": analyst_response.response_metadata,
            }
        }
        thread_id = req.context.thread_id or f"analyst-{uuid.uuid4()}"
        error = None
        if not analyst_response.sql and not analyst_response.text:
            error = ApiError(
                title="Cortex Analyst returned no answer",
                detail="No text or SQL was returned for the request.",
                code="ANALYST_EMPTY_RESPONSE",
            )

        response = STTMBuilderResponse.from_invocation(
            req,
            thread_id=thread_id,
            parent_message_id=req.context.parent_message_id,
            agent=None,
            result=None,
            message=response_message,
            status=STTMStatus.COMPLETED,
            artifact_type=artifact_type,
            artifact=artifact,
            semantic_level_achieved=semantic_refresh.achieved_level,
            semantic_refresh_status={
                "bundle_id": semantic_refresh.bundle_id,
                "bundle_hash": semantic_refresh.bundle_hash,
                "bundle_label": semantic_refresh.bundle_label,
                "requested_level": semantic_refresh.requested_level,
                "achieved_level": semantic_refresh.achieved_level,
                "status": semantic_refresh.status,
                "semantic_view_name": semantic_refresh.semantic_view_name,
                "promoted": semantic_refresh.promoted,
                "cache_hit": semantic_refresh.cache_hit,
                "stale_reason": None,
            },
            warnings=warnings,
            error=error,
            meta=meta,
        )
        finalized = self._postflight_guard.finalize_sttm_response(response, effective_decision)
        if not self._is_derived_source_request(req) and finalized.error is None:
            with _ANALYST_RESPONSE_CACHE_LOCK:
                if len(_ANALYST_RESPONSE_CACHE) >= 256:
                    expired = [
                        key
                        for key, (created_at, _response) in _ANALYST_RESPONSE_CACHE.items()
                        if time.monotonic() - created_at > _ANALYST_RESPONSE_CACHE_TTL_SECONDS
                    ]
                    for key in expired:
                        _ANALYST_RESPONSE_CACHE.pop(key, None)
                    if len(_ANALYST_RESPONSE_CACHE) >= 256:
                        oldest_key = min(
                            _ANALYST_RESPONSE_CACHE,
                            key=lambda key: _ANALYST_RESPONSE_CACHE[key][0],
                        )
                        _ANALYST_RESPONSE_CACHE.pop(oldest_key, None)
                _ANALYST_RESPONSE_CACHE[cache_key] = (
                    time.monotonic(),
                    finalized.model_copy(deep=True),
                )
        return finalized

    @staticmethod
    def _analyst_result_message(
        req: STTMBuilderEnvelopeRequest,
        preview_rows: list[dict[str, Any]],
    ) -> str | None:
        """Turn a scalar Analyst execution result into the user-facing answer."""

        if len(preview_rows) != 1 or len(preview_rows[0]) != 1:
            return None
        column, value = next(iter(preview_rows[0].items()))
        question = (req.data.message or "").lower()
        if any(
            token in question
            for token in (
                "how many",
                "record count",
                "row count",
                "count of",
                "number of records",
                "total number of",
            )
        ):
            source_name = next(
                (
                    table.table
                    for table in (req.context.source_tables or [])
                    if table.table.lower() in question
                ),
                None,
            )
            if source_name:
                return f"The **{source_name}** table contains **{value} records**."
            return f"The result is **{value} records**."
        label = str(column).replace("_", " ").strip().lower()
        return f"The **{label}** is **{value}**."

    @classmethod
    def _build_analyst_question(cls, req: STTMBuilderEnvelopeRequest) -> str:
        """Preserve the business conversation when a turn is delegated to Analyst."""
        current = (req.data.message or "").strip()
        workspace = req.context.workspace_context
        workspace_payload = (
            workspace.model_dump(mode="json", exclude_none=True)
            if hasattr(workspace, "model_dump")
            else workspace
        )
        history: list[str] = []
        if isinstance(workspace_payload, dict):
            for item in (workspace_payload.get("conversation_history") or [])[-12:]:
                if not isinstance(item, dict):
                    continue
                role = str(item.get("role") or "").strip().lower()
                content = cls._trim_string(item.get("content"), 1800)
                if role in {"user", "assistant"} and content:
                    history.append(f"{role.upper()}: {content}")
        if history and history[-1].startswith("USER:") and history[-1][5:].strip() == current:
            history.pop()
        if not history:
            return current
        return (
            "Continue the existing STTM conversation. Resolve pronouns such as 'this' or "
            "'those' from the recent turns. Use the current semantic model and only columns "
            "that it actually exposes. Treat prior SQL as learning evidence, not as text to copy. "
            "If the user asks to generate all recommended derived sources one by one, generate "
            "only the next not-yet-generated recommendation as a standalone derived-source draft "
            "and suggest 'Generate the next recommended derived source' for the following turn. "
            "Do not merge different row grains into one draft.\n\n"
            "Recent conversation:\n"
            + "\n".join(history)
            + f"\n\nCURRENT USER REQUEST: {current}"
        )

    @staticmethod
    def _should_answer_from_semantic_context(
        req: STTMBuilderEnvelopeRequest,
        semantic_refresh: Any | None,
    ) -> bool:
        if req.data.intent != Interface.CHAT or semantic_refresh is None:
            return False
        if req.context.surface != SemanticSurface.SOURCE_SELECTION:
            return False
        if STTMBuilderService._is_derived_source_request(req):
            return False
        text = (req.data.message or "").lower()
        analyst_tokens = (
            "sql",
            "query",
            "count",
            "sum",
            "average",
            "avg",
            "group by",
            "how many",
            "top ",
            "total ",
            "trend",
            "revenue",
        )
        if any(token in text for token in analyst_tokens):
            return False
        return any(
            token in text
            for token in (
                "selected tables",
                "tell me about",
                "what can you tell me",
                "relationship",
                "relationships",
                "join",
                "how are",
                "explain",
            )
        )

    def _invoke_semantic_context(
        self,
        req: STTMBuilderEnvelopeRequest,
        semantic_refresh: Any,
    ) -> STTMBuilderResponse:
        message = self._build_semantic_context_message(req, semantic_refresh)
        artifact = self._semantic_refresh_to_dict(semantic_refresh) or {}
        return STTMBuilderResponse.from_invocation(
            req,
            thread_id=req.context.thread_id or f"semantic-{uuid.uuid4()}",
            parent_message_id=req.context.parent_message_id,
            agent=None,
            result=None,
            message=message,
            status=STTMStatus.COMPLETED,
            artifact_type=STTMArtifactType.SEMANTIC_CONTEXT,
            artifact=artifact,
            semantic_level_achieved=semantic_refresh.achieved_level,
            semantic_refresh_status={
                "bundle_id": semantic_refresh.bundle_id,
                "bundle_hash": semantic_refresh.bundle_hash,
                "bundle_label": semantic_refresh.bundle_label,
                "requested_level": semantic_refresh.requested_level,
                "achieved_level": semantic_refresh.achieved_level,
                "status": semantic_refresh.status,
                "semantic_view_name": semantic_refresh.semantic_view_name,
                "promoted": semantic_refresh.promoted,
                "cache_hit": semantic_refresh.cache_hit,
                "stale_reason": None,
            },
            warnings=[],
            error=None,
            meta={"semantic_context_local": True},
        )

    @staticmethod
    def _build_semantic_context_message(
        req: STTMBuilderEnvelopeRequest,
        semantic_refresh: Any,
    ) -> str:
        source_tables = req.context.source_tables or []
        relationships = req.context.relationships or []
        semantic_items = req.context.semantic_context or []
        lines = []
        if semantic_refresh.bundle_label:
            lines.append(f"Here is a summary of `{semantic_refresh.bundle_label}`.")
        else:
            lines.append("Here is a summary of the selected tables.")
        if source_tables:
            table_names = ", ".join(table.table for table in source_tables)
            lines.append(f"Selected tables: {table_names}.")
        if relationships:
            rel = relationships[0]
            left = rel.left_table.table
            right = rel.right_table.table
            join_bits = [
                f"{cond.left_column} {cond.operator} {cond.right_column}"
                for cond in rel.conditions
            ]
            join_text = ", ".join(join_bits) if join_bits else "configured join conditions"
            lines.append(
                f"Primary relationship: `{left}` joins to `{right}` on {join_text}."
            )
            if len(relationships) > 1:
                lines.append(f"There are {len(relationships)} total relationships in the current selection.")
        descriptions = []
        for item in semantic_items[:4]:
            model = item.semantic_model if isinstance(item.semantic_model, dict) else {}
            description = model.get("domain_summary") or model.get("description")
            if isinstance(description, str) and description.strip():
                descriptions.append(f"`{item.table.table}`: {description.strip()}")
        if descriptions:
            lines.append("Table context:")
            lines.extend(descriptions)
        return "\n\n".join(lines)

    def _preview_sql_rows(self, sql_text: str | None) -> list[dict[str, Any]]:
        if not sql_text:
            return []
        preview_query = f"SELECT * FROM ({sql_text.rstrip().rstrip(';')}) AS ANALYST_PREVIEW LIMIT 5"
        try:
            rows = self._query_session.sql(preview_query).collect()
        except Exception as exc:  # pragma: no cover - preview failure should not break the chat path
            logger.warning("Analyst SQL preview failed: %s", exc)
            return []
        return [
            json.loads(json.dumps(row.as_dict(recursive=True), default=str))
            for row in rows
        ]

    @classmethod
    def _build_agent_payload(cls, req: STTMBuilderEnvelopeRequest) -> str:
        payload = STTMAgentRequestEnvelope.from_builder_request(req)
        payload_dict = payload.model_dump(mode="json", exclude_none=True)
        context = payload_dict.get("context")
        if isinstance(context, dict):
            # This is guidance to the orchestrator, not a backend-selected
            # execution route. AGT_STTM_BUILDER must decide from the requested
            # outcome and available context whether a tool is necessary.
            context["orchestration_policy"] = {
                "route_owner": "AGT_STTM_BUILDER",
                "routing_hint_is_advisory": True,
                "use_analyst_when": (
                    "The answer requires computing, filtering, aggregating, "
                    "or sampling actual rows from selected data."
                ),
                "answer_from_context_when": (
                    "The answer is available from prepared semantic, FIR, "
                    "precedent, mapping, relationship, or workspace context."
                ),
                "data_answer_contract": (
                    "For actual-data questions, invoke Cortex Analyst and "
                    "report the executed result; do not return SQL alone."
                ),
            }
            requested_target_columns: dict[str, list[str]] = {}
            for attribute in (payload_dict.get("data") or {}).get("attributes") or []:
                if not isinstance(attribute, dict):
                    continue
                target_table = cls._table_qualified_name(attribute.get("target_table"))
                target_attribute = attribute.get("target_attribute")
                if target_table and isinstance(target_attribute, str) and target_attribute:
                    requested_target_columns.setdefault(target_table, []).append(target_attribute)
            selected_columns = cls._precedent_selected_columns(
                context,
                requested_target_columns,
            )
            context["semantic_context"] = cls._compact_semantic_context(
                context.get("semantic_context"),
                selected_columns,
                requested_target_columns,
                context.get("driving_table"),
                context.get("relationships"),
            )
            context["workspace_context"] = cls._compact_workspace_context(
                context.get("workspace_context")
            )
        compact_payload = _prune_empty(payload_dict)
        return json.dumps(compact_payload, separators=(",", ":"))

    @classmethod
    def _precedent_selected_columns(
        cls,
        context: dict[str, Any],
        requested_target_columns: dict[str, list[str]],
    ) -> dict[str, list[str]]:
        """Select batch-relevant source columns without discarding full precedent rules."""
        # "Select all" is a UI contract, not a model-token contract. Starting
        # from the full selected-column set made every shadow batch resend up to
        # 80 attributes for each physical table. Build the model subset from
        # batch precedent, join keys, and lexical target relevance instead.
        selected: dict[str, set[str]] = {}
        target_names = {
            str(column).upper()
            for columns in requested_target_columns.values()
            for column in columns
        }
        source_tables = {
            cls._table_qualified_name(table): table
            for table in (context.get("source_tables") or [])
            if cls._table_qualified_name(table)
        }
        driving_name = cls._table_qualified_name(context.get("driving_table"))
        alias_to_relation: dict[str, str] = {"SOURCE": driving_name or ""}
        graph = context.get("relation_graph")
        if isinstance(graph, dict):
            for node in graph.get("nodes") or []:
                if not isinstance(node, dict):
                    continue
                relation_id = str(node.get("relation_id") or "")
                table_name = cls._table_qualified_name(node.get("table")) or relation_id
                alias = str(node.get("alias") or "")
                if alias and table_name:
                    alias_to_relation[alias.upper()] = table_name
            for edge in graph.get("edges") or []:
                if not isinstance(edge, dict):
                    continue
                left_id = str(edge.get("left_relation_id") or "")
                right_id = str(edge.get("right_relation_id") or "")
                for condition in edge.get("conditions") or []:
                    if not isinstance(condition, dict):
                        continue
                    left_column = condition.get("left_column")
                    right_column = condition.get("right_column")
                    if left_id and left_column:
                        selected.setdefault(left_id, set()).add(str(left_column))
                    if right_id and right_column:
                        selected.setdefault(right_id, set()).add(str(right_column))
        learning = context.get("learning_context")
        precedents = learning.get("mapping_precedents") if isinstance(learning, dict) else []
        dependency_values: list[str] = []
        for precedent in precedents or []:
            if not isinstance(precedent, dict):
                continue
            alias_contract = precedent.get("alias_contract")
            if isinstance(alias_contract, dict):
                for alias, relation in alias_contract.items():
                    if alias and relation:
                        alias_to_relation[str(alias).upper()] = str(relation)
            for mapping in precedent.get("mappings") or []:
                if not isinstance(mapping, dict):
                    continue
                target = str(
                    mapping.get("target_column")
                    or mapping.get("target_attribute")
                    or ""
                ).rsplit(".", 1)[-1].upper()
                if target not in target_names:
                    continue
                for key in ("source_dependencies", "source_columns", "source_attributes"):
                    value = mapping.get(key)
                    if isinstance(value, str):
                        dependency_values.append(value)
                    elif isinstance(value, list):
                        dependency_values.extend(str(item) for item in value if item)
                for key in ("source_column", "preprocessing_rule", "expression"):
                    value = mapping.get(key)
                    if isinstance(value, str):
                        dependency_values.append(value)

        known_upper = {name.upper(): name for name in source_tables}
        for value in dependency_values:
            for qualifier, column in re.findall(
                r"([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,2})\.([A-Za-z_$][\w$]*)",
                value,
            ):
                qualifier_upper = qualifier.upper()
                relation = known_upper.get(qualifier_upper) or alias_to_relation.get(qualifier_upper)
                if relation:
                    selected.setdefault(relation, set()).add(column)
                    continue
                # Fully-qualified references arrive as DB.SCHEMA.TABLE.COLUMN.
                for known_key, known_name in known_upper.items():
                    if qualifier_upper == known_key:
                        selected.setdefault(known_name, set()).add(column)
                        break
        return {table: sorted(columns) for table, columns in selected.items() if columns}

    @classmethod
    def _compact_semantic_context(
        cls,
        items: Any,
        selected_columns_by_table: Any,
        requested_target_columns_by_table: Any = None,
        driving_table: Any = None,
        relationships: Any = None,
    ) -> list[dict[str, Any]] | None:
        if not isinstance(items, list) or not items:
            return None
        selected_map = (
            selected_columns_by_table if isinstance(selected_columns_by_table, dict) else {}
        )
        target_map = (
            requested_target_columns_by_table
            if isinstance(requested_target_columns_by_table, dict)
            else {}
        )
        target_names = {str(name).upper() for name in target_map}
        driving_name = cls._table_qualified_name(driving_table).upper()
        related_names: set[str] = set()
        if isinstance(relationships, list):
            for relationship in relationships:
                if not isinstance(relationship, dict):
                    continue
                for key in ("left_table", "right_table"):
                    name = cls._table_qualified_name(relationship.get(key))
                    if name:
                        related_names.add(name.upper())

        def priority(item: Any) -> tuple[int, str]:
            if not isinstance(item, dict):
                return (9, "")
            name = cls._table_qualified_name(item.get("table")).upper()
            scope = str(item.get("scope") or "").upper()
            if name in target_names:
                return (0, name)
            if scope in {"DERIVED_SOURCE", "CTE"}:
                return (1, name)
            if driving_name and name == driving_name:
                return (2, name)
            if name in related_names:
                return (3, name)
            if name in {str(key).upper() for key in selected_map}:
                return (4, name)
            return (5, name)

        # Keep all relevant relation semantics for realistic migrations. The former
        # positional [:8] cap routinely removed the target and every derived source.
        ordered_items = sorted(items, key=priority)[:32]
        compact_items: list[dict[str, Any]] = []
        for item in ordered_items:
            if not isinstance(item, dict):
                continue
            table = item.get("table")
            scope = item.get("scope")
            semantic_model = item.get("semantic_model")
            compact_model = cls._compact_semantic_model(
                table,
                semantic_model,
                selected_map,
                target_map,
                preserve_all_attributes=str(scope or "").upper()
                in {"DERIVED_SOURCE", "CTE"},
            )
            compact_items.append(
                _prune_empty(
                    {
                        "table": table,
                        "scope": scope,
                        "semantic_model": compact_model,
                    }
                )
            )
        return compact_items or None

    @classmethod
    def _compact_semantic_model(
        cls,
        table: Any,
        semantic_model: Any,
        selected_columns_by_table: dict[str, Any],
        requested_target_columns_by_table: dict[str, Any] | None = None,
        preserve_all_attributes: bool = False,
    ) -> Any:
        if isinstance(semantic_model, str):
            return cls._trim_string(semantic_model, 500)
        if isinstance(semantic_model, list):
            return semantic_model[:10]
        if not isinstance(semantic_model, dict):
            return semantic_model

        qualified_name = cls._table_qualified_name(table)
        selected_columns = selected_columns_by_table.get(qualified_name)
        requested_target_columns = (requested_target_columns_by_table or {}).get(qualified_name)
        attribute_names = {
            str(name).upper()
            for name in (requested_target_columns or selected_columns or [])
            if isinstance(name, str) and name.strip()
        }
        raw_attributes = semantic_model.get("attributes") or semantic_model.get("columns")
        compact_attributes: list[dict[str, Any]] = []
        if isinstance(raw_attributes, list):
            chosen_attributes = raw_attributes
            if preserve_all_attributes:
                chosen_attributes = raw_attributes
            elif attribute_names:
                chosen_attributes = [
                    attr
                    for attr in raw_attributes
                    if isinstance(attr, dict)
                    and str(attr.get("name", "")).upper() in attribute_names
                ]
            elif requested_target_columns_by_table:
                target_tokens = {
                    token
                    for columns in requested_target_columns_by_table.values()
                    for column in columns
                    for token in re.split(r"[^A-Z0-9]+", str(column).upper())
                    if len(token) > 2
                }
                relevant = [
                    attr
                    for attr in raw_attributes
                    if isinstance(attr, dict)
                    and (
                        attr.get("is_primary_key")
                        or attr.get("is_foreign_key")
                        or bool(
                            target_tokens
                            & set(
                                token
                                for token in re.split(
                                    r"[^A-Z0-9]+", str(attr.get("name") or "").upper()
                                )
                                if len(token) > 2
                            )
                        )
                    )
                ]
                chosen_attributes = relevant[:24] or raw_attributes[:8]
            # Mapping still belongs entirely to AGT_SOURCE_MAPPING. Keep every
            # selected source attribute, while restricting target semantics to the
            # current batch, so the Agent has complete evidence without duplicated
            # full-workspace payloads.
            for attr in chosen_attributes[:80]:
                if not isinstance(attr, dict):
                    continue
                compact_attributes.append(
                    _prune_empty(
                        {
                            "name": attr.get("name"),
                            "data_type": attr.get("data_type"),
                            "summary": cls._trim_string(
                                attr.get("summary") or attr.get("description"), 140
                            ),
                            "constraints": attr.get("constraints"),
                            "is_primary_key": attr.get("is_primary_key"),
                            "is_foreign_key": attr.get("is_foreign_key"),
                        }
                    )
                )

        output_columns: list[dict[str, Any]] = []
        raw_output_columns = semantic_model.get("output_columns")
        raw_column_semantics = semantic_model.get("column_semantics")
        semantic_by_name = {
            str(item.get("name") or item.get("column_name") or "").upper(): item
            for item in (raw_column_semantics if isinstance(raw_column_semantics, list) else [])
            if isinstance(item, dict)
        }
        if isinstance(raw_output_columns, list):
            for output in raw_output_columns[:100]:
                if not isinstance(output, dict):
                    continue
                name = output.get("name") or output.get("column_name")
                semantic = semantic_by_name.get(str(name or "").upper(), {})
                output_columns.append(
                    _prune_empty(
                        {
                            "name": name,
                            "data_type": output.get("data_type") or output.get("type"),
                            "description": cls._trim_string(
                                semantic.get("business_meaning")
                                or semantic.get("description")
                                or output.get("description"),
                                240,
                            ),
                            "source_columns": semantic.get("source_columns")
                            or output.get("source_columns"),
                            "is_primary_key": output.get("is_primary_key"),
                        }
                    )
                )

        relationships = semantic_model.get("relationships")
        compact_relationships = None
        if isinstance(relationships, dict):
            compact_relationships = {}
            for key in ("incoming", "outgoing"):
                rel_list = relationships.get(key)
                if not isinstance(rel_list, list):
                    continue
                compact_relationships[key] = [
                    _prune_empty(
                        {
                            "references_table": rel.get("references_table"),
                            "references_column": rel.get("references_column"),
                            "foreign_key": rel.get("foreign_key"),
                            "cardinality": rel.get("cardinality"),
                            "description": cls._trim_string(rel.get("description"), 160),
                        }
                    )
                    for rel in rel_list[:6]
                    if isinstance(rel, dict)
                ]

        return _prune_empty(
            {
                "description": cls._trim_string(semantic_model.get("description"), 500),
                "domain_summary": cls._trim_string(semantic_model.get("domain_summary"), 300),
                "business_context": cls._trim_string(semantic_model.get("business_context"), 500),
                "table_role_hint": semantic_model.get("table_role_hint"),
                "purpose": cls._trim_string(semantic_model.get("purpose"), 500),
                "grain": cls._trim_string(semantic_model.get("grain"), 240),
                "keys": semantic_model.get("keys"),
                "derived_source_id": semantic_model.get("derived_source_id"),
                "physical_view_name": semantic_model.get("physical_view_name"),
                "upstream_hash": semantic_model.get("upstream_hash"),
                "source_dependency_hash": semantic_model.get("source_dependency_hash"),
                "semantic_quality": semantic_model.get("semantic_quality"),
                "semantic_coverage_issues": semantic_model.get("semantic_coverage_issues"),
                "sql_text": cls._trim_string(semantic_model.get("sql_text"), 8000),
                "attributes": compact_attributes or None,
                "output_columns": output_columns or None,
                "relationships": compact_relationships,
                "selected_ui_relationships": semantic_model.get("selected_ui_relationships"),
            }
        )

    @classmethod
    def _compact_workspace_context(
        cls,
        workspace_context: Any,
    ) -> dict[str, Any] | None:
        if not isinstance(workspace_context, dict):
            return None
        mapping_rows = workspace_context.get("mapping_rows")
        checked_ids = {
            str(item)
            for item in (workspace_context.get("checked_mapping_row_ids") or [])
            if item is not None
        }
        active_id = workspace_context.get("active_mapping_row_id")
        accepted_rows = []
        if isinstance(mapping_rows, list):
            accepted_rows = [
                _prune_empty(
                    {
                        "id": row.get("id"),
                        "target_column": row.get("target_column"),
                        "source_columns": row.get("source_columns") or row.get("source_column"),
                        "rule": row.get("rule"),
                        "expression": row.get("expression"),
                        "natural_language_rule": row.get("natural_language_rule"),
                        "description": row.get("description"),
                        "load_order": row.get("load_order"),
                        "confidence": row.get("confidence") or row.get("confidence_score"),
                        "confidence_reason": row.get("confidence_reason"),
                        "status": row.get("status"),
                    }
                )
                for row in mapping_rows
                if isinstance(row, dict)
                and (
                    (checked_ids and str(row.get("id") or "") in checked_ids)
                    or (active_id and str(row.get("id") or "") == str(active_id))
                    or row.get("source_columns") or row.get("source_column")
                    or row.get("expression")
                    or str(row.get("status") or "").lower() in {"accepted", "approved"}
                )
            ][:80]
        semantic = workspace_context.get("semantic")
        compact_semantic = None
        if isinstance(semantic, dict):
            compact_semantic = _prune_empty(
                {
                    "bundle_id": semantic.get("bundle_id"),
                    "bundle_hash": semantic.get("bundle_hash"),
                    "level": semantic.get("level"),
                    "asset_versions": semantic.get("asset_versions"),
                    "composed_model_hash": semantic.get("composed_model_hash"),
                }
            )
        return _prune_empty(
            {
                "context_version": workspace_context.get("context_version"),
                "context_hash": workspace_context.get("context_hash"),
                "page": workspace_context.get("page"),
                "surface": workspace_context.get("surface"),
                "mapping_intent": workspace_context.get("mapping_intent"),
                "mapping_rows": accepted_rows or None,
                "checked_mapping_row_ids": workspace_context.get("checked_mapping_row_ids"),
                "conversation_history": [
                    _prune_empty(
                        {
                            "role": item.get("role"),
                            "content": cls._trim_string(item.get("content"), 2000),
                        }
                    )
                    for item in (workspace_context.get("conversation_history") or [])[-30:]
                    if isinstance(item, dict)
                    and item.get("role") in {"user", "assistant"}
                    and cls._trim_string(item.get("content"), 2000)
                ] or None,
                "semantic": compact_semantic,
            }
        )

    @staticmethod
    def _table_qualified_name(table: Any) -> str | None:
        if not isinstance(table, dict):
            return None
        database = table.get("database")
        schema = table.get("schema")
        table_name = table.get("table")
        if all(isinstance(part, str) and part for part in (database, schema, table_name)):
            return f"{database}.{schema}.{table_name}"
        return None

    @staticmethod
    def _trim_string(value: Any, limit: int) -> str | None:
        if not isinstance(value, str):
            return None
        stripped = value.strip()
        if not stripped:
            return None
        if len(stripped) <= limit:
            return stripped
        return f"{stripped[:limit - 1].rstrip()}..."

    def _parse_envelope(
        self,
        raw: str,
    ) -> tuple[
        SubAgent | None,
        SourceMappingResult | TransformationResult | None,
        str | None,
        list[Any],
        Any,
        dict[str, Any],
        STTMStatus,
        STTMArtifactType | None,
        dict[str, Any] | None,
        SemanticLevel | None,
        dict[str, Any] | None,
    ]:
        json_str = _extract_json_object(raw)
        try:
            envelope: dict[str, Any] = json.loads(json_str)
        except json.JSONDecodeError as exc:
            raise SnowflakeAgentError(
                f"Orchestration agent response is not valid JSON: {exc} — raw: {raw[:400]}"
            ) from exc

        try:
            normalized_envelope = dict(envelope)
            if isinstance(normalized_envelope.get("error"), dict):
                normalized_error = _coerce_api_error(normalized_envelope["error"])
                if normalized_error is not None:
                    normalized_envelope["error"] = normalized_error.model_dump(mode="json")
            parsed = STTMAgentResponseEnvelope.model_validate(normalized_envelope)
        except ValidationError:
            parsed = None

        if parsed is not None:
            sub_agent = parsed.data.agent
            result = None
            if sub_agent and parsed.data.result is not None:
                result = self._validate_result(sub_agent, parsed.data.result.model_dump(mode="json"))
            if result is None and sub_agent is None:
                embedded = self._parse_embedded_envelope(parsed.data.message)
                if embedded is not None:
                    logger.info("Unwrapped structured sub-agent response from orchestrator message")
                    return self._merge_embedded_envelope(
                        outer=(
                            parsed.data.agent,
                            result,
                            parsed.data.message,
                            parsed.warnings,
                            parsed.error,
                            parsed.meta,
                            parsed.data.status,
                            parsed.data.artifact_type,
                            parsed.data.artifact,
                            parsed.data.semantic_level_achieved,
                            parsed.data.semantic_refresh_status.model_dump(mode="json")
                            if parsed.data.semantic_refresh_status
                            else None,
                        ),
                        nested=embedded,
                    )
            return (
                sub_agent,
                result,
                parsed.data.message,
                parsed.warnings,
                parsed.error,
                parsed.meta,
                parsed.data.status,
                parsed.data.artifact_type,
                parsed.data.artifact,
                parsed.data.semantic_level_achieved,
                parsed.data.semantic_refresh_status.model_dump(mode="json")
                if parsed.data.semantic_refresh_status
                else None,
            )

        data = envelope.get("data") if isinstance(envelope.get("data"), dict) else envelope
        agent_name: str | None = data.get("agent") or envelope.get("agent")
        raw_result: dict[str, Any] | None = data.get("result") or envelope.get("result")
        message: str | None = data.get("message") or envelope.get("message")
        warnings = envelope.get("warnings") if isinstance(envelope.get("warnings"), list) else []
        raw_error = envelope.get("error")
        error = _coerce_api_error(raw_error if isinstance(raw_error, (dict, ApiError)) else None)
        meta = envelope.get("meta") if isinstance(envelope.get("meta"), dict) else {}
        status = _status_from_payload(data)

        if not agent_name:
            embedded = self._parse_embedded_envelope(message)
            if embedded is not None:
                logger.info("Unwrapped structured sub-agent response from legacy orchestrator message")
                return self._merge_embedded_envelope(
                    outer=(
                        None,
                        None,
                        message,
                        warnings,
                        error,
                        meta,
                        STTMStatus.NEEDS_INPUT if message else status,
                        STTMArtifactType(data.get("artifact_type"))
                        if data.get("artifact_type") in {item.value for item in STTMArtifactType}
                        else None,
                        data.get("artifact") if isinstance(data.get("artifact"), dict) else None,
                        SemanticLevel(data.get("semantic_level_achieved"))
                        if data.get("semantic_level_achieved") in {item.value for item in SemanticLevel}
                        else None,
                        data.get("semantic_refresh_status")
                        if isinstance(data.get("semantic_refresh_status"), dict)
                        else None,
                    ),
                    nested=embedded,
                )
            return (
                None,
                None,
                message,
                warnings,
                error,
                meta,
                STTMStatus.NEEDS_INPUT if message else status,
                STTMArtifactType(data.get("artifact_type"))
                if data.get("artifact_type") in {item.value for item in STTMArtifactType}
                else None,
                data.get("artifact") if isinstance(data.get("artifact"), dict) else None,
                SemanticLevel(data.get("semantic_level_achieved"))
                if data.get("semantic_level_achieved") in {item.value for item in SemanticLevel}
                else None,
                data.get("semantic_refresh_status")
                if isinstance(data.get("semantic_refresh_status"), dict)
                else None,
            )

        sub_agent = _normalize_sub_agent(agent_name)

        if raw_result is None:
            if error is not None or status == STTMStatus.FAILED:
                return (
                    sub_agent,
                    None,
                    message,
                    warnings,
                    error,
                    meta,
                    status,
                    STTMArtifactType(data.get("artifact_type"))
                    if data.get("artifact_type") in {item.value for item in STTMArtifactType}
                    else None,
                    data.get("artifact") if isinstance(data.get("artifact"), dict) else None,
                    SemanticLevel(data.get("semantic_level_achieved"))
                    if data.get("semantic_level_achieved") in {item.value for item in SemanticLevel}
                    else None,
                    data.get("semantic_refresh_status")
                    if isinstance(data.get("semantic_refresh_status"), dict)
                    else None,
                )
            raise SnowflakeAgentError(f"Sub-agent {agent_name!r} returned a null result")

        validated = self._validate_result(sub_agent, raw_result)
        return (
            sub_agent,
            validated,
            message,
            warnings,
            error,
            meta,
            status,
            STTMArtifactType(data.get("artifact_type"))
            if data.get("artifact_type") in {item.value for item in STTMArtifactType}
            else None,
            data.get("artifact") if isinstance(data.get("artifact"), dict) else None,
            SemanticLevel(data.get("semantic_level_achieved"))
            if data.get("semantic_level_achieved") in {item.value for item in SemanticLevel}
            else None,
            data.get("semantic_refresh_status")
            if isinstance(data.get("semantic_refresh_status"), dict)
            else None,
        )

    def _parse_chat_response(
        self,
        raw: str,
        raw_payload: dict[str, Any] | None = None,
    ) -> tuple[
        SubAgent | None,
        SourceMappingResult | TransformationResult | None,
        str | None,
        list[Any],
        Any,
        dict[str, Any],
        STTMStatus,
        STTMArtifactType | None,
        dict[str, Any] | None,
        SemanticLevel | None,
        dict[str, Any] | None,
    ]:
        sse_message = _extract_sse_text(raw)
        if sse_message is not None:
            return None, None, sse_message, [], None, {}, STTMStatus.COMPLETED, None, None, None, None

        try:
            parsed = self._parse_envelope(raw)
            if parsed[7] is not None:
                return parsed
            analyst_artifact = self._extract_agentic_analyst_artifact(raw_payload, parsed[2] or raw.strip())
            if analyst_artifact is None:
                return parsed
            return (
                parsed[0],
                parsed[1],
                parsed[2],
                parsed[3],
                parsed[4],
                parsed[5],
                parsed[6],
                STTMArtifactType.ANALYST_ANSWER,
                analyst_artifact,
                SemanticLevel.L2_ANALYST_READY,
                None,
            )
        except SnowflakeAgentError:
            text = raw.strip()
            analyst_artifact = self._extract_agentic_analyst_artifact(raw_payload, text)
            if analyst_artifact is not None:
                return (
                    None,
                    None,
                    text or None,
                    [],
                    None,
                    {},
                    STTMStatus.COMPLETED,
                    STTMArtifactType.ANALYST_ANSWER,
                    analyst_artifact,
                    SemanticLevel.L2_ANALYST_READY,
                    None,
                )
            return None, None, text or None, [], None, {}, STTMStatus.COMPLETED, None, None, None, None

    def _parse_embedded_envelope(
        self,
        message: str | None,
    ) -> tuple[
        SubAgent | None,
        SourceMappingResult | TransformationResult | None,
        str | None,
        list[Any],
        Any,
        dict[str, Any],
        STTMStatus,
        STTMArtifactType | None,
        dict[str, Any] | None,
        SemanticLevel | None,
        dict[str, Any] | None,
    ] | None:
        embedded_json = _extract_embedded_envelope_json(message)
        if embedded_json is None:
            return None
        try:
            return self._parse_envelope(embedded_json)
        except SnowflakeAgentError:
            logger.debug("Embedded orchestrator message looked like JSON but was not a valid envelope")
            return None

    @staticmethod
    def _merge_embedded_envelope(
        *,
        outer: tuple[
            SubAgent | None,
            SourceMappingResult | TransformationResult | None,
            str | None,
            list[Any],
            Any,
            dict[str, Any],
            STTMStatus,
            STTMArtifactType | None,
            dict[str, Any] | None,
            SemanticLevel | None,
            dict[str, Any] | None,
        ],
        nested: tuple[
            SubAgent | None,
            SourceMappingResult | TransformationResult | None,
            str | None,
            list[Any],
            Any,
            dict[str, Any],
            STTMStatus,
            STTMArtifactType | None,
            dict[str, Any] | None,
            SemanticLevel | None,
            dict[str, Any] | None,
        ],
    ) -> tuple[
        SubAgent | None,
        SourceMappingResult | TransformationResult | None,
        str | None,
        list[Any],
        Any,
        dict[str, Any],
        STTMStatus,
        STTMArtifactType | None,
        dict[str, Any] | None,
        SemanticLevel | None,
        dict[str, Any] | None,
    ]:
        return (
            nested[0] or outer[0],
            nested[1] or outer[1],
            nested[2] or outer[2],
            [*(outer[3] or []), *(nested[3] or [])],
            nested[4] or outer[4],
            {**(outer[5] or {}), **(nested[5] or {})},
            nested[6] or outer[6],
            nested[7] or outer[7],
            nested[8] or outer[8],
            nested[9] or outer[9],
            nested[10] or outer[10],
        )

    @staticmethod
    def _extract_agentic_analyst_artifact(
        raw_payload: dict[str, Any] | None,
        message_text: str | None,
    ) -> dict[str, Any] | None:
        if not isinstance(raw_payload, dict):
            return None
        content = raw_payload.get("content")
        if not isinstance(content, list):
            return None

        sql_result: dict[str, Any] | None = None
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_result":
                continue
            tool_result = block.get("tool_result")
            if not isinstance(tool_result, dict) or tool_result.get("type") != "system_execute_sql":
                continue
            nested_content = tool_result.get("content")
            if not isinstance(nested_content, list):
                continue
            for item in nested_content:
                if not isinstance(item, dict) or item.get("type") != "json":
                    continue
                json_payload = item.get("json")
                if isinstance(json_payload, dict):
                    sql_result = json_payload
                    break
            if sql_result is not None:
                break

        if sql_result is None:
            return None

        preview_rows: list[dict[str, Any]] = []
        result_set = sql_result.get("result_set")
        if isinstance(result_set, dict):
            row_meta = result_set.get("resultSetMetaData", {})
            row_types = row_meta.get("rowType", []) if isinstance(row_meta, dict) else []
            column_names = [
                str(item.get("name"))
                for item in row_types
                if isinstance(item, dict) and item.get("name")
            ]
            rows = result_set.get("data", [])
            if isinstance(rows, list):
                for row in rows[:5]:
                    if isinstance(row, list) and column_names:
                        preview_rows.append(
                            {
                                column_names[index]: row[index]
                                for index in range(min(len(column_names), len(row)))
                            }
                        )

        return {
            "answer_text": message_text or "",
            "sql_text": sql_result.get("sql"),
            "preview_rows": preview_rows,
            "semantic_view_name": sql_result.get("semantic_model_path"),
            "semantic_sql_used": bool(sql_result.get("sql")),
            "fallback_to_standard_sql": False,
            "query_id": sql_result.get("query_id"),
        }

    @staticmethod
    def _merge_agent_meta(
        meta: dict[str, Any],
        extra_meta: dict[str, Any] | None = None,
        *,
        raw_payload: dict[str, Any] | None = None,
        artifact_type: STTMArtifactType | None = None,
        artifact: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        merged = dict(meta or {})
        if extra_meta:
            merged.update(extra_meta)
        if raw_payload and "agent_run" not in merged:
            merged["agent_run"] = {
                "status": raw_payload.get("status"),
                "schema_version": raw_payload.get("schema_version"),
                "sequence_number": raw_payload.get("sequence_number"),
            }
        if artifact_type == STTMArtifactType.ANALYST_ANSWER and artifact:
            merged.setdefault("analyst", {})
            if artifact.get("query_id"):
                merged["analyst"]["query_id"] = artifact.get("query_id")
            if artifact.get("semantic_view_name"):
                merged["analyst"]["semantic_view_name"] = artifact.get("semantic_view_name")
        return merged

    @staticmethod
    def _validate_result(
        sub_agent: SubAgent,
        raw_result: dict[str, Any],
    ) -> SourceMappingResult | TransformationResult:
        try:
            if sub_agent == SubAgent.SOURCE_MAPPING_AGENT:
                mappings = _normalize_source_mappings(raw_result)
                return SourceMappingResult(mappings=mappings)

            if sub_agent == SubAgent.TRANSFORMATION_AGENT:
                return _normalize_transformation_result(raw_result)
        except (ValidationError, Exception) as exc:
            raise SnowflakeAgentError(
                f"{sub_agent} result failed schema validation: {exc}"
            ) from exc

        raise SnowflakeAgentError(f"Unhandled sub-agent type: {sub_agent}")


def _extract_json_object(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        return text[start : end + 1]
    return text.strip()


def _extract_embedded_envelope_json(text: str | None) -> str | None:
    if not isinstance(text, str):
        return None

    candidates: list[str] = []
    stripped = text.strip()
    if not stripped:
        return None

    fenced_blocks = re.findall(r"```(?:json)?\s*([\s\S]*?)```", stripped, flags=re.IGNORECASE)
    candidates.extend(block.strip() for block in fenced_blocks if block.strip())

    if stripped.startswith("{") and stripped.endswith("}"):
        candidates.append(stripped)

    if '"contract_version"' in stripped or '"operation"' in stripped or '"data"' in stripped:
        candidates.append(_extract_json_object(stripped))

    for candidate in candidates:
        json_candidate = _extract_json_object(candidate)
        try:
            payload = json.loads(json_candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        if (
            payload.get("contract_version") == "1.0"
            or isinstance(payload.get("data"), dict)
            or payload.get("operation")
        ):
            return json.dumps(payload)

    return None


def _prune_empty(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, nested in value.items():
            pruned = _prune_empty(nested)
            if pruned in (None, [], {}):
                continue
            out[key] = pruned
        return out
    if isinstance(value, list):
        return [_prune_empty(item) for item in value]
    return value


def _status_from_payload(payload: dict[str, Any]) -> STTMStatus:
    raw_status = str(payload.get("status") or STTMStatus.COMPLETED.value).lower()
    try:
        return STTMStatus(raw_status)
    except ValueError:
        return STTMStatus.COMPLETED


def _normalize_sub_agent(agent_name: str) -> SubAgent:
    aliases = {
        "SOURCE_MAPPING_AGENT": SubAgent.SOURCE_MAPPING_AGENT,
        "AGT_SOURCE_MAPPING": SubAgent.SOURCE_MAPPING_AGENT,
        "source_mapping": SubAgent.SOURCE_MAPPING_AGENT,
        "TRANSFORMATION_AGENT": SubAgent.TRANSFORMATION_AGENT,
        "AGT_TRANSFORMATION_RULE": SubAgent.TRANSFORMATION_AGENT,
        "transformation_rules": SubAgent.TRANSFORMATION_AGENT,
    }
    normalized = aliases.get(agent_name) or aliases.get(agent_name.strip())
    if normalized:
        return normalized
    try:
        return SubAgent(agent_name)
    except ValueError as exc:
        raise SnowflakeAgentError(
            f"Unknown sub-agent in orchestration response: {agent_name!r}"
        ) from exc


def _normalize_source_mappings(raw_result: dict[str, Any]) -> dict[str, AttributeMapping]:
    raw_mappings = raw_result.get("mappings", raw_result)

    if isinstance(raw_mappings, dict):
        return {
            attr: AttributeMapping.model_validate(value)
            for attr, value in raw_mappings.items()
        }

    if not isinstance(raw_mappings, list):
        raise ValueError("source mapping result must contain an object or list of mappings")

    mappings: dict[str, AttributeMapping] = {}
    for item in raw_mappings:
        if not isinstance(item, dict):
            continue
        target = item.get("target") or item.get("target_attribute")
        if not isinstance(target, str) or not target:
            continue
        sources = item.get("sources") or item.get("source_attributes") or []
        source_attributes: list[str] = []
        confidences: list[float] = []
        for source in sources:
            if isinstance(source, str):
                source_attributes.append(source)
                continue
            if not isinstance(source, dict):
                continue
            table_name = source.get("table")
            column_name = source.get("column") or source.get("attribute")
            if table_name and column_name:
                source_attributes.append(f"{table_name}.{column_name}")
            elif column_name:
                source_attributes.append(str(column_name))
            if "confidence_score" in source:
                confidences.append(float(source["confidence_score"]))
            elif "confidence" in source:
                confidences.append(_confidence_to_score(source["confidence"]))

        candidate_sources = item.get("candidate_source_attributes") or item.get("candidates") or []
        candidate_source_attributes: list[str] = []
        for candidate in candidate_sources:
            if isinstance(candidate, str):
                candidate_source_attributes.append(candidate)
                continue
            if not isinstance(candidate, dict):
                continue
            table_name = candidate.get("table")
            column_name = candidate.get("column") or candidate.get("attribute")
            if table_name and column_name:
                candidate_source_attributes.append(f"{table_name}.{column_name}")
            elif column_name:
                candidate_source_attributes.append(str(column_name))

        processing_order = item.get("processing_order")
        if processing_order is not None:
            try:
                processing_order = int(processing_order)
            except (TypeError, ValueError):
                processing_order = None

        raw_mapping_mode = str(item.get("mapping_mode") or "").strip().lower()
        if raw_mapping_mode in {"attribute", "project_attribute", "project_value"}:
            mapping_mode = "attribute"
        elif raw_mapping_mode in {"value", "constant", "literal", "placeholder"}:
            mapping_mode = "constant"
        else:
            mapping_mode = "source"
        raw_classification = str(item.get("transformation_classification") or "").strip().lower()
        classification_aliases = {
            "simple_multi_source": "simple_multi_source",
            "multi_source": "simple_multi_source",
            "value": "value",
            "direct": "direct",
            "reused": "reused",
            "complex": "complex",
            "unresolved": "unresolved",
        }
        classification = classification_aliases.get(raw_classification)

        mappings[target] = AttributeMapping(
            source_attributes=source_attributes,
            mapping_mode=mapping_mode,
            constant_value=item.get("constant_value") or item.get("value"),
            attribute_name=item.get("attribute_name") or item.get("project_attribute_name"),
            source_dependencies=item.get("source_dependencies") or source_attributes,
            value_binding_ids=item.get("value_binding_ids") or [],
            transformation_classification=classification,
            precedent_decision=item.get("precedent_decision"),
            pattern_decision=item.get("pattern_decision"),
            precedent_mapping_id=item.get("precedent_mapping_id"),
            override_evidence=item.get("override_evidence") or [],
            confidence_score=max(confidences) if confidences else 0.0,
            confidence_reason=item.get("confidence_reason") or item.get("reason") or item.get("explanation"),
            candidate_source_attributes=candidate_source_attributes,
            unmatched_reason=item.get("unmatched_reason"),
            preprocessing_rule=_sanitize_attribute_level_rule(item.get("preprocessing_rule") or item.get("rule")),
            preprocessing_rule_type=_sanitize_preprocessing_rule_type(
                item.get("preprocessing_rule") or item.get("rule"),
                item.get("preprocessing_rule_type") or item.get("rule_type"),
            ),
            preprocessing_nl_rule=item.get("preprocessing_nl_rule") or item.get("nl_rule"),
            processing_order=processing_order,
            description=item.get("description"),
            used_inference_ids=item.get("used_inference_ids") or item.get("learning_evidence") or [],
            used_recommendation_ids=item.get("used_recommendation_ids") or [],
            used_learning_ids=item.get("used_learning_ids") or [],
        )

    return mappings


def _normalize_transformation_result(raw_result: dict[str, Any]) -> TransformationResult:
    if "rules" not in raw_result or not isinstance(raw_result["rules"], list):
        return TransformationResult.model_validate(raw_result)

    rules: list[TransformationRule] = []
    for item in raw_result["rules"]:
        if not isinstance(item, dict):
            continue
        rules.append(
            TransformationRule(
                target_attribute=str(item.get("target_attribute") or item.get("target_id") or ""),
                rule=_sanitize_attribute_level_rule(
                    str(item.get("rule") or item.get("transformation_rule") or "")
                ),
                description=item.get("description"),
                used_inference_ids=item.get("used_inference_ids") or item.get("learning_evidence") or [],
                used_recommendation_ids=item.get("used_recommendation_ids") or [],
                learning_evidence=item.get("learning_evidence") or [],
                pattern_decision=item.get("pattern_decision"),
                precedent_decision=item.get("precedent_decision"),
                source_dependencies=item.get("source_dependencies") or [],
                value_binding_ids=item.get("value_binding_ids") or [],
                override_evidence=item.get("override_evidence") or [],
            )
        )
    return TransformationResult(rules=rules)


def _sanitize_attribute_level_rule(value: Any) -> str:
    rule = str(value or "").strip()
    if not rule:
        return ""

    # Mapping and preprocessing rules must be attribute-level expressions. Step 1 already
    # owns FROM/JOIN/WHERE construction, so we reject query-shaped SQL here instead of
    # applying misleading transformations in the mapping grid.
    scrubbed = re.sub(r"'(?:''|[^'])*'", "''", rule)
    if re.search(
        r"(?i)\b(select|with|from|join|where|qualify|group\s+by|having|order\s+by)\b",
        scrubbed,
    ):
        return ""
    if ";" in scrubbed:
        return ""
    return rule


def _sanitize_preprocessing_rule_type(rule_value: Any, rule_type: Any) -> str | None:
    sanitized_rule = _sanitize_attribute_level_rule(rule_value)
    normalized_type = str(rule_type or "").strip() or None
    if not sanitized_rule:
        return None
    return normalized_type


def _confidence_to_score(value: Any) -> float:
    if isinstance(value, (int, float)):
        return max(0.0, min(1.0, float(value)))
    lookup = {
        "HIGH": 0.9,
        "MEDIUM": 0.6,
        "LOW": 0.3,
    }
    return lookup.get(str(value).upper(), 0.0)


def _extract_sse_text(raw: str) -> str | None:
    text = raw.strip()
    if not text.startswith("event:"):
        return None

    final_payload: dict[str, Any] | None = None
    for chunk in text.split("\n\n"):
        lines = [line for line in chunk.splitlines() if line.strip()]
        if not lines:
            continue

        event_name: str | None = None
        data_parts: list[str] = []
        for line in lines:
            if line.startswith("event:"):
                event_name = line.partition(":")[2].strip()
            elif line.startswith("data:"):
                data_parts.append(line.partition(":")[2].lstrip())

        if event_name != "response" or not data_parts:
            continue

        raw_data = "\n".join(data_parts).strip()
        if raw_data == "[DONE]":
            continue

        try:
            payload = json.loads(raw_data)
        except json.JSONDecodeError:
            continue

        if isinstance(payload, dict):
            final_payload = payload

    if not final_payload:
        return None

    content = final_payload.get("content", [])
    if not isinstance(content, list):
        return None

    text_parts: list[str] = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        block_text = block.get("text", "")
        if isinstance(block_text, str) and block_text.strip():
            text_parts.append(block_text.strip())

    return "\n\n".join(text_parts).strip() or None


def _find_nested_string(payload: Any, key: str) -> str | None:
    if isinstance(payload, dict):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value
        for nested in payload.values():
            found = _find_nested_string(nested, key)
            if found:
                return found
    if isinstance(payload, list):
        for nested in payload:
            found = _find_nested_string(nested, key)
            if found:
                return found
    return None


def _find_nested_int(payload: Any, key: str) -> int | None:
    if isinstance(payload, dict):
        value = payload.get(key)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
        for nested in payload.values():
            found = _find_nested_int(nested, key)
            if found is not None:
                return found
    if isinstance(payload, list):
        for nested in payload:
            found = _find_nested_int(nested, key)
            if found is not None:
                return found
    return None


def _extract_assistant_message_id(payload: dict[str, Any] | None) -> int | None:
    if not isinstance(payload, dict):
        return None
    metadata = payload.get("metadata")
    if isinstance(metadata, dict):
        assistant_message_id = metadata.get("assistant_message_id") or metadata.get("message_id")
        if isinstance(assistant_message_id, int):
            return assistant_message_id
        if isinstance(assistant_message_id, str) and assistant_message_id.isdigit():
            return int(assistant_message_id)
    message = payload.get("message")
    if isinstance(message, dict):
        metadata = message.get("metadata")
        if isinstance(metadata, dict):
            assistant_message_id = metadata.get("assistant_message_id") or metadata.get("message_id")
            role = str(metadata.get("role") or "").strip().lower()
            if role in {"", "assistant"}:
                if isinstance(assistant_message_id, int):
                    return assistant_message_id
                if isinstance(assistant_message_id, str) and assistant_message_id.isdigit():
                    return int(assistant_message_id)

    def visit(node: Any) -> int | None:
        if isinstance(node, dict):
            role = str(node.get("role") or "").strip().lower()
            message_id = (
                node.get("assistant_message_id")
                or node.get("message_id")
            )
            if role == "assistant":
                if isinstance(message_id, int):
                    return message_id
                if isinstance(message_id, str) and message_id.isdigit():
                    return int(message_id)
            for nested in node.values():
                found = visit(nested)
                if found is not None:
                    return found
        if isinstance(node, list):
            for nested in node:
                found = visit(nested)
                if found is not None:
                    return found
        return None

    return visit(payload) or _find_nested_int(payload, "message_id")


def _extract_stream_message_metadata(
    event_name: str,
    payload: Any,
) -> dict[str, int | str] | None:
    if event_name != "metadata" or not isinstance(payload, dict):
        return None
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        return None
    role = str(metadata.get("role") or "").strip().lower()
    message_id = metadata.get("message_id")
    if not role:
        return None
    if isinstance(message_id, str) and message_id.isdigit():
        return {"role": role, "message_id": int(message_id)}
    if isinstance(message_id, int):
        return {"role": role, "message_id": message_id}
    return None


def _extract_stream_response_payload(event_name: str, payload: Any) -> dict[str, Any] | None:
    if event_name == "response" and isinstance(payload, dict):
        return payload
    if isinstance(payload, dict):
        response = payload.get("response")
        if isinstance(response, dict):
            return response
    return None


def _extract_stream_message_text(payload: dict[str, Any] | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    content = payload.get("content")
    if not isinstance(content, list):
        message = payload.get("message")
        if isinstance(message, dict):
            content = message.get("content")
    if not isinstance(content, list):
        return None
    text_parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text":
            text_value = block.get("text")
            if isinstance(text_value, str) and text_value:
                text_parts.append(text_value)
        elif block.get("type") == "output_text":
            text_value = block.get("text")
            if isinstance(text_value, str) and text_value:
                text_parts.append(text_value)
    return "".join(text_parts).strip() or None


class _StructuredAnswerDeltaFilter:
    """Prevent the agent's JSON response contract from appearing in chat."""

    def __init__(self) -> None:
        self._pending = ""
        self._mode = "undecided"

    def push(self, delta: str) -> str | None:
        if not delta:
            return None
        if self._mode == "structured":
            return None
        if self._mode == "plain":
            return delta

        self._pending += delta
        candidate = self._pending.lstrip()
        if not candidate:
            return None

        structured_prefixes = ("{", "```json", "```JSON")
        if any(candidate.startswith(prefix) for prefix in structured_prefixes):
            self._mode = "structured"
            self._pending = ""
            return None
        if any(prefix.startswith(candidate) for prefix in structured_prefixes):
            return None

        self._mode = "plain"
        output = self._pending
        self._pending = ""
        return output


def _extract_stream_text_delta(event_name: str, payload: Any) -> str | None:
    if isinstance(payload, str):
        return payload if event_name.endswith("delta") else None

    if not isinstance(payload, dict):
        return None

    # Cortex Agents emits answer tokens as:
    #   event: response.text.delta
    #   data: {"content_index": 0, "text": "..."}
    # Do not treat response.thinking.delta as answer text.
    if event_name == "response.text.delta":
        text_value = payload.get("text")
        if isinstance(text_value, str) and text_value:
            return text_value

    for key in ("delta", "text_delta", "output_text"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
        if isinstance(value, dict):
            nested_text = value.get("text") or value.get("value")
            if isinstance(nested_text, str) and nested_text:
                return nested_text

    content = payload.get("content")
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") in {"text_delta", "output_text_delta"}:
                text_value = block.get("text") or block.get("value")
                if isinstance(text_value, str) and text_value:
                    parts.append(text_value)
        if parts:
            return "".join(parts)

    return None


def _extract_stream_suggestions(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return []

    suggestions = payload.get("suggestions")
    if isinstance(suggestions, list):
        return [str(item) for item in suggestions if item is not None]

    content = payload.get("content")
    if isinstance(content, list):
        items: list[str] = []
        for block in content:
            if (
                isinstance(block, dict)
                and block.get("type") == "suggestions"
                and isinstance(block.get("suggestions"), list)
            ):
                items.extend(str(item) for item in block["suggestions"] if item is not None)
        return items

    return []


def _extract_stream_status(event_name: str, payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("message", "status", "phase", "title"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                if event_name.endswith("delta") and key == "message":
                    continue
                return value.strip()
    return None


def _semantic_summary(payload: Any) -> str:
    if isinstance(payload, dict):
        for key in ("domain_summary", "description", "summary"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    if isinstance(payload, list) and payload:
        return f"{len(payload)} semantic attributes available"
    return "Semantic model available"
