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
from snowflake.connector.util_text import split_statements


ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCE_NAMESPACE = "FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA"
NAMESPACE_PLACEHOLDER = "__STTM_METADATA_NAMESPACE__"
SEMANTIC_TABLE_OBJECT_PLACEHOLDER = "__SEMANTIC_TABLE_VIEWS_OBJECT__"
SEMANTIC_COLUMN_OBJECT_PLACEHOLDER = "__SEMANTIC_COLUMN_VIEWS_OBJECT__"
SEMANTIC_NATIVE_OBJECT_PLACEHOLDER = "__SEMANTIC_NATIVE_VIEWS_OBJECT__"
SKILLS_STAGE_NAME = "STTM_AGENT_SKILLS"

BASE_SQL_FILES = [
    ROOT_DIR / "infra/snowflake/create-table-ddl.sql",
    ROOT_DIR
    / "infra/snowflake/migrations/20260723_warehouse_routing_conversation_artifacts.sql",
    ROOT_DIR / "infra/snowflake/migrations/20260731_project_attributes.sql",
    ROOT_DIR / "infra/snowflake/migrations/20260801_agent_artifact_jobs.sql",
    ROOT_DIR / "infra/snowflake/create-derived-sources-table.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-table-ddl.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-list-tables.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-list-columns.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-sample-data.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-table-stats.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-attribute-profile.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-table-relationship.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-check-table-staleness.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-check-column-staleness.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-cached-semantic-view.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-table-context-bundle.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-save-semantic-view.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-semantic-registry.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-rollup-schema-summary.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-semantic-model.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-subagent-semantic-model.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-subagent-source-mapping.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-subagent-transformation-rule.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-dbt-repo-tools.sql",
]

FIR_SQL_FILES = [
    ROOT_DIR / "infra/snowflake/fir_system/tables/tbl_agent_fir_360.sql",
    ROOT_DIR / "infra/snowflake/fir_system/tables/tbl_semantic_view_versions.sql",
    ROOT_DIR / "infra/snowflake/fir_system/tables/tbl_fir_agent_recommendations.sql",
    ROOT_DIR / "infra/snowflake/fir_system/tables/fir_v2_schema.sql",
    ROOT_DIR / "infra/snowflake/scripts/20260719_evernest_import_reliability.sql",
    ROOT_DIR / "infra/snowflake/fir_system/tables/fir_v2_linking_schema.sql",
    ROOT_DIR / "infra/snowflake/fir_system/streams/fir_streams.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-collect-feedback.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-enrich-context.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-refresh-features.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-backfill-events.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-generate-inferences.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-create-semantic-version.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-generate-recommendations.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-apply-confidence-decay.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-get-agent-recommendations.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-orchestrate-batch.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-consolidate-semantic-versions.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-read-documents.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-read-pending-records.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-read-semantic-evidence.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-store-inference.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-store-recommendation.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-reconcile-recommendation-identities.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-store-qa-pair.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-agent-learning-helpers.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-materialize-derived-source.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-precompute-from-semantic-view.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-precompute-permutations.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-score-recommendations.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-invoke-agent.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-process-learning-queue.sql",
    ROOT_DIR / "infra/snowflake/fir_system/cortex_search/workbench_rag_search_service.sql",
    ROOT_DIR / "infra/snowflake/fir_system/cortex_search/fir_search_services.sql",
]

LINKING_MIGRATION_SQL_FILES = [
    ROOT_DIR / "infra/snowflake/fir_system/tables/fir_v2_linking_schema.sql",
]

PERFORMANCE_R13_SQL_FILES = [
    ROOT_DIR / "infra/snowflake/migrations/20260805_safe_performance.sql",
    ROOT_DIR / "infra/snowflake/agentic_tools/sp-get-table-relationship.sql",
    ROOT_DIR / "infra/snowflake/fir_system/procedures/sp-fir-get-agent-recommendations.sql",
]

POST_AGENT_SQL_FILES = [
    ROOT_DIR / "infra/snowflake/fir_system/tasks/fir_tasks.sql",
]

