#!/usr/bin/env python3
"""Precompute semantic table records and bundle views for client deployments."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = REPO_ROOT / "services" / "sttm-builder"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.core.config import Settings
from app.core.datahub import DataHubAdapter
from app.core.derived_source import DerivedSourceService
from app.core.semantic_context import SemanticContextService
from app.core.semantic_model import SemanticModelService
from app.core.snowflake import get_local_cached_client, get_local_rest_session_context
from app.core.snowflake_agent import SnowflakeAgentClient
from app.core.table_selection import TableSelectionService
from app.schema.common import TableRef
from app.schema.semantic_context import SemanticContextRefreshRequest, SemanticLevel


def _parse_table_ref(value: str) -> TableRef:
    parts = [part.strip() for part in value.split(".")]
    if len(parts) != 3 or not all(parts):
        raise ValueError(f"Expected DATABASE.SCHEMA.TABLE, got '{value}'.")
    return TableRef(database=parts[0], schema=parts[1], table=parts[2])


def _parse_schema_ref(value: str) -> tuple[str, str]:
    parts = [part.strip() for part in value.split(".")]
    if len(parts) != 2 or not all(parts):
        raise ValueError(f"Expected DATABASE.SCHEMA, got '{value}'.")
    return parts[0], parts[1]


def _build_services(settings: Settings) -> dict[str, Any]:
    snowflake_client = get_local_cached_client(settings)
    rest_context = get_local_rest_session_context(settings)
    agent_client = SnowflakeAgentClient(
        token=rest_context.token,
        host=rest_context.host,
        auth_mode="snowflake_token",
        request_timeout=120.0,
    )
    semantic_model_service = SemanticModelService(settings)
    table_selection_service = TableSelectionService(snowflake_client, settings)
    derived_source_service = DerivedSourceService(snowflake_client.session, settings)
    semantic_context_service = SemanticContextService(
        session=snowflake_client.session,
        settings=settings,
        semantic_model_service=semantic_model_service,
        table_selection_service=table_selection_service,
        derived_source_service=derived_source_service,
        datahub_adapter=DataHubAdapter(settings),
    )
    return {
        "snowflake_client": snowflake_client,
        "agent_client": agent_client,
        "semantic_model_service": semantic_model_service,
        "semantic_context_service": semantic_context_service,
        "table_selection_service": table_selection_service,
    }


def _load_config(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError("Bootstrap config must be a YAML object.")
    return data


def _expand_table_groups(
    *,
    groups: list[dict[str, Any]],
    table_selection_service: TableSelectionService,
) -> list[TableRef]:
    tables: list[TableRef] = []
    seen: set[str] = set()
    for group in groups:
        for raw_table in group.get("tables", []) or []:
            ref = _parse_table_ref(str(raw_table))
            key = ref.qualified_name.upper()
            if key not in seen:
                seen.add(key)
                tables.append(ref)
        for raw_schema in group.get("schemas", []) or []:
            db_name, schema_name = _parse_schema_ref(str(raw_schema))
            for item in table_selection_service.list_tables(db_name, schema_name):
                ref = TableRef(database=db_name, schema=schema_name, table=item.table_name)
                key = ref.qualified_name.upper()
                if key not in seen:
                    seen.add(key)
                    tables.append(ref)
    return tables


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Warm semantic records and bundle views for a client deployment.",
    )
    parser.add_argument(
        "--config-file",
        default="infra/snowflake/bootstrap/client_semantic_bootstrap.example.yaml",
        help="YAML config describing the tables, schemas, and bundles to warm.",
    )
    parser.add_argument(
        "--sync-search",
        action="store_true",
        help="Rebuild the workbench RAG projection and ensure the Cortex Search service after loading knowledge.",
    )
    args = parser.parse_args()

    settings = Settings(_env_file=str(APP_ROOT / ".env.local"), DATAHUB_ENABLED=False)
    services = _build_services(settings)
    config = _load_config(Path(args.config_file))
    defaults = config.get("defaults", {}) or {}

    table_level = SemanticLevel(
        str(defaults.get("table_semantic_level", SemanticLevel.L2_ANALYST_READY.value))
    )
    bundle_level_default = SemanticLevel(
        str(defaults.get("bundle_semantic_level", SemanticLevel.L3_MAPPING_ENRICHED.value))
    )
    allow_agent_refresh_for_bundles = bool(defaults.get("allow_agent_refresh_for_bundles", False))
    force = bool(defaults.get("force", False))

    semantic_model_service: SemanticModelService = services["semantic_model_service"]
    semantic_context_service: SemanticContextService = services["semantic_context_service"]
    table_selection_service: TableSelectionService = services["table_selection_service"]
    agent_client: SnowflakeAgentClient = services["agent_client"]
    snowflake_client = services["snowflake_client"]

    table_groups = config.get("table_groups", []) or []
    if not isinstance(table_groups, list):
        raise ValueError("table_groups must be a list.")
    tables = _expand_table_groups(groups=table_groups, table_selection_service=table_selection_service)

    table_result = semantic_model_service.ensure_tables(
        session=snowflake_client.session,
        agent_client=agent_client,
        tables=tables,
        force=force,
        semantic_level=table_level,
    )

    bundle_results: list[dict[str, Any]] = []
    bundles = config.get("bundles", []) or []
    if not isinstance(bundles, list):
        raise ValueError("bundles must be a list.")
    for bundle in bundles:
        source_tables = [_parse_table_ref(str(item)) for item in (bundle.get("source_tables", []) or [])]
        target_table = _parse_table_ref(str(bundle["target_table"])) if bundle.get("target_table") else None
        requested_level = SemanticLevel(
            str(bundle.get("requested_level", bundle_level_default.value))
        )
        relationships = [
            item.model_dump(mode="json")
            for item in table_selection_service.list_relationships_for_tables(source_tables)
        ]
        response = semantic_context_service.refresh_bundle(
            SemanticContextRefreshRequest(
                selected_source_tables=source_tables,
                target_table=target_table,
                relationships=relationships,
                requested_level=requested_level,
                force=force,
            ),
            agent_client=agent_client,
            allow_agent_refresh=bool(
                bundle.get("allow_agent_refresh", allow_agent_refresh_for_bundles)
            ),
        )
        bundle_results.append(
            {
                "name": bundle.get("name"),
                "bundle_id": response.bundle_id,
                "semantic_view_name": response.semantic_view_name,
                "status": response.status.value,
                "achieved_level": response.achieved_level.value,
                "notes": response.summary.notes,
            }
        )

    output = {
        "table_result": table_result,
        "warmed_tables": [table.qualified_name for table in tables],
        "bundle_results": bundle_results,
    }
    print(json.dumps(output, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
