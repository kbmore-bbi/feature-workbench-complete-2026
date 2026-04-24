import json
import os

from pydantic import ValidationError

from app.core.exceptions import SnowflakeAgentError
from app.core.snowflake_agent import SnowflakeAgentClient
from app.schema.sttm_builder import (
    AttributeMapping,
    Interface,
    SourceMappingResult,
    STTMBuilderRequest,
    STTMBuilderResponse,
    SubAgent,
    TransformationResult,
)


class STTMBuilderService:
    """
    Drives the STTM_BUILDER_AGENT orchestration agent.

    The agent routes each request to the appropriate sub-agent
    (SOURCE_MAPPING_AGENT or TRANSFORMATION_AGENT) based on the interface
    tag embedded in the prompt.  This service:
      1. Builds a structured prompt from the request.
      2. Calls the agent (creating or resuming a thread).
      3. Parses and validates the orchestration response envelope.
      4. Returns a typed STTMBuilderResponse.
    """

    def __init__(self, agent_client: SnowflakeAgentClient) -> None:
        self._agent = agent_client
        agent_name = os.environ.get("SNOWFLAKE_STTM_BUILDER_AGENT", "").strip()
        if not agent_name:
            raise SnowflakeAgentError(
                "SNOWFLAKE_STTM_BUILDER_AGENT env var is not set. "
                "Expected format: DATABASE.SCHEMA.AGENT_NAME"
            )
        self._agent_name = agent_name

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def invoke(self, req: STTMBuilderRequest) -> STTMBuilderResponse:
        user_text = self._build_prompt(req)

        raw_text, thread_id = self._agent.run(
            [{"role": "user", "content": [{"type": "text", "text": user_text}]}],
            agent=self._agent_name,
            thread_id=req.thread_id,
        )

        sub_agent, result, message = self._parse_envelope(raw_text)

        return STTMBuilderResponse(
            thread_id=thread_id,
            agent=sub_agent,
            result=result,
            message=message,
        )

    # ------------------------------------------------------------------
    # Prompt construction
    # ------------------------------------------------------------------

    @staticmethod
    def _build_prompt(req: STTMBuilderRequest) -> str:
        lines: list[str] = [f"[INTERFACE: {req.interface}]"]

        if req.interface == Interface.CHAT:
            lines.append(req.message)  # type: ignore[arg-type]
            return "\n".join(lines)

        # AUTO_MAP and TRANSFORM — structured format
        source_names = ", ".join(t.qualified_name for t in req.source_tables)  # type: ignore[union-attr]
        lines.append(f"Source tables: {source_names}")
        lines.append("")
        lines.append("Target attributes:")

        for item in req.attributes:  # type: ignore[union-attr]
            target = f"{item.target_table.qualified_name}.{item.target_attribute}"
            if item.source_mappings:
                mapped = ", ".join(
                    f"{m.table.qualified_name}.{m.attribute}" for m in item.source_mappings
                )
                lines.append(f"  {target}  [mapped: {mapped}]")
            else:
                lines.append(f"  {target}  [not yet mapped]")

        if req.message:
            lines.append("")
            lines.append(f"User context: {req.message}")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Envelope parsing and result validation
    # ------------------------------------------------------------------

    def _parse_envelope(
        self,
        raw: str,
    ) -> tuple[SubAgent | None, SourceMappingResult | TransformationResult | None, str | None]:
        json_str = _extract_json_object(raw)
        try:
            envelope: dict = json.loads(json_str)
        except json.JSONDecodeError as exc:
            raise SnowflakeAgentError(
                f"Orchestration agent response is not valid JSON: {exc} — raw: {raw[:400]}"
            ) from exc

        agent_name: str | None = envelope.get("agent")
        raw_result: dict | None = envelope.get("result")
        message: str | None = envelope.get("message")

        if not agent_name:
            return None, None, message

        try:
            sub_agent = SubAgent(agent_name)
        except ValueError:
            raise SnowflakeAgentError(
                f"Unknown sub-agent in orchestration response: {agent_name!r}"
            )

        if raw_result is None:
            raise SnowflakeAgentError(
                f"Sub-agent {agent_name!r} returned a null result"
            )

        validated = self._validate_result(sub_agent, raw_result)
        return sub_agent, validated, message

    @staticmethod
    def _validate_result(
        sub_agent: SubAgent,
        raw_result: dict,
    ) -> SourceMappingResult | TransformationResult:
        try:
            if sub_agent == SubAgent.SOURCE_MAPPING_AGENT:
                raw_mappings: dict = raw_result.get("mappings", raw_result)
                mappings = {
                    attr: AttributeMapping.model_validate(v)
                    for attr, v in raw_mappings.items()
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
