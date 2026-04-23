from pydantic import BaseModel, Field


class AgentInfo(BaseModel):
    id: str = Field(description="Agent identifier used in API requests.")
    display_name: str = Field(description="Human-readable agent name.")
    description: str = Field(description="What this agent does.")
    default_model: str = Field(description="Default orchestration LLM for this agent.")
    supported_models: list[str] = Field(
        description="All Snowflake Cortex LLMs that can be used as the orchestration model."
    )


class AgentsListResponse(BaseModel):
    agents: list[AgentInfo]
