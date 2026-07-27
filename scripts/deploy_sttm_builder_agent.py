#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import snowflake.connector


SOURCE_NAMESPACE = "FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA"
NAMESPACE_PLACEHOLDER = "__STTM_METADATA_NAMESPACE__"


def load_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def render_sql(raw_sql: str, namespace: str) -> str:
    return (
        raw_sql.replace(NAMESPACE_PLACEHOLDER, namespace)
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
    parser = argparse.ArgumentParser(description="Deploy one Workbench agent spec to Snowflake.")
    parser.add_argument(
        "--env-file",
        default="services/sttm-builder/.env.local",
        help="Path to the backend env file with Snowflake credentials.",
    )
    parser.add_argument(
        "--spec-file",
        default="infra/snowflake/agents/agent_spec_sttm_builder.yaml",
        help="Path to the agent spec YAML.",
    )
    parser.add_argument(
        "--agent-name",
        default="AGT_STTM_BUILDER",
        help="Snowflake agent object name.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    env = load_env_file(Path(args.env_file))
    namespace = f"{env['SNOWFLAKE_DATABASE']}.{env['SNOWFLAKE_SCHEMA']}"
    spec_path = Path(args.spec_file)
    manifest_path = Path("infra/snowflake/agents/agent_spec_manifest.json")
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text()).get("agents") or {}
        contract = manifest.get(args.agent_name)
        if contract:
            actual_hash = hashlib.sha256(spec_path.read_bytes()).hexdigest()
            if actual_hash != contract.get("sha256"):
                raise SystemExit(
                    f"{args.agent_name} spec hash does not match the deployment manifest."
                )
    spec_text = render_sql(spec_path.read_text(), namespace)
    statement = render_agent_statement(args.agent_name, spec_text, namespace)

    connect_kwargs: dict[str, str] = {
        "account": env["SNOWFLAKE_ACCOUNT"],
        "user": env["SNOWFLAKE_USER"],
        "role": env["SNOWFLAKE_ROLE"],
        "warehouse": env["SNOWFLAKE_WAREHOUSE"],
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
        with connection.cursor() as cursor:
            cursor.execute(statement)
        print(f"Deployed {namespace}.{args.agent_name} (sha256={hashlib.sha256(spec_path.read_bytes()).hexdigest()})")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
