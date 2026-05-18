import json
import logging
from typing import Any

from pydantic import ValidationError
from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.exceptions import SnowflakeAgentError
from app.core.semantic_model import SemanticModelService
from app.core.snowflake_agent import SnowflakeAgentClient
from app.schema.common import TableRef
from app.schema.sttm_builder import (
    AttributeMapping,
    Interface,
    SemanticContextItem,
    SourceMappingResult,
    STTMBuilderRequest,
    STTMBuilderResponse,
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
        settings: Settings,
        session: Session,
        semantic_model_service: SemanticModelService,
    ) -> None:
        self._agent = agent_client
        self._settings = settings
        self._session = session
        self._semantic_model_service = semantic_model_service

        agent_name = settings.resolved_sttm_builder_agent.strip()
        if not agent_name:
            raise SnowflakeAgentError(
                "Could not resolve the STTM builder agent. Set "
                "SNOWFLAKE_STTM_BUILDER_AGENT or provide the metadata "
                "database/schema configuration."
            )
        self._agent_name = agent_name

    def invoke(self, req: STTMBuilderRequest) -> STTMBuilderResponse:
        req.semantic_context = self._ensure_semantic_context(req)
        user_text = self._build_prompt(req)

        raw_text, thread_id = self._agent.run(
            [{"role": "user", "content": [{"type": "text", "text": user_text}]}],
            agent=self._agent_name,
            thread_id=req.thread_id,
        )

        if req.interface == Interface.CHAT:
            sub_agent, result, message = self._parse_chat_response(raw_text)
            return STTMBuilderResponse(
                thread_id=thread_id,
                agent=sub_agent,
                result=result,
                message=message or raw_text.strip(),
            )

        sub_agent, result, message = self._parse_envelope(raw_text)
        return STTMBuilderResponse(
            thread_id=thread_id,
            agent=sub_agent,
            result=result,
            message=message,
        )

    def _ensure_semantic_context(
        self,
        req: STTMBuilderRequest,
    ) -> list[SemanticContextItem] | None:
        if not req.source_tables:
            return req.semantic_context
        try:
            records = self._semantic_model_service.get_table_records(
                self._session, req.source_tables
            )
            if not records and req.interface is not Interface.CHAT:
                self._semantic_model_service.ensure_tables(
                    session=self._session,
                    agent_client=self._agent,
                    tables=req.source_tables,
                    force=False,
                )
                records = self._semantic_model_service.get_table_records(
                    self._session, req.source_tables
                )

            if not records:
                return req.semantic_context

            context_items: list[SemanticContextItem] = []
            for record in records:
                table_name = record.get("table_name")
                if not table_name:
                    continue

                context_items.append(
                    SemanticContextItem(
                        table=TableRef(
                            database=str(record["database"]),
                            schema=str(record["schema_name"]),
                            table=str(table_name),
                        ),
                        semantic_model=record["semantic_model"],
                        scope=str(record["scope"]),
                    )
                )

            return context_items or req.semantic_context
        except Exception as exc:
            logger.warning(
                "Semantic context enrichment failed; continuing without semantic context: %s",
                exc,
            )
            return req.semantic_context

    @staticmethod
    def _build_prompt(req: STTMBuilderRequest) -> str:
        lines: list[str] = [f"[INTERFACE: {req.interface}]"]

        if req.source_tables:
            lines.append("Source table context:")
            for table in req.source_tables:
                lines.append(f"  - {table.qualified_name}")

        if req.driving_table:
            lines.append(f"Driving table: {req.driving_table.qualified_name}")

        if req.relationships:
            lines.append("")
            lines.append("Relationship context:")
            for relationship in req.relationships:
                left = relationship.left_table.qualified_name
                right = relationship.right_table.qualified_name
                conditions = ", ".join(
                    f"{condition.left_column} {condition.operator} {condition.right_column}"
                    for condition in relationship.conditions
                ) or "none"
                source = relationship.source or "USER_DEFINED"
                lines.append(
                    f"  - {left} {relationship.join_type} JOIN {right} "
                    f"[{source}] on {conditions}"
                )

        if req.selected_columns_by_table:
            lines.append("")
            lines.append("Selected columns by table:")
            for table_name, columns in sorted(req.selected_columns_by_table.items()):
                rendered = ", ".join(columns) if columns else "(none selected)"
                lines.append(f"  - {table_name}: {rendered}")

        if req.semantic_context:
            lines.append("")
            lines.append("Semantic context:")
            for item in req.semantic_context:
                lines.append(
                    f"  - {item.table.qualified_name}: {_semantic_summary(item.semantic_model)}"
                )

        if req.interface == Interface.CHAT:
            lines.append("")
            lines.append(req.message or "")
            lines.append("")
            lines.append(
                "Formatting instructions: respond in clean Markdown using short headings, "
                "bold key facts, flat bullet lists, and tables when useful. "
                "If you mention SQL, place it in fenced code blocks."
            )
            return "\n".join(lines)

        lines.append("")
        source_names = ", ".join(t.qualified_name for t in req.source_tables or [])
        lines.append(f"Source tables: {source_names}")
        lines.append("")
        lines.append("Target attributes:")

        for item in req.attributes or []:
            target = f"{item.target_table.qualified_name}.{item.target_attribute}"
            if item.source_mappings:
                mapped = ", ".join(
                    f"{mapping.table.qualified_name}.{mapping.attribute}"
                    for mapping in item.source_mappings
                )
                lines.append(f"  {target}  [mapped: {mapped}]")
            else:
                lines.append(f"  {target}  [not yet mapped]")

        if req.message:
            lines.append("")
            lines.append(f"User context: {req.message}")

        return "\n".join(lines)

    def _parse_envelope(
        self,
        raw: str,
    ) -> tuple[SubAgent | None, SourceMappingResult | TransformationResult | None, str | None]:
        json_str = _extract_json_object(raw)
        try:
            envelope: dict[str, Any] = json.loads(json_str)
        except json.JSONDecodeError as exc:
            raise SnowflakeAgentError(
                f"Orchestration agent response is not valid JSON: {exc} — raw: {raw[:400]}"
            ) from exc

        agent_name: str | None = envelope.get("agent")
        raw_result: dict[str, Any] | None = envelope.get("result")
        message: str | None = envelope.get("message")

        if not agent_name:
            return None, None, message

        try:
            sub_agent = SubAgent(agent_name)
        except ValueError as exc:
            raise SnowflakeAgentError(
                f"Unknown sub-agent in orchestration response: {agent_name!r}"
            ) from exc

        if raw_result is None:
            raise SnowflakeAgentError(f"Sub-agent {agent_name!r} returned a null result")

        validated = self._validate_result(sub_agent, raw_result)
        return sub_agent, validated, message

    def _parse_chat_response(
        self,
        raw: str,
    ) -> tuple[SubAgent | None, SourceMappingResult | TransformationResult | None, str | None]:
        sse_message = _extract_sse_text(raw)
        if sse_message is not None:
            return None, None, sse_message

        try:
            return self._parse_envelope(raw)
        except SnowflakeAgentError:
            text = raw.strip()
            return None, None, text or None

    @staticmethod
    def _validate_result(
        sub_agent: SubAgent,
        raw_result: dict[str, Any],
    ) -> SourceMappingResult | TransformationResult:
        try:
            if sub_agent == SubAgent.SOURCE_MAPPING_AGENT:
                raw_mappings: dict[str, Any] = raw_result.get("mappings", raw_result)
                mappings = {
                    attr: AttributeMapping.model_validate(value)
                    for attr, value in raw_mappings.items()
                }
                return SourceMappingResult(mappings=mappings)

            if sub_agent == SubAgent.TRANSFORMATION_AGENT:
                return TransformationResult.model_validate(raw_result)
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


def _semantic_summary(payload: Any) -> str:
    if isinstance(payload, dict):
        for key in ("domain_summary", "description", "summary"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    if isinstance(payload, list) and payload:
        return f"{len(payload)} semantic attributes available"
    return "Semantic model available"
