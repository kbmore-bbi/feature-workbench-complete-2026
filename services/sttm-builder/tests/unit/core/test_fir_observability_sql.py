from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[5]
FIR_ROOT = REPO_ROOT / "infra" / "snowflake" / "fir_system"


def _read(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8").upper()


def test_run_observability_schema_covers_cost_scope_and_quality_metrics() -> None:
    ddl = _read("infra/snowflake/fir_system/tables/fir_v2_schema.sql")

    required_columns = {
        "TRIGGER_REASON",
        "ASSET_COUNT",
        "TARGET_ROW_COUNT",
        "DUPLICATE_WORK_SKIPPED",
        "PATTERNS_EXTRACTED",
        "PATTERNS_ENRICHED",
        "PATTERNS_REJECTED",
        "PATTERNS_PROMOTED",
        "AGENT_REQUEST_COUNT",
        "INPUT_TOKENS",
        "OUTPUT_TOKENS",
        "TOOL_CALL_COUNT",
        "DURATION_MS",
        "RETRY_COUNT",
        "CIRCUIT_BREAKER_STATUS",
        "ESTIMATED_COST",
        "QUERY_TAG",
        "RESULT_VALIDATION_STATUS",
    }

    assert "TBL_FIR_RUN_OBSERVABILITY" in ddl
    assert required_columns.issubset(set(ddl.split()))
    assert "VW_FIR_RUN_OPERATIONS" in ddl


def test_operational_alert_view_covers_required_failure_modes() -> None:
    ddl = _read("infra/snowflake/fir_system/tables/fir_v2_schema.sql")

    for alert_type in (
        "IDLE_AGENT_CALL",
        "DUPLICATE_ASSET_PROCESSING",
        "DAILY_BUDGET_THRESHOLD",
        "STUCK_WORK",
        "REPEATED_TIMEOUT",
    ):
        assert f"'{alert_type}'" in ddl

    assert "0.8 *" in ddl
    assert "DATEADD('HOUR', -24" in ddl


def test_agent_and_promotion_stages_emit_run_telemetry() -> None:
    agent = _read(
        "infra/snowflake/fir_system/procedures/sp-fir-invoke-agent.sql"
    )
    queue = _read(
        "infra/snowflake/fir_system/procedures/"
        "sp-fir-process-learning-queue.sql"
    )
    grants = _read("infra/snowflake/fir_system/grants/fir_grants.sql")

    assert "MERGE INTO {NAMESPACE}.TBL_FIR_RUN_OBSERVABILITY" in agent
    assert "ALTER SESSION SET QUERY_TAG" in agent
    assert "INPUT_TOKENS" in agent and "OUTPUT_TOKENS" in agent
    assert "PATTERNS_PROMOTED" in queue
    assert "RESULT_VALIDATION_STATUS = 'PROMOTED'" in queue
    assert "TBL_FIR_RUN_OBSERVABILITY" in grants
    assert "VW_FIR_RUN_OPERATIONS" in grants
    assert "VW_FIR_OPERATIONAL_ALERTS" in grants


def test_semantic_change_streams_use_raw_metadata_registry_tables() -> None:
    streams = _read("infra/snowflake/fir_system/streams/fir_streams.sql")

    assert "__SEMANTIC_REGISTRY_NAMESPACE__" not in streams
    assert (
        "ON TABLE __STTM_METADATA_NAMESPACE__.SEM_TABLE_VIEWS"
        in streams
    )
    assert (
        "ON TABLE __STTM_METADATA_NAMESPACE__.SEM_COLUMN_VIEWS"
        in streams
    )
