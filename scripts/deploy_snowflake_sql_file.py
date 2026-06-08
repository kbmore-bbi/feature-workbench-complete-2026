#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import snowflake.connector


SOURCE_NAMESPACE = "FFP_HDP_CRM_MIG_DB_DEV.SCH_STTM_METADATA"


def load_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deploy a Snowflake SQL file into the configured namespace.")
    parser.add_argument("--env-file", default="services/sttm-builder/.env.local")
    parser.add_argument("--sql-file", required=True)
    return parser.parse_args()


def render_sql(raw_sql: str, namespace: str) -> str:
    return raw_sql.replace(SOURCE_NAMESPACE, namespace)


def main() -> None:
    args = parse_args()
    env = load_env_file(Path(args.env_file))
    namespace = f"{env['SNOWFLAKE_DATABASE']}.{env['SNOWFLAKE_SCHEMA']}"
    sql_text = render_sql(Path(args.sql_file).read_text(), namespace)

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
            cursor.execute(sql_text)
        print(f"Deployed {Path(args.sql_file).name} into {namespace}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
