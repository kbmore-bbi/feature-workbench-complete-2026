from functools import lru_cache

from pydantic import BaseModel, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Snowflake Cortex LLMs available for agent orchestration.
SNOWFLAKE_SUPPORTED_MODELS: list[str] = [
    "claude-sonnet-4",
    "claude-3-5-sonnet",
    "claude-3-haiku",
    "llama3.3-70b",
    "llama3.1-405b",
    "llama3.1-70b",
    "mistral-large2",
    "snowflake-arctic",
    "reka-flash",
    "jamba-1.5-large",
    "jamba-1.5-mini",
]


class AgentConfig(BaseModel):
    """Internal agent definition — snowflake_name is infra detail, not exposed to callers."""

    id: str
    display_name: str
    description: str
    snowflake_name: str
    default_model: str


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env.local", extra="ignore")

    # Snowflake connection
    snowflake_account: str = ""
    snowflake_host: str = ""

    # Agent registry
    snowflake_sttm_builder_agent: str = ""
    snowflake_agent_orchestration_model: str = "claude-sonnet-4"

    # CORS — comma-separated list of allowed origins, or "*" for all
    cors_allowed_origins: str = ""

    @computed_field
    @property
    def agents(self) -> list[AgentConfig]:
        return [
            AgentConfig(
                id="sttm_builder",
                display_name="STTM Builder Agent",
                description=(
                    "Orchestration agent that routes requests to SOURCE_MAPPING_AGENT "
                    "or TRANSFORMATION_AGENT based on the interface (AUTO_MAP, CHAT, TRANSFORM). "
                    "Handles attribute mapping suggestions, refinements, and transformation rule generation."
                ),
                snowflake_name=self.snowflake_sttm_builder_agent,
                default_model=self.snowflake_agent_orchestration_model,
            ),
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
