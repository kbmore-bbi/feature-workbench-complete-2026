"""Direct AGT_SOURCE_MAPPING invocation router.

This router provides a direct endpoint to the AGT_SOURCE_MAPPING agent,
bypassing the AGT_STTM_BUILDER orchestrator for faster auto-mapping.

The direct invocation:
1. Builds full semantic context from SemanticContextService
2. Injects comprehensive FIR learning context from LearningRetrievalService
3. Calls AGT_SOURCE_MAPPING directly with the enriched payload
4. Returns the same response format as the WebSocket streaming path
"""

import json
import logging
import time
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import (
    get_automap_snowflake_client,
    get_semantic_context_service,
    get_snowflake_agent_client,
)
from app.auth.dependencies import get_current_principal
from app.core.config import Settings, get_settings
from app.core.agent_payload_budget import budget_agent_payload
from app.core.agent_execution_context import attach_agent_execution_context
from app.core.conversation_memory import ConversationMemoryService
from app.core.learning_retrieval import LearningRetrievalService
from app.core.semantic_context import SemanticContextService
from app.core.snowflake import SnowflakeClient
from app.core.snowflake_agent import SnowflakeAgentClient
from app.core.exceptions import (
    AppError,
    ContextPrecedentUnavailableError,
    SemanticAssetNotFoundError,
    SnowflakeAgentError,
)
from app.guardrails.config.loader import load_config
from app.guardrails.contracts.decisions import GovernanceDecision
from app.guardrails.integrations.fastapi import attach_governance_decision
from app.guardrails.runtime.preflight import PreflightGuard
from app.guardrails.runtime.postflight import PostflightGuard
from app.schema.common import TableRef
from app.schema.contracts import ApiError, ApiWarning, resolve_request_id
from app.schema.semantic_context import (
    SemanticContextRefreshRequest,
    SemanticLevel,
    SemanticSurface,
)
from app.schema.sttm_builder import (
    AttributeMapping,
    Interface,
    LearningContext,
    RelationshipContextItem,
    RelationGraphContext,
    SemanticContextItem,
    SourceMappingResult,
    STTMAgentRequestEnvelope,
    STTMBuilderContext,
    STTMBuilderEnvelopeRequest,
    STTMBuilderRequestData,
    STTMBuilderResponse,
    STTMArtifactType,
    STTMOperation,
    STTMStatus,
    SubAgent,
    TargetAttributeItem,
)
from app.schema.workspace_context import WorkbenchContextSnapshotV1

router = APIRouter(prefix="/workbench", tags=["Auto Mapping"])
logger = logging.getLogger(__name__)


class DirectAutoMapRequest(BaseModel):
    """Request schema for direct AGT_SOURCE_MAPPING invocation."""

    request_id: str | None = None
    attributes: list[TargetAttributeItem] = Field(
        ..., min_length=1, description="Target attributes to map"
    )
    source_tables: list[TableRef] = Field(
        ..., min_length=1, description="Source tables available for mapping"
    )
    target_table: TableRef | None = Field(
        default=None, description="Target table for the mapping"
    )
    driving_table: TableRef | None = Field(
        default=None, description="Driving table in the mapping context"
    )
    relationships: list[RelationshipContextItem] | None = Field(
        default=None, description="Relationships between tables"
    )
    semantic_context: list[SemanticContextItem] | None = Field(
        default=None, description="Pre-resolved semantic context"
    )
    selected_columns_by_table: dict[str, list[str]] | None = Field(
        default=None, description="Selected columns grouped by table"
    )
    selected_derived_sources: list[str] | None = Field(
        default=None, description="Selected derived source IDs"
    )
    semantic_bundle_id: str | None = Field(
        default=None, description="Existing semantic bundle ID"
    )
    semantic_bundle_label: str | None = Field(
        default=None, description="Semantic bundle label"
    )
    semantic_view_name: str | None = Field(
        default=None, description="Semantic view name"
    )
    derived_source_lineage: list[dict[str, Any]] | None = Field(
        default=None, description="Derived source lineage"
    )
    datahub_context: dict[str, Any] | None = Field(
        default=None, description="DataHub context"
    )
    mapping_intent: dict[str, Any] | None = Field(
        default=None, description="Mapping intent for FIR learning"
    )
    message: str | None = Field(
        default=None, description="Optional user guidance or correction"
    )
    project_id: str | None = Field(
        default=None, description="Project ID for FIR learning context"
    )
    sttm_id: str | None = Field(default=None, description="Current mapping/STTM ID")
    workspace_context: dict[str, Any] | None = Field(
        default=None, description="Workspace context snapshot"
    )
    relation_graph: RelationGraphContext | None = Field(
        default=None,
        description="Unified physical, derived, CTE, join, and Value relation graph",
    )
    prepared_context_hash: str | None = None


