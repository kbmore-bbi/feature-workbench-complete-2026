#!/usr/bin/env python3
"""Prewarm or reuse semantic context for a table selection before opening the UI."""

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
        "semantic_context_service": semantic_context_service,
        "table_selection_service": table_selection_service,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create or reuse semantic context for a selected source/target table set.",
    )
    parser.add_argument(
        "--source-table",
        action="append",
        dest="source_tables",
        required=True,
        help="Fully qualified source table DATABASE.SCHEMA.TABLE. Repeat for multiple tables.",
    )
    parser.add_argument(
        "--target-table",
        help="Fully qualified target table DATABASE.SCHEMA.TABLE.",
    )
    parser.add_argument(
        "--relationships-file",
        help="Optional path to a JSON file containing relationship objects to use instead of discovered relationships.",
    )
    parser.add_argument(
        "--requested-level",
        choices=[level.value for level in SemanticLevel],
        default=SemanticLevel.L3_MAPPING_ENRICHED.value,
        help="Semantic level to prepare. Default: L3_MAPPING_ENRICHED",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force a semantic refresh even if a reusable bundle already exists.",
    )
    parser.add_argument(
        "--no-agent-refresh",
        action="store_true",
        help="Skip AGT_SEMANTIC_MODEL refresh and only reuse existing/cached semantics.",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print a compact validation summary instead of the full composed semantic payload.",
    )
    args = parser.parse_args()

    settings = Settings(_env_file=str(APP_ROOT / ".env.local"), DATAHUB_ENABLED=False)
    services = _build_services(settings)
    source_tables = [_parse_table_ref(item) for item in args.source_tables]
    target_table = _parse_table_ref(args.target_table) if args.target_table else None

    table_selection_service: TableSelectionService = services["table_selection_service"]
    semantic_context_service: SemanticContextService = services["semantic_context_service"]
    agent_client: SnowflakeAgentClient = services["agent_client"]

    if args.relationships_file:
        relationships = json.loads(Path(args.relationships_file).read_text(encoding="utf-8"))
        if not isinstance(relationships, list):
            raise ValueError("--relationships-file must contain a JSON array of relationship objects.")
    else:
        relationships = [
            item.model_dump(mode="json")
            for item in table_selection_service.list_relationships_for_tables(source_tables)
        ]
    response = semantic_context_service.refresh_bundle(
        SemanticContextRefreshRequest(
            selected_source_tables=source_tables,
            target_table=target_table,
            relationships=relationships,
            requested_level=SemanticLevel(args.requested_level),
            force=args.force,
        ),
        agent_client=agent_client,
        allow_agent_refresh=not args.no_agent_refresh,
    )

    payload = response.model_dump(mode="json", exclude_none=True)
    if args.summary_only:
        summary = payload.get("summary") or {}
        semantic_context = payload.get("semantic_context") or []
        semantic_model_yaml = payload.get("semantic_model_yaml") or summary.get("semantic_model_yaml")
        analyst_model = yaml.safe_load(semantic_model_yaml) if isinstance(semantic_model_yaml, str) else {}
        tables = analyst_model.get("tables") if isinstance(analyst_model, dict) else None
        relationships_out = analyst_model.get("relationships") if isinstance(analyst_model, dict) else None
        print(
            json.dumps(
                {
                    "success": payload.get("success"),
                    "bundle_id": payload.get("bundle_id"),
                    "bundle_hash": payload.get("bundle_hash"),
                    "composed_model_hash": summary.get("composed_model_hash"),
                    "asset_versions": summary.get("asset_versions"),
                    "semantic_context_count": len(semantic_context) if isinstance(semantic_context, list) else None,
                    "analyst_table_count": len(tables) if isinstance(tables, list) else None,
                    "analyst_relationship_count": len(relationships_out) if isinstance(relationships_out, list) else None,
                    "notes": payload.get("notes") or [],
                    "warnings": payload.get("warnings") or [],
                },
                indent=2,
                default=str,
            )
        )
    else:
        print(json.dumps(payload, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
