from app.core.config import Settings
from app.core.warehouse_routing import (
    WarehouseWorkload,
    connection_session_parameters,
    query_tag,
    resolve_warehouse,
)


def test_workload_warehouse_fallback_chain() -> None:
    settings = Settings(
        _env_file=None,
        snowflake_warehouse="DEFAULT_XS",
        snowflake_control_warehouse="CONTROL_XS",
        snowflake_agent_warehouse="",
        snowflake_execution_warehouse="",
        auto_mapping_warehouse="",
    )

    assert resolve_warehouse(settings, WarehouseWorkload.CONTROL) == "CONTROL_XS"
    assert resolve_warehouse(settings, WarehouseWorkload.AGENT) == "CONTROL_XS"
    assert resolve_warehouse(settings, WarehouseWorkload.EXECUTION) == "CONTROL_XS"
    assert resolve_warehouse(settings, WarehouseWorkload.AUTOMAP) == "CONTROL_XS"


def test_every_workload_can_route_to_one_xsmall_from_environment() -> None:
    settings = Settings(
        _env_file=None,
        snowflake_warehouse="SHARED_XS",
        snowflake_control_warehouse="SHARED_XS",
        snowflake_agent_warehouse="SHARED_XS",
        snowflake_execution_warehouse="SHARED_XS",
        auto_mapping_warehouse="SHARED_XS",
    )

    assert {
        resolve_warehouse(settings, workload)
        for workload in WarehouseWorkload
    } == {"SHARED_XS"}


def test_query_context_contains_workload_and_timeout_without_warehouse_name() -> None:
    settings = Settings(
        _env_file=None,
        app_name="Workbench",
        snowflake_control_statement_timeout_seconds=17,
    )

    parameters = connection_session_parameters(
        settings,
        WarehouseWorkload.CONTROL,
        service="metadata",
    )

    assert parameters["STATEMENT_TIMEOUT_IN_SECONDS"] == 17
    assert '"workload":"control"' in parameters["QUERY_TAG"]
    assert '"service":"metadata"' in parameters["QUERY_TAG"]
    assert "warehouse" not in parameters["QUERY_TAG"].lower()


def test_rich_query_tag_includes_traceable_workload_dimensions() -> None:
    settings = Settings(_env_file=None, app_name="Workbench")

    tag = query_tag(
        settings,
        WarehouseWorkload.AUTOMAP,
        endpoint="/auto-map",
        project_id="903",
        mapping_id="1101",
        job_id="job-1",
        trace_id="trace-1",
    )

    for expected in (
        '"workload":"automap"',
        '"project":"903"',
        '"mapping":"1101"',
        '"job":"job-1"',
        '"trace":"trace-1"',
    ):
        assert expected in tag