class DirectAutoMapResponse(BaseModel):
    """Response schema for direct AGT_SOURCE_MAPPING invocation."""

    request_id: str
    status: STTMStatus
    mappings: dict[str, AttributeMapping]
    message: str | None = None
    warnings: list[ApiWarning] = Field(default_factory=list)
    error: ApiError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)
    semantic_refresh_status: dict[str, Any] | None = None


def _build_governance_decision(
    request_id: str,
    operation: str,
    persona: str | None = None,
) -> GovernanceDecision:
    return GovernanceDecision(
        trace_id=str(uuid.uuid4()),
        request_id=request_id,
        operation=operation,
        persona=persona,
        redaction_count=0,
        detected_pii=[],
    )


def _apply_preflight(
    request: Request,
    body: DirectAutoMapRequest,
    settings: Settings,
) -> tuple[DirectAutoMapRequest, GovernanceDecision]:
    """Apply guardrails preflight to the request."""
    request_id = body.request_id or resolve_request_id(request)
    principal = get_current_principal(request)

    guard = PreflightGuard(load_config(settings=settings))
    decision = _build_governance_decision(
        request_id=request_id,
        operation="sttm.auto_map.direct",
        persona=principal.app_persona.value,
    )
    attach_governance_decision(request, decision)

    if not body.request_id:
        body = body.model_copy(update={"request_id": request_id})

    return body, decision


def _build_envelope_request(
    body: DirectAutoMapRequest,
) -> STTMBuilderEnvelopeRequest:
    """Convert DirectAutoMapRequest to STTMBuilderEnvelopeRequest."""
    workspace_context = None
    if body.workspace_context:
        try:
            workspace_context = WorkbenchContextSnapshotV1.model_validate(
                body.workspace_context
            )
        except Exception:
            pass

    return STTMBuilderEnvelopeRequest(
        request_id=body.request_id,
        operation=STTMOperation.AUTO_MAP,
        context=STTMBuilderContext(
            source_tables=body.source_tables,
            target_table=body.target_table,
            driving_table=body.driving_table,
            relationships=body.relationships,
            semantic_context=body.semantic_context,
            selected_columns_by_table=body.selected_columns_by_table,
            selected_derived_sources=body.selected_derived_sources,
            semantic_bundle_id=body.semantic_bundle_id,
            semantic_bundle_label=body.semantic_bundle_label,
            semantic_view_name=body.semantic_view_name,
            derived_source_lineage=body.derived_source_lineage,
            datahub_context=body.datahub_context,
            mapping_intent=body.mapping_intent,
            workspace_context=workspace_context,
            surface=SemanticSurface.MAPPING,
            semantic_level_requested=SemanticLevel.FULL_REGISTRY,
            project_id=body.project_id,
            sttm_id=body.sttm_id,
            relation_graph=body.relation_graph,
            prepared_context_hash=body.prepared_context_hash,
        ),
        data=STTMBuilderRequestData(
            intent=Interface.AUTO_MAP,
            attributes=body.attributes,
            message=body.message,
        ),
    )


