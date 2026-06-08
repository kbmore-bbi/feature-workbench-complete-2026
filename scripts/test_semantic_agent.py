#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from dataclasses import dataclass

from snowflake.snowpark import Session


@dataclass
class SnowConfig:
    account: str
    user: str
    password: str
    role: str
    warehouse: str
    database: str
    schema: str


def load_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def resolve_config(env_path: Path) -> SnowConfig:
    env = load_env_file(env_path)
    return SnowConfig(
        account=env["SNOWFLAKE_ACCOUNT"],
        user=env["SNOWFLAKE_USER"],
        password=env["SNOWFLAKE_PASSWORD"],
        role=env["SNOWFLAKE_ROLE"],
        warehouse=env["SNOWFLAKE_WAREHOUSE"],
        database=env["SNOWFLAKE_DATABASE"],
        schema=env["SNOWFLAKE_SCHEMA"],
    )


def create_session(config: SnowConfig) -> Session:
    return Session.builder.configs(
        {
            "account": config.account,
            "user": config.user,
            "password": config.password,
            "role": config.role,
            "warehouse": config.warehouse,
            "database": config.database,
            "schema": config.schema,
        }
    ).create()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the semantic-model subagent directly for one table.")
    parser.add_argument("--env-file", default="services/sttm-builder/.env.local")
    parser.add_argument("--database", required=True)
    parser.add_argument("--schema", required=True)
    parser.add_argument("--table", required=True)
    parser.add_argument("--semantic-level", default="L2_ANALYST_READY")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = resolve_config(Path(args.env_file))
    session = create_session(config)
    try:
        payload = {
            "contract_version": "1.0",
            "operation": "semantic_model.generate",
            "context": {
                "semantic_level_requested": args.semantic_level,
                "source_tables": [
                    {
                        "database": args.database,
                        "schema": args.schema,
                        "table": args.table,
                    }
                ],
            },
            "data": {
                "scope": "TABLE",
                "database": args.database,
                "schema": args.schema,
                "table": args.table,
                "semantic_level": args.semantic_level,
            },
        }
        payload_json = json.dumps(payload).replace("'", "''")
        row = session.sql(
            f"CALL {config.database}.{config.schema}.SP_SUBAGT_SEMANTIC_MODEL('{payload_json}')"
        ).collect()[0]
        print(row[0])
    finally:
        session.close()


if __name__ == "__main__":
    main()