AGENT_SPECS = [
    ("AGT_SOURCE_MAPPING", ROOT_DIR / "infra/snowflake/agents/agent_spec_source_mapping.yaml"),
    ("AGT_TRANSFORMATION_RULE", ROOT_DIR / "infra/snowflake/agents/agent_spec_transformation_rule.yaml"),
    ("AGT_STTM_BUILDER", ROOT_DIR / "infra/snowflake/agents/agent_spec_sttm_builder.yaml"),
    ("AGT_DBT_CONVERSION", ROOT_DIR / "infra/snowflake/agents/agent_spec_dbt_conversion.yaml"),
    ("AGT_DBT_TEST_GENERATION", ROOT_DIR / "infra/snowflake/agents/agent_spec_test_case_generation.yaml"),
    ("AGT_SEMANTIC_MODEL", ROOT_DIR / "infra/snowflake/agents/agent_spec_semantic_model.yaml"),
    ("AGT_WORKBENCH_CONVERSATION", ROOT_DIR / "infra/snowflake/agents/agent_spec_workbench_conversation.yaml"),
    ("AGT_FIR_SYSTEM", ROOT_DIR / "infra/snowflake/agents/agent_spec_fir_system.yaml"),
]

SKILL_DIRECTORIES = [
    ROOT_DIR / "infra/snowflake/skills/sttm_bundle_orchestration",
    ROOT_DIR / "infra/snowflake/skills/derived_source_analyst",
    ROOT_DIR / "infra/snowflake/skills/live_feedback_and_recommendations",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default=os.environ.get("SNOWFLAKE_DATABASE", ""))
    parser.add_argument("--schema", default=os.environ.get("SNOWFLAKE_SCHEMA", ""))
    parser.add_argument(
        "--semantic-database",
        default=os.environ.get("SNOWFLAKE_SEMANTIC_VIEWS_DATABASE", ""),
    )
    parser.add_argument(
        "--semantic-schema",
        default=os.environ.get("SNOWFLAKE_SEMANTIC_VIEWS_SCHEMA", ""),
    )
    parser.add_argument(
        "--semantic-table-object",
        default=os.environ.get(
            "SNOWFLAKE_SEMANTIC_TABLE_VIEWS_TABLE",
            "LATEST_TABLE_VIEWS",
        ),
    )
    parser.add_argument(
        "--semantic-column-object",
        default=os.environ.get(
            "SNOWFLAKE_SEMANTIC_COLUMN_VIEWS_TABLE",
            "LATEST_COLUMN_VIEWS",
        ),
    )
    parser.add_argument(
        "--semantic-native-object",
        default=os.environ.get(
            "SNOWFLAKE_SEMANTIC_NATIVE_VIEWS_TABLE",
            "LATEST_NATIVE_VIEWS",
        ),
    )
    parser.add_argument("--warehouse", default=os.environ.get("SNOWFLAKE_WAREHOUSE", ""))
    parser.add_argument(
        "--artifact-stage",
        default=os.environ.get(
            "SNOWFLAKE_AGENT_ARTIFACT_STAGE",
            "AI_WORKBENCH_ARTIFACTS",
        ),
    )
    parser.add_argument("--role", default=os.environ.get("SNOWFLAKE_ROLE", ""))
    parser.add_argument("--account", default=os.environ.get("SNOWFLAKE_ACCOUNT", ""))
    parser.add_argument("--user", default=os.environ.get("SNOWFLAKE_USER", ""))
    parser.add_argument("--password", default=os.environ.get("SNOWFLAKE_PASSWORD", ""))
    parser.add_argument(
        "--authenticator",
        default=os.environ.get("SNOWFLAKE_AUTHENTICATOR", ""),
    )
    parser.add_argument("--host", default=os.environ.get("SNOWFLAKE_HOST", ""))
    parser.add_argument(
        "--linking-migration-only",
        action="store_true",
        help="Apply only the FIR project/mapping linking migration; do not deploy agents or skills.",
    )
    parser.add_argument(
        "--performance-r13-only",
        action="store_true",
        help=(
            "Apply only the R13 performance table and optimized procedures; "
            "do not deploy agents, tasks, streams, stages, skills, or grants."
        ),
    )
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


