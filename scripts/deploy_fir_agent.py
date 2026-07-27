#!/usr/bin/env python3
"""Deploy AGT_FIR_SYSTEM Cortex Agent and its supporting procedures to Snowflake.

Reads credentials from services/sttm-builder/.env.local.
Deploys: SP_FIR_READ_DOCUMENTS, SP_FIR_READ_PENDING_RECORDS, SP_FIR_STORE_INFERENCE,
         SP_FIR_STORE_RECOMMENDATION, SP_FIR_INVOKE_AGENT, and AGT_FIR_SYSTEM.
"""
from __future__ import annotations

import argparse
import sys
from io import StringIO
from pathlib import Path

import snowflake.connector


SOURCE_NAMESPACE = "FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA"
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def load_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def render_sql(raw_sql: str, namespace: str, warehouse: str) -> str:
    return (
        raw_sql
        .replace("__STTM_METADATA_NAMESPACE__", namespace)
        .replace("__WAREHOUSE_NAME__", warehouse)
        .replace(SOURCE_NAMESPACE, namespace)
    )


def render_agent_statement(agent_name: str, spec_text: str, namespace: str) -> str:
    qualified_name = f"{namespace}.{agent_name}"
    profile = f'{{"display_name":"{agent_name}"}}'
    return (
        f"CREATE OR REPLACE AGENT {qualified_name}\n"
        f"    PROFILE = '{profile}'\n"
        "    FROM SPECIFICATION\n"
        "    $$\n"
        f"{spec_text.rstrip()}\n"
        "    $$"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Deploy AGT_FIR_SYSTEM agent and supporting procedures."
    )
    parser.add_argument(
        "--env-file",
        default="services/sttm-builder/.env.local",
        help="Path to env file with Snowflake credentials.",
    )
    parser.add_argument(
        "--spec-file",
        default="infra/snowflake/agents/agent_spec_fir_system.yaml",
        help="Path to the FIR system agent spec YAML.",
    )
    parser.add_argument(
        "--skip-procedures",
        action="store_true",
        help="Skip procedure deployment (only deploy agent).",
    )
    parser.add_argument(
        "--skip-agent",
        action="store_true",
        help="Skip agent creation (only deploy procedures).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print SQL statements instead of executing.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    env_path = PROJECT_ROOT / args.env_file
    spec_path = PROJECT_ROOT / args.spec_file

    if not env_path.exists():
        print(f"ERROR: env file not found: {env_path}", file=sys.stderr)
        sys.exit(1)
    if not spec_path.exists():
        print(f"ERROR: spec file not found: {spec_path}", file=sys.stderr)
        sys.exit(1)

    env = load_env_file(env_path)
    namespace = f"{env['SNOWFLAKE_DATABASE']}.{env['SNOWFLAKE_SCHEMA']}"
    warehouse = env["SNOWFLAKE_WAREHOUSE"]

    print(f"Namespace: {namespace}")
    print(f"Warehouse: {warehouse}")
    print()

    statements: list[tuple[str, str]] = []

    # 1. Deploy supporting procedures
    if not args.skip_procedures:
        proc_files = [
            ("SP_FIR_READ_DOCUMENTS", "infra/snowflake/fir_system/procedures/sp-fir-read-documents.sql"),
            ("SP_FIR_READ_PENDING_RECORDS", "infra/snowflake/fir_system/procedures/sp-fir-read-pending-records.sql"),
            ("SP_FIR_STORE_INFERENCE", "infra/snowflake/fir_system/procedures/sp-fir-store-inference.sql"),
            ("SP_FIR_STORE_RECOMMENDATION", "infra/snowflake/fir_system/procedures/sp-fir-store-recommendation.sql"),
            ("SP_FIR_INVOKE_AGENT", "infra/snowflake/fir_system/procedures/sp-fir-invoke-agent.sql"),
            ("SP_FIR_PRECOMPUTE_PERMUTATIONS", "infra/snowflake/fir_system/procedures/sp-fir-precompute-permutations.sql"),
        ]
        for label, rel_path in proc_files:
            sql_path = PROJECT_ROOT / rel_path
            if not sql_path.exists():
                print(f"WARNING: {sql_path} not found, skipping", file=sys.stderr)
                continue
            raw_sql = sql_path.read_text()
            rendered = render_sql(raw_sql, namespace, warehouse)
            statements.append((label, rendered))

    # 2. Deploy agent
    if not args.skip_agent:
        spec_text = render_sql(spec_path.read_text(), namespace, warehouse)
        agent_stmt = render_agent_statement("AGT_FIR_SYSTEM", spec_text, namespace)
        statements.append(("AGT_FIR_SYSTEM", agent_stmt))

    if args.dry_run:
        for label, sql in statements:
            print(f"-- ═══ {label} ═══")
            print(sql)
            print(";")
            print()
        return

    # Connect and execute
    connect_kwargs: dict[str, str] = {
        "account": env["SNOWFLAKE_ACCOUNT"],
        "user": env["SNOWFLAKE_USER"],
        "role": env["SNOWFLAKE_ROLE"],
        "warehouse": warehouse,
        "database": env["SNOWFLAKE_DATABASE"],
        "schema": env["SNOWFLAKE_SCHEMA"],
    }
    host = env.get("SNOWFLAKE_HOST", "").strip()
    if host:
        connect_kwargs["host"] = host
    authenticator = env.get("SNOWFLAKE_AUTHENTICATOR", "").strip().lower()
    if authenticator == "externalbrowser":
        connect_kwargs["authenticator"] = "externalbrowser"
    else:
        connect_kwargs["password"] = env["SNOWFLAKE_PASSWORD"]

    connection = snowflake.connector.connect(**connect_kwargs)
    try:
        for label, sql in statements:
            print(f"→ Deploying {label}...")
            for cursor in connection.execute_stream(StringIO(sql), remove_comments=True):
                cursor.close()
            print(f"  ✓ {label} deployed")
        print()
        print(f"All components deployed to {namespace}")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        connection.close()


if __name__ == "__main__":
    main()