def _enrich_with_learning_context(
    envelope: STTMBuilderEnvelopeRequest,
    learning_service: LearningRetrievalService,
) -> STTMBuilderEnvelopeRequest:
    """Enrich the request with comprehensive FIR learning context."""
    try:
        project_id = envelope.context.project_id or ""
        source_tables = [
            f"{t.database}.{t.schema}.{t.table}"
            for t in (envelope.context.source_tables or [])
        ]
        target_table = ""
        if envelope.context.target_table:
            t = envelope.context.target_table
            target_table = f"{t.database}.{t.schema}.{t.table}"
        target_columns = [
            attr.target_attribute for attr in (envelope.data.attributes or [])
        ]
        workspace = envelope.context.workspace_context

        learning_context = learning_service.get_comprehensive_learning_context(
            project_id=project_id,
            source_tables=source_tables,
            target_table=target_table,
            target_columns=target_columns,
            mapping_intent=envelope.context.mapping_intent,
            sttm_id=envelope.context.sttm_id,
            context_key=workspace.context_key if workspace else None,
            source_set_hash=workspace.source_set_hash if workspace else None,
            derived_set_hash=workspace.derived_set_hash if workspace else None,
            milestone=workspace.milestone if workspace else None,
            target_agent="AGT_SOURCE_MAPPING",
        )

        return envelope.model_copy(
            update={
                "context": envelope.context.model_copy(
                    update={"learning_context": learning_context}
                )
            }
        )
    except ContextPrecedentUnavailableError:
        raise
    except Exception as exc:
        logger.warning("Failed to enrich request with learning context: %s", exc)
        return envelope


def _build_agent_payload(
    envelope: STTMBuilderEnvelopeRequest,
    settings: Settings,
    reading_instructions: dict[str, Any] | None = None,
) -> str:
    """Build the JSON payload for AGT_SOURCE_MAPPING."""
    agent_envelope = STTMAgentRequestEnvelope.from_builder_request(envelope)
    # Add learning context to agent envelope
    agent_dict = agent_envelope.model_dump(mode="json", exclude_none=True)
    if envelope.context.learning_context:
        agent_dict["context"]["learning_context"] = envelope.context.learning_context.model_dump(
            mode="json"
        )
    # Add reading instructions if available
    if reading_instructions:
        agent_dict["context"]["reading_instructions"] = reading_instructions
    return budget_agent_payload(
        agent_dict,
        max_chars=settings.agent_outbound_message_max_chars,
        max_bytes=settings.agent_outbound_message_max_bytes,
        enabled=settings.agent_payload_budget_v1,
    ).text


def _parse_mapping_response(
    raw_text: str,
) -> tuple[dict[str, AttributeMapping], str | None, list[ApiWarning], ApiError | None]:
    """Parse the AGT_SOURCE_MAPPING response."""
    try:
        # Extract JSON from the response
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("No JSON object found in response")

        json_str = raw_text[start : end + 1]
        envelope = json.loads(json_str)

        data = envelope.get("data", envelope)
        result = data.get("result", {})
        raw_mappings = result.get("mappings", {})
        message = data.get("message")

        warnings = []
        for warning in envelope.get("warnings", []):
            if isinstance(warning, dict):
                warnings.append(
                    ApiWarning(
                        code=warning.get("code", "AGENT_WARNING"),
                        message=warning.get("message", str(warning)),
                    )
                )
            elif isinstance(warning, str):
                warnings.append(ApiWarning(code="AGENT_WARNING", message=warning))

        error = None
        raw_error = envelope.get("error")
        if raw_error and isinstance(raw_error, dict):
            error = ApiError(
                title=raw_error.get("title", "Agent error"),
                detail=raw_error.get("detail", str(raw_error)),
                code=raw_error.get("code", "AGENT_ERROR"),
            )

        # Parse mappings
        mappings: dict[str, AttributeMapping] = {}
        if isinstance(raw_mappings, dict):
            for target, value in raw_mappings.items():
                if isinstance(value, dict):
                    mappings[target] = AttributeMapping.model_validate(value)

        return mappings, message, warnings, error

    except json.JSONDecodeError as exc:
        logger.error("Failed to parse agent response as JSON: %s", exc)
        return (
            {},
            None,
            [],
            ApiError(
                title="Invalid agent response",
                detail=f"Failed to parse response: {exc}",
                code="AGENT_PARSE_ERROR",
            ),
        )
    except Exception as exc:
        logger.error("Failed to parse agent response: %s", exc)
        return (
            {},
            None,
            [],
            ApiError(
                title="Agent response error",
                detail=str(exc),
                code="AGENT_RESPONSE_ERROR",
            ),
        )