def render_sql(
    raw_sql: str,
    namespace: str,
    *,
    warehouse: str = "",
    role: str = "",
    database: str = "",
    semantic_namespace: str = "",
    semantic_table_object: str = "LATEST_TABLE_VIEWS",
    semantic_column_object: str = "LATEST_COLUMN_VIEWS",
    semantic_native_object: str = "LATEST_NATIVE_VIEWS",
) -> str:
    rendered = raw_sql.replace(NAMESPACE_PLACEHOLDER, namespace)
    rendered = rendered.replace(SOURCE_NAMESPACE, namespace)
    rendered = rendered.replace("__WAREHOUSE_NAME__", warehouse)
    rendered = rendered.replace("__SERVICE_OWNER_ROLE__", role)
    rendered = rendered.replace("__DATABASE__", database)
    rendered = rendered.replace(
        "__SEMANTIC_REGISTRY_NAMESPACE__",
        semantic_namespace or namespace,
    )
    rendered = rendered.replace(
        SEMANTIC_TABLE_OBJECT_PLACEHOLDER,
        semantic_table_object or "LATEST_TABLE_VIEWS",
    )
    rendered = rendered.replace(
        SEMANTIC_COLUMN_OBJECT_PLACEHOLDER,
        semantic_column_object or "LATEST_COLUMN_VIEWS",
    )
    rendered = rendered.replace(
        SEMANTIC_NATIVE_OBJECT_PLACEHOLDER,
        semantic_native_object or "LATEST_NATIVE_VIEWS",
    )
    return re.sub(
        r"CREATE TABLE(?! IF NOT EXISTS)\s+",
        "CREATE TABLE IF NOT EXISTS ",
        rendered,
        flags=re.IGNORECASE,
    )


def _existing_column_names(connection, table_identifier: str) -> set[str]:
    """Return normalized column names without relying on INFORMATION_SCHEMA casing."""
    with connection.cursor() as cursor:
        cursor.execute(f"DESC TABLE {table_identifier}")
        return {
            str(row[0]).strip().upper()
            for row in cursor.fetchall()
            if row and row[0] is not None
        }


def _skip_redundant_mime_type_add(connection, statement: str, label: str) -> bool:
    """Work around Snowflake ambiguity on ADD COLUMN IF NOT EXISTS MIME_TYPE.

    Some upgraded client tables already contain MIME_TYPE but Snowflake raises
    002028 instead of treating this particular ALTER as a no-op. Inspect the
    table first and skip only this one additive statement when the column is
    demonstrably present.
    """
    if not label.endswith("20260723_warehouse_routing_conversation_artifacts.sql"):
        return False
    match = re.search(
        r"""
        ALTER\s+TABLE\s+
        (?P<table>[A-Za-z0-9_$".]+)
        \s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+
        "?MIME_TYPE"?
        \s+STRING
        """,
        statement,
        flags=re.IGNORECASE | re.VERBOSE,
    )
    if not match:
        return False
    table_identifier = match.group("table")
    if "MIME_TYPE" not in _existing_column_names(connection, table_identifier):
        return False
    print(
        "[bootstrap-sttm-metadata] MIME_TYPE already exists on "
        f"{table_identifier}; skipping redundant additive ALTER."
    )
    return True


def execute_multi_statement(connection, sql_text: str, label: str) -> None:
    print(f"[bootstrap-sttm-metadata] Applying {label}")
    # Snowflake's execute_stream treats a trailing block of line comments after
    # the final semicolon as another (empty) statement when comments are
    # preserved. Keep comments inside SQL/procedure bodies intact, but remove a
    # comment-only tail before handing the stream to the connector.
    executable_sql = re.sub(r"(?:\s*--[^\r\n]*(?:\r?\n|$))+\s*$", "", sql_text)
    if not executable_sql.strip():
        return
    try:
        statements = split_statements(
            io.StringIO(executable_sql),
            remove_comments=False,
        )
        for statement, _is_put_or_get in statements:
            if not statement.strip():
                continue
            if _skip_redundant_mime_type_add(connection, statement, label):
                continue
            with connection.cursor() as cursor:
                cursor.execute(statement)
                _ = cursor.rowcount
    except Exception as exc:
        raise RuntimeError(f"Failed while applying {label}: {exc}") from exc


def create_schema(connection, database: str, schema: str) -> None:
    statement = f'CREATE SCHEMA IF NOT EXISTS "{database}"."{schema}"'
    with connection.cursor() as cursor:
        cursor.execute(statement)


