#!/usr/bin/env python3
"""Create STTM metadata tables, procedures, tools, and agents in a target namespace."""

from __future__ import annotations

import argparse
import io
import os
import re
from pathlib import Path

import snowflake.connector


ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCE_NAMESPACE = "FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA"

SQL_FILES = [
    ROOT_DIR / "infra/snowflake/create-table-ddl.sql",
    ROOT_DIR / "infra/snowflake/create-derived-sources-table.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-table-ddl.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-list-tables.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-sample-data.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-attribute-profile.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-table-relationship.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-semantic-model.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-subagent-source-mapping.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-subagent-transformation-rule.sql",
]

AGENT_SPECS = [
    ("AGT_SOURCE_MAPPING", ROOT_DIR / "infra/snowflake/agents/agent_spec_source_mapping.yaml"),
    ("AGT_TRANSFORMATION_RULE", ROOT_DIR / "infra/snowflake/agents/agent_spec_transformation_rule.yaml"),
    ("AGT_STTM_BUILDER", ROOT_DIR / "infra/snowflake/agents/agent_spec_sttm_builder.yaml"),
    ("AGT_SEMANTIC_MODEL", ROOT_DIR / "infra/snowflake/agents/agent_spec_semantic_model.yaml"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default=os.environ.get("SNOWFLAKE_DATABASE", ""))
    parser.add_argument("--schema", default=os.environ.get("SNOWFLAKE_SCHEMA", ""))
    parser.add_argument("--warehouse", default=os.environ.get("SNOWFLAKE_WAREHOUSE", ""))
    parser.add_argument("--role", default=os.environ.get("SNOWFLAKE_ROLE", ""))
    parser.add_argument("--account", default=os.environ.get("SNOWFLAKE_ACCOUNT", ""))
    parser.add_argument("--user", default=os.environ.get("SNOWFLAKE_USER", ""))
    parser.add_argument("--password", default=os.environ.get("SNOWFLAKE_PASSWORD", ""))
    parser.add_argument(
        "--authenticator",
        default=os.environ.get("SNOWFLAKE_AUTHENTICATOR", ""),
    )
    parser.add_argument("--host", default=os.environ.get("SNOWFLAKE_HOST", ""))
    return parser.parse_args()


def connect(args: argparse.Namespace):
    if not args.account or not args.user:
        raise SystemExit("SNOWFLAKE_ACCOUNT and SNOWFLAKE_USER are required.")
    if not args.database or not args.schema:
        raise SystemExit("SNOWFLAKE_DATABASE and SNOWFLAKE_SCHEMA are required.")

    kwargs: dict[str, str] = {
        "account": args.account,
        "user": args.user,
    }
    if args.host:
        kwargs["host"] = args.host
    if args.role:
        kwargs["role"] = args.role
    if args.warehouse:
        kwargs["warehouse"] = args.warehouse
    if args.database:
        kwargs["database"] = args.database

    authenticator = (args.authenticator or "").strip().lower()
    if authenticator == "externalbrowser":
        kwargs["authenticator"] = "externalbrowser"
    else:
        if not args.password:
            raise SystemExit(
                "SNOWFLAKE_PASSWORD is required unless SNOWFLAKE_AUTHENTICATOR=externalbrowser."
            )
        kwargs["password"] = args.password

    return snowflake.connector.connect(**kwargs)


def target_namespace(database: str, schema: str) -> str:
    return f"{database.strip()}.{schema.strip()}"


def render_sql(raw_sql: str, namespace: str) -> str:
    rendered = raw_sql.replace(SOURCE_NAMESPACE, namespace)
    return re.sub(
        r"CREATE TABLE(?! IF NOT EXISTS)\s+",
        "CREATE TABLE IF NOT EXISTS ",
        rendered,
        flags=re.IGNORECASE,
    )


def execute_multi_statement(connection, sql_text: str, label: str) -> None:
    print(f"[bootstrap-sttm-metadata] Applying {label}")
    stream = io.StringIO(sql_text)
    for cursor in connection.execute_stream(stream, remove_comments=False):
        try:
            _ = cursor.rowcount
        finally:
            cursor.close()


def create_schema(connection, database: str, schema: str) -> None:
    statement = f'CREATE SCHEMA IF NOT EXISTS "{database}"."{schema}"'
    with connection.cursor() as cursor:
        cursor.execute(statement)


def apply_sql_files(connection, namespace: str) -> None:
    for path in SQL_FILES:
        sql_text = render_sql(path.read_text(), namespace)
        execute_multi_statement(connection, sql_text, str(path.relative_to(ROOT_DIR)))


def activate_session(connection, args: argparse.Namespace) -> None:
    with connection.cursor() as cursor:
        if args.role:
            cursor.execute(f'USE ROLE "{args.role}"')
        if args.warehouse:
            cursor.execute(f'USE WAREHOUSE "{args.warehouse}"')
        if args.database:
            cursor.execute(f'USE DATABASE "{args.database}"')


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


def apply_agents(connection, namespace: str) -> None:
    for agent_name, path in AGENT_SPECS:
        spec_text = render_sql(path.read_text(), namespace)
        statement = render_agent_statement(agent_name, spec_text, namespace)
        print(
            "[bootstrap-sttm-metadata] Creating agent "
            f"{namespace}.{agent_name} from {path.relative_to(ROOT_DIR)}"
        )
        with connection.cursor() as cursor:
            cursor.execute(statement)


def main() -> int:
    args = parse_args()
    namespace = target_namespace(args.database, args.schema)

    with connect(args) as connection:
        activate_session(connection, args)
        create_schema(connection, args.database, args.schema)
        apply_sql_files(connection, namespace)
        apply_agents(connection, namespace)

    print("")
    print("[bootstrap-sttm-metadata] Completed successfully.")
    print(f"[bootstrap-sttm-metadata] Target namespace: {namespace}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
