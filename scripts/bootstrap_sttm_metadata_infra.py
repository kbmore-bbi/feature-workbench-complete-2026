#!/usr/bin/env python3
"""Create STTM metadata tables, procedures, tools, and agents in a target namespace."""

from __future__ import annotations

import argparse
import io
import os
import re
from pathlib import Path

import snowflake.connector
import yaml


ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCE_NAMESPACE = "FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA"
SKILLS_STAGE_NAME = "STTM_AGENT_SKILLS"

SQL_FILES = [
    ROOT_DIR / "infra/snowflake/create-table-ddl.sql",
    ROOT_DIR / "infra/snowflake/create-derived-sources-table.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-table-ddl.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-list-tables.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-sample-data.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-attribute-profile.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-table-relationship.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-semantic-model.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-subagent-semantic-model.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-subagent-source-mapping.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-subagent-transformation-rule.sql",
]

AGENT_SPECS = [
    ("AGT_SOURCE_MAPPING", ROOT_DIR / "infra/snowflake/agents/agent_spec_source_mapping.yaml"),
    ("AGT_TRANSFORMATION_RULE", ROOT_DIR / "infra/snowflake/agents/agent_spec_transformation_rule.yaml"),
    ("AGT_STTM_BUILDER", ROOT_DIR / "infra/snowflake/agents/agent_spec_sttm_builder.yaml"),
    ("AGT_SEMANTIC_MODEL", ROOT_DIR / "infra/snowflake/agents/agent_spec_semantic_model.yaml"),
]