def create_stage(
    connection,
    database: str,
    schema: str,
    stage_name: str,
) -> None:
    raw_parts = [
        part.strip().strip('"')
        for part in stage_name.lstrip("@").split(".")
        if part.strip()
    ]
    if len(raw_parts) == 1:
        parts = [database, schema, raw_parts[0]]
    elif len(raw_parts) == 3:
        parts = raw_parts
    else:
        raise SystemExit(
            "Stage names must be OBJECT or DATABASE.SCHEMA.OBJECT; received "
            f"'{stage_name}'."
        )
    if any(not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", part) for part in parts):
        raise SystemExit(f"Unsafe Snowflake stage identifier: '{stage_name}'.")
    qualified = ".".join(f'"{part}"' for part in parts)
    statement = f"CREATE STAGE IF NOT EXISTS {qualified}"
    with connection.cursor() as cursor:
        cursor.execute(statement)


def read_repository_text(path: Path) -> str:
    """Read version-controlled SQL, YAML, and Markdown consistently on Windows."""
    return path.read_text(encoding="utf-8-sig")


def apply_sql_files(
    connection,
    paths: list[Path],
    *,
    namespace: str,
    warehouse: str,
    role: str,
    database: str,
    semantic_namespace: str,
    semantic_table_object: str,
    semantic_column_object: str,
    semantic_native_object: str,
) -> None:
    for path in paths:
        sql_text = render_sql(
            read_repository_text(path),
            namespace,
            warehouse=warehouse,
            role=role,
            database=database,
            semantic_namespace=semantic_namespace,
            semantic_table_object=semantic_table_object,
            semantic_column_object=semantic_column_object,
            semantic_native_object=semantic_native_object,
        )
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
        spec_text = render_sql(read_repository_text(path), namespace)
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
    semantic_namespace = target_namespace(
        args.semantic_database or args.database,
        args.semantic_schema or args.schema,
    )

    with connect(args) as connection:
        activate_session(connection, args)
        if args.performance_r13_only:
            apply_sql_files(
                connection,
                PERFORMANCE_R13_SQL_FILES,
                namespace=namespace,
                warehouse=args.warehouse,
                role=args.role,
                database=args.database,
                semantic_namespace=semantic_namespace,
                semantic_table_object=args.semantic_table_object,
                semantic_column_object=args.semantic_column_object,
                semantic_native_object=args.semantic_native_object,
            )
            print("")
            print("[bootstrap-sttm-metadata] R13 safe-performance migration completed.")
            print("[bootstrap-sttm-metadata] No tasks, streams, agents, stages, or grants were modified.")
            return 0
        if args.linking_migration_only:
            apply_sql_files(
                connection,
                LINKING_MIGRATION_SQL_FILES,
                namespace=namespace,
                warehouse=args.warehouse,
                role=args.role,
                database=args.database,
                semantic_namespace=semantic_namespace,
                semantic_table_object=args.semantic_table_object,
                semantic_column_object=args.semantic_column_object,
                semantic_native_object=args.semantic_native_object,
            )
            print("")
            print("[bootstrap-sttm-metadata] FIR linking migration completed successfully.")
            print(f"[bootstrap-sttm-metadata] Target namespace: {namespace}")
            return 0
        create_schema(connection, args.database, args.schema)
        create_stage(connection, args.database, args.schema, SKILLS_STAGE_NAME)
        create_stage(connection, args.database, args.schema, args.artifact_stage)
        upload_skills(connection, args.database, args.schema)
        apply_sql_files(
            connection,
            [*BASE_SQL_FILES, *FIR_SQL_FILES],
            namespace=namespace,
            warehouse=args.warehouse,
            role=args.role,
            database=args.database,
            semantic_namespace=semantic_namespace,
            semantic_table_object=args.semantic_table_object,
            semantic_column_object=args.semantic_column_object,
            semantic_native_object=args.semantic_native_object,
        )
        apply_agents(connection, namespace)
        apply_sql_files(
            connection,
            POST_AGENT_SQL_FILES,
            namespace=namespace,
            warehouse=args.warehouse,
            role=args.role,
            database=args.database,
            semantic_namespace=semantic_namespace,
            semantic_table_object=args.semantic_table_object,
            semantic_column_object=args.semantic_column_object,
            semantic_native_object=args.semantic_native_object,
        )
        restore_bundle_analyst_tools(
            connection,
            namespace=namespace,
            warehouse=args.warehouse,
        )
    print("")
    print("[bootstrap-sttm-metadata] Completed successfully.")
    print(f"[bootstrap-sttm-metadata] Target namespace: {namespace}")
    print(f"[bootstrap-sttm-metadata] Semantic registry: {semantic_namespace}")
    print(
        "[bootstrap-sttm-metadata] Semantic objects: "
        f"{args.semantic_table_object}, {args.semantic_column_object}, "
        f"{args.semantic_native_object}"
    )
    print("[bootstrap-sttm-metadata] Role grants were not modified.")
    print("[bootstrap-sttm-metadata] FIR tasks were created suspended; resume after verification.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
