from pydantic import BaseModel, Field

from app.schema.common import AttributeRef, TableRef


class AutoMappingRequest(BaseModel):
    target_table: TableRef = Field(
        description="Target table (database, schema, table).",
    )
    target_attributes: list[str] = Field(
        min_length=1,
        description="Target column names to map to.",
    )
    source_tables: list[TableRef] = Field(
        min_length=1,
        description="One or more source tables. The agent fetches DDL for each.",
    )
    thread_id: str | None = Field(
        default=None,
        description=(
            "Snowflake Cortex Agent thread ID. "
            "Omit to start a new session; supply to continue an existing one."
        ),
    )


class MappingRefinementRequest(BaseModel):
    thread_id: str = Field(
        description="Thread ID from a prior suggest response — required to continue the session.",
    )
    target_attribute: AttributeRef = Field(
        description="The specific target attribute whose mapping is incorrect.",
    )
    feedback: str = Field(
        min_length=1,
        description="User context explaining why the mapping is wrong or what to look for.",
    )


class AttributeMapping(BaseModel):
    source_attributes: list[str] = Field(
        description="Source attributes mapped to this target attribute."
    )
    confidence_score: float = Field(
        ge=0.0,
        le=1.0,
        description="Model confidence (0 = no match, 1 = exact).",
    )


class AutoMappingResponse(BaseModel):
    thread_id: str = Field(
        description="Cortex Agent thread ID — pass back to continue the session."
    )
    mappings: dict[str, AttributeMapping] = Field(
        description="Keyed by target attribute name."
    )


class MappingRefinementResponse(BaseModel):
    thread_id: str = Field(
        description="Cortex Agent thread ID — pass back for further refinements."
    )
    attribute: str = Field(
        description="The target attribute that was re-examined."
    )
    mapping: AttributeMapping = Field(
        description="Updated mapping for the re-examined attribute."
    )