SKILL_DIRECTORIES = [
    ROOT_DIR / "infra/snowflake/skills/sttm_bundle_orchestration",
    ROOT_DIR / "infra/snowflake/skills/derived_source_analyst",
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


def create_stage(connection, database: str, schema: str) -> None:
    statement = f'CREATE STAGE IF NOT EXISTS "{database}"."{schema}"."{SKILLS_STAGE_NAME}"'
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


def upload_skills(connection, database: str, schema: str) -> None:
    stage_path = f'@"{database}"."{schema}"."{SKILLS_STAGE_NAME}"'
    for skill_dir in SKILL_DIRECTORIES:
        for file_path in skill_dir.iterdir():
            if not file_path.is_file():
                continue
            destination = f"{stage_path}/skills/{skill_dir.name}/"
            statement = (
                f"PUT file://{file_path.resolve().as_posix()} "
                f"{destination} AUTO_COMPRESS=FALSE OVERWRITE=TRUE"
            )
            print(
                "[bootstrap-sttm-metadata] Uploading skill file "
                f"{file_path.relative_to(ROOT_DIR)} to {destination}"
            )
            with connection.cursor() as cursor:
                cursor.execute(statement)


def _fetch_single_row_dict(connection, sql: str) -> dict[str, object] | None:
    with connection.cursor() as cursor:
        cursor.execute(sql)
        row = cursor.fetchone()
        if row is None:
            return None
        columns = [str(column[0]) for column in cursor.description or []]
    return dict(zip(columns, row))


def _replace_agent(connection, *, agent_name: str, profile: str, spec: dict[str, object]) -> None:
    spec_yaml = yaml.safe_dump(spec, sort_keys=False, allow_unicode=False)
    escaped_profile = profile.replace("'", "''")
    statement = (
        f"CREATE OR REPLACE AGENT {agent_name}\n"
        f"    PROFILE = '{escaped_profile}'\n"
        "    FROM SPECIFICATION\n"
        "    $$\n"
        f"{spec_yaml.rstrip()}\n"
        "    $$"
    )
    with connection.cursor() as cursor:
        cursor.execute(statement)


def restore_bundle_analyst_tools(connection, *, namespace: str, warehouse: str) -> None:
    bundle_table = f"{namespace}.TBL_SEMANTIC_BUNDLES"
    agent_name = f"{namespace}.AGT_STTM_BUILDER"

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT SEMANTIC_BUNDLE_ID, BUNDLE_LABEL, SEMANTIC_VIEW_NAME, ANALYST_TOOL_NAME
                FROM {bundle_table}
                WHERE SEMANTIC_VIEW_NAME IS NOT NULL
                """
            )
            rows = cursor.fetchall()
            columns = [str(column[0]) for column in cursor.description or []]
    except Exception as exc:
        print(
            "[bootstrap-sttm-metadata] Skipping Analyst tool restore because bundle metadata "
            f"was not readable: {exc}"
        )
        return

    if not rows:
        print("[bootstrap-sttm-metadata] No promoted semantic bundles found to restore.")
        return

    described = _fetch_single_row_dict(connection, f"DESCRIBE AGENT {agent_name}")
    if not described:
        print(f"[bootstrap-sttm-metadata] DESCRIBE AGENT returned no rows for {agent_name}")
        return

    described_lower = {str(key).lower(): value for key, value in described.items()}
    raw_spec = (
        described_lower.get("agent_spec")
        or described_lower.get("specification")
        or described_lower.get("spec")
    )
    if not raw_spec:
        print(f"[bootstrap-sttm-metadata] No agent spec found in DESCRIBE AGENT for {agent_name}")
        return

    profile = str(described_lower.get("profile") or '{"display_name":"AGT_STTM_BUILDER"}')
    spec = yaml.safe_load(raw_spec) if isinstance(raw_spec, str) else raw_spec
    if not isinstance(spec, dict):
        print(f"[bootstrap-sttm-metadata] Agent spec for {agent_name} was not a mapping.")
        return

    tools = spec.setdefault("tools", [])
    tool_resources = spec.setdefault("tool_resources", {})
    if not isinstance(tools, list) or not isinstance(tool_resources, dict):
        print(f"[bootstrap-sttm-metadata] Agent spec for {agent_name} has invalid tool sections.")
        return

    changed = False
    for row in rows:
        row_dict = dict(zip(columns, row))
        bundle_id = str(row_dict.get("SEMANTIC_BUNDLE_ID") or "").strip()
        semantic_view_name = str(row_dict.get("SEMANTIC_VIEW_NAME") or "").strip()
        if not bundle_id or not semantic_view_name:
            continue

        bundle_label = str(row_dict.get("BUNDLE_LABEL") or bundle_id).strip()
        tool_name = str(row_dict.get("ANALYST_TOOL_NAME") or f"ANALYST_{bundle_id.upper()}").strip()

        existing_resource = tool_resources.get(tool_name)
        if not isinstance(existing_resource, dict) or str(existing_resource.get("semantic_view") or "") != semantic_view_name:
            resource: dict[str, object] = {"semantic_view": semantic_view_name}
            if warehouse:
                resource["execution_environment"] = {
                    "type": "warehouse",
                    "warehouse": warehouse,
                }
            tool_resources[tool_name] = resource
            changed = True

        tool_present = any(
            isinstance(tool, dict)
            and isinstance(tool.get("tool_spec"), dict)
            and str(tool["tool_spec"].get("name") or "") == tool_name
            for tool in tools
        )
        if not tool_present:
            tools.append(
                {
                    "tool_spec": {
                        "type": "cortex_analyst_text_to_sql",
                        "name": tool_name,
                        "description": (
                            f"Uses Cortex Analyst over semantic view {semantic_view_name} "
                            f"for analytical questions on {bundle_label}."
                        ),
                    }
                }
            )
            changed = True

    if changed:
        print(
            "[bootstrap-sttm-metadata] Restoring Cortex Analyst tools on "
            f"{agent_name} for promoted semantic bundles."
        )
        _replace_agent(connection, agent_name=agent_name, profile=profile, spec=spec)
    else:
        print("[bootstrap-sttm-metadata] Cortex Analyst tools already up to date.")


def main() -> int:
    args = parse_args()
    namespace = target_namespace(args.database, args.schema)

    with connect(args) as connection:
        activate_session(connection, args)
        create_schema(connection, args.database, args.schema)
        create_stage(connection, args.database, args.schema)
        upload_skills(connection, args.database, args.schema)
        apply_sql_files(connection, namespace)
        apply_agents(connection, namespace)
        restore_bundle_analyst_tools(
            connection,
            namespace=namespace,
            warehouse=args.warehouse.strip(),
        )

    print("")
    print("[bootstrap-sttm-metadata] Completed successfully.")
    print(f"[bootstrap-sttm-metadata] Target namespace: {namespace}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
