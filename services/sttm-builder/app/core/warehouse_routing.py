"""Workload-aware Snowflake warehouse and query-context routing.

The resolver is intentionally deterministic and side-effect free.  Callers
select a workload before acquiring a session; a pooled session is therefore
never mutated with ``USE WAREHOUSE`` and cannot leak warehouse state between
requests.
"""

from __future__ import annotations

import json
from enum import Enum
from typing import Any

from app.core.config import Settings


class WarehouseWorkload(str, Enum):
    CONTROL = "control"
    AGENT = "agent"
    EXECUTION = "execution"
    AUTOMAP = "automap"
    PREPARATION = "preparation"


def resolve_warehouse(settings: Settings, workload: WarehouseWorkload) -> str:
    control = (
        settings.snowflake_control_warehouse.strip()
        or settings.snowflake_warehouse.strip()
    )
    agent = settings.snowflake_agent_warehouse.strip() or control
    execution = settings.snowflake_execution_warehouse.strip() or control
    automap = settings.auto_mapping_warehouse.strip() or agent
    preparation = (
        settings.snowflake_preparation_warehouse.strip()
        if settings.preparation_warehouse_routing_v1
        else ""
    ) or control
    return {
        WarehouseWorkload.CONTROL: control,
        WarehouseWorkload.AGENT: agent,
        WarehouseWorkload.EXECUTION: execution,
        WarehouseWorkload.AUTOMAP: automap,
        WarehouseWorkload.PREPARATION: preparation,
    }[workload]


def statement_timeout_seconds(
    settings: Settings,
    workload: WarehouseWorkload,
) -> int:
    return max(
        1,
        {
            WarehouseWorkload.CONTROL: settings.snowflake_control_statement_timeout_seconds,
            WarehouseWorkload.AGENT: settings.snowflake_agent_statement_timeout_seconds,
            WarehouseWorkload.EXECUTION: settings.snowflake_execution_statement_timeout_seconds,
            WarehouseWorkload.AUTOMAP: settings.snowflake_automap_statement_timeout_seconds,
            WarehouseWorkload.PREPARATION: settings.snowflake_preparation_statement_timeout_seconds,
        }[workload],
    )


def query_tag(
    settings: Settings,
    workload: WarehouseWorkload,
    *,
    service: str | None = None,
    endpoint: str | None = None,
    project_id: str | None = None,
    mapping_id: str | None = None,
    job_id: str | None = None,
    trace_id: str | None = None,
) -> str:
    """Return a compact JSON query tag suitable for connection parameters.

    Per-request fields are optional because pooled connections carry only a
    stable base tag.  Services may supply a richer tag on a request-scoped
    connection, but must never mutate a shared session to do so.
    """

    payload: dict[str, Any] = {
        "app": settings.app_name,
        "service": service or "sttm-builder",
        "workload": workload.value,
    }
    optional = {
        "endpoint": endpoint,
        "project": project_id,
        "mapping": mapping_id,
        "job": job_id,
        "trace": trace_id,
    }
    payload.update({key: value for key, value in optional.items() if value})
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)[:2000]


def routed_settings(
    settings: Settings,
    workload: WarehouseWorkload,
) -> Settings:
    """Clone settings with the resolved warehouse for legacy consumers."""

    return settings.model_copy(
        update={"snowflake_warehouse": resolve_warehouse(settings, workload)}
    )


def connection_session_parameters(
    settings: Settings,
    workload: WarehouseWorkload,
    *,
    service: str | None = None,
) -> dict[str, Any]:
    return {
        "QUERY_TAG": query_tag(settings, workload, service=service),
        "STATEMENT_TIMEOUT_IN_SECONDS": statement_timeout_seconds(settings, workload),
    }
