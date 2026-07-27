#!/usr/bin/env python3
"""Generate and verify canonical workbench semantic assets."""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = REPO_ROOT / "services" / "sttm-builder"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.core.config import Settings
from app.core.snowflake import get_local_cached_connector, get_local_rest_session_context
from app.core.snowflake_agent import SnowflakeAgentClient
from semantic_registry_native import publish_native_view


TEST_TABLES = (
    ("BBI_STTM_TEST_DB", "DL_AMOUNT", "LOAN_INCOME_AMOUNT_CALCULATION"),
    ("BBI_STTM_TEST_DB", "DL_AMOUNT", "NOTE"),
    ("BBI_STTM_TEST_DB", "DW_OPS", "PORTAL_USER_HISTORY"),
    ("BBI_STTM_TEST_DB", "DW_OPS", "LOAN_INCOME_AMOUNT_CALCULATION"),
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", default=str(APP_ROOT / ".env.local"))
    parser.add_argument("--agent", default="FOCUS_DB_2.STTM_MCP.AGT_SEMANTIC_MODEL_V2")
    parser.add_argument(
        "--registry",
        default=None,
        help=(
            "Semantic registry DATABASE.SCHEMA. Defaults to "
            "SNOWFLAKE_SEMANTIC_VIEWS_DATABASE/SCHEMA from the env file."
        ),
    )
    parser.add_argument(
        "--refresh-phase2",
        action="store_true",
        help="Refresh schema column-search metadata before semantic generation.",
    )
    parser.add_argument(
        "--table",
        action="append",
        help=(
            "Limit the run to an exact TABLE name or DATABASE.SCHEMA.TABLE FQN. "
            "May be specified more than once."
        ),
    )
    args = parser.parse_args()

    base_settings = Settings(_env_file=args.env_file)
    registry = args.registry or (
        f"{base_settings.snowflake_semantic_views_database}."
        f"{base_settings.snowflake_semantic_views_schema}"
    )
    if registry.strip(".") == "" or registry.count(".") != 1:
        raise SystemExit(
            "Set SNOWFLAKE_SEMANTIC_VIEWS_DATABASE and "
            "SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA, or pass --registry DATABASE.SCHEMA."
        )
    normalized_host = (
        base_settings.snowflake_host.strip()
        or f"{base_settings.snowflake_account.lower().replace('_', '-')}.snowflakecomputing.com"
    ).replace("_", "-")
    settings = Settings(_env_file=args.env_file, SNOWFLAKE_HOST=normalized_host)
    rest = get_local_rest_session_context(settings)
    agent = SnowflakeAgentClient(
        token=rest.token,
        host=rest.host,
        auth_mode="snowflake_token",
        request_timeout=900.0,
    )
    connection = get_local_cached_connector(settings)
    results: list[dict[str, object]] = []

    requested_tables = [str(value).strip().upper() for value in (args.table or []) if value]
    if requested_tables:
        selected: list[tuple[str, str, str]] = []
        for requested in requested_tables:
            parts = requested.split(".")
            if len(parts) == 3:
                selected.append((parts[0], parts[1], parts[2]))
                continue
            matches = [item for item in TEST_TABLES if item[2].upper() == requested]
            if len(matches) != 1:
                raise SystemExit(
                    f"Expected an unambiguous TABLE name or DATABASE.SCHEMA.TABLE, got {requested!r}."
                )
            selected.append(matches[0])
        selected_tables = tuple(dict.fromkeys(selected))
    else:
        selected_tables = TEST_TABLES
    if args.refresh_phase2:
        for database, schema in sorted({(item[0], item[1]) for item in selected_tables}):
            with connection.cursor() as cursor:
                cursor.execute(
                    "CALL FOCUS_DB_2.STTM_MCP.REFRESH_COLUMN_SEARCH_INDEX(%s, %s, NULL)",
                    (database, schema),
                )
                refresh_row = cursor.fetchone()
            print(
                json.dumps(
                    {
                        "event": "phase2_refreshed",
                        "database": database,
                        "schema": schema,
                        "result": refresh_row[0] if refresh_row else None,
                    },
                    default=str,
                    separators=(",", ":"),
                ),
                flush=True,
            )
    for database, schema, table in selected_tables:
        request_id = str(uuid.uuid4())
        instruction = {
            "scope": "TABLE",
            "database": database,
            "schema": schema,
            "table": table,
            "force": True,
            "publication": {
                "producer_agent": "AGT_SEMANTIC_MODEL_V2",
                "request_id": request_id,
                "change_reason": "Canonical workbench test semantic asset publication",
            },
        }
        prompt = (
            "Generate the complete TABLE-scope semantic asset for this exact table and "
            "publish it through SAVE_SEMANTIC_VIEW. Return only the required JSON response.\n"
            + json.dumps(instruction, separators=(",", ":"))
        )
        text, thread_id, _ = agent.run_detailed(
            [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
            agent=args.agent,
            request_timeout=900.0,
        )
        try:
            agent_result = json.loads(text)
        except json.JSONDecodeError as exc:
            stripped = text.strip()
            if stripped.startswith("```") and stripped.endswith("```"):
                stripped = stripped.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
                agent_result = json.loads(stripped)
            else:
                preview = " ".join(text.split())[:900]
                raise RuntimeError(
                    f"AGT_SEMANTIC_MODEL_V2 returned non-JSON for {database}.{schema}.{table} "
                    f"(thread_id={thread_id}, chars={len(text)}, preview={preview!r})"
                ) from exc
        if not isinstance(agent_result, dict):
            raise RuntimeError(
                f"AGT_SEMANTIC_MODEL_V2 returned a non-object for {database}.{schema}.{table}"
            )
        save_metadata = agent_result.get("save_metadata")
        print(
            json.dumps(
                {
                    "event": "agent_completed",
                    "fqn": f"{database}.{schema}.{table}",
                    "thread_id": thread_id,
                    "scope": agent_result.get("scope"),
                    "keys": sorted(agent_result),
                    "columns": len(
                        agent_result.get("attributes")
                        or agent_result.get("attribute_semantic_model")
                        or []
                    ),
                    "save_metadata": save_metadata,
                    "error": agent_result.get("error"),
                },
                separators=(",", ":"),
            ),
            flush=True,
        )
        if not isinstance(save_metadata, dict) or str(save_metadata.get("status") or "").upper() not in {
            "OK",
            "SAVED",
            "SUCCESS",
            "CACHED",
        }:
            response_preview = json.dumps(agent_result, separators=(",", ":"))[:1800]
            raise RuntimeError(
                f"AGT_SEMANTIC_MODEL_V2 did not acknowledge registry publication for "
                f"{database}.{schema}.{table} (thread_id={thread_id}, "
                f"save_metadata={save_metadata!r}, response={response_preview})"
            )
        native = publish_native_view(
            connection,
            registry=registry,
            database=database,
            schema=schema,
            table=table,
        )
        publication = native["publication"]
        results.append(
            {
                "fqn": f"{database}.{schema}.{table}",
                "thread_id": thread_id,
                "view_id": native["view_id"],
                "version": native["version"],
                "native_view_id": publication.get("native_view_id"),
                "physical_view_name": publication.get("target_fqn"),
                "relationship_aliases_normalized": native["normalized"],
                "agent_response_chars": len(text),
            }
        )

    print(json.dumps({"status": "OK", "assets": results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
