#!/usr/bin/env python3
"""Run one timed workbench query at a time for search or conversation flows."""

from __future__ import annotations

import argparse
import json
import sys
import time
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


def _parse_table_ref(value: str) -> TableRef:
    parts = [part.strip() for part in value.split(".")]
    if len(parts) != 3 or not all(parts):
        raise ValueError(f"Expected DATABASE.SCHEMA.TABLE, got '{value}'.")
    return TableRef(database=parts[0], schema=parts[1], table=parts[2])


def _settings() -> Settings:
    return Settings(_env_file=str(APP_ROOT / ".env.local"), DATAHUB_ENABLED=False)


def _services(settings: Settings) -> dict[str, Any]:
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
        "agent_client": agent_client,
        "memory_service": memory_service,
        "conversation_service": conversation_service,
    }


def _agent_payload(query: str) -> str:
    payload = {
        "contract_version": "1.0",
        "request_id": "timed-direct-agent",
        "operation": "conversation.ask",
        "context": {
            "trace_id": "timed-direct-agent",
            "surface": "SOURCE_SELECTION",
            "semantic_level_requested": "L1_CONTEXT",
        },
        "data": {
            "execution_mode": "response_generation",
            "intent_class": "rag_lookup",
            "message": query,
            "requested_sources": ["relationships", "semantic", "recommendations", "feedback", "conversations"],
            "evidence": [],
        },
        "meta": {
            "guardrails": {
                "allowed_routes": ["conversation", "sttm_builder"],
                "route_plan": {
                    "route": "conversation",
                    "intent_class": "rag_lookup",
                    "reason": "timed_direct_test",
                    "confidence": 1.0,
                    "suggested_operation": None,
                },
            }
        },
    }
    return json.dumps(payload, separators=(",", ":"))


def run_search(query: str, settings: Settings) -> dict[str, Any]:
    services = _services(settings)
    memory_service: ConversationMemoryService = services["memory_service"]
    started = time.perf_counter()
    hits = memory_service.search(query=query, limit=5, folders=["relationships", "semantic"])
    elapsed = time.perf_counter() - started
    return {
        "mode": "search",
        "query": query,
        "elapsed_seconds": round(elapsed, 3),
        "hit_count": len(hits),
        "hits": [item.model_dump(mode="json") for item in hits],
    }


def run_conversation_agent(query: str, settings: Settings) -> dict[str, Any]:
    services = _services(settings)
    agent_client: SnowflakeAgentClient = services["agent_client"]
    started = time.perf_counter()
    raw_text, thread_id, raw_payload = agent_client.run_detailed(
        [{"role": "user", "content": [{"type": "text", "text": _agent_payload(query)}]}],
        agent=settings.resolved_workbench_conversation_agent,
    )
    elapsed = time.perf_counter() - started
    return {
        "mode": "conversation_agent",
        "query": query,
        "elapsed_seconds": round(elapsed, 3),
        "thread_id": thread_id,
        "raw_text": raw_text,
        "raw_payload": raw_payload,
    }


def run_conversation_service(query: str, settings: Settings, source_tables: list[TableRef]) -> dict[str, Any]:
    services = _services(settings)
    conversation_service: ConversationService = services["conversation_service"]
    req = ConversationRequestEnvelope.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "timed-service-agent",
            "operation": "conversation.ask",
            "context": {
                "trace_id": "timed-service-agent",
                "surface": "SOURCE_SELECTION",
                "source_tables": [item.model_dump(mode="json") for item in source_tables],
            },
            "data": {
                "message": query,
                "requested_sources": ["relationships", "semantic"],
            },
        }
    )
    started = time.perf_counter()
    response = conversation_service.invoke(req)
    elapsed = time.perf_counter() - started
    payload = response.model_dump(mode="json", exclude_none=True) if hasattr(response, "model_dump") else response
    return {
        "mode": "conversation_service",
        "query": query,
        "elapsed_seconds": round(elapsed, 3),
        "response": payload,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["search", "conversation_agent", "conversation_service"], required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument(
        "--source-table",
        action="append",
        dest="source_tables",
        default=[
            "BBI_STTM_TEST_DB.DL_AMOUNT.NOTE",
            "BBI_STTM_TEST_DB.DL_AMOUNT.LOAN_INCOME_AMOUNT_CALCULATION",
        ],
    )
    args = parser.parse_args()

    settings = _settings()
    source_tables = [_parse_table_ref(item) for item in args.source_tables]

    if args.mode == "search":
        result = run_search(args.query, settings)
    elif args.mode == "conversation_agent":
        result = run_conversation_agent(args.query, settings)
    else:
        result = run_conversation_service(args.query, settings, source_tables)

    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