@router.post(
    "/auto-map/direct",
    response_model=DirectAutoMapResponse,
    summary="Direct AGT_SOURCE_MAPPING invocation",
    description=(
        "Invokes AGT_SOURCE_MAPPING directly, bypassing the AGT_STTM_BUILDER orchestrator "
        "for faster auto-mapping. Builds full semantic context and injects FIR learning context "
        "before calling the agent."
    ),
)
async def direct_auto_map(
    request: Request,
    body: DirectAutoMapRequest,
    agent_client: Annotated[SnowflakeAgentClient, Depends(get_snowflake_agent_client)],
    client: Annotated[SnowflakeClient, Depends(get_automap_snowflake_client)],
    semantic_context_service: Annotated[
        SemanticContextService, Depends(get_semantic_context_service)
    ],
    settings: Annotated[Settings, Depends(get_settings)],
) -> DirectAutoMapResponse:
    """
    Direct invocation of AGT_SOURCE_MAPPING for fast auto-mapping.

    This endpoint:
    1. Applies guardrails preflight
    2. Resolves/refreshes semantic context if needed
    3. Enriches the request with FIR learning context
    4. Calls AGT_SOURCE_MAPPING directly
    5. Returns parsed mapping results
    """
    started_at = time.perf_counter()
    body, decision = _apply_preflight(request, body, settings)
    request_id = body.request_id or str(uuid.uuid4())

    # Build envelope request
    envelope = _build_envelope_request(body)

    # Resolve semantic context if not pre-populated
    semantic_ms = 0.0
    reading_instructions: dict[str, Any] | None = None
    if not body.semantic_context and body.source_tables:
        try:
            semantic_started = time.perf_counter()
            refresh_response = semantic_context_service.refresh_bundle(
                SemanticContextRefreshRequest(
                    selected_source_tables=body.source_tables,
                    selected_derived_sources=body.selected_derived_sources or [],
                    target_table=body.target_table,
                    relationships=[
                        rel.model_dump(mode="json") if hasattr(rel, "model_dump") else rel
                        for rel in (body.relationships or [])
                    ],
                    selected_columns_by_table=body.selected_columns_by_table or {},
                    requested_level=SemanticLevel.L3_MAPPING_ENRICHED,
                    force=False,
                )
            )
            semantic_ms = (time.perf_counter() - semantic_started) * 1000

            # Capture reading instructions for the agent
            if refresh_response.reading_instructions:
                reading_instructions = refresh_response.reading_instructions.model_dump(mode="json")

            # Update envelope with refreshed semantic context
            envelope = envelope.model_copy(
                update={
                    "context": envelope.context.model_copy(
                        update={
                            "semantic_context": [
                                SemanticContextItem.model_validate(item)
                                for item in refresh_response.semantic_context
                            ],
                            "semantic_bundle_id": refresh_response.bundle_id,
                            "semantic_bundle_label": refresh_response.bundle_label,
                            "semantic_view_name": refresh_response.semantic_view_name,
                            "derived_source_lineage": [
                                item.model_dump(mode="json")
                                for item in refresh_response.lineage
                            ],
                            "datahub_context": refresh_response.datahub_context,
                        }
                    )
                }
            )
        except SemanticAssetNotFoundError as exc:
            return DirectAutoMapResponse(
                request_id=request_id,
                status=STTMStatus.FAILED,
                mappings={},
                message=None,
                warnings=[],
                error=ApiError(
                    title="Semantic assets not found",
                    detail=exc.message,
                    code="SEMANTIC_ASSET_NOT_FOUND",
                ),
                meta={"timings_ms": {"total": round((time.perf_counter() - started_at) * 1000, 1)}},
            )
        except Exception as exc:
            logger.warning("Semantic context refresh failed: %s", exc)

    # Persist the exact UI context before retrieval so the hot path only reads
    # precomputed FIR outputs for the same context key.
    memory = ConversationMemoryService(client.session, settings)
    envelope = attach_agent_execution_context(envelope, memory)

    # Enrich with FIR learning context
    learning_service = LearningRetrievalService(client.session, settings)
    envelope = _enrich_with_learning_context(envelope, learning_service)
    envelope = attach_agent_execution_context(envelope, memory)

    # Build agent payload with reading instructions
    user_text = _build_agent_payload(
        envelope,
        settings,
        reading_instructions=reading_instructions,
    )
    messages = [{"role": "user", "content": [{"type": "text", "text": user_text}]}]

    # Resolve the source mapping agent name
    source_mapping_agent = settings.resolved_source_mapping_agent.strip()
    if not source_mapping_agent:
        return DirectAutoMapResponse(
            request_id=request_id,
            status=STTMStatus.FAILED,
            mappings={},
            message=None,
            warnings=[],
            error=ApiError(
                title="Agent configuration error",
                detail="Source mapping agent not configured",
                code="AGENT_NOT_CONFIGURED",
            ),
            meta={"timings_ms": {"total": round((time.perf_counter() - started_at) * 1000, 1)}},
        )

    # Call AGT_SOURCE_MAPPING directly
    agent_ms = 0.0
    try:
        agent_started = time.perf_counter()
        raw_text, thread_id, raw_payload = agent_client.run_detailed(
            messages,
            agent=source_mapping_agent,
            thread_id=None,
            parent_message_id=None,
        )
        agent_ms = (time.perf_counter() - agent_started) * 1000

        mappings, message, warnings, error = _parse_mapping_response(raw_text)

        # Apply postflight guardrails
        config = load_config(settings=settings)
        postflight = PostflightGuard(config)

        total_ms = (time.perf_counter() - started_at) * 1000
        meta = {
            "timings_ms": {
                "semantic_context": round(semantic_ms, 1),
                "agent": round(agent_ms, 1),
                "total": round(total_ms, 1),
            },
            "direct_invocation": True,
            "agent": source_mapping_agent,
            "learning_context_provided": envelope.context.learning_context is not None,
        }

        status = STTMStatus.COMPLETED if mappings and not error else STTMStatus.FAILED

        try:
            used_inference_ids = sorted({
                value
                for mapping in mappings.values()
                for value in mapping.used_inference_ids
                if value
            })
            used_recommendation_ids = sorted({
                value
                for mapping in mappings.values()
                for value in mapping.used_recommendation_ids
                if value
            })
            workspace = envelope.context.workspace_context
            execution = envelope.context.execution_context
            context_key = (execution.context_key if execution else None) or (workspace.context_key if workspace else "")
            snapshot_id = (execution.snapshot_id if execution else None) or (workspace.snapshot_id if workspace else None)
            artifact_id = memory.record_agent_artifact(
                request_id=request_id,
                session_id=envelope.context.session_id,
                thread_id=thread_id,
                agent_name=source_mapping_agent,
                artifact_type="source_mapping",
                payload={
                    "mappings": {
                        key: value.model_dump(mode="json", exclude_none=True)
                        for key, value in mappings.items()
                    },
                    "message": message,
                    "raw_agent_payload": raw_payload,
                },
                artifact_status="completed" if status == STTMStatus.COMPLETED else "failed",
                entity_type="sttm",
                entity_ids=[
                    value for value in (envelope.context.project_id, envelope.context.sttm_id) if value
                ],
                semantic_bundle_id=envelope.context.semantic_bundle_id,
                semantic_bundle_hash=workspace.semantic.bundle_hash if workspace else None,
                summary=message,
                created_by=envelope.actor.user_id if envelope.actor else None,
                context_key=context_key,
                snapshot_id=snapshot_id,
                retrieved_inference_ids=(
                    execution.retrieved_inference_ids if execution else []
                ),
                retrieved_recommendation_ids=(
                    execution.retrieved_recommendation_ids if execution else []
                ),
                used_inference_ids=used_inference_ids,
                used_recommendation_ids=used_recommendation_ids,
            )
            for recommendation_id in used_recommendation_ids:
                memory.record_fir_recommendation_outcome(
                    recommendation_id=recommendation_id,
                    outcome_type="used",
                    context_key=context_key,
                    snapshot_id=snapshot_id,
                    request_id=request_id,
                    artifact_id=artifact_id,
                    user_id=envelope.actor.user_id if envelope.actor else None,
                    payload={"agent_name": source_mapping_agent, "artifact_type": "source_mapping"},
                )
        except Exception as exc:
            logger.warning("Could not persist direct auto-map FIR artifact: %s", exc)

        return DirectAutoMapResponse(
            request_id=request_id,
            status=status,
            mappings=mappings,
            message=message,
            warnings=warnings + [
                ApiWarning(code=w.code, message=w.message)
                for w in decision.warnings
            ],
            error=error,
            meta=meta,
            semantic_refresh_status={
                "bundle_id": envelope.context.semantic_bundle_id,
                "bundle_label": envelope.context.semantic_bundle_label,
                "semantic_view_name": envelope.context.semantic_view_name,
            } if envelope.context.semantic_bundle_id else None,
        )

    except SnowflakeAgentError as exc:
        logger.error("AGT_SOURCE_MAPPING invocation failed: %s", exc)
        return DirectAutoMapResponse(
            request_id=request_id,
            status=STTMStatus.FAILED,
            mappings={},
            message=None,
            warnings=[ApiWarning(code=w.code, message=w.message) for w in decision.warnings],
            error=ApiError(
                title="Agent invocation failed",
                detail=str(exc),
                code="AGENT_INVOCATION_ERROR",
            ),
            meta={
                "timings_ms": {
                    "semantic_context": round(semantic_ms, 1),
                    "total": round((time.perf_counter() - started_at) * 1000, 1),
                },
                "direct_invocation": True,
            },
        )


