#!/usr/bin/env python3
"""Run live workbench smoke tests against Snowflake-backed agents and semantic storage."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = REPO_ROOT / "services" / "sttm-builder"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.core.config import Settings
from app.core.conversation import ConversationService
from app.core.conversation_memory import ConversationMemoryService
from app.core.datahub import DataHubAdapter
from app.core.derived_source import DerivedSourceService
from app.core.semantic_context import SemanticContextService
from app.core.semantic_model import SemanticModelService
from app.core.snowflake import get_local_cached_client, get_local_rest_session_context
from app.core.snowflake_agent import SnowflakeAgentClient
from app.core.snowflake_analyst import SnowflakeAnalystClient
from app.core.sttm_builder import STTMBuilderService
from app.core.table_selection import TableSelectionService
from app.schema.common import TableRef
from app.schema.conversation import ConversationRequestEnvelope
from app.schema.semantic_context import SemanticContextRefreshRequest, SemanticLevel


def _parse_table_ref(value: str) -> TableRef:
    parts = [part.strip() for part in value.split(".")]
    if len(parts) != 3 or not all(parts):
        raise ValueError(f"Expected table in DATABASE.SCHEMA.TABLE format, got '{value}'.")
    return TableRef(database=parts[0], schema=parts[1], table=parts[2])


def _build_services(settings: Settings) -> dict[str, Any]:
    snowflake_client = get_local_cached_client(settings)
    rest_context = get_local_rest_session_context(settings)
    agent_client = SnowflakeAgentClient(
        token=rest_context.token,
        host=rest_context.host,
        auth_mode="snowflake_token",
        request_timeout=90.0,
    )
    analyst_client = SnowflakeAnalystClient(
        token=rest_context.token,
        host=rest_context.host,
        auth_mode="snowflake_token",
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
    sttm_builder_service = STTMBuilderService(
        agent_client,
        analyst_client=analyst_client,
        settings=settings,
        session=snowflake_client.session,
        semantic_model_service=semantic_model_service,
        semantic_context_service=semantic_context_service,
    )
    memory_service = ConversationMemoryService(snowflake_client.session, settings)
    conversation_service = ConversationService(
        agent_client,
        sttm_builder_service=sttm_builder_service,
        memory_service=memory_service,
        settings=settings,
    )
    return {
        "snowflake_client": snowflake_client,
        "agent_client": agent_client,
        "analyst_client": analyst_client,
        "semantic_model_service": semantic_model_service,
        "table_selection_service": table_selection_service,
        "semantic_context_service": semantic_context_service,
        "conversation_service": conversation_service,
        "memory_service": memory_service,
    }


def _artifact_preview(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "model_dump"):
        payload = value.model_dump(mode="json", exclude_none=True)
    else:
        payload = value
    if isinstance(payload, dict):
        preview = dict(payload)
        if isinstance(preview.get("source_ids"), list):
            preview["source_ids"] = preview["source_ids"][:5]
        if isinstance(preview.get("turn_ids"), list):
            preview["turn_ids"] = preview["turn_ids"][:5]
        return preview
    return payload


def _envelope_preview(envelope: Any) -> dict[str, Any]:
    if hasattr(envelope, "model_dump"):
        payload = envelope.model_dump(mode="json", exclude_none=True)
    elif isinstance(envelope, dict):
        payload = envelope
    else:
        return {"raw": str(envelope)}

    data = payload.get("data") or {}
    artifact = data.get("artifact")
    return {
        "operation": payload.get("operation"),
        "status": data.get("status"),
        "route": data.get("route"),
        "intent_class": data.get("intent_class"),
        "message": data.get("message"),
        "agent": data.get("agent"),
        "approval_required": data.get("approval_required"),
        "artifact": _artifact_preview(artifact),
        "warnings": payload.get("warnings") or [],
        "error": payload.get("error"),
        "meta": payload.get("meta") or {},
    }


def _error_preview(exc: Exception) -> dict[str, Any]:
    return {
        "error_type": exc.__class__.__name__,
        "message": str(exc),
    }


def _table_record_summary(record: dict[str, Any] | None) -> dict[str, Any]:
    if not record:
        return {"exists": False}
    semantic_model = record.get("semantic_model") if isinstance(record, dict) else {}
    if not isinstance(semantic_model, dict):
        semantic_model = {"value": semantic_model}
    attributes = semantic_model.get("attributes")
    sample_attributes = []
    if isinstance(attributes, list):
        for item in attributes[:3]:
            if not isinstance(item, dict):
                continue
            sample_attributes.append(
                {
                    "name": item.get("name"),
                    "summary": item.get("summary"),
                    "description": item.get("description"),
                }
            )
    return {
        "exists": True,
        "scope": record.get("scope"),
        "table": record.get("table_name"),
        "updated_at": record.get("updated_at"),
        "description": semantic_model.get("description"),
        "domain_summary": semantic_model.get("domain_summary"),
        "attribute_count": len(attributes) if isinstance(attributes, list) else None,
        "sample_attributes": sample_attributes,
        "semantic_view": semantic_model.get("semantic_view"),
    }


def run_conversation_checks(
    service: ConversationService,
    *,
    source_tables: list[TableRef],
    target_table: TableRef | None,
) -> dict[str, Any]:
    def execute(req: ConversationRequestEnvelope) -> dict[str, Any]:
        try:
            return _envelope_preview(service.invoke(req))
        except Exception as exc:  # pragma: no cover - live smoke diagnostic path
            return _error_preview(exc)

    quick_answer = ConversationRequestEnvelope.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "smoke-convo-quick",
            "operation": "conversation.ask",
            "context": {
                "trace_id": "smoke-convo-quick",
                "surface": "SOURCE_SELECTION",
                "source_tables": [item.model_dump(mode="json") for item in source_tables],
            },
            "data": {
                "message": "What can you help me with in this migration workbench?",
                "requested_sources": ["semantic"],
            },
        }
    )
    recommend = ConversationRequestEnvelope.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "smoke-convo-recommend",
            "operation": "conversation.recommend",
            "context": {
                "trace_id": "smoke-convo-recommend",
                "surface": "SOURCE_SELECTION",
                "source_tables": [item.model_dump(mode="json") for item in source_tables],
            },
            "data": {
                "message": (
                    "Recommend which source tables and relationships I should inspect first "
                    "for loan income mapping and explain why."
                ),
                "requested_sources": ["relationships", "semantic"],
            },
        }
    )
    mapping_handoff = ConversationRequestEnvelope.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "smoke-convo-handoff",
            "operation": "conversation.ask",
            "context": {
                "trace_id": "smoke-convo-handoff",
                "surface": "MAPPING",
                "semantic_level_requested": "L3_MAPPING_ENRICHED",
                "source_tables": [item.model_dump(mode="json") for item in source_tables],
                "target_table": target_table.model_dump(mode="json") if target_table else None,
            },
            "data": {
                "message": (
                    "Please help with STTM mapping for these loan income tables and call out "
                    "ambiguous source-to-target relationships."
                ),
                "requested_sources": ["relationships", "semantic"],
            },
        }
    )
    return {
        "quick_answer": execute(quick_answer),
        "recommendation": execute(recommend),
        "mapping_handoff": execute(mapping_handoff),
    }


def run_semantic_checks(
    *,
    semantic_model_service: SemanticModelService,
    semantic_context_service: SemanticContextService,
    table_selection_service: TableSelectionService,
    agent_client: SnowflakeAgentClient,
    session: Any,
    source_tables: list[TableRef],
    target_table: TableRef | None,
) -> dict[str, Any]:
    def record_error(bucket: dict[str, Any], key: str, exc: Exception) -> None:
        bucket[key] = _error_preview(exc)

    levels = [
        SemanticLevel.L1_CONTEXT,
        SemanticLevel.L2_ANALYST_READY,
        SemanticLevel.L3_MAPPING_ENRICHED,
    ]
    records_by_level: dict[str, Any] = {}
    primary_table = source_tables[0]
    semantic_tables = [primary_table]
    for level in levels:
        try:
            semantic_model_service.ensure_tables(
                session,
                agent_client,
                semantic_tables,
                force=True,
                semantic_level=level,
            )
            record = semantic_model_service.get_record(
                session=session,
                scope="TABLE",
                db_name=primary_table.database,
                schema_name=primary_table.schema,
                table_name=primary_table.table,
            )
            records_by_level[level.value] = _table_record_summary(record)
        except Exception as exc:  # pragma: no cover - live smoke diagnostic path
            record_error(records_by_level, level.value, exc)

    relationships = [
        item.model_dump(mode="json")
        for item in table_selection_service.list_relationships_for_tables(source_tables)
    ]
    try:
        refresh = semantic_context_service.refresh_bundle(
            SemanticContextRefreshRequest(
                selected_source_tables=source_tables,
                target_table=target_table,
                relationships=relationships,
                requested_level=SemanticLevel.L3_MAPPING_ENRICHED,
                force=True,
            ),
            agent_client=agent_client,
            allow_agent_refresh=True,
        )
        refresh_payload: dict[str, Any] = refresh.model_dump(mode="json", exclude_none=True)
    except Exception as exc:  # pragma: no cover - live smoke diagnostic path
        refresh_payload = _error_preview(exc)
    return {
        "table_records_by_level": records_by_level,
        "refresh_bundle": refresh_payload,
    }


def run_search_check(memory_service: ConversationMemoryService) -> dict[str, Any]:
    try:
        sync_result = memory_service.sync_all(rebuild_search_service=False)
        hits = memory_service.search(
            query="loan income relationship",
            limit=5,
            folders=["relationships", "semantic"],
        )
        return {
            "sync_result": sync_result,
            "hits": [item.model_dump(mode="json") for item in hits],
        }
    except Exception as exc:  # pragma: no cover - live smoke diagnostic path
        return _error_preview(exc)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-table",
        action="append",
        dest="source_tables",
        default=[
            "BBI_STTM_TEST_DB.DL_AMOUNT.NOTE",
            "BBI_STTM_TEST_DB.DL_AMOUNT.LOAN_INCOME_AMOUNT_CALCULATION",
        ],
        help="Fully qualified source table to include. Can be specified multiple times.",
    )
    parser.add_argument(
        "--target-table",
        default="BBI_STTM_TEST_DB.DL_AMOUNT.LOAN_INCOME_AMOUNT_CALCULATION",
        help="Fully qualified target table used for L3 semantic refresh and conversation handoff tests.",
    )
    args = parser.parse_args()

    settings = Settings(_env_file=str(APP_ROOT / ".env.local"), DATAHUB_ENABLED=False)
    services = _build_services(settings)
    source_tables = [_parse_table_ref(item) for item in args.source_tables]
    target_table = _parse_table_ref(args.target_table) if args.target_table else None

    semantic_checks = run_semantic_checks(
        semantic_model_service=services["semantic_model_service"],
        semantic_context_service=services["semantic_context_service"],
        table_selection_service=services["table_selection_service"],
        agent_client=services["agent_client"],
        session=services["snowflake_client"].session,
        source_tables=source_tables,
        target_table=target_table,
    )
    conversation_checks = run_conversation_checks(
        services["conversation_service"],
        source_tables=source_tables,
        target_table=target_table,
    )
    summary = {
        "agents": {
            "conversation": settings.resolved_workbench_conversation_agent,
            "semantic_model": settings.resolved_semantic_model_agent,
            "sttm_builder": settings.resolved_sttm_builder_agent,
        },
        "source_tables": [item.qualified_name for item in source_tables],
        "target_table": target_table.qualified_name if target_table else None,
        "semantic_checks": semantic_checks,
        "conversation_checks": conversation_checks,
        "search_check": run_search_check(services["memory_service"]),
    }
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
