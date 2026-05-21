import json
import logging
import re
import uuid
from collections.abc import Iterator
from typing import Any

from pydantic import ValidationError
from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.exceptions import SnowflakeAgentError
from app.core.semantic_context import SemanticContextService
from app.core.semantic_model import SemanticModelService
from app.core.snowflake_agent import SnowflakeAgentClient
from app.core.snowflake_analyst import SnowflakeAnalystClient
from app.schema.contracts import ApiError, ApiWarning
from app.schema.semantic_context import SemanticContextRefreshRequest, SemanticLevel, SemanticSurface
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
    SubAgent,
    TransformationResult,
)

logger = logging.getLogger(__name__)


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
    ) -> None:
        self._agent = agent_client
        self._analyst = analyst_client
        self._settings = settings
        self._session = session
        self._semantic_model_service = semantic_model_service
        self._semantic_context_service = semantic_context_service

        agent_name = settings.resolved_sttm_builder_agent.strip()
        if not agent_name:
            raise SnowflakeAgentError(
                "Could not resolve the STTM builder agent. Set "
                "SNOWFLAKE_STTM_BUILDER_AGENT or provide the metadata "
                "database/schema configuration."
            )
        self._agent_name = agent_name

    def invoke(self, req: STTMBuilderEnvelopeRequest) -> STTMBuilderResponse:
        req, semantic_refresh = self._with_semantic_context(req)

        user_text = self._build_agent_payload(req)
        logger.info(
            "Sending STTM agent payload: request_id=%s operation=%s chars=%s surface=%s level=%s bundle=%s",
            req.request_id,
            req.operation.value,
            len(user_text),
            req.context.surface.value,
            req.context.semantic_level_requested.value,
            req.context.semantic_bundle_id,
        )

        thread_id_to_use = None if self._should_reset_thread(req) else req.context.thread_id

        raw_text, thread_id, raw_payload = self._agent.run_detailed(
            [{"role": "user", "content": [{"type": "text", "text": user_text}]}],
            agent=self._agent_name,
            thread_id=thread_id_to_use,
        )

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
            artifact_type, artifact = self._coerce_chat_artifact(
                req,
                artifact_type=artifact_type,
                artifact=artifact,
            )
            return STTMBuilderResponse.from_invocation(
                req,
                thread_id=thread_id,
                agent=sub_agent,
                result=result,
                message=self._sanitize_final_chat_message(message or raw_text.strip()),
                status=status,
                artifact_type=artifact_type or (
                    STTMArtifactType.SEMANTIC_CONTEXT
                    if semantic_refresh and sub_agent is None and result is None
                    else STTMArtifactType.NONE
                ),
                artifact=artifact if artifact is not None else (
                    semantic_refresh.model_dump(mode="json") if semantic_refresh else None
                ),
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
        return STTMBuilderResponse.from_invocation(
            req,
            thread_id=thread_id,
            agent=sub_agent,
            result=result,
            message=message,
            status=status,
            artifact_type=artifact_type or self._artifact_type_for_response(sub_agent, semantic_refresh),
            artifact=artifact if artifact is not None else (
                semantic_refresh.model_dump(mode="json") if semantic_refresh else None
            ),
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

    def invoke_stream(self, req: STTMBuilderEnvelopeRequest) -> Iterator[str]:
        def emit(event: str, data: dict[str, Any]) -> str:
            return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"

        def iterator() -> Iterator[str]:
            yield emit(
                "status",
                {
                    "phase": "semantic_refresh_started",
                    "message": "Refreshing semantic context for the current selection.",
                },
            )
            req_with_context, semantic_refresh = self._with_semantic_context(req)
            if semantic_refresh is not None:
                yield emit(
                    "status",
                    {
                        "phase": "semantic_refresh_completed",
                        "message": (
                            "Semantic context is ready. Handing the request to AGT_STTM_BUILDER."
                            if semantic_refresh.semantic_view_name
                            else "Semantic context is ready. Handing the request to AGT_STTM_BUILDER."
                        ),
                        "bundle_id": semantic_refresh.bundle_id,
                        "bundle_label": semantic_refresh.bundle_label,
                        "semantic_level": semantic_refresh.achieved_level,
                        "status": semantic_refresh.status,
                        "semantic_view_name": semantic_refresh.semantic_view_name,
                    },
                )

            user_text = self._build_agent_payload(req_with_context)
            thread_id_to_use = (
                None if self._should_reset_thread(req_with_context) else req_with_context.context.thread_id
            )
            yield emit(
                "status",
                {
                    "phase": "agent_started",
                    "message": "AGT_STTM_BUILDER is evaluating the request and choosing the right path.",
                    "bundle_id": req_with_context.context.semantic_bundle_id,
                    "semantic_level": req_with_context.context.semantic_level_requested,
                },
            )

            final_payload: dict[str, Any] | None = None
            resolved_thread_id = thread_id_to_use
            text_parts: list[str] = []

            try:
                for event_name, payload in self._agent.stream_events(
                    [{"role": "user", "content": [{"type": "text", "text": user_text}]}],
                    agent=self._agent_name,
                    thread_id=thread_id_to_use,
                ):
                    potential_thread = _find_nested_string(payload, "thread_id")
                    if potential_thread:
                        resolved_thread_id = potential_thread

                    delta = _extract_stream_text_delta(event_name, payload)
                    if delta:
                        text_parts.append(delta)
                        yield emit("delta", {"text": delta})

                    suggestions = _extract_stream_suggestions(payload)
                    if suggestions:
                        yield emit("suggestions", {"items": suggestions})

                    status_message = _extract_stream_status(event_name, payload)
                    if status_message:
                        yield emit("status", {"phase": "agent_progress", "message": status_message})

                    response_payload = _extract_stream_response_payload(event_name, payload)
                    if response_payload is not None:
                        final_payload = response_payload
            except Exception as exc:
                logger.exception("Streaming STTM agent request failed")
                yield emit(
                    "error",
                    {
                        "message": str(exc),
                        "code": "SNOWFLAKE_AGENT_STREAM_ERROR",
                    },
                )
                return

            raw_payload = final_payload
            raw_text = _extract_stream_message_text(final_payload) or "".join(text_parts).strip()
            response = self._build_chat_response(
                req_with_context,
                raw_text=raw_text,
                raw_payload=raw_payload,
                thread_id=resolved_thread_id or str(uuid.uuid4()),
                semantic_refresh=semantic_refresh,
            )
            yield emit("final", response.model_dump(mode="json"))

        return iterator()

    def _with_semantic_context(
        self,
        req: STTMBuilderEnvelopeRequest,
    ) -> tuple[STTMBuilderEnvelopeRequest, Any | None]:
        source_tables = req.context.source_tables or []
        selected_derived_sources = req.context.selected_derived_sources or []
        if not source_tables and not selected_derived_sources:
            return req, None
        try:
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
                    requested_level=requested_level,
                    force=False,
                ),
                agent_client=self._agent,
                allow_agent_refresh=False,
            )
            context = req.context.model_copy(
                update={
                    "semantic_context": [
                        SemanticContextItem.model_validate(item)
                        for item in semantic_refresh.semantic_context
                    ],
                    "semantic_bundle_id": semantic_refresh.bundle_id,
                    "semantic_bundle_label": semantic_refresh.bundle_label,
                    "semantic_view_name": semantic_refresh.semantic_view_name,
                    "semantic_level_requested": semantic_refresh.achieved_level,
                    "derived_source_lineage": [
                        item.model_dump(mode="json") for item in semantic_refresh.lineage
                    ],
                    "datahub_context": semantic_refresh.datahub_context,
                }
            )
            return req.model_copy(update={"context": context}), semantic_refresh
        except Exception as exc:
            logger.warning(
                "Semantic context enrichment failed; continuing without semantic context: %s",
                exc,
            )
            return req, None

    def _build_chat_response(
        self,
        req: STTMBuilderEnvelopeRequest,
        *,
        raw_text: str,
        raw_payload: dict[str, Any] | None,
        thread_id: str,
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
            agent=sub_agent,
            result=result,
            message=self._sanitize_final_chat_message(message or raw_text.strip()),
            status=status,
            artifact_type=artifact_type or (
                STTMArtifactType.SEMANTIC_CONTEXT
                if semantic_refresh and sub_agent is None and result is None
                else STTMArtifactType.NONE
            ),
            artifact=artifact if artifact is not None else (
                semantic_refresh.model_dump(mode="json") if semantic_refresh else None
            ),
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
        return cls._is_derived_source_request(req)

    @staticmethod
    def _determine_semantic_level(req: STTMBuilderEnvelopeRequest) -> SemanticLevel:
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
        direct_tokens = (
            "derived source",
            "derived table",
            "generate sql",
            "generate query",
            "write sql",
            "write query",
            "build query",
            "create query",
        )
        if any(token in text for token in direct_tokens):
            return True
        return ("create" in text or "build" in text or "generate" in text) and "join" in text

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
        if artifact_type == STTMArtifactType.ANALYST_ANSWER and artifact.get("sql_text"):
            enriched_artifact = dict(artifact)
            enriched_artifact.setdefault("draft_kind", "analyst_generated")
            enriched_artifact.setdefault("open_in_builder", True)
            if suggestion := cls._suggest_derived_source_name(req.data.message or ""):
                enriched_artifact.setdefault("source_name_suggestion", suggestion)
            return STTMArtifactType.DERIVED_SOURCE_DRAFT, enriched_artifact
        if artifact_type == STTMArtifactType.DERIVED_SOURCE_DRAFT:
            enriched_artifact = dict(artifact)
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
        if req.data.intent != Interface.CHAT or semantic_refresh is None:
            return False
        if semantic_refresh.achieved_level not in {
            SemanticLevel.L2_ANALYST_READY,
            SemanticLevel.L3_MAPPING_ENRICHED,
        }:
            return False
        if not semantic_refresh.semantic_view_name or not semantic_refresh.promoted:
            return False
        if STTMBuilderService._is_derived_source_request(req):
            return True

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
        non_analyst_tokens = ("map", "mapping", "transform", "rule")
        return any(token in text for token in analyst_tokens) and not any(
            token in text for token in non_analyst_tokens
        )

    def _invoke_analyst(
        self,
        req: STTMBuilderEnvelopeRequest,
        semantic_refresh: Any,
    ) -> STTMBuilderResponse:
        analyst_response = self._analyst.ask(
            question=req.data.message or "",
            semantic_view=semantic_refresh.semantic_view_name,
        )
        preview_rows = self._preview_sql_rows(analyst_response.sql)
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

        response_message = analyst_response.text or (
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

        return STTMBuilderResponse.from_invocation(
            req,
            thread_id=thread_id,
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
        artifact = semantic_refresh.model_dump(mode="json")
        return STTMBuilderResponse.from_invocation(
            req,
            thread_id=req.context.thread_id or f"semantic-{uuid.uuid4()}",
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
            rows = self._session.sql(preview_query).collect()
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
            context["semantic_context"] = cls._compact_semantic_context(
                context.get("semantic_context"),
                context.get("selected_columns_by_table"),
            )
        compact_payload = _prune_empty(payload_dict)
        return json.dumps(compact_payload, separators=(",", ":"))

    @classmethod
    def _compact_semantic_context(
        cls,
        items: Any,
        selected_columns_by_table: Any,
    ) -> list[dict[str, Any]] | None:
        if not isinstance(items, list) or not items:
            return None
        selected_map = (
            selected_columns_by_table if isinstance(selected_columns_by_table, dict) else {}
        )
        compact_items: list[dict[str, Any]] = []
        for item in items[:8]:
            if not isinstance(item, dict):
                continue
            table = item.get("table")
            scope = item.get("scope")
            semantic_model = item.get("semantic_model")
            compact_model = cls._compact_semantic_model(table, semantic_model, selected_map)
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
    ) -> Any:
        if isinstance(semantic_model, str):
            return cls._trim_string(semantic_model, 500)
        if isinstance(semantic_model, list):
            return semantic_model[:10]
        if not isinstance(semantic_model, dict):
            return semantic_model

        qualified_name = cls._table_qualified_name(table)
        selected_columns = selected_columns_by_table.get(qualified_name)
        attribute_names = {
            str(name).upper()
            for name in (selected_columns or [])
            if isinstance(name, str) and name.strip()
        }
        raw_attributes = semantic_model.get("attributes")
        compact_attributes: list[dict[str, Any]] = []
        if isinstance(raw_attributes, list):
            chosen_attributes = raw_attributes
            if attribute_names:
                chosen_attributes = [
                    attr
                    for attr in raw_attributes
                    if isinstance(attr, dict)
                    and str(attr.get("name", "")).upper() in attribute_names
                ]
            for attr in chosen_attributes[:12]:
                if not isinstance(attr, dict):
                    continue
                compact_attributes.append(
                    _prune_empty(
                        {
                            "name": attr.get("name"),
                            "data_type": attr.get("data_type"),
                            "summary": cls._trim_string(
                                attr.get("summary") or attr.get("description"), 180
                            ),
                            "constraints": attr.get("constraints"),
                            "is_primary_key": attr.get("is_primary_key"),
                            "is_foreign_key": attr.get("is_foreign_key"),
                        }
                    )
                )

        semantic_view = semantic_model.get("semantic_view")
        compact_semantic_view = None
        if isinstance(semantic_view, dict):
            compact_semantic_view = _prune_empty(
                {
                    "name": semantic_view.get("name"),
                    "bundle_id": semantic_view.get("bundle_id"),
                    "bundle_label": semantic_view.get("bundle_label"),
                    "semantic_level": semantic_view.get("semantic_level"),
                    "analyst_tool_name": semantic_view.get("analyst_tool_name"),
                }
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
                "attributes": compact_attributes or None,
                "relationships": compact_relationships,
                "semantic_view": compact_semantic_view,
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
            parsed = STTMAgentResponseEnvelope.model_validate(envelope)
        except ValidationError:
            parsed = None

        if parsed is not None:
            sub_agent = parsed.data.agent
            result = None
            if sub_agent and parsed.data.result is not None:
                result = self._validate_result(sub_agent, parsed.data.result.model_dump(mode="json"))
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
        error = envelope.get("error") if isinstance(envelope.get("error"), dict) else None
        meta = envelope.get("meta") if isinstance(envelope.get("meta"), dict) else {}
        status = _status_from_payload(data)

        if not agent_name:
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
        *,
        raw_payload: dict[str, Any] | None,
        artifact_type: STTMArtifactType | None,
        artifact: dict[str, Any] | None,
    ) -> dict[str, Any]:
        merged = dict(meta or {})
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

        mappings[target] = AttributeMapping(
            source_attributes=source_attributes,
            confidence_score=max(confidences) if confidences else 0.0,
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
                rule=str(item.get("rule") or item.get("transformation_rule") or ""),
                description=item.get("description"),
            )
        )
    return TransformationResult(rules=rules)


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


def _extract_stream_text_delta(event_name: str, payload: Any) -> str | None:
    if isinstance(payload, str):
        return payload if event_name.endswith("delta") else None

    if not isinstance(payload, dict):
        return None

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