@router.post(
    "/auto-map/direct/stream",
    summary="Direct AGT_SOURCE_MAPPING invocation with SSE streaming",
    description=(
        "Invokes AGT_SOURCE_MAPPING directly with Server-Sent Events streaming "
        "for real-time progress updates."
    ),
)
async def direct_auto_map_stream(
    request: Request,
    body: DirectAutoMapRequest,
    agent_client: Annotated[SnowflakeAgentClient, Depends(get_snowflake_agent_client)],
    client: Annotated[SnowflakeClient, Depends(get_automap_snowflake_client)],
    semantic_context_service: Annotated[
        SemanticContextService, Depends(get_semantic_context_service)
    ],
    settings: Annotated[Settings, Depends(get_settings)],
) -> StreamingResponse:
    """
    Direct invocation of AGT_SOURCE_MAPPING with SSE streaming for progress updates.
    """

    def emit(event: str, data: dict[str, Any]) -> str:
        return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"

    async def stream_generator():
        started_at = time.perf_counter()
        body_copy, decision = _apply_preflight(request, body, settings)
        request_id = body_copy.request_id or str(uuid.uuid4())

        yield emit("status", {"phase": "started", "message": "Direct auto-mapping started."})

        # Build envelope request
        envelope = _build_envelope_request(body_copy)
        memory = ConversationMemoryService(client.session, settings)
        envelope = attach_agent_execution_context(envelope, memory)

        # Resolve semantic context if needed
        semantic_ms = 0.0
        reading_instructions: dict[str, Any] | None = None
        if not body_copy.semantic_context and body_copy.source_tables:
            yield emit(
                "status",
                {"phase": "semantic_context", "message": "Resolving semantic context..."},
            )
            try:
                semantic_started = time.perf_counter()
                refresh_response = semantic_context_service.refresh_bundle(
                    SemanticContextRefreshRequest(
                        selected_source_tables=body_copy.source_tables,
                        selected_derived_sources=body_copy.selected_derived_sources or [],
                        target_table=body_copy.target_table,
                        relationships=[
                            rel.model_dump(mode="json") if hasattr(rel, "model_dump") else rel
                            for rel in (body_copy.relationships or [])
                        ],
                        selected_columns_by_table=body_copy.selected_columns_by_table or {},
                        requested_level=SemanticLevel.L3_MAPPING_ENRICHED,
                        force=False,
                    )
                )
                semantic_ms = (time.perf_counter() - semantic_started) * 1000

                # Capture reading instructions for the agent
                if refresh_response.reading_instructions:
                    reading_instructions = refresh_response.reading_instructions.model_dump(mode="json")

                envelope = envelope.model_copy(
                    update={
                        "context": envelope.context.model_copy(
                            update={
                                "semantic_context": [
                                    SemanticContextItem.model_validate(item)
                                    for item in refresh_response.semantic_context
                                ],
                                "semantic_bundle_id": refresh_response.bundle_id,
                                "semantic_bundle_label": refresh_response.bundle_label,
                                "semantic_view_name": refresh_response.semantic_view_name,
                            }
                        )
                    }
                )

                yield emit(
                    "status",
                    {
                        "phase": "semantic_context_ready",
                        "message": "Semantic context resolved.",
                        "bundle_id": refresh_response.bundle_id,
                    },
                )
            except SemanticAssetNotFoundError as exc:
                yield emit(
                    "error",
                    {
                        "request_id": request_id,
                        "message": exc.message,
                        "code": "SEMANTIC_ASSET_NOT_FOUND",
                    },
                )
                return
            except Exception as exc:
                logger.warning("Semantic context refresh failed: %s", exc)
                yield emit(
                    "status",
                    {"phase": "semantic_context_warning", "message": f"Semantic refresh warning: {exc}"},
                )

        # Enrich with learning context
        yield emit("status", {"phase": "learning_context", "message": "Enriching with FIR learnings..."})
        learning_service = LearningRetrievalService(client.session, settings)
        envelope = _enrich_with_learning_context(envelope, learning_service)
        envelope = attach_agent_execution_context(envelope, memory)

        # Build agent payload with reading instructions
        user_text = _build_agent_payload(
            envelope,
            settings,
            reading_instructions=reading_instructions,
        )
        messages = [{"role": "user", "content": [{"type": "text", "text": user_text}]}]

        source_mapping_agent = settings.resolved_source_mapping_agent.strip()
        if not source_mapping_agent:
            yield emit(
                "error",
                {
                    "request_id": request_id,
                    "message": "Source mapping agent not configured",
                    "code": "AGENT_NOT_CONFIGURED",
                },
            )
            return

        # Call agent with streaming
        yield emit(
            "status",
            {"phase": "agent_started", "message": "AGT_SOURCE_MAPPING is generating mapping suggestions."},
        )

        try:
            agent_started = time.perf_counter()
            text_parts: list[str] = []

            for event_name, payload in agent_client.stream_events(
                messages,
                agent=source_mapping_agent,
                thread_id=None,
                parent_message_id=None,
            ):
                # Extract text deltas
                if isinstance(payload, dict):
                    delta = payload.get("delta") or payload.get("text_delta")
                    if isinstance(delta, str) and delta:
                        text_parts.append(delta)
                        yield emit("delta", {"text": delta})

            agent_ms = (time.perf_counter() - agent_started) * 1000
            raw_text = "".join(text_parts)

            mappings, message, warnings, error = _parse_mapping_response(raw_text)

            total_ms = (time.perf_counter() - started_at) * 1000

            final_response = DirectAutoMapResponse(
                request_id=request_id,
                status=STTMStatus.COMPLETED if mappings and not error else STTMStatus.FAILED,
                mappings=mappings,
                message=message,
                warnings=warnings,
                error=error,
                meta={
                    "timings_ms": {
                        "semantic_context": round(semantic_ms, 1),
                        "agent": round(agent_ms, 1),
                        "total": round(total_ms, 1),
                    },
                    "direct_invocation": True,
                    "streaming": True,
                },
                semantic_refresh_status={
                    "bundle_id": envelope.context.semantic_bundle_id,
                    "bundle_label": envelope.context.semantic_bundle_label,
                    "semantic_view_name": envelope.context.semantic_view_name,
                } if envelope.context.semantic_bundle_id else None,
            )

            try:
                used_inference_ids = sorted({
                    value
                    for mapping in mappings.values()
                    for value in mapping.used_inference_ids
                    if value
                })
                used_recommendation_ids = sorted({
                    value
                    for mapping in mappings.values()
                    for value in mapping.used_recommendation_ids
                    if value
                })
                workspace = envelope.context.workspace_context
                execution = envelope.context.execution_context
                artifact_id = memory.record_agent_artifact(
                    request_id=request_id,
                    session_id=envelope.context.session_id,
                    thread_id=None,
                    agent_name=source_mapping_agent,
                    artifact_type="source_mapping",
                    payload=final_response.model_dump(mode="json"),
                    artifact_status="completed" if mappings and not error else "failed",
                    entity_type="sttm",
                    entity_ids=[
                        value
                        for value in (
                            envelope.context.project_id,
                            envelope.context.sttm_id,
                        )
                        if value
                    ],
                    semantic_bundle_id=envelope.context.semantic_bundle_id,
                    semantic_bundle_hash=(
                        workspace.semantic.bundle_hash if workspace else None
                    ),
                    summary=message,
                    created_by=envelope.actor.user_id if envelope.actor else None,
                    context_key=(
                        execution.context_key
                        if execution
                        else workspace.context_key if workspace else ""
                    ),
                    snapshot_id=(
                        execution.snapshot_id
                        if execution
                        else workspace.snapshot_id if workspace else None
                    ),
                    retrieved_inference_ids=(
                        execution.retrieved_inference_ids if execution else []
                    ),
                    retrieved_recommendation_ids=(
                        execution.retrieved_recommendation_ids if execution else []
                    ),
                    used_inference_ids=used_inference_ids,
                    used_recommendation_ids=used_recommendation_ids,
                )
                for recommendation_id in used_recommendation_ids:
                    memory.record_fir_recommendation_outcome(
                        recommendation_id=recommendation_id,
                        outcome_type="used",
                        context_key=execution.context_key if execution else "",
                        snapshot_id=execution.snapshot_id if execution else None,
                        request_id=request_id,
                        artifact_id=artifact_id,
                        user_id=envelope.actor.user_id if envelope.actor else None,
                        payload={
                            "agent_name": source_mapping_agent,
                            "artifact_type": "source_mapping",
                            "streaming": True,
                        },
                    )
            except Exception as exc:
                logger.warning("Unable to persist streaming Auto-map FIR lineage: %s", exc)

            yield emit("final", final_response.model_dump(mode="json"))

        except SnowflakeAgentError as exc:
            logger.error("AGT_SOURCE_MAPPING streaming failed: %s", exc)
            yield emit(
                "error",
                {
                    "request_id": request_id,
                    "message": str(exc),
                    "code": "AGENT_STREAMING_ERROR",
                },
            )

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
