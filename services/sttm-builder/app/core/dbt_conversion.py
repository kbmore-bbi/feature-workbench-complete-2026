from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from app.core.config import Settings
from app.core.conversation_memory import ConversationMemoryService
from app.core.exceptions import SnowflakeAgentError
from app.core.learning_retrieval import LearningRetrievalService
from app.core.snowflake_agent import SnowflakeAgentClient
from app.schema.contracts import ApiActor, ApiError, ApiWarning, build_response_envelope
from app.schema.dbt_conversion import (
    DbtConversionGeneratedFile,
    DbtConversionRequest,
    DbtConversionResponse,
    DbtConversionSourceUpdate,
)

logger = logging.getLogger(__name__)

DBT_CONVERSION_OPERATION = "dbt_conversion.generate"
_DEFAULT_CHECKLIST = [
    "File names must follow {release_version}_{ADO_ID}_{project_code}_{purpose}.sql where applicable.",
    "Do not use materialized = table unless explicitly required; default to incremental and confirm exceptions.",
    "DELETE statements must be scoped only to affected entries.",
    "Use NULLIF for nullable string fields.",
    "Use MAX(datetime) for latest-record logic, not max batch ID.",
    "If CT tables have additional columns, use them in join conditions.",
    "Do not hardcode DBT values; reference shared project configuration when possible.",
    "Keep database and materialization defaults at the project level unless an override is truly different.",
    "Follow DBT model naming standards with underscore delimiters and pluralized model names.",
    "Environment-specific database names must come from ENV-driven config only, never hardcoded values.",
]


@dataclass
class DbtConversionOutcome:
    data: DbtConversionResponse
    context: dict[str, Any]
    warnings: list[ApiWarning]
    error: ApiError | None
    meta: dict[str, Any]


