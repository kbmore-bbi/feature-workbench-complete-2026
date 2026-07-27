from functools import lru_cache
from urllib.parse import urlparse

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
    auth_mode: str = Field(
        default="ingress_headers",
        alias="AUTH_MODE",
    )
    spcs_execute_as_caller_enabled: bool = Field(
        default=True,
        alias="SPCS_EXECUTE_AS_CALLER_ENABLED",
    )
    auth_session_cookie_name: str = Field(
        default="sttm_session",
        alias="AUTH_SESSION_COOKIE_NAME",
    )
    auth_state_cookie_name: str = Field(
        default="sttm_oauth_state",
        alias="AUTH_STATE_COOKIE_NAME",
    )
    auth_session_secret: str = Field(
        default="",
        alias="AUTH_SESSION_SECRET",
    )
    auth_session_encryption_key: str = Field(
        default="",
        alias="AUTH_SESSION_ENCRYPTION_KEY",
    )
    auth_session_cookie_domain: str = Field(
        default="",
        alias="AUTH_SESSION_COOKIE_DOMAIN",
    )
    auth_session_cookie_samesite: str = Field(
        default="lax",
        alias="AUTH_SESSION_COOKIE_SAMESITE",
    )
    auth_session_cookie_secure: bool = Field(
        default=True,
        alias="AUTH_SESSION_COOKIE_SECURE",
    )
    auth_session_cookie_max_age_seconds: int = Field(
        default=2592000,
        alias="AUTH_SESSION_COOKIE_MAX_AGE_SECONDS",
    )
    auth_oauth_state_ttl_seconds: int = Field(
        default=600,
        alias="AUTH_OAUTH_STATE_TTL_SECONDS",
    )
    auth_access_token_refresh_skew_seconds: int = Field(
        default=120,
        alias="AUTH_ACCESS_TOKEN_REFRESH_SKEW_SECONDS",
    )
    auth_principal_cache_ttl_seconds: int = Field(
        default=300,
        alias="AUTH_PRINCIPAL_CACHE_TTL_SECONDS",
    )
    auth_post_login_redirect_path: str = Field(
        default="/home",
        alias="AUTH_POST_LOGIN_REDIRECT_PATH",
    )
    auth_post_logout_redirect_path: str = Field(
        default="/home",
        alias="AUTH_POST_LOGOUT_REDIRECT_PATH",
    )
    snowflake_oauth_client_id: str = Field(
        default="",
        alias="SNOWFLAKE_OAUTH_CLIENT_ID",
    )
    snowflake_oauth_client_secret: str = Field(
        default="",
        alias="SNOWFLAKE_OAUTH_CLIENT_SECRET",
    )
    snowflake_oauth_authorize_url: str = Field(
        default="",
        alias="SNOWFLAKE_OAUTH_AUTHORIZE_URL",
    )
    snowflake_oauth_token_url: str = Field(
        default="",
        alias="SNOWFLAKE_OAUTH_TOKEN_URL",
    )
    snowflake_oauth_redirect_uri: str = Field(
        default="",
        alias="SNOWFLAKE_OAUTH_REDIRECT_URI",
    )
    snowflake_oauth_scope: str = Field(
        default="",
        alias="SNOWFLAKE_OAUTH_SCOPE",
    )
    snowflake_oauth_sessions_table: str = Field(
        default="TBL_WORKBENCH_OAUTH_SESSIONS",
        alias="SNOWFLAKE_OAUTH_SESSIONS_TABLE",
    )

    snowflake_account: str = Field(default="", alias="SNOWFLAKE_ACCOUNT")
    snowflake_host: str = Field(default="", alias="SNOWFLAKE_HOST")
    snowflake_rest_host: str = Field(default="", alias="SNOWFLAKE_REST_HOST")
    snowflake_authenticator: str = Field(default="", alias="SNOWFLAKE_AUTHENTICATOR")
    snowflake_user: str = Field(default="", alias="SNOWFLAKE_USER")
    snowflake_password: str = Field(default="", alias="SNOWFLAKE_PASSWORD")
    snowflake_role: str = Field(default="", alias="SNOWFLAKE_ROLE")
    snowflake_warehouse: str = Field(default="", alias="SNOWFLAKE_WAREHOUSE")
    snowflake_control_warehouse: str = Field(
        default="",
        alias="SNOWFLAKE_CONTROL_WAREHOUSE",
    )
    snowflake_agent_warehouse: str = Field(
        default="",
        alias="SNOWFLAKE_AGENT_WAREHOUSE",
    )
    snowflake_execution_warehouse: str = Field(
        default="",
        alias="SNOWFLAKE_EXECUTION_WAREHOUSE",
    )
    auto_mapping_warehouse: str = Field(
        default="",
        alias="AUTO_MAPPING_WAREHOUSE",
    )
    snowflake_control_statement_timeout_seconds: int = Field(
        default=60,
        alias="SNOWFLAKE_CONTROL_STATEMENT_TIMEOUT_SECONDS",
    )
    snowflake_agent_statement_timeout_seconds: int = Field(
        default=300,
        alias="SNOWFLAKE_AGENT_STATEMENT_TIMEOUT_SECONDS",
    )
    snowflake_execution_statement_timeout_seconds: int = Field(
        default=900,
        alias="SNOWFLAKE_EXECUTION_STATEMENT_TIMEOUT_SECONDS",
    )
    snowflake_automap_statement_timeout_seconds: int = Field(
        default=600,
        alias="SNOWFLAKE_AUTOMAP_STATEMENT_TIMEOUT_SECONDS",
    )
    snowflake_session_healthcheck_interval_seconds: int = Field(
        default=0,
        alias="SNOWFLAKE_SESSION_HEALTHCHECK_INTERVAL_SECONDS",
        description=(
            "Optional periodic pooled-session validation. Zero disables SELECT 1 "
            "health queries; failed real work reconnects the session instead."
        ),
    )
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
    conversation_model_route_planning_enabled: bool = Field(
        default=False,
        alias="CONVERSATION_MODEL_ROUTE_PLANNING_ENABLED",
    )
    snowflake_dbt_conversion_agent: str = Field(
        default="",
        alias="SNOWFLAKE_DBT_CONVERSION_AGENT",
    )
    snowflake_test_case_generation_agent: str = Field(
        default="",
        alias="SNOWFLAKE_TEST_CASE_GENERATION_AGENT",
    )
    snowflake_relationships_procedure: str = Field(
        default="",
        alias="SNOWFLAKE_RELATIONSHIPS_PROCEDURE",
    )
    snowflake_semantic_model_table: str = Field(
        default="TBL_SEMANTIC_MODELS",
        alias="SNOWFLAKE_SEMANTIC_MODEL_TABLE",
    )
    snowflake_semantic_table_views_table: str = Field(
        default="SEM_TABLE_VIEWS",
        alias="SNOWFLAKE_SEMANTIC_TABLE_VIEWS_TABLE",
    )
    snowflake_semantic_views_database: str = Field(
        default="",
        alias="SNOWFLAKE_SEMANTIC_VIEWS_DATABASE",
        description="Database where SEM_TABLE_VIEWS lives (fallback for relationship extraction)",
    )
    snowflake_semantic_views_schema: str = Field(
        default="",
        alias="SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA",
        description="Schema where SEM_TABLE_VIEWS lives (fallback for relationship extraction)",
    )
    snowflake_semantic_column_views_table: str = Field(
        default="SEM_COLUMN_VIEWS",
        alias="SNOWFLAKE_SEMANTIC_COLUMN_VIEWS_TABLE",
    )
    snowflake_semantic_native_views_table: str = Field(
        default="SEM_NATIVE_VIEWS",
        alias="SNOWFLAKE_SEMANTIC_NATIVE_VIEWS_TABLE",
    )
    snowflake_semantic_projections_table: str = Field(
        default="TBL_SEMANTIC_PROJECTIONS",
        alias="SNOWFLAKE_SEMANTIC_PROJECTIONS_TABLE",
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
    snowflake_fir_templates_table: str = Field(
        default="TBL_WORKBENCH_FIR_TEMPLATES",
        alias="SNOWFLAKE_FIR_TEMPLATES_TABLE",
    )

    # FIR System Tables (AGT_FIR_SYSTEM batch processing)
    snowflake_fir_360_table: str = Field(
        default="TBL_AGENT_FIR_360",
        alias="SNOWFLAKE_FIR_360_TABLE",
        description="Core FIR lineage table linking feedback → inference → recommendation",
    )
    snowflake_semantic_versions_table: str = Field(
        default="TBL_SEMANTIC_VIEW_VERSIONS",
        alias="SNOWFLAKE_SEMANTIC_VERSIONS_TABLE",
        description="Versioned curated semantic views (RAW → CURATED_V1 → CURATED_V2)",
    )
    snowflake_fir_agent_recommendations_table: str = Field(
        default="TBL_FIR_AGENT_RECOMMENDATIONS",
        alias="SNOWFLAKE_FIR_AGENT_RECOMMENDATIONS_TABLE",
        description="Agent-specific recommendations with trigger conditions",
    )

    # FIR Feature Flags
    fir_streaming_enabled: bool = Field(
        default=False,
        alias="FIR_STREAMING_ENABLED",
        description="Enable streaming responses from agents (feature flag for phased rollout)",
    )
    fir_signal_bus_enabled: bool = Field(
        default=True,
        alias="FIR_SIGNAL_BUS_ENABLED",
        description="Enable real-time signal delivery via WebSocket",
    )
    fir_signal_max_per_window: int = Field(
        default=3,
        alias="FIR_SIGNAL_MAX_PER_WINDOW",
        description="Maximum signals to deliver per time window",
    )
    fir_signal_window_seconds: int = Field(
        default=30,
        alias="FIR_SIGNAL_WINDOW_SECONDS",
        description="Time window for signal batching in seconds",
    )
    fir_learning_context_enabled: bool = Field(
        default=True,
        alias="FIR_LEARNING_CONTEXT_ENABLED",
        description="Enable learning context injection into agent requests",
    )
    prepared_workspace_context_v2: bool = Field(
        default=True,
        alias="PREPARED_WORKSPACE_CONTEXT_V2",
    )
    assistant_streaming_v2: bool = Field(
        default=True,
        alias="ASSISTANT_STREAMING_V2",
    )
    fir_target_mapping_patterns_v2: bool = Field(
        default=True,
        alias="FIR_TARGET_MAPPING_PATTERNS_V2",
    )
    fir_durable_jobs_v2: bool = Field(
        default=True,
        alias="FIR_DURABLE_JOBS_V2",
    )
    prepared_context_l1_idle_seconds: int = Field(
        default=3600,
        alias="PREPARED_CONTEXT_L1_IDLE_SECONDS",
    )
    prepared_context_soft_revalidate_seconds: int = Field(
        default=86400,
        alias="PREPARED_CONTEXT_SOFT_REVALIDATE_SECONDS",
    )
    prepared_context_cleanup_days: int = Field(
        default=30,
        alias="PREPARED_CONTEXT_CLEANUP_DAYS",
    )
    prepared_context_debounce_ms: int = Field(
        default=750,
        alias="PREPARED_CONTEXT_DEBOUNCE_MS",
    )
    snowflake_prepared_workspace_contexts_table: str = Field(
        default="TBL_PREPARED_WORKSPACE_CONTEXTS",
        alias="SNOWFLAKE_PREPARED_WORKSPACE_CONTEXTS_TABLE",
    )
    snowflake_target_mapping_patterns_table: str = Field(
        default="TBL_FIR_TARGET_MAPPING_PATTERNS",
        alias="SNOWFLAKE_TARGET_MAPPING_PATTERNS_TABLE",
    )
    snowflake_fir_learning_jobs_table: str = Field(
        default="TBL_FIR_LEARNING_JOBS",
        alias="SNOWFLAKE_FIR_LEARNING_JOBS_TABLE",
    )
    snowflake_fir_learning_work_items_table: str = Field(
        default="TBL_FIR_LEARNING_WORK_ITEMS",
        alias="SNOWFLAKE_FIR_LEARNING_WORK_ITEMS_TABLE",
    )
    fir_agent_request_timeout_seconds: int = Field(
        default=840,
        alias="FIR_AGENT_REQUEST_TIMEOUT_SECONDS",
    )
    fir_agent_max_assets_per_run: int = Field(
        default=1,
        alias="FIR_AGENT_MAX_ASSETS_PER_RUN",
    )
    fir_agent_max_patterns_per_batch: int = Field(
        default=10,
        alias="FIR_AGENT_MAX_PATTERNS_PER_BATCH",
    )
    fir_agent_max_concurrency: int = Field(
        default=2,
        alias="FIR_AGENT_MAX_CONCURRENCY",
    )
    fir_agent_retry_limit: int = Field(
        default=2,
        alias="FIR_AGENT_RETRY_LIMIT",
    )
    fir_job_max_runtime_seconds: int = Field(
        default=3600,
        alias="FIR_JOB_MAX_RUNTIME_SECONDS",
    )

    snowflake_workspace_snapshots_table: str = Field(
        default="TBL_WORKSPACE_SNAPSHOTS",
        alias="SNOWFLAKE_WORKSPACE_SNAPSHOTS_TABLE",
    )
    snowflake_agent_artifacts_table: str = Field(
        default="TBL_AGENT_ARTIFACTS",
        alias="SNOWFLAKE_AGENT_ARTIFACTS_TABLE",
    )
    snowflake_agent_artifact_stage: str = Field(
        default="AI_WORKBENCH_ARTIFACTS",
        alias="SNOWFLAKE_AGENT_ARTIFACT_STAGE",
    )
    agent_inline_artifact_limit_bytes: int = Field(
        default=32768,
        alias="AGENT_INLINE_ARTIFACT_LIMIT_BYTES",
    )
    agent_artifact_draft_retention_days: int = Field(
        default=90,
        alias="AGENT_ARTIFACT_DRAFT_RETENTION_DAYS",
    )
    snowflake_conversation_segments_table: str = Field(
        default="TBL_WORKBENCH_CONVERSATION_SEGMENTS",
        alias="SNOWFLAKE_CONVERSATION_SEGMENTS_TABLE",
    )
    agent_context_limit_tokens: int = Field(
        default=90000,
        alias="AGENT_CONTEXT_LIMIT_TOKENS",
    )
    agent_thread_rollover_ratio: float = Field(
        default=0.65,
        alias="AGENT_THREAD_ROLLOVER_RATIO",
    )
    agent_thread_hard_ratio: float = Field(
        default=0.80,
        alias="AGENT_THREAD_HARD_RATIO",
    )
    agent_recent_turns_to_keep: int = Field(
        default=8,
        alias="AGENT_RECENT_TURNS_TO_KEEP",
    )
    agent_max_turns_per_segment: int = Field(
        default=60,
        alias="AGENT_MAX_TURNS_PER_SEGMENT",
    )
    snowflake_projects_table: str = Field(
        default="TBL_PROJECTS",
        alias="SNOWFLAKE_PROJECTS_TABLE",
    )
    snowflake_sttm_table: str = Field(
        default="TBL_STTM",
        alias="SNOWFLAKE_STTM_TABLE",
    )
    snowflake_sttm_versions_table: str = Field(
        default="TBL_STTM_VERSIONS",
        alias="SNOWFLAKE_STTM_VERSIONS_TABLE",
    )
    snowflake_sttm_sources_table: str = Field(
        default="TBL_STTM_SOURCES",
        alias="SNOWFLAKE_STTM_SOURCES_TABLE",
    )
    snowflake_sttm_attributes_table: str = Field(
        default="TBL_STTM_ATTRIBUTES",
        alias="SNOWFLAKE_STTM_ATTRIBUTES_TABLE",
    )
    # Deprecated compatibility alias. Current UI mapping-row state is stored in
    # TBL_STTM_ATTRIBUTES.CONDITION, so no separate mapping-row table is used.
    snowflake_sttm_mapping_rows_table: str = Field(
        default="TBL_STTM_ATTRIBUTES",
        alias="SNOWFLAKE_STTM_MAPPING_ROWS_TABLE",
    )
    snowflake_rag_search_service: str = Field(
        default="CSS_WORKBENCH_RAG",
        alias="SNOWFLAKE_RAG_SEARCH_SERVICE",
    )
    snowflake_agent_orchestration_model: str = Field(
        default="claude-sonnet-4",
        alias="SNOWFLAKE_AGENT_ORCHESTRATION_MODEL",
    )
    snowflake_session_retry_attempts: int = Field(
        default=2,
        alias="SNOWFLAKE_SESSION_RETRY_ATTEMPTS",
    )
    snowflake_session_retry_backoff_seconds: float = Field(
        default=1.0,
        alias="SNOWFLAKE_SESSION_RETRY_BACKOFF_SECONDS",
    )
    snowflake_user_session_cache_ttl_seconds: int = Field(
        default=1800,
        alias="SNOWFLAKE_USER_SESSION_CACHE_TTL_SECONDS",
    )
    snowflake_agent_retry_attempts: int = Field(
        default=3,
        alias="SNOWFLAKE_AGENT_RETRY_ATTEMPTS",
    )
    snowflake_agent_retry_backoff_seconds: float = Field(
        default=1.0,
        alias="SNOWFLAKE_AGENT_RETRY_BACKOFF_SECONDS",
    )
    auto_mapping_service_url: str = Field(
        default="",
        alias="AUTO_MAPPING_SERVICE_URL",
    )
    auto_mapping_service_timeout_seconds: float = Field(
        default=300.0,
        alias="AUTO_MAPPING_SERVICE_TIMEOUT_SECONDS",
    )
    auto_mapping_service_retry_attempts: int = Field(
        default=2,
        alias="AUTO_MAPPING_SERVICE_RETRY_ATTEMPTS",
    )
    auto_mapping_worker_max_concurrency: int = Field(
        default=5,
        alias="AUTO_MAPPING_WORKER_MAX_CONCURRENCY",
    )
    auto_mapping_proxy_batch_size: int = Field(
        default=17,
        alias="AUTO_MAPPING_PROXY_BATCH_SIZE",
    )
    auto_mapping_proxy_max_in_flight: int = Field(
        default=2,
        alias="AUTO_MAPPING_PROXY_MAX_IN_FLIGHT",
    )
    auto_map_pipeline_v2: bool = Field(
        default=False,
        alias="AUTO_MAP_PIPELINE_V2",
    )
    agent_spec_source_mapping_sha256: str = Field(
        default="",
        alias="AGENT_SPEC_SOURCE_MAPPING_SHA256",
    )
    agent_spec_transformation_rule_sha256: str = Field(
        default="",
        alias="AGENT_SPEC_TRANSFORMATION_RULE_SHA256",
    )
    coco_enabled: bool = Field(default=False, alias="COCO_ENABLED")
    coco_service_url: str = Field(
        default="ws://127.0.0.1:8001/api/v1/coco/ws",
        alias="COCO_SERVICE_URL",
    )
    coco_knowledge_dir: str = Field(
        default="/app/knowledge",
        alias="COCO_KNOWLEDGE_DIR",
    )
    coco_workbench_api_url: str = Field(
        default="http://127.0.0.1:8000",
        alias="COCO_WORKBENCH_API_URL",
    )
    coco_snowflake_account: str = Field(default="", alias="COCO_SNOWFLAKE_ACCOUNT")
    coco_snowflake_warehouse: str = Field(default="", alias="COCO_SNOWFLAKE_WAREHOUSE")
    coco_snowflake_database: str = Field(default="", alias="COCO_SNOWFLAKE_DATABASE")
    coco_snowflake_schema: str = Field(default="", alias="COCO_SNOWFLAKE_SCHEMA")
    coco_permission_timeout_seconds: float = Field(
        default=300.0,
        alias="COCO_PERMISSION_TIMEOUT_SECONDS",
    )
    coco_cli_path: str = Field(
        default="/root/.local/bin/cortex",
        alias="CORTEX_CODE_CLI_PATH",
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
            AgentConfig(
                id="test_case_generation",
                display_name="Test Case Generation Agent",
                description=(
                    "Generates QA seed data and detailed test-case documents from the final "
                    "validated STTM mapping."
                ),
                snowflake_name=self.resolved_test_case_generation_agent,
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
            # Deployment templates intentionally use DB.SCHEMA.<object> as a
            # portable placeholder.  Never send that literal namespace to
            # Snowflake; bind it to the configured metadata registry instead.
            if _looks_like_placeholder(candidate):
                resolved_database = self.resolved_metadata_database
                resolved_schema = self.resolved_metadata_schema
                if resolved_database and resolved_schema:
                    return (
                        f"{resolved_database}."
                        f"{resolved_schema}."
                        f"{resolved_object_name}"
                    )
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
    def resolved_semantic_views_table(self) -> str:
        """Fully-qualified SEM_TABLE_VIEWS path.

        Priority: explicit SNOWFLAKE_SEMANTIC_VIEWS_DATABASE/SCHEMA env vars,
        then fallback to the main metadata namespace.
        """
        table_name = self.snowflake_semantic_table_views_table or "SEM_TABLE_VIEWS"
        parts = _split_qualified_name(table_name)
        if parts:
            return f"{parts[0]}.{parts[1]}.{parts[2]}"
        db = (self.snowflake_semantic_views_database or "").strip()
        schema = (self.snowflake_semantic_views_schema or "").strip()
        if db and schema:
            return f"{db}.{schema}.{table_name}"
        return self.qualify_table_name(table_name)

    @property
    def resolved_semantic_column_views_table(self) -> str:
        """Fully-qualified SEM_COLUMN_VIEWS path.

        Uses the same database/schema override as resolved_semantic_views_table
        so both tables resolve consistently when stored in a separate registry.
        """
        table_name = self.snowflake_semantic_column_views_table or "SEM_COLUMN_VIEWS"
        parts = _split_qualified_name(table_name)
        if parts:
            return f"{parts[0]}.{parts[1]}.{parts[2]}"
        db = (self.snowflake_semantic_views_database or "").strip()
        schema = (self.snowflake_semantic_views_schema or "").strip()
        if db and schema:
            return f"{db}.{schema}.{table_name}"
        return self.qualify_table_name(table_name)

    @property
    def resolved_semantic_native_views_table(self) -> str:
        """Fully-qualified SEM_NATIVE_VIEWS or LATEST_NATIVE_VIEWS path."""
        table_name = self.snowflake_semantic_native_views_table or "SEM_NATIVE_VIEWS"
        parts = _split_qualified_name(table_name)
        if parts:
            return f"{parts[0]}.{parts[1]}.{parts[2]}"
        db = (self.snowflake_semantic_views_database or "").strip()
        schema = (self.snowflake_semantic_views_schema or "").strip()
        if db and schema:
            return f"{db}.{schema}.{table_name}"
        return self.qualify_table_name(table_name)

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
        if not self.snowflake_workbench_conversation_agent:
            return self.resolved_sttm_builder_agent
        return self._resolve_agent_name(
            self.snowflake_workbench_conversation_agent,
            legacy_object_name="WORKBENCH_CONVERSATION_AGENT",
            default_object_name="AGT_STTM_BUILDER",
        )

    @property
    def resolved_dbt_conversion_agent(self) -> str:
        return self._resolve_agent_name(
            self.snowflake_dbt_conversion_agent,
            legacy_object_name="DBT_CONVERSION_AGENT",
            default_object_name="AGT_DBT_CONVERSION",
        )

    @property
    def resolved_test_case_generation_agent(self) -> str:
        return self._resolve_agent_name(
            self.snowflake_test_case_generation_agent,
            legacy_object_name="TEST_CASE_GENERATION_AGENT",
            default_object_name="AGT_DBT_TEST_GENERATION",
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
    def qualified_oauth_sessions_table(self) -> str:
        return self.qualify_table_name(self.snowflake_oauth_sessions_table)

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
    def rest_snowflake_host(self) -> str:
        """Public Snowflake host for REST APIs authenticated with user OAuth tokens."""
        explicit_rest_host = (self.snowflake_rest_host or "").strip().replace("_", "-").lower()
        if explicit_rest_host:
            if explicit_rest_host.endswith(".snowflakecomputing.com"):
                return explicit_rest_host
            return f"{explicit_rest_host}.snowflakecomputing.com"
        account = (self.snowflake_account or "").strip().replace("_", "-").lower()
        if account:
            if account.endswith(".snowflakecomputing.com"):
                return account
            return f"{account}.snowflakecomputing.com"
        for raw_url in (self.snowflake_oauth_token_url, self.snowflake_oauth_authorize_url):
            host = (urlparse(raw_url.strip()).hostname or "").strip()
            if host:
                return host
        return self.resolved_snowflake_host

    @property
    def non_local_env(self) -> bool:
        return self.app_env.strip().lower() not in {"", "dev", "local", "test"}

    @property
    def debug_routes_enabled(self) -> bool:
        if self.guardrails_debug_routes_enabled:
            return True
        return not self.non_local_env

    @property
    def uses_custom_oauth(self) -> bool:
        return self.auth_mode.strip().lower() == "custom_oauth"

    @property
    def auto_mapping_service_enabled(self) -> bool:
        return bool(self.resolved_auto_mapping_service_url)

    @property
    def resolved_auto_mapping_service_url(self) -> str:
        explicit = self.auto_mapping_service_url.strip()
        if explicit:
            return explicit
        # Local V2 uses the private worker ASGI app in-process. Deployed SPCS
        # environments must still provide the explicit internal service URL.
        if not self.non_local_env and self.auto_map_pipeline_v2:
            return "inprocess"
        return ""

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
