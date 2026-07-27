#!/usr/bin/env python3
"""Bind AGT_SEMANTIC_MODEL_V2 tools to the configured semantic registry."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import snowflake.connector
import yaml


def _load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def _connect(env: dict[str, str], role: str):
    kwargs: dict[str, str] = {
        "account": env["SNOWFLAKE_ACCOUNT"],
        "user": env["SNOWFLAKE_USER"],
        "role": role,
        "warehouse": env.get("SNOWFLAKE_WAREHOUSE", ""),
    }
    host = env.get("SNOWFLAKE_HOST", "").strip()
    if not host:
        host = f"{env['SNOWFLAKE_ACCOUNT'].lower().replace('_', '-')}.snowflakecomputing.com"
    kwargs["host"] = host.replace("_", "-")
    if env.get("SNOWFLAKE_AUTHENTICATOR", "").strip().lower() == "externalbrowser":
        kwargs["authenticator"] = "externalbrowser"
    else:
        kwargs["password"] = env["SNOWFLAKE_PASSWORD"]
    return snowflake.connector.connect(**kwargs)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", default="services/sttm-builder/.env.local")
    parser.add_argument("--agent")
    parser.add_argument("--registry")
    parser.add_argument("--administrative-role", default="ACCOUNTADMIN")
    args = parser.parse_args()

    env = _load_env(Path(args.env_file))
    env = {**os.environ, **env}
    semantic_database = env.get("SNOWFLAKE_SEMANTIC_VIEWS_DATABASE", "").strip()
    semantic_schema = env.get("SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA", "").strip()
    if args.registry:
        registry = args.registry.strip()
    elif semantic_database and semantic_schema:
        registry = f"{semantic_database}.{semantic_schema}"
    else:
        raise RuntimeError(
            "Set SNOWFLAKE_SEMANTIC_VIEWS_DATABASE and "
            "SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA, or pass --registry."
        )
    agent = (
        args.agent
        or env.get("SNOWFLAKE_SEMANTIC_MODEL_AGENT")
        or f"{registry}.AGT_SEMANTIC_MODEL_V2"
    ).strip()
    connection = _connect(env, args.administrative_role)
    original_owner = "AIA_AGENT_ROLE"
    try:
        with connection.cursor() as cursor:
            cursor.execute(f"SHOW GRANTS ON AGENT {agent}")
            grant_rows = cursor.fetchall()
            grant_columns = [str(item[0]).lower() for item in cursor.description or []]
        role_grants = {
            str(dict(zip(grant_columns, row)).get("grantee_name") or "")
            for row in grant_rows
            if str(dict(zip(grant_columns, row)).get("privilege") or "").upper() == "USAGE"
        }
        role_grants.update({"ACCOUNTADMIN", "FOCUS_ADMIN", "WORKBENCH_ADMIN"})
        with connection.cursor() as cursor:
            cursor.execute(f"DESCRIBE AGENT {agent}")
            row = cursor.fetchone()
            columns = [str(item[0]).lower() for item in cursor.description or []]
            described = dict(zip(columns, row or []))
        original_owner = str(described.get("owner") or original_owner)
        raw_spec = described.get("agent_spec")
        spec = json.loads(raw_spec) if isinstance(raw_spec, str) else raw_spec
        if not isinstance(spec, dict):
            raise RuntimeError("AGT_SEMANTIC_MODEL_V2 specification is not a JSON object")
        resources = spec.setdefault("tool_resources", {})
        if not isinstance(resources, dict):
            raise RuntimeError("Agent tool_resources is not an object")
        warehouse = env.get("SNOWFLAKE_WAREHOUSE", "AIA_WH") or "AIA_WH"
        execution_environment = {"type": "warehouse", "warehouse": warehouse}
        bindings = {
            "SAVE_SEMANTIC_VIEW": (
                f"{registry}.SAVE_SEMANTIC_VIEW",
                "SAVE_SEMANTIC_VIEW(VARCHAR)",
            ),
            "GET_CACHED_SEMANTIC_VIEW": (
                f"{registry}.GET_CACHED_SEMANTIC_VIEW",
                "GET_CACHED_SEMANTIC_VIEW(VARCHAR, VARCHAR, VARCHAR)",
            ),
            "CHECK_TABLE_STALENESS": (
                f"{registry}.CHECK_TABLE_STALENESS",
                "CHECK_TABLE_STALENESS(VARCHAR, VARCHAR, VARCHAR)",
            ),
            "CHECK_COLUMN_STALENESS": (
                f"{registry}.CHECK_COLUMN_STALENESS",
                "CHECK_COLUMN_STALENESS(VARCHAR, VARCHAR, VARCHAR, VARCHAR)",
            ),
        }
        for tool_name, (identifier, signature) in bindings.items():
            resources[tool_name] = {
                "type": "procedure",
                "identifier": identifier,
                "name": signature,
                "execution_environment": dict(execution_environment),
            }

        instructions = spec.setdefault("instructions", {})
        orchestration = str(instructions.get("orchestration") or "")
        registry_instruction = (
            "\n\nCanonical registry rule: SAVE_SEMANTIC_VIEW versions the completed TABLE "
            f"asset in {registry}. Call it exactly once "
            "for every generated or refreshed table asset. Keep table JSON, column JSON, "
            "native semantic-view DDL, and Cortex Analyst YAML in this configured registry. "
            "CREATE_TABLE_SEMANTIC_VIEW publishes and versions the native view after the table asset is saved."
        )
        if "Canonical registry rule:" in orchestration:
            orchestration = orchestration.split("Canonical registry rule:", 1)[0].rstrip()
        instructions["orchestration"] = orchestration + registry_instruction

        profile = str(described.get("profile") or '{"display_name":"AGT_SEMANTIC_MODEL_V2"}')
        spec_yaml = yaml.safe_dump(spec, sort_keys=False, allow_unicode=False)
        escaped_profile = profile.replace("'", "''")
        statement = (
            f"CREATE OR REPLACE AGENT {agent}\n"
            f"PROFILE = '{escaped_profile}'\n"
            "FROM SPECIFICATION\n$$\n"
            f"{spec_yaml.rstrip()}\n$$"
        )
        with connection.cursor() as cursor:
            if original_owner.upper() != args.administrative_role.upper():
                cursor.execute(
                    f"GRANT OWNERSHIP ON AGENT {agent} TO ROLE {args.administrative_role} COPY CURRENT GRANTS"
                )
            cursor.execute(statement)
            if original_owner.upper() != args.administrative_role.upper():
                cursor.execute(
                    f"GRANT OWNERSHIP ON AGENT {agent} TO ROLE {original_owner} COPY CURRENT GRANTS"
                )
            for role_name in sorted(role for role in role_grants if role and role.upper() != original_owner.upper()):
                cursor.execute(f"GRANT USAGE ON AGENT {agent} TO ROLE {role_name}")
        print(f"Rebound {agent} to canonical semantic registry {registry}")
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
