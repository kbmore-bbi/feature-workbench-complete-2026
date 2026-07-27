from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from app.core.config import Settings
from app.core.conversation_memory import ConversationMemoryService
from app.core.exceptions import SnowflakeAgentError
from app.core.learning_retrieval import LearningRetrievalService
from app.core.snowflake_agent import SnowflakeAgentClient
from app.schema.contracts import ApiActor, ApiError, ApiWarning
from app.schema.test_case_generation import (
    TestCaseDocumentItem,
    TestCaseGenerationRequest,
    TestCaseGenerationResponse,
    TestCaseGroup,
    TestCaseSeedFile,
)

logger = logging.getLogger(__name__)

TEST_CASE_GENERATION_OPERATION = "test_cases.generate"
TEST_CASE_GENERATION_REQUEST_TIMEOUT_SECONDS = 360.0


@dataclass
class TestCaseGenerationOutcome:
    data: TestCaseGenerationResponse
    context: dict[str, Any]
    warnings: list[ApiWarning]
    error: ApiError | None
    meta: dict[str, Any]


class TestCaseGenerationService:
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
        agent_name = settings.resolved_test_case_generation_agent.strip()
        if not agent_name:
            raise SnowflakeAgentError(
                "Could not resolve the test-case generation agent. Set "
                "SNOWFLAKE_TEST_CASE_GENERATION_AGENT or provide the metadata database/schema configuration."
            )
        self._agent_name = agent_name

    def generate(
        self,
        body: TestCaseGenerationRequest,
        *,
        request_id: str | None,
        actor: ApiActor | None,
        context: dict[str, Any] | None,
        warnings: list[ApiWarning] | None,
        meta: dict[str, Any] | None,
    ) -> TestCaseGenerationOutcome:
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
        outcome = TestCaseGenerationOutcome(
            data=response_data,
            context={**request_context, "thread_id": thread_id},
            warnings=[*(warnings or []), *response_warnings],
            error=response_error,
            meta={
                **(meta or {}),
                **response_meta,
                "agent_name": self._agent_name,
            },
        )
        self._record_fir_artifact(
            body=body,
            request_id=request_id,
            actor=actor,
            context=outcome.context,
            prepared_payload=prepared_payload,
            response=response_data,
            status="failed" if response_error else "completed",
        )
        return outcome

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
                request_timeout=TEST_CASE_GENERATION_REQUEST_TIMEOUT_SECONDS,
            )
        except SnowflakeAgentError as exc:
            if not thread_id or "Cortex Agent returned HTTP 400" not in str(exc):
                raise
            logger.warning(
                "Retrying test-case generation without thread after HTTP 400: agent=%s thread_id=%s",
                self._agent_name,
                thread_id,
            )
            return self._agent.run_detailed(
                messages,
                agent=self._agent_name,
                thread_id=None,
                request_timeout=TEST_CASE_GENERATION_REQUEST_TIMEOUT_SECONDS,
            )

    def _build_agent_request(
        self,
        body: TestCaseGenerationRequest,
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
        materialization = body.materialization or ("view" if target_layer == "mart" else "incremental")
        fir_context = self._retrieve_fir_context(body=body, context=context)
        payload = {
            "contract_version": "1.0",
            "request_id": request_id,
            "operation": TEST_CASE_GENERATION_OPERATION,
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
                    "project_name": body.project_name or f"{body.target_table.table} Test Cases",
                    "domain_name": domain_name,
                    "target_layer": target_layer,
                    "materialization": materialization,
                    "source_tables": [table.model_dump(mode="json") for table in body.source_tables],
                    "target_table": body.target_table.model_dump(mode="json"),
                    "relationships": [item.model_dump(mode="json") for item in body.relationships],
                    "validated_sql": _normalize_sql(body.validated_sql),
                    "attribute_mappings": _build_attribute_mappings(body.mappings),
                    "transformation_rules": _build_transformation_rules(body.mappings),
                    "semantic_context": [item.model_dump(mode="json") for item in body.semantic_context],
                    "derived_sources": [
                        {
                            "derived_source_name": item.derived_source_name,
                            "sql_text": item.sql_text,
                            "semantic_view_name": item.semantic_view_name,
                            "base_sources": [
                                base_source.model_dump(mode="json")
                                for base_source in item.base_sources
                            ],
                        }
                        for item in body.derived_sources
                    ],
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
        body: TestCaseGenerationRequest,
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
            milestone="test_case_generation",
            target_agent="AGT_DBT_TEST_GENERATION",
        )
        return learning.model_dump(mode="json", exclude_none=True)

    def _record_fir_artifact(
        self,
        *,
        body: TestCaseGenerationRequest,
        request_id: str | None,
        actor: ApiActor | None,
        context: dict[str, Any],
        prepared_payload: dict[str, Any],
        response: TestCaseGenerationResponse,
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
                artifact_type="test_case_generation",
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
                summary=f"Generated {len(response.test_case_document)} test cases.",
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
                    payload={
                        "agent_name": self._agent_name,
                        "artifact_type": "test_case_generation",
                    },
                )
        except Exception as exc:
            logger.warning("Could not persist test-generation FIR artifact: %s", exc)

    @staticmethod
    def _build_prompt(payload: dict[str, Any]) -> str:
        return (
            "You are being called by the BBI AI Migration Workbench.\n"
            "The JSON below already uses the standard workbench payload envelope.\n"
            "Treat envelope.data as the authoritative test-case generation request.\n"
            "Use data.validated_sql as the validated transformation SQL for reasoning.\n"
            "Return ONLY JSON.\n"
            "Preferred response shape: the same standard envelope with contract_version='1.0', "
            "the same request_id, operation='test_cases.generate', and the generated artifacts in data.\n"
            "Inside data include: status, domain_name, target_layer, materialization, target_model, "
            "target_table, test_groups, seed_files, and test_case_document.\n"
            "If your runtime insists on the legacy raw JSON object, return that raw JSON only and do not add markdown fences.\n\n"
            f"{json.dumps(payload, indent=2)}"
        )

    def _parse_response(
        self,
        raw_text: str,
        *,
        raw_payload: dict[str, Any] | None,
    ) -> tuple[TestCaseGenerationResponse, list[ApiWarning], ApiError | None, dict[str, Any]]:
        text = raw_text or _extract_message_text(raw_payload) or ""
        json_str = _extract_json_object(text)
        try:
            payload = json.loads(json_str)
        except json.JSONDecodeError as exc:
            raise SnowflakeAgentError(
                f"Test-case generation response is not valid JSON: {exc} — raw: {text[:400]}"
            ) from exc

        envelope_data = payload.get("data") if isinstance(payload, dict) else None
        source_payload = envelope_data if isinstance(envelope_data, dict) else payload
        if not isinstance(source_payload, dict):
            raise SnowflakeAgentError("Test-case generation response did not contain an object payload.")

        response = TestCaseGenerationResponse(
            status=str(source_payload.get("status") or "failed"),
            domain_name=_string_or_none(source_payload.get("domain_name")),
            target_layer=_string_or_none(source_payload.get("target_layer")),
            materialization=_string_or_none(source_payload.get("materialization")),
            target_model=_string_or_none(source_payload.get("target_model")),
            target_table=_string_or_none(source_payload.get("target_table")),
            test_groups=[
                TestCaseGroup(
                    group=_string_or_none(item.get("group")) or "ungrouped",
                    target_columns=[
                        str(column).strip()
                        for column in item.get("target_columns", [])
                        if str(column).strip()
                    ],
                )
                for item in source_payload.get("test_groups", [])
                if isinstance(item, dict)
            ],
            seed_files=[
                TestCaseSeedFile(
                    file_path=_string_or_none(item.get("file_path")) or "",
                    file_type=_string_or_none(item.get("file_type")) or "SEED",
                    content=_string_or_none(item.get("content")) or "",
                )
                for item in source_payload.get("seed_files", [])
                if isinstance(item, dict)
            ],
            test_case_document=[
                TestCaseDocumentItem(
                    test_case_id=_string_or_none(item.get("test_case_id")) or "",
                    group=_string_or_none(item.get("group")) or "ungrouped",
                    target_attribute=_string_or_none(item.get("target_attribute")) or "",
                    source_columns=_string_or_none(item.get("source_columns")) or "",
                    mapping_rule=_string_or_none(item.get("mapping_rule")) or "",
                    test_case_description=_string_or_none(item.get("test_case_description")) or "",
                    test_type=_string_or_none(item.get("test_type")) or "",
                    sample_source_input=_string_or_none(item.get("sample_source_input")) or "",
                    expected_target_value=_string_or_none(item.get("expected_target_value")) or "",
                    confidence=_string_or_none(item.get("confidence")),
                )
                for item in source_payload.get("test_case_document", [])
                if isinstance(item, dict)
            ],
            agent_name=self._agent_name,
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
                title="Test-case generation failed.",
                detail=(
                    "The test-case generation agent returned a failed status."
                ),
                code="TEST_CASE_GENERATION_FAILED",
                status=500,
            )

        meta = {
            "raw_response_format": "standard_envelope" if isinstance(envelope_data, dict) else "legacy_json",
            "raw_payload_present": raw_payload is not None,
        }
        return response, warnings, error, meta


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if value is None:
        return None
    return str(value)


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
        source_columns = list(getattr(mapping, "source_columns", None) or [])
        source_column = _string_or_none(getattr(mapping, "source_column", None))
        if not source_columns and source_column:
            source_columns = [part.strip() for part in source_column.split(",") if part.strip()]
        result[target_column] = _prune_empty(
            {
                "source_attributes": source_columns,
                "preprocessing_rule": _string_or_none(getattr(mapping, "expression", None))
                or _string_or_none(getattr(mapping, "rule", None)),
                "preprocessing_rule_type": _string_or_none(getattr(mapping, "rule", None)) or "Direct",
                "preprocessing_nl_rule": _string_or_none(getattr(mapping, "nl_rule", None)),
                "description": _string_or_none(getattr(mapping, "description", None)),
                "data_type": _string_or_none(getattr(mapping, "target_type", None)),
            }
        )
    return result


def _build_transformation_rules(mappings: list[Any]) -> list[dict[str, Any]]:
    rules: list[dict[str, Any]] = []
    for mapping in mappings:
        status = str(getattr(mapping, "status", "") or "").upper()
        target_column = _string_or_none(getattr(mapping, "target_column", None))
        rule = _string_or_none(getattr(mapping, "expression", None)) or _string_or_none(
            getattr(mapping, "rule", None)
        )
        normalized_rule_type = (_string_or_none(getattr(mapping, "rule", None)) or "").strip().lower()
        if not target_column or status not in {"MAPPED", "PROCESSING"}:
            continue
        if not rule or normalized_rule_type in {"", "direct", "select..."}:
            continue
        rules.append(
            _prune_empty(
                {
                    "target_attribute": target_column,
                    "rule": rule,
                    "description": _string_or_none(getattr(mapping, "description", None))
                    or _string_or_none(getattr(mapping, "nl_rule", None)),
                }
            )
        )
    return rules


def _normalize_warnings(*warning_sets: Any) -> list[ApiWarning]:
    normalized: list[ApiWarning] = []
    for warning_set in warning_sets:
        if not isinstance(warning_set, list):
            continue
        for item in warning_set:
            if isinstance(item, dict):
                code = _string_or_none(item.get("code")) or "TEST_CASE_GENERATION_WARNING"
                message = _string_or_none(item.get("message")) or _string_or_none(item.get("detail"))
                if message:
                    normalized.append(
                        ApiWarning(code=code, message=message, field=_string_or_none(item.get("field")))
                    )
            elif isinstance(item, str) and item.strip():
                normalized.append(ApiWarning(code="TEST_CASE_GENERATION_WARNING", message=item.strip()))
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


def _extract_message_text(payload: dict[str, Any] | None) -> str | None:
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
    thinking_parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") in {"text", "output_text"}:
            text_value = block.get("text")
            if isinstance(text_value, str) and text_value:
                text_parts.append(text_value)
        thinking = block.get("thinking")
        if isinstance(thinking, dict):
            thinking_text = thinking.get("text")
            if isinstance(thinking_text, str) and thinking_text:
                thinking_parts.append(thinking_text)
    combined = text_parts if text_parts else thinking_parts
    return "".join(combined).strip() or None


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