class DbtConversionService:
    def __init__(
        self,
        *,
        agent_client: SnowflakeAgentClient,
        settings: Settings,
        learning_service: LearningRetrievalService | None = None,
        memory_service: ConversationMemoryService | None = None,
    ) -> None:
        self._agent = agent_client
        self._settings = settings
        self._learning_service = learning_service
        self._memory = memory_service
        agent_name = settings.resolved_dbt_conversion_agent.strip()
        if not agent_name:
            raise SnowflakeAgentError(
                "Could not resolve the DBT conversion agent. Set "
                "SNOWFLAKE_DBT_CONVERSION_AGENT or provide the metadata database/schema configuration."
            )
        self._agent_name = agent_name

    def generate(
        self,
        body: DbtConversionRequest,
        *,
        request_id: str | None,
        actor: ApiActor | None,
        context: dict[str, Any] | None,
        warnings: list[ApiWarning] | None,
        meta: dict[str, Any] | None,
    ) -> DbtConversionOutcome:
        request_context = dict(context or {})
        prepared_payload = self._build_agent_request(
            body,
            request_id=request_id,
            actor=actor,
            context=request_context,
            meta=meta,
        )
        messages = [
            {
                "role": "user",
                "content": [{"type": "text", "text": self._build_prompt(prepared_payload)}],
            }
        ]
        raw_text, thread_id, raw_payload = self._run_agent_detailed(
            messages=messages,
            thread_id=request_context.get("thread_id"),
        )
        response_data, response_warnings, response_error, response_meta = self._parse_response(
            raw_text,
            raw_payload=raw_payload,
        )
        merged_context = {
            **request_context,
            "thread_id": thread_id,
        }
        merged_warnings = [*(warnings or []), *response_warnings]
        merged_meta = {
            **(meta or {}),
            **response_meta,
            "agent_name": self._agent_name,
        }
        self._record_fir_artifact(
            body=body,
            request_id=request_id,
            actor=actor,
            context=merged_context,
            prepared_payload=prepared_payload,
            response=response_data,
            status="failed" if response_error else "completed",
        )
        return DbtConversionOutcome(
            data=response_data,
            context=merged_context,
            warnings=merged_warnings,
            error=response_error,
            meta=merged_meta,
        )

    def generate_stream(
        self,
        body: DbtConversionRequest,
        *,
        request_id: str | None,
        actor: ApiActor | None,
        context: dict[str, Any] | None,
        warnings: list[ApiWarning] | None,
        meta: dict[str, Any] | None,
    ) -> Iterator[str]:
        request_context = dict(context or {})
        prepared_payload = self._build_agent_request(
            body,
            request_id=request_id,
            actor=actor,
            context=request_context,
            meta=meta,
        )
        messages = [
            {
                "role": "user",
                "content": [{"type": "text", "text": self._build_prompt(prepared_payload)}],
            }
        ]

        def emit(event: str, data: dict[str, Any]) -> str:
            return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"

        def iterator() -> Iterator[str]:
            target_table_name = ".".join(
                [
                    body.target_table.database,
                    body.target_table.schema,
                    body.target_table.table,
                ]
            )
            logger.info(
                "DBT conversion stream request started: request_id=%s agent=%s target_table=%s source_tables=%d",
                request_id,
                self._agent_name,
                target_table_name,
                len(body.source_tables),
            )
            yield emit(
                "status",
                {
                    "phase": "request_prepared",
                    "message": "Packaging the summary SQL, mappings, lineage, and semantic context for DBT conversion.",
                },
            )
            yield emit(
                "status",
                {
                    "phase": "agent_started",
                    "message": "AGT_DBT_CONVERSION is reviewing the final SQL and loading dbt project context.",
                },
            )

            final_payload: dict[str, Any] | None = None
            resolved_thread_id = request_context.get("thread_id")
            text_parts: list[str] = []
            step_history: list[str] = []
            stream_started_at = time.monotonic()
            active_tool_name: str | None = None
            event_count = 0

            try:
                logger.info(
                    "DBT conversion agent stream opened: request_id=%s agent=%s thread_id=%s",
                    request_id,
                    self._agent_name,
                    resolved_thread_id,
                )
                stream_iterator = self._agent.stream_events(
                    messages,
                    agent=self._agent_name,
                    thread_id=resolved_thread_id,
                )
                for event_name, payload in stream_iterator:
                    event_count += 1
                    payload_keys = _payload_keys(payload)
                    logger.info(
                        "DBT conversion stream event: request_id=%s event=%s keys=%s",
                        request_id,
                        event_name,
                        payload_keys,
                    )

                    potential_thread = _find_nested_string(payload, "thread_id")
                    if potential_thread:
                        resolved_thread_id = potential_thread

                    tool_name = _find_tool_name(payload)
                    if tool_name:
                        active_tool_name = tool_name
                        logger.info(
                            "DBT conversion tool called: request_id=%s tool=%s event=%s",
                            request_id,
                            tool_name,
                            event_name,
                        )

                    status_message = _extract_dbt_stream_status(event_name, payload)
                    if status_message and status_message not in step_history:
                        step_history.append(status_message)
                        logger.info(
                            "DBT conversion status event emitted: request_id=%s event=%s message=%s",
                            request_id,
                            event_name,
                            status_message,
                        )
                        yield emit(
                            "status",
                            {
                                "phase": "agent_progress",
                                "message": status_message,
                            },
                        )

                    delta = _extract_stream_text_delta(event_name, payload)
                    if delta:
                        text_parts.append(delta)

                    response_payload = _extract_stream_response_payload(event_name, payload)
                    if response_payload is not None:
                        logger.info(
                            "DBT conversion final payload received: request_id=%s event=%s",
                            request_id,
                            event_name,
                        )
                        final_payload = response_payload
            except Exception as exc:
                logger.exception(
                    "Streaming DBT conversion failed: request_id=%s agent=%s target_table=%s active_tool=%s elapsed=%.1fs",
                    request_id,
                    self._agent_name,
                    target_table_name,
                    active_tool_name,
                    time.monotonic() - stream_started_at,
                )
                yield emit(
                    "error",
                    {
                        "message": str(exc),
                        "code": "DBT_CONVERSION_STREAM_ERROR",
                    },
                )
                return

            raw_text = _extract_stream_message_text(final_payload) or "".join(text_parts).strip()
            logger.info(
                "DBT conversion stream finished: request_id=%s duration=%.1fs events=%d raw_text_len=%d final_payload=%s",
                request_id,
                time.monotonic() - stream_started_at,
                event_count,
                len(raw_text),
                final_payload is not None,
            )
            try:
                outcome = self._normalize_outcome(
                    request_id=request_id,
                    actor=actor,
                    context={
                        **request_context,
                        "thread_id": resolved_thread_id,
                    },
                    warnings=warnings,
                    meta=meta,
                    raw_text=raw_text,
                    raw_payload=final_payload,
                )
            except Exception as exc:
                logger.exception(
                    "DBT conversion parse failure: request_id=%s raw_text_len=%d final_payload_keys=%s",
                    request_id,
                    len(raw_text),
                    _payload_keys(final_payload),
                )
                yield emit(
                    "error",
                    {
                        "message": (
                            "AGT_DBT_CONVERSION finished without a valid final payload. "
                            "Please retry and review the backend logs for the parse failure."
                        ),
                        "code": "DBT_CONVERSION_PARSE_ERROR",
                    },
                )
                return
            self._record_fir_artifact(
                body=body,
                request_id=request_id,
                actor=actor,
                context=outcome.context,
                prepared_payload=prepared_payload,
                response=outcome.data,
                status="failed" if outcome.error else "completed",
            )
            envelope = build_response_envelope(
                operation=DBT_CONVERSION_OPERATION,
                request=None,
                request_id=request_id,
                actor=actor,
                context=outcome.context,
                warnings=outcome.warnings,
                error=outcome.error,
                meta=outcome.meta,
                data=outcome.data,
            )
            if outcome.error is None and str(outcome.data.status).lower() != "failed":
                for generated_file in outcome.data.generated_files:
                    logger.info(
                        "DBT conversion file ready: request_id=%s path=%s",
                        request_id,
                        generated_file.file_path,
                    )
                    yield emit(
                        "status",
                        {
                            "phase": "file_ready",
                            "message": f"Generated {generated_file.file_path}.",
                        },
                    )
                    yield emit(
                        "artifact",
                        {
                            "kind": "generated_file",
                            "file": generated_file.model_dump(mode="json"),
                        },
                    )
                for schema_file in outcome.data.schema_files:
                    logger.info(
                        "DBT conversion schema ready: request_id=%s path=%s",
                        request_id,
                        schema_file.file_path,
                    )
                    yield emit(
                        "status",
                        {
                            "phase": "file_ready",
                            "message": f"Prepared {schema_file.file_path}.",
                        },
                    )
                    yield emit(
                        "artifact",
                        {
                            "kind": "schema_file",
                            "file": schema_file.model_dump(mode="json"),
                        },
                    )
                if outcome.data.source_update is not None and (
                    outcome.data.source_update.content or outcome.data.source_update.action != "NO_CHANGE"
                ):
                    logger.info(
                        "DBT conversion source update ready: request_id=%s path=%s action=%s",
                        request_id,
                        outcome.data.source_update.file_path,
                        outcome.data.source_update.action,
                    )
                    yield emit(
                        "status",
                        {
                            "phase": "file_ready",
                            "message": (
                                f"{outcome.data.source_update.action.title().replace('_', ' ')} "
                                f"{outcome.data.source_update.file_path}."
                            ),
                        },
                    )
                    yield emit(
                        "artifact",
                        {
                            "kind": "source_update",
                            "file": outcome.data.source_update.model_dump(mode="json"),
                        },
                    )
            logger.info(
                "DBT conversion stream final emitted: request_id=%s status=%s",
                request_id,
                outcome.data.status,
            )
            yield emit("final", envelope.model_dump(mode="json"))

        return iterator()

    def _normalize_outcome(
        self,
        *,
        request_id: str | None,
        actor: ApiActor | None,
        context: dict[str, Any] | None,
        warnings: list[ApiWarning] | None,
        meta: dict[str, Any] | None,
        raw_text: str,
        raw_payload: dict[str, Any] | None,
    ) -> DbtConversionOutcome:
        response_data, response_warnings, response_error, response_meta = self._parse_response(
            raw_text,
            raw_payload=raw_payload,
        )
        return DbtConversionOutcome(
            data=response_data,
            context=dict(context or {}),
            warnings=[*(warnings or []), *response_warnings],
            error=response_error,
            meta={
                **(meta or {}),
                **response_meta,
                "agent_name": self._agent_name,
            },
        )

    def _run_agent_detailed(
        self,
        *,
        messages: list[dict[str, Any]],
        thread_id: str | None,
    ) -> tuple[str, str, dict[str, Any] | None]:
        try:
            return self._agent.run_detailed(
                messages,
                agent=self._agent_name,
                thread_id=thread_id,
            )
        except SnowflakeAgentError as exc:
            if not thread_id or "Cortex Agent returned HTTP 400" not in str(exc):
                raise
            logger.warning(
                "Retrying DBT conversion without thread after HTTP 400: agent=%s thread_id=%s",
                self._agent_name,
                thread_id,
            )
            return self._agent.run_detailed(
                messages,
                agent=self._agent_name,
                thread_id=None,
            )

    def _build_agent_request(
        self,
        body: DbtConversionRequest,
        *,
        request_id: str | None,
        actor: ApiActor | None,
        context: dict[str, Any],
        meta: dict[str, Any] | None,
    ) -> dict[str, Any]:
        domain_name = body.domain_name or _derive_domain_name(
            target_schema=body.target_table.schema,
            source_tables=body.source_tables,
        )
        target_layer = (body.target_layer or _derive_target_layer(body.target_table.schema)).lower()
        materialization = (
            body.materialization
            or ("view" if target_layer == "mart" else "incremental")
        )
        fir_context = self._retrieve_fir_context(body=body, context=context)
        payload = {
            "contract_version": "1.0",
            "request_id": request_id,
            "operation": DBT_CONVERSION_OPERATION,
            "actor": actor.model_dump(mode="json") if actor else None,
            "context": {
                **context,
                "summary_surface": "sttm.summary",
                "agent_name": self._agent_name,
            },
            "data": _prune_empty(
                {
                    "project_id": body.project_id or context.get("project_id"),
                    "sttm_id": body.sttm_id or context.get("sttm_id"),
                    "project_name": body.project_name or f"{body.target_table.table} DBT Conversion",
                    "domain_name": domain_name,
                    "target_layer": target_layer,
                    "materialization": materialization,
                    "source_tables": [table.model_dump(mode="json") for table in body.source_tables],
                    "target_table": body.target_table.model_dump(mode="json"),
                    "driving_table": body.driving_table.model_dump(mode="json") if body.driving_table else None,
                    "selected_derived_sources": body.selected_derived_sources,
                    "relationships": [item.model_dump(mode="json") for item in body.relationships],
                    "selected_columns_by_table": body.selected_columns_by_table,
                    "semantic_bundle_id": body.semantic_bundle_id,
                    "semantic_bundle_label": body.semantic_bundle_label,
                    "semantic_view_name": body.semantic_view_name,
                    "source_query_sql": body.source_query_sql,
                    "validated_sql": _normalize_sql(body.validated_sql),
                    "generated_sql": _normalize_sql(body.generated_sql),
                    "attribute_mappings": _build_attribute_mappings(body.mappings),
                    "transformation_rules": _build_transformation_rules(body.mappings),
                    "semantic_context": [item.model_dump(mode="json") for item in body.semantic_context],
                    "derived_source_lineage": body.derived_source_lineage,
                    "datahub_context": body.datahub_context,
                    "checklist": body.checklist or _DEFAULT_CHECKLIST,
                    "fir_context": fir_context,
                }
            ),
            "warnings": [],
            "error": None,
            "meta": {
                **(meta or {}),
                "branch": "main",
                "transport": "workbench_standard_envelope",
            },
        }
        return _prune_empty(payload)

    def _retrieve_fir_context(
        self,
        *,
        body: DbtConversionRequest,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        learning_service = getattr(self, "_learning_service", None)
        if learning_service is None:
            return {}
        project_id = str(body.project_id or context.get("project_id") or "").strip()
        if not project_id:
            return {}
        source_tables = [
            ".".join([table.database, table.schema, table.table])
            for table in body.source_tables
        ]
        target_table = ".".join(
            [body.target_table.database, body.target_table.schema, body.target_table.table]
        )
        learning = learning_service.get_comprehensive_learning_context(
            project_id=project_id,
            source_tables=source_tables,
            target_table=target_table,
            target_columns=[
                mapping.target_column
                for mapping in body.mappings
                if mapping.target_column
            ],
            sttm_id=body.sttm_id or context.get("sttm_id"),
            context_key=context.get("context_key"),
            milestone="dbt_conversion",
            target_agent="AGT_DBT_CONVERSION",
        )
        return learning.model_dump(mode="json", exclude_none=True)

    def _record_fir_artifact(
        self,
        *,
        body: DbtConversionRequest,
        request_id: str | None,
        actor: ApiActor | None,
        context: dict[str, Any],
        prepared_payload: dict[str, Any],
        response: DbtConversionResponse,
        status: str,
    ) -> None:
        memory = getattr(self, "_memory", None)
        if memory is None:
            return
        try:
            fir_context = prepared_payload.get("data", {}).get("fir_context") or {}
            artifact_id = memory.record_agent_artifact(
                request_id=request_id,
                session_id=context.get("session_id"),
                thread_id=context.get("thread_id"),
                agent_name=self._agent_name,
                artifact_type="dbt_conversion",
                payload=response.model_dump(mode="json", exclude_none=True),
                artifact_status=status,
                entity_type="sttm",
                entity_ids=[
                    value
                    for value in (
                        body.project_id or context.get("project_id"),
                        body.sttm_id or context.get("sttm_id"),
                    )
                    if value
                ],
                semantic_bundle_id=body.semantic_bundle_id,
                summary=response.message,
                created_by=actor.user_id if actor else None,
                context_key=context.get("context_key") or fir_context.get("context_key"),
                snapshot_id=context.get("snapshot_id"),
                retrieved_inference_ids=response.retrieved_inference_ids
                or fir_context.get("retrieved_inference_ids")
                or [],
                retrieved_recommendation_ids=response.retrieved_recommendation_ids
                or fir_context.get("retrieved_recommendation_ids")
                or [],
                used_inference_ids=response.used_inference_ids,
                used_recommendation_ids=response.used_recommendation_ids,
            )
            for recommendation_id in response.used_recommendation_ids:
                memory.record_fir_recommendation_outcome(
                    recommendation_id=recommendation_id,
                    outcome_type="used",
                    context_key=context.get("context_key") or fir_context.get("context_key"),
                    snapshot_id=context.get("snapshot_id"),
                    request_id=request_id,
                    artifact_id=artifact_id,
                    user_id=actor.user_id if actor else None,
                    payload={"agent_name": self._agent_name, "artifact_type": "dbt_conversion"},
                )
        except Exception as exc:
            logger.warning("Could not persist DBT FIR artifact: %s", exc)

    @staticmethod
    def _build_prompt(payload: dict[str, Any]) -> str:
        return (
            "You are being called by the BBI AI Migration Workbench.\n"
            "The JSON below already uses the standard workbench payload envelope.\n"
            "Treat envelope.data as the authoritative conversion request.\n"
            "Use data.validated_sql as the final SQL that should be converted into dbt artifacts.\n"
            "Use data.checklist as mandatory review guidance whenever it applies.\n"
            "Return ONLY JSON.\n"
            "Preferred response shape: the same standard envelope with contract_version='1.0', "
            "the same request_id, operation='dbt_conversion.generate', and the conversion result in data.\n"
            "Inside data include: status, action, message, generated_files, source_updates, schema_files, macros_used, materialization, materialization_reason.\n"
            "If your runtime insists on the legacy raw JSON object, return that raw JSON only and do not add markdown fences.\n\n"
            f"{json.dumps(payload, indent=2)}"
        )

    def _parse_response(
        self,
        raw_text: str,
        *,
        raw_payload: dict[str, Any] | None,
    ) -> tuple[DbtConversionResponse, list[ApiWarning], ApiError | None, dict[str, Any]]:
        text = raw_text or _extract_stream_message_text(raw_payload) or ""
        json_str = _extract_json_object(text)
        try:
            payload = json.loads(json_str)
        except json.JSONDecodeError as exc:
            raise SnowflakeAgentError(
                f"DBT conversion response is not valid JSON: {exc} — raw: {text[:400]}"
            ) from exc

        envelope_data = payload.get("data") if isinstance(payload, dict) else None
        source_payload = envelope_data if isinstance(envelope_data, dict) else payload
        if not isinstance(source_payload, dict):
            raise SnowflakeAgentError("DBT conversion response did not contain an object payload.")

        response = DbtConversionResponse(
            status=str(source_payload.get("status") or "failed"),
            action=source_payload.get("action"),
            message=source_payload.get("message"),
            generated_files=[
                _normalize_generated_file(item)
                for item in source_payload.get("generated_files", [])
                if isinstance(item, dict)
            ],
            source_update=_normalize_source_update(source_payload.get("source_updates")),
            schema_files=[
                _normalize_schema_file(item)
                for item in source_payload.get("schema_files", [])
                if isinstance(item, dict)
            ],
            macros_used=[
                str(item)
                for item in source_payload.get("macros_used", [])
                if isinstance(item, (str, int, float))
            ],
            materialization=_string_or_none(source_payload.get("materialization")),
            materialization_reason=_string_or_none(source_payload.get("materialization_reason")),
            agent_name=self._agent_name,
            domain_name=_string_or_none(source_payload.get("domain_name")),
            target_layer=_string_or_none(source_payload.get("target_layer")),
            branch=_string_or_none(source_payload.get("branch")) or "main",
            retrieved_inference_ids=_string_list(source_payload.get("retrieved_inference_ids")),
            retrieved_recommendation_ids=_string_list(source_payload.get("retrieved_recommendation_ids")),
            used_inference_ids=_string_list(source_payload.get("used_inference_ids")),
            used_recommendation_ids=_string_list(source_payload.get("used_recommendation_ids")),
        )
        warnings = _normalize_warnings(payload.get("warnings"), source_payload.get("warnings"))

        error: ApiError | None = None
        if isinstance(payload.get("error"), dict):
            try:
                error = ApiError.model_validate(payload["error"])
            except Exception:
                error = None
        if response.status.lower() == "failed" and error is None:
            error = ApiError(
                title="DBT conversion failed.",
                detail=response.message or "The DBT conversion agent returned a failed status.",
                code="DBT_CONVERSION_FAILED",
                status=500,
            )

        meta = {
            "raw_response_format": "standard_envelope" if isinstance(envelope_data, dict) else "legacy_json",
            "raw_payload_present": raw_payload is not None,
        }
        return response, warnings, error, meta


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def _normalize_sql(sql_text: str | None) -> str | None:
    normalized = (sql_text or "").strip()
    return normalized.rstrip(";") if normalized else None


def _derive_domain_name(
    *,
    target_schema: str,
    source_tables: list[Any],
) -> str:
    for schema_name in [target_schema, *[getattr(table, "schema", "") for table in source_tables]]:
        if not isinstance(schema_name, str) or not schema_name.strip():
            continue
        normalized = schema_name.strip().lower()
        for prefix in ("raw_", "curated_", "mart_", "api_", "ds_"):
            if normalized.startswith(prefix):
                suffix = normalized[len(prefix):]
                if suffix:
                    return suffix
        if "_" in normalized:
            return normalized.split("_", 1)[1]
        return normalized
    return "default_domain"


def _derive_target_layer(schema_name: str) -> str:
    normalized = (schema_name or "").strip().lower()
    if normalized.startswith("mart_"):
        return "mart"
    if normalized.startswith("raw_"):
        return "raw"
    return "curated"


def _build_attribute_mappings(mappings: list[Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for mapping in mappings:
        status = str(getattr(mapping, "status", "") or "").upper()
        target_column = _string_or_none(getattr(mapping, "target_column", None))
        if not target_column or status not in {"MAPPED", "PROCESSING"}:
            continue
        source_columns = list(getattr(mapping, "source_columns", []) or [])
        if not source_columns and getattr(mapping, "source_column", None):
            source_columns = [
                item.strip()
                for item in str(getattr(mapping, "source_column")).split(",")
                if item.strip()
            ]
        result[target_column] = _prune_empty(
            {
                "source_attributes": source_columns,
                "preprocessing_rule": getattr(mapping, "expression", None)
                or getattr(mapping, "rule", None),
                "preprocessing_rule_type": getattr(mapping, "rule", None),
                "preprocessing_nl_rule": getattr(mapping, "nl_rule", None),
                "processing_order": None,
                "description": getattr(mapping, "description", None),
                "data_type": getattr(mapping, "target_type", None),
            }
        )
    return result


def _build_transformation_rules(mappings: list[Any]) -> list[dict[str, Any]]:
    rules: list[dict[str, Any]] = []
    for mapping in mappings:
        status = str(getattr(mapping, "status", "") or "").upper()
        target_column = _string_or_none(getattr(mapping, "target_column", None))
        if not target_column or status != "MAPPED":
            continue
        expression = _string_or_none(getattr(mapping, "expression", None))
        rule_type = _string_or_none(getattr(mapping, "rule", None))
        if expression:
            rules.append(
                _prune_empty(
                    {
                        "target_attribute": target_column,
                        "rule": expression,
                        "description": getattr(mapping, "description", None)
                        or getattr(mapping, "nl_rule", None),
                    }
                )
            )
            continue
        if rule_type and rule_type.lower() not in {"direct", "select..."}:
            rules.append(
                _prune_empty(
                    {
                        "target_attribute": target_column,
                        "rule": rule_type,
                        "description": getattr(mapping, "description", None)
                        or getattr(mapping, "nl_rule", None),
                    }
                )
            )
    return rules




def _normalize_generated_file(item: dict[str, Any]) -> DbtConversionGeneratedFile:
    file_path = str(item.get("file_path") or item.get("path") or item.get("file_name") or "").strip()
    file_name = str(item.get("file_name") or file_path.rsplit("/", 1)[-1]).strip()
    content = str(item.get("content") or item.get("dbt_sql") or "").rstrip()
    return DbtConversionGeneratedFile(
        file_name=file_name,
        file_path=file_path,
        file_type=str(item.get("file_type") or "MODEL"),
        content=content,
        language=_language_for_path(file_path),
    )


def _normalize_schema_file(item: dict[str, Any]) -> DbtConversionGeneratedFile:
    file_path = str(item.get("file_path") or item.get("path") or item.get("file_name") or "").strip()
    file_name = str(item.get("file_name") or file_path.rsplit("/", 1)[-1]).strip()
    content = str(item.get("content") or "").rstrip()
    return DbtConversionGeneratedFile(
        file_name=file_name,
        file_path=file_path,
        file_type=str(item.get("file_type") or "SCHEMA"),
        content=content,
        language=_language_for_path(file_path),
    )


def _normalize_source_update(value: Any) -> DbtConversionSourceUpdate | None:
    if not isinstance(value, dict):
        return None
    file_path = str(value.get("file_path") or "").strip()
    action = str(value.get("action") or "NO_CHANGE").strip() or "NO_CHANGE"
    if not file_path and action == "NO_CHANGE":
        return None
    return DbtConversionSourceUpdate(
        file_path=file_path or "models/_sources.yml",
        action=action,
        content=_string_or_none(value.get("content")),
        language=_language_for_path(file_path or "models/_sources.yml"),
    )


def _language_for_path(path: str) -> str:
    lowered = (path or "").lower()
    if lowered.endswith((".yml", ".yaml")):
        return "yaml"
    if lowered.endswith(".sql"):
        return "sql"
    return "text"


def _normalize_warnings(*warning_sets: Any) -> list[ApiWarning]:
    normalized: list[ApiWarning] = []
    for warning_set in warning_sets:
        if not isinstance(warning_set, list):
            continue
        for item in warning_set:
            if isinstance(item, dict):
                code = _string_or_none(item.get("code")) or "DBT_CONVERSION_WARNING"
                message = _string_or_none(item.get("message")) or _string_or_none(item.get("detail"))
                if message:
                    normalized.append(ApiWarning(code=code, message=message, field=_string_or_none(item.get("field"))))
            elif isinstance(item, str) and item.strip():
                normalized.append(ApiWarning(code="DBT_CONVERSION_WARNING", message=item.strip()))
    return normalized


def _extract_json_object(text: str) -> str:
    stripped = (text or "").strip()
    fenced_blocks = re.findall(r"```(?:json)?\s*([\s\S]*?)```", stripped, flags=re.IGNORECASE)
    for block in fenced_blocks:
        candidate = block.strip()
        if candidate:
            stripped = candidate
            break
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start != -1 and end > start:
        return stripped[start : end + 1]
    return stripped


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
        return [_prune_empty(item) for item in value if _prune_empty(item) not in (None, {}, [])]
    return value


def _find_nested_string(payload: Any, key: str) -> str | None:
    if isinstance(payload, dict):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
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


def _payload_keys(payload: Any) -> list[str]:
    if isinstance(payload, dict):
        return sorted(str(key) for key in payload.keys())
    return []


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
        if block.get("type") in {"text", "output_text"}:
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


def _extract_dbt_stream_status(event_name: str, payload: Any) -> str | None:
    tool_name = _find_tool_name(payload)
    if tool_name:
        return {
            "get_dbt_project_config": "Inspecting dbt_project.yml defaults and materialization settings.",
            "list_domain_models": "Scanning existing domain models to decide whether to reuse, update, or create files.",
            "get_sources_yaml": "Reviewing the shared _sources.yml definitions for source references.",
            "list_macros": "Inspecting reusable macros available in the dbt repository.",
            "get_dbt_file": "Reading a repo file for deeper context before generating the final models.",
        }.get(tool_name, f"Running {tool_name} for dbt repository context.")

    if isinstance(payload, dict):
        for key in ("message", "status", "phase", "title"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                if event_name.endswith("delta") and key == "message":
                    continue
                return value.strip()
    return None


def _find_tool_name(payload: Any) -> str | None:
    candidates = [
        _find_nested_string(payload, "tool_name"),
        _find_nested_string(payload, "name"),
        _find_nested_string(payload, "tool"),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        normalized = candidate.strip().split("/")[-1]
        normalized = normalized.rsplit(".", 1)[-1]
        if normalized in {
            "get_dbt_project_config",
            "list_domain_models",
            "get_sources_yaml",
            "list_macros",
            "get_dbt_file",
        }:
            return normalized
    return None
