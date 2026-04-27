from functools import lru_cache

from pydantic import BaseModel, Field, computed_field
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
    model_config = SettingsConfigDict(
        env_file=".env.local",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = Field(default="BBI AI Migration Workbench API", alias="APP_NAME")
    app_env: str = Field(default="dev", alias="APP_ENV")
    app_version: str = Field(default="0.1.0", alias="APP_VERSION")
    port: int = Field(default=8000, alias="PORT")
    users_table: str = Field(default="TBL_USERS", alias="USERS_TABLE")
    app_role_admin: str = Field(default="WORKBENCH_ADMIN", alias="APP_ROLE_ADMIN")
    app_role_publisher: str = Field(
        default="WORKBENCH_PUBLISHER",
        alias="APP_ROLE_PUBLISHER",
    )
    app_role_viewer: str = Field(
        default="WORKBENCH_VIEWER",
        alias="APP_ROLE_VIEWER",
    )

    snowflake_account: str = Field(default="", alias="SNOWFLAKE_ACCOUNT")
    snowflake_host: str = Field(default="", alias="SNOWFLAKE_HOST")
    snowflake_warehouse: str = Field(default="", alias="SNOWFLAKE_WAREHOUSE")
    snowflake_database: str = Field(default="", alias="SNOWFLAKE_DATABASE")
    snowflake_schema: str = Field(default="", alias="SNOWFLAKE_SCHEMA")

    snowflake_sttm_builder_agent: str = Field(
        default="",
        alias="SNOWFLAKE_STTM_BUILDER_AGENT",
    )
    snowflake_agent_orchestration_model: str = Field(
        default="claude-sonnet-4",
        alias="SNOWFLAKE_AGENT_ORCHESTRATION_MODEL",
    )
    cors_allowed_origins: str = Field(default="", alias="CORS_ALLOWED_ORIGINS")

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

    def qualify_table_name(self, table_name: str) -> str:
        if "." in table_name:
            return table_name
        return f"{self.snowflake_database}.{self.snowflake_schema}.{table_name}"

    @property
    def qualified_users_table(self) -> str:
        return self.qualify_table_name(self.users_table)


@lru_cache
def get_settings() -> Settings:
    return Settings()
