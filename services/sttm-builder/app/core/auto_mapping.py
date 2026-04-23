import json
import os

from pydantic import TypeAdapter, ValidationError

from app.core.exceptions import SnowflakeAgentError
from app.core.snowflake_agent import SnowflakeAgentClient
from app.schema.auto_mapping import (
    AttributeMapping,
    AutoMappingResponse,
    MappingRefinementResponse,
)
from app.schema.common import AttributeRef, TableRef

_MappingsAdapter: TypeAdapter[dict[str, AttributeMapping]] = TypeAdapter(
    dict[str, AttributeMapping]
)


class AutoMappingService:
    """
    Drives the Snowflake Cortex Auto-Map Agent.

    The agent's system prompt, tools (DDL fetcher, etc.), and response schema
    are all defined inside Snowflake.  This service only:
      1. Builds the user-turn message with table/attribute names.
      2. Calls the agent (creating or resuming a thread).
      3. Validates the JSON response into typed Pydantic models.
    """

    def __init__(self, agent_client: SnowflakeAgentClient) -> None:
        self._agent = agent_client
        self._agent_name: str = os.environ["SNOWFLAKE_AUTO_MAP_AGENT"]

    def suggest(
        self,
        target_table: TableRef,
        target_attributes: list[str],
        source_tables: list[TableRef],
        *,
        thread_id: str | None = None,
    ) -> AutoMappingResponse:
        source_tables_str = ", ".join(t.qualified_name for t in source_tables)
        target_attrs_str = ", ".join(target_attributes)

        user_text = (
            f"Suggest auto mapping for target table: {target_table.qualified_name} "
            f"(target attributes: {target_attrs_str}) "
            f"from source tables: {source_tables_str}"
        )

        raw_text, new_thread_id = self._agent.run(
            [{"role": "user", "content": [{"type": "text", "text": user_text}]}],
            agent=self._agent_name,
            thread_id=thread_id,
        )

        mappings = self._parse_mappings(raw_text, target_attributes)
        return AutoMappingResponse(thread_id=new_thread_id, mappings=mappings)

    def refine(
        self,
        thread_id: str,
        target_attribute: AttributeRef,
        feedback: str,
    ) -> MappingRefinementResponse:
        """Re-examine a single attribute mapping using user feedback."""
        attr_name = target_attribute.attribute
        table_name = target_attribute.table.qualified_name

        user_text = (
            f"The mapping for target attribute '{attr_name}' "
            f"in table '{table_name}' is incorrect. "
            f"Additional context: {feedback}. "
            f"Please re-examine only this attribute and suggest the correct mapping."
        )

        raw_text, new_thread_id = self._agent.run(
            [{"role": "user", "content": [{"type": "text", "text": user_text}]}],
            agent=self._agent_name,
            thread_id=thread_id,
        )

        mappings = self._parse_mappings(raw_text, [attr_name])
        return MappingRefinementResponse(
            thread_id=new_thread_id,
            attribute=attr_name,
            mapping=mappings[attr_name],
        )

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_mappings(
        raw: str, target_attributes: list[str]
    ) -> dict[str, AttributeMapping]:
        json_str = _extract_json_object(raw)
        try:
            data: dict = json.loads(json_str)
        except json.JSONDecodeError as exc:
            raise SnowflakeAgentError(
                f"Agent response is not valid JSON: {exc} — raw: {raw[:400]}"
            ) from exc

        raw_mappings: dict = data.get("mappings", data)

        try:
            validated = _MappingsAdapter.validate_python(raw_mappings)
        except ValidationError as exc:
            raise SnowflakeAgentError(
                f"Agent response failed schema validation: {exc}"
            ) from exc

        return {
            attr: validated.get(attr, AttributeMapping(source_attributes=[], confidence_score=0.0))
            for attr in target_attributes
        }


def _extract_json_object(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        return text[start : end + 1]
    return text.strip()
