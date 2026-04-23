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
    snowflake_auto_map_agent: str = ""
    snowflake_agent_orchestration_model: str = "claude-sonnet-4"

    @computed_field
    @property
    def agents(self) -> list[AgentConfig]:
        """
        Single source of truth for all Cortex Agents in this service.
        Add new agents here as the feature set grows.
        """
        return [
            AgentConfig(
                id="auto_map",
                display_name="Auto Map Agent",
                description=(
                    "Suggests and auto-fills source-to-target attribute mappings. "
                    "Fetches DDL from Snowflake and returns per-attribute confidence scores."
                ),
                snowflake_name=self.snowflake_auto_map_agent,
                default_model=self.snowflake_agent_orchestration_model,
            ),
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
