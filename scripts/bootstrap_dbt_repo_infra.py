#!/usr/bin/env python3
"""Create or refresh the Snowflake Git repository objects used by AGT_DBT_CONVERSION."""

from __future__ import annotations

import argparse
import os

import snowflake.connector


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default=os.environ.get("SNOWFLAKE_DATABASE", ""))
    parser.add_argument("--schema", default=os.environ.get("SNOWFLAKE_SCHEMA", ""))
    parser.add_argument("--warehouse", default=os.environ.get("SNOWFLAKE_WAREHOUSE", ""))
    parser.add_argument("--role", default=os.environ.get("SNOWFLAKE_ROLE", ""))
    parser.add_argument("--account", default=os.environ.get("SNOWFLAKE_ACCOUNT", ""))
    parser.add_argument("--user", default=os.environ.get("SNOWFLAKE_USER", ""))
    parser.add_argument("--password", default=os.environ.get("SNOWFLAKE_PASSWORD", ""))
    parser.add_argument("--authenticator", default=os.environ.get("SNOWFLAKE_AUTHENTICATOR", ""))
    parser.add_argument("--host", default=os.environ.get("SNOWFLAKE_HOST", ""))
    parser.add_argument(
        "--api-integration",
        default=os.environ.get("SNOWFLAKE_DBT_GIT_API_INTEGRATION", "GIT_API_INTEGRATION_DBT"),
    )
    parser.add_argument(
        "--allowed-prefix",
        default=os.environ.get("SNOWFLAKE_DBT_GIT_ALLOWED_PREFIX", ""),
    )
    parser.add_argument(
        "--secret-name",
        default=os.environ.get("SNOWFLAKE_DBT_GIT_SECRET_NAME", "GIT_SECRET_DBT"),
    )
    parser.add_argument(
        "--git-username",
        default=os.environ.get("SNOWFLAKE_DBT_GIT_USERNAME", ""),
    )
    parser.add_argument(
        "--git-pat",
        default=os.environ.get("SNOWFLAKE_DBT_GIT_PAT", ""),
    )
    parser.add_argument(
        "--repository-name",
        default=os.environ.get("SNOWFLAKE_DBT_GIT_REPOSITORY_NAME", "DBT_REPO"),
    )
    parser.add_argument(
        "--repository-origin",
        default=os.environ.get("SNOWFLAKE_DBT_GIT_ORIGIN", ""),
    )
    parser.add_argument(
        "--consumer-role",
        default=os.environ.get("SNOWFLAKE_DBT_GIT_CONSUMER_ROLE", ""),
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


def main() -> int:
    args = parse_args()
    missing = []
    if not args.allowed_prefix:
        missing.append("SNOWFLAKE_DBT_GIT_ALLOWED_PREFIX")
    if not args.git_username:
        missing.append("SNOWFLAKE_DBT_GIT_USERNAME")
    if not args.git_pat:
        missing.append("SNOWFLAKE_DBT_GIT_PAT")
    if not args.repository_origin:
        missing.append("SNOWFLAKE_DBT_GIT_ORIGIN")
    if missing:
        raise SystemExit(
            "Missing required DBT git settings: " + ", ".join(missing)
        )

    namespace = f"{args.database.strip()}.{args.schema.strip()}"
    secret_name = f"{namespace}.{args.secret_name.strip()}"
    repo_name = f"{namespace}.{args.repository_name.strip()}"
    file_format_name = f"{namespace}.DBT_TEXT_LINE_FORMAT"
    consumer_role = (args.consumer_role or args.role or "").strip()

    statements = [
        (
            "git secret",
            " ".join(
                [
                    f"CREATE OR REPLACE SECRET {secret_name}",
                    "TYPE = password",
                    f"USERNAME = {_quote_literal(args.git_username.strip())}",
                    f"PASSWORD = {_quote_literal(args.git_pat)}",
                    "COMMENT = 'GitHub PAT for dbt repo access'",
                ]
            ),
        ),
        (
            "api integration",
            " ".join(
                [
                    f"CREATE OR REPLACE API INTEGRATION {_quote_identifier(args.api_integration.strip())}",
                    "API_PROVIDER = git_https_api",
                    f"API_ALLOWED_PREFIXES = ({_quote_literal(args.allowed_prefix.strip())})",
                    f"ALLOWED_AUTHENTICATION_SECRETS = ({secret_name})",
                    "ENABLED = TRUE",
                    "COMMENT = 'GitHub API integration for dbt repo access'",
                ]
            ),
        ),
        (
            "git repository",
            " ".join(
                [
                    f"CREATE OR REPLACE GIT REPOSITORY {repo_name}",
                    f"API_INTEGRATION = {_quote_identifier(args.api_integration.strip())}",
                    f"GIT_CREDENTIALS = {secret_name}",
                    f"ORIGIN = {_quote_literal(args.repository_origin.strip())}",
                    "COMMENT = 'dbt project repo for AGT_DBT_CONVERSION'",
                ]
            ),
        ),
        (
            "file format",
            " ".join(
                [
                    f"CREATE OR REPLACE FILE FORMAT {file_format_name}",
                    "TYPE = 'CSV'",
                    "FIELD_DELIMITER = '\\x01'",
                    "RECORD_DELIMITER = '\\n'",
                    "SKIP_HEADER = 0",
                    "EMPTY_FIELD_AS_NULL = FALSE",
                    "FIELD_OPTIONALLY_ENCLOSED_BY = 'NONE'",
                    "COMMENT = 'Line-by-line text reader for dbt repo content'",
                ]
            ),
        ),
        ("git fetch", f"ALTER GIT REPOSITORY {repo_name} FETCH"),
    ]

    with connect(args) as connection:
        with connection.cursor() as cursor:
            if args.role:
                cursor.execute(f'USE ROLE "{args.role}"')
            if args.warehouse:
                cursor.execute(f'USE WAREHOUSE "{args.warehouse}"')
            cursor.execute(f'USE DATABASE "{args.database}"')
            cursor.execute(f'USE SCHEMA "{args.schema}"')
            for label, statement in statements:
                print(f"[bootstrap-dbt-repo] Applying {label}")
                cursor.execute(statement)

            if consumer_role:
                print(
                    "[bootstrap-dbt-repo] Granting DBT repository read access "
                    f"to role {consumer_role}"
                )
                cursor.execute(
                    f"GRANT READ ON GIT REPOSITORY {repo_name} TO ROLE {_quote_identifier(consumer_role)}"
                )

    print("")
    print("[bootstrap-dbt-repo] Completed successfully.")
    print(f"[bootstrap-dbt-repo] Target namespace: {namespace}")
    print(f"[bootstrap-dbt-repo] Repository object: {repo_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
