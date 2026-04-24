from enum import Enum

from pydantic import BaseModel, Field, model_validator

from app.schema.common import AttributeRef, TableRef


class Interface(str, Enum):
    AUTO_MAP = "AUTO_MAP"
    CHAT = "CHAT"
    TRANSFORM = "TRANSFORM"


class SubAgent(str, Enum):
    SOURCE_MAPPING_AGENT = "SOURCE_MAPPING_AGENT"
    TRANSFORMATION_AGENT = "TRANSFORMATION_AGENT"


class TargetAttributeItem(BaseModel):
    """One target attribute with its optional current source mapping."""

    target_table: TableRef = Field(description="Target table this attribute belongs to.")
    target_attribute: str = Field(description="Target column name.")
    source_mappings: list[AttributeRef] | None = Field(
        default=None,
        description=(
            "Source attributes already mapped to this target attribute. "
            "Omit or set to null if not yet mapped."
        ),
    )


class STTMBuilderRequest(BaseModel):
    interface: Interface = Field(
        description=(
            "AUTO_MAP — button-triggered mapping request. "
            "CHAT — free-text message; orchestration agent decides which sub-agent to call. "
            "TRANSFORM — transformation rule generation."
        )
    )
    thread_id: str | None = Field(
        default=None,
        description="Cortex Agent thread ID. Omit to start a new session; supply to continue one.",
    )

    # Structured input — required for AUTO_MAP and TRANSFORM
    attributes: list[TargetAttributeItem] | None = Field(
        default=None,
        min_length=1,
        description=(
            "Target attributes to map or transform. Each item specifies the target table, "
            "target attribute, and optionally its current source mapping. "
            "Required for AUTO_MAP and TRANSFORM."
        ),
    )
    source_tables: list[TableRef] | None = Field(
        default=None,
        min_length=1,
        description=(
            "Pool of source tables available for mapping. "
            "Pass even when source mappings are already set. "
            "Required for AUTO_MAP and TRANSFORM."
        ),
    )

    # User message — required for CHAT, optional refinement context for AUTO_MAP / TRANSFORM
    message: str | None = Field(
        default=None,
        description=(
            "User's message or refinement feedback. "
            "Required for CHAT. "
            "Optional for AUTO_MAP / TRANSFORM to add context to the mapping request."
        ),
    )

    @model_validator(mode="after")
    def _validate_by_interface(self) -> "STTMBuilderRequest":
        if self.interface in (Interface.AUTO_MAP, Interface.TRANSFORM):
            missing = [
                name
                for name, val in [("attributes", self.attributes), ("source_tables", self.source_tables)]
                if not val
            ]
            if missing:
                raise ValueError(f"{self.interface} requires: {', '.join(missing)}")
        elif self.interface == Interface.CHAT:
            if not self.message:
                raise ValueError("CHAT interface requires a non-empty `message`")
        return self


# ---------------------------------------------------------------------------
# Sub-agent result schemas
# ---------------------------------------------------------------------------


class AttributeMapping(BaseModel):
    source_attributes: list[str] = Field(
        description="Source attributes that map to this target attribute."
    )
    confidence_score: float = Field(
        ge=0.0,
        le=1.0,
        description="Mapping confidence (0 = no match, 1 = exact).",
    )


class SourceMappingResult(BaseModel):
    """Validated result from SOURCE_MAPPING_AGENT."""

    mappings: dict[str, AttributeMapping] = Field(
        description="Keyed by target attribute name."
    )


class TransformationRule(BaseModel):
    target_attribute: str = Field(description="Target column this rule applies to.")
    rule: str = Field(description="Transformation expression or SQL fragment.")
    description: str | None = Field(
        default=None, description="Human-readable explanation of the rule."
    )


class TransformationResult(BaseModel):
    """Validated result from TRANSFORMATION_AGENT."""

    rules: list[TransformationRule] = Field(
        description="One rule per target attribute."
    )


# ---------------------------------------------------------------------------
# Unified response
# ---------------------------------------------------------------------------


class STTMBuilderResponse(BaseModel):
    thread_id: str = Field(
        description="Cortex Agent thread ID — pass back on follow-up calls."
    )
    agent: SubAgent | None = Field(
        default=None,
        description="Which sub-agent handled the request. Null when no sub-agent was called.",
    )
    result: SourceMappingResult | TransformationResult | None = Field(
        default=None,
        description="Typed result from the sub-agent. Null when agent is null.",
    )
    message: str | None = Field(
        default=None,
        description="Agent summary or clarifying question. Always present for CHAT interface.",
    )
