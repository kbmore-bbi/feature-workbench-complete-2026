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

LEGACY_METADATA_DATABASE = "FFP_HDP_CRM_MIG_DB_DEV"
LEGACY_METADATA_SCHEMA = "SCH_STTM_METADATA"


class AgentConfig(BaseModel):
    """Internal agent definition — snowflake_name is infra detail, not exposed to callers."""

    id: str
    display_name: str
    description: str
    snowflake_name: str
    default_model: str


def _split_qualified_name(value: str) -> tuple[str, str, str] | None:
    parts = [part.strip() for part in value.split(".")]
    if len(parts) != 3 or not all(parts):
        return None
    return parts[0], parts[1], parts[2]


def _looks_like_placeholder(value: str) -> bool:
    normalized = value.strip().upper()
    if not normalized:
        return True
    return normalized.startswith(("DB.SCHEMA.", "YOUR_DB.YOUR_SCHEMA."))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.local",
        extra="ignore",
        case_sensitive=False,
        populate_by_name=True,
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
    local_dev_auth_enabled: bool = Field(
        default=False,
        alias="LOCAL_DEV_AUTH_ENABLED",
    )
    local_dev_user_email: str = Field(
        default="",
        alias="LOCAL_DEV_USER_EMAIL",
    )
    local_dev_bypass_metadata: bool = Field(
        default=True,
        alias="LOCAL_DEV_BYPASS_METADATA",
    )

    snowflake_account: str = Field(default="", alias="SNOWFLAKE_ACCOUNT")
    snowflake_host: str = Field(default="", alias="SNOWFLAKE_HOST")
    snowflake_authenticator: str = Field(default="", alias="SNOWFLAKE_AUTHENTICATOR")
    snowflake_user: str = Field(default="", alias="SNOWFLAKE_USER")
    snowflake_password: str = Field(default="", alias="SNOWFLAKE_PASSWORD")
    snowflake_role: str = Field(default="", alias="SNOWFLAKE_ROLE")
    snowflake_warehouse: str = Field(default="", alias="SNOWFLAKE_WAREHOUSE")
    snowflake_database: str = Field(default="", alias="SNOWFLAKE_DATABASE")
    snowflake_schema: str = Field(default="", alias="SNOWFLAKE_SCHEMA")

    snowflake_sttm_builder_agent: str = Field(
        default="",
        alias="SNOWFLAKE_STTM_BUILDER_AGENT",
    )
    snowflake_source_mapping_agent: str = Field(
        default="",
        alias="SNOWFLAKE_SOURCE_MAPPING_AGENT",
    )
    snowflake_semantic_model_agent: str = Field(
        default="",
        alias="SNOWFLAKE_SEMANTIC_MODEL_AGENT",
    )
    snowflake_workbench_conversation_agent: str = Field(
        default="",
        alias="SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT",
    )
    snowflake_dbt_conversion_agent: str = Field(
        default="",
        alias="SNOWFLAKE_DBT_CONVERSION_AGENT",
    )
    snowflake_relationships_procedure: str = Field(
        default="",
        alias="SNOWFLAKE_RELATIONSHIPS_PROCEDURE",
    )
    snowflake_semantic_model_table: str = Field(
        default="TBL_SEMANTIC_MODELS",
        alias="SNOWFLAKE_SEMANTIC_MODEL_TABLE",
    )
    snowflake_semantic_bundles_table: str = Field(
        default="TBL_SEMANTIC_BUNDLES",
        alias="SNOWFLAKE_SEMANTIC_BUNDLES_TABLE",
    )
    snowflake_semantic_overrides_table: str = Field(
        default="TBL_SEMANTIC_OVERRIDES",
        alias="SNOWFLAKE_SEMANTIC_OVERRIDES_TABLE",
    )
    snowflake_derived_sources_table: str = Field(
        default="TBL_DERIVED_SOURCES",
        alias="SNOWFLAKE_DERIVED_SOURCES_TABLE",
    )
    snowflake_derived_view_prefix: str = Field(
        default="VW_DERIVED_SOURCE_",
        alias="SNOWFLAKE_DERIVED_VIEW_PREFIX",
    )
    snowflake_conversation_turns_table: str = Field(
        default="TBL_WORKBENCH_CONVERSATION_TURNS",
        alias="SNOWFLAKE_CONVERSATION_TURNS_TABLE",
    )
    snowflake_conversation_feedback_table: str = Field(
        default="TBL_WORKBENCH_FEEDBACK",
        alias="SNOWFLAKE_CONVERSATION_FEEDBACK_TABLE",
    )
    snowflake_conversation_recommendations_table: str = Field(
        default="TBL_WORKBENCH_RECOMMENDATIONS",
        alias="SNOWFLAKE_CONVERSATION_RECOMMENDATIONS_TABLE",
    )
    snowflake_assistant_inferences_table: str = Field(
        default="TBL_WORKBENCH_INFERENCES",
        alias="SNOWFLAKE_ASSISTANT_INFERENCES_TABLE",
    )
    snowflake_assistant_signals_table: str = Field(
        default="TBL_WORKBENCH_ASSISTANT_SIGNALS",
        alias="SNOWFLAKE_ASSISTANT_SIGNALS_TABLE",
    )
    snowflake_assistant_settings_table: str = Field(
        default="TBL_WORKBENCH_ASSISTANT_SETTINGS",
        alias="SNOWFLAKE_ASSISTANT_SETTINGS_TABLE",
    )
    snowflake_relationship_facts_table: str = Field(
        default="TBL_WORKBENCH_RELATIONSHIP_FACTS",
        alias="SNOWFLAKE_RELATIONSHIP_FACTS_TABLE",
    )
    snowflake_rag_documents_table: str = Field(
        default="TBL_WORKBENCH_RAG_DOCUMENTS",
        alias="SNOWFLAKE_RAG_DOCUMENTS_TABLE",
    )
    snowflake_client_notes_table: str = Field(
        default="TBL_WORKBENCH_CLIENT_NOTES",
        alias="SNOWFLAKE_CLIENT_NOTES_TABLE",
    )
    snowflake_client_sql_assets_table: str = Field(
        default="TBL_WORKBENCH_CLIENT_SQL_ASSETS",
        alias="SNOWFLAKE_CLIENT_SQL_ASSETS_TABLE",
    )
    snowflake_fir_events_table: str = Field(
        default="TBL_WORKBENCH_FIR_EVENTS",
        alias="SNOWFLAKE_FIR_EVENTS_TABLE",
    )
    snowflake_fir_feature_snapshots_table: str = Field(
        default="TBL_WORKBENCH_FIR_FEATURES",
        alias="SNOWFLAKE_FIR_FEATURES_TABLE",
    )
    snowflake_mapping_intents_table: str = Field(
        default="TBL_WORKBENCH_MAPPING_INTENTS",
        alias="SNOWFLAKE_MAPPING_INTENTS_TABLE",
    )
    snowflake_semantic_learnings_table: str = Field(
        default="TBL_WORKBENCH_SEMANTIC_LEARNINGS",
        alias="SNOWFLAKE_SEMANTIC_LEARNINGS_TABLE",
    )
    snowflake_fir_model_scores_table: str = Field(
        default="TBL_WORKBENCH_FIR_MODEL_SCORES",
        alias="SNOWFLAKE_FIR_MODEL_SCORES_TABLE",
    )
    snowflake_rag_search_service: str = Field(
        default="CSS_WORKBENCH_RAG",
        alias="SNOWFLAKE_RAG_SEARCH_SERVICE",
    )
    snowflake_agent_orchestration_model: str = Field(
        default="claude-sonnet-4",
        alias="SNOWFLAKE_AGENT_ORCHESTRATION_MODEL",
    )
    datahub_enabled: bool = Field(default=False, alias="DATAHUB_ENABLED")
    datahub_graphql_url: str = Field(default="", alias="DATAHUB_GRAPHQL_URL")
    datahub_ui_url: str = Field(default="", alias="DATAHUB_UI_URL")
    datahub_token: str = Field(default="", alias="DATAHUB_TOKEN")
    datahub_dataset_env: str = Field(default="PROD", alias="DATAHUB_DATASET_ENV")
    datahub_timeout_seconds: float = Field(default=10.0, alias="DATAHUB_TIMEOUT_SECONDS")
    cors_allowed_origins: str = Field(default="", alias="CORS_ALLOWED_ORIGINS")
    guardrails_enabled: bool = Field(default=True, alias="GUARDRAILS_ENABLED")
    guardrails_debug_routes_enabled: bool = Field(
        default=False,
        alias="GUARDRAILS_DEBUG_ROUTES_ENABLED",
    )
    guardrails_presidio_enabled: bool = Field(
        default=False,
        alias="GUARDRAILS_PRESIDIO_ENABLED",
    )
    guardrails_reject_raw_pii: bool = Field(
        default=False,
        alias="GUARDRAILS_REJECT_RAW_PII",
    )

    @computed_field
    @property
    def agents(self) -> list[AgentConfig]:
        return [
            AgentConfig(
                id="workbench_conversation",
                display_name="Workbench Conversation Agent",
                description=(
                    "Fast governed conversation agent for quick answers, recommendations, "
                    "feedback capture, and approved semantic-context RAG before any STTM handoff."
                ),
                snowflake_name=self.resolved_workbench_conversation_agent,
                default_model=self.snowflake_agent_orchestration_model,
            ),
            AgentConfig(
                id="sttm_builder",
                display_name="STTM Builder Agent",
                description=(
                    "Orchestration agent that routes requests to SOURCE_MAPPING_AGENT "
                    "or TRANSFORMATION_AGENT based on the interface (AUTO_MAP, CHAT, TRANSFORM). "
                    "Handles attribute mapping suggestions, refinements, and transformation rule generation."
                ),
                snowflake_name=self.resolved_sttm_builder_agent,
                default_model=self.snowflake_agent_orchestration_model,
            ),
            AgentConfig(
                id="dbt_conversion",
                display_name="DBT Conversion Agent",
                description=(
                    "Converts final STTM mapping SQL into dbt model files, source updates, "
                    "and schema YAML aligned to the client repository layout."
                ),
                snowflake_name=self.resolved_dbt_conversion_agent,
                default_model=self.snowflake_agent_orchestration_model,
            ),
        ]

    def qualify_table_name(self, table_name: str) -> str:
        return self.qualify_metadata_object_name(table_name)

    def qualify_metadata_object_name(self, object_name: str) -> str:
        candidate = object_name.strip()
        if not candidate:
            return candidate

        parts = _split_qualified_name(candidate)
        if parts:
            database, schema, resolved_object_name = parts
            if self._should_rebase_legacy_metadata_namespace(database, schema):
                return (
                    f"{self.snowflake_database.strip()}."
                    f"{self.snowflake_schema.strip()}."
                    f"{resolved_object_name}"
                )
            return f"{database}.{schema}.{resolved_object_name}"

        if "." in candidate:
            return candidate

        database = self.resolved_metadata_database
        schema = self.resolved_metadata_schema
        if not database or not schema:
            return candidate
        return f"{database}.{schema}.{candidate}"

    @property
    def normalized_snowflake_authenticator(self) -> str:
        return (self.snowflake_authenticator or "").strip().lower()

    @property
    def local_dev_uses_externalbrowser(self) -> bool:
        return self.normalized_snowflake_authenticator == "externalbrowser"

    @property
    def resolved_metadata_database(self) -> str:
        if self.snowflake_database.strip():
            return self.snowflake_database.strip()
        for candidate in (
            self.snowflake_semantic_model_table,
            self.snowflake_semantic_bundles_table,
            self.snowflake_semantic_overrides_table,
            self.snowflake_derived_sources_table,
        ):
            parts = _split_qualified_name(candidate)
            if parts:
                return parts[0]
        return ""

    @property
    def resolved_metadata_schema(self) -> str:
        if self.snowflake_schema.strip():
            return self.snowflake_schema.strip()
        for candidate in (
            self.snowflake_semantic_model_table,
            self.snowflake_semantic_bundles_table,
            self.snowflake_semantic_overrides_table,
            self.snowflake_derived_sources_table,
        ):
            parts = _split_qualified_name(candidate)
            if parts:
                return parts[1]
        return ""

    @property
    def resolved_sttm_builder_agent(self) -> str:
        return self._resolve_agent_name(
            self.snowflake_sttm_builder_agent,
            legacy_object_name="STTM_BUILDER_AGENT",
            default_object_name="AGT_STTM_BUILDER",
        )

    @property
    def resolved_semantic_model_agent(self) -> str:
        return self._resolve_agent_name(
            self.snowflake_semantic_model_agent,
            legacy_object_name="SEMANTIC_MODEL_AGENT",
            default_object_name="AGT_SEMANTIC_MODEL",
        )

    @property
    def resolved_source_mapping_agent(self) -> str:
        return self._resolve_agent_name(
            self.snowflake_source_mapping_agent,
            legacy_object_name="SOURCE_MAPPING_AGENT",
            default_object_name="AGT_SOURCE_MAPPING",
        )

    @property
    def resolved_workbench_conversation_agent(self) -> str:
        return self._resolve_agent_name(
            self.snowflake_workbench_conversation_agent,
            legacy_object_name="WORKBENCH_CONVERSATION_AGENT",
            default_object_name="AGT_WORKBENCH_CONVERSATION",
        )

    @property
    def resolved_dbt_conversion_agent(self) -> str:
        return self._resolve_agent_name(
            self.snowflake_dbt_conversion_agent,
            legacy_object_name="DBT_CONVERSION_AGENT",
            default_object_name="AGT_DBT_CONVERSION",
        )

    @property
    def resolved_relationships_procedure(self) -> str:
        raw_value = self.snowflake_relationships_procedure.strip()
        if raw_value and not _looks_like_placeholder(raw_value):
            parts = _split_qualified_name(self.qualify_metadata_object_name(raw_value))
            if parts:
                return f"{parts[0]}.{parts[1]}.{parts[2]}"

        database = self.resolved_metadata_database
        schema = self.resolved_metadata_schema
        if not database or not schema:
            return ""
        return f"{database}.{schema}.SP_GET_TABLE_RELATIONSHIPS"

    @property
    def qualified_users_table(self) -> str:
        return self.qualify_table_name(self.users_table)

    @property
    def local_dev_effective_email(self) -> str:
        return self.local_dev_user_email or self.snowflake_user

    @property
    def resolved_snowflake_host(self) -> str:
        host = (self.snowflake_host or "").strip()
        if host == "your_org-your_account.snowflakecomputing.com":
            return ""
        return host

    @property
    def non_local_env(self) -> bool:
        return self.app_env.strip().lower() not in {"", "dev", "local", "test"}

    @property
    def debug_routes_enabled(self) -> bool:
        if self.guardrails_debug_routes_enabled:
            return True
        return not self.non_local_env

    def _resolve_agent_name(
        self,
        raw_value: str,
        *,
        legacy_object_name: str,
        default_object_name: str,
    ) -> str:
        candidate = raw_value.strip()
        if candidate and not _looks_like_placeholder(candidate):
            parts = _split_qualified_name(candidate)
            if parts:
                database, schema, object_name = parts
                if object_name.upper() == legacy_object_name:
                    object_name = default_object_name
                if self._should_rebase_legacy_metadata_namespace(database, schema):
                    database = self.snowflake_database.strip()
                    schema = self.snowflake_schema.strip()
                return f"{database}.{schema}.{object_name}"
            if "." not in candidate:
                database = self.resolved_metadata_database
                schema = self.resolved_metadata_schema
                if database and schema:
                    object_name = default_object_name if candidate.upper() == legacy_object_name else candidate
                    return f"{database}.{schema}.{object_name}"

        database = self.resolved_metadata_database
        schema = self.resolved_metadata_schema
        if not database or not schema:
            return ""
        return f"{database}.{schema}.{default_object_name}"

    def _should_rebase_legacy_metadata_namespace(self, database: str, schema: str) -> bool:
        current_database = self.snowflake_database.strip()
        current_schema = self.snowflake_schema.strip()
        if not current_database or not current_schema:
            return False
        return (
            database.strip().upper() == LEGACY_METADATA_DATABASE
            and schema.strip().upper() == LEGACY_METADATA_SCHEMA
            and (
                current_database.strip().upper() != LEGACY_METADATA_DATABASE
                or current_schema.strip().upper() != LEGACY_METADATA_SCHEMA
            )
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
