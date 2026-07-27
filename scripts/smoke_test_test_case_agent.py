#!/usr/bin/env python3
"""Smoke-test the test-case generation Snowflake agent with a realistic request."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import snowflake.connector

from app.core.test_case_generation import TestCaseGenerationService


ROOT_DIR = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT_DIR / "infra/snowflake/env/client.env"


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def build_request_payload() -> dict[str, Any]:
    return {
        "contract_version": "1.0",
        "request_id": f"smoke-{uuid.uuid4()}",
        "operation": "test_cases.generate",
        "context": {
            "summary_surface": "sttm.summary",
        },
        "data": {
            "domain_name": "account_billing",
            "target_layer": "curated",
            "materialization": "incremental",
            "target_table": {
                "database": "FOCUS_CURATED_DB",
                "schema": "CURATED_ACCOUNT_BILLING",
                "table": "ACCOUNT_DETAILS",
            },
            "source_tables": [
                {
                    "database": "FOCUS_RAW_DB",
                    "schema": "RAW_ACCOUNT_BILLING",
                    "table": "DS_IBT_ACCOUNTS",
                },
                {
                    "database": "FOCUS_RAW_DB",
                    "schema": "RAW_ACCOUNT_BILLING",
                    "table": "DS_IBT_CONTACTS",
                },
            ],
            "relationships": [
                {
                    "left_table": {
                        "database": "FOCUS_RAW_DB",
                        "schema": "RAW_ACCOUNT_BILLING",
                        "table": "DS_IBT_ACCOUNTS",
                    },
                    "right_table": {
                        "database": "FOCUS_RAW_DB",
                        "schema": "RAW_ACCOUNT_BILLING",
                        "table": "DS_IBT_CONTACTS",
                    },
                    "join_type": "LEFT",
                    "conditions": [
                        {
                            "left_column": "ACCT_ID",
                            "right_column": "ACCOUNT_ID",
                            "operator": "=",
                        }
                    ],
                }
            ],
            "validated_sql": (
                "SELECT a.ACCT_ID AS ACCOUNT_ID, "
                "CONCAT(c.FIRST_NAME, ' ', c.LAST_NAME) AS FULL_NAME, "
                "COALESCE(a.STATUS, 'UNKNOWN') AS ACCOUNT_STATUS, "
                "a.CREATED_DATE, a.MODIFIED_DATE, "
                "MD5(CAST(a.ACCT_ID AS VARCHAR)) AS ACCOUNT_KEY, "
                "CASE WHEN COALESCE(a.STATUS, 'UNKNOWN') = 'ACTIVE' THEN TRUE ELSE FALSE END AS IS_ACTIVE_FLAG "
                "FROM FOCUS_RAW_DB.RAW_ACCOUNT_BILLING.DS_IBT_ACCOUNTS a "
                "LEFT JOIN FOCUS_RAW_DB.RAW_ACCOUNT_BILLING.DS_IBT_CONTACTS c "
                "ON a.ACCT_ID = c.ACCOUNT_ID "
                "WHERE a.IS_ACTIVE = TRUE"
            ),
            "attribute_mappings": {
                "ACCOUNT_ID": {
                    "source_attributes": [
                        "FOCUS_RAW_DB.RAW_ACCOUNT_BILLING.DS_IBT_ACCOUNTS.ACCT_ID"
                    ],
                    "preprocessing_rule": "Direct",
                    "preprocessing_rule_type": "Direct",
                    "description": "Unique account identifier from source system",
                    "data_type": "NUMBER",
                },
                "FULL_NAME": {
                    "source_attributes": [
                        "FOCUS_RAW_DB.RAW_ACCOUNT_BILLING.DS_IBT_CONTACTS.FIRST_NAME",
                        "FOCUS_RAW_DB.RAW_ACCOUNT_BILLING.DS_IBT_CONTACTS.LAST_NAME",
                    ],
                    "preprocessing_rule": "CONCAT(FIRST_NAME, ' ', LAST_NAME)",
                    "preprocessing_rule_type": "Custom",
                    "preprocessing_nl_rule": "Concatenate first and last name with a space",
                    "description": "Full contact name",
                    "data_type": "VARCHAR(500)",
                },
                "ACCOUNT_STATUS": {
                    "source_attributes": [
                        "FOCUS_RAW_DB.RAW_ACCOUNT_BILLING.DS_IBT_ACCOUNTS.STATUS"
                    ],
                    "preprocessing_rule": "COALESCE(STATUS, 'UNKNOWN')",
                    "preprocessing_rule_type": "COALESCE",
                    "preprocessing_nl_rule": "Default to UNKNOWN when status is null",
                    "description": "Account status with fallback default",
                    "data_type": "VARCHAR(50)",
                },
                "ACCOUNT_KEY": {
                    "source_attributes": [
                        "FOCUS_RAW_DB.RAW_ACCOUNT_BILLING.DS_IBT_ACCOUNTS.ACCT_ID"
                    ],
                    "preprocessing_rule": "MD5(CAST(ACCT_ID AS VARCHAR))",
                    "preprocessing_rule_type": "Custom",
                    "preprocessing_nl_rule": "Surrogate key as the MD5 hash of the account id",
                    "description": "Surrogate key from account id",
                    "data_type": "VARCHAR(32)",
                },
            },
            "transformation_rules": [
                {
                    "target_attribute": "FULL_NAME",
                    "rule": "CONCAT(FIRST_NAME, ' ', LAST_NAME)",
                    "description": "Concatenate first and last name with a space",
                },
                {
                    "target_attribute": "ACCOUNT_STATUS",
                    "rule": "COALESCE(STATUS, 'UNKNOWN')",
                    "description": "Default to UNKNOWN when status is null",
                },
                {
                    "target_attribute": "ACCOUNT_KEY",
                    "rule": "MD5(CAST(ACCT_ID AS VARCHAR))",
                    "description": "Surrogate key from account id",
                },
            ],
        },
        "warnings": [],
        "error": None,
        "meta": {
            "transport": "workbench_standard_envelope",
        },
    }


def build_prompt(payload: dict[str, Any]) -> str:
    return (
        "You are being called by the BBI AI Migration Workbench.\n"
        "The JSON below already uses the standard workbench payload envelope.\n"
        "Treat envelope.data as the authoritative test-case generation request.\n"
        "Use data.validated_sql as the validated transformation SQL for reasoning.\n"
        "Return ONLY JSON.\n"
        "Preferred response shape: the same standard envelope with contract_version='1.0', "
        "the same request_id, operation='test_cases.generate', and the generated artifacts in data.\n"
        "Inside data include: status, domain_name, target_layer, materialization, target_model, "
        "target_table, test_groups, seed_files, and test_case_document.\n"
        "If your runtime insists on the legacy raw JSON object, return that raw JSON only and do not add markdown fences.\n\n"
        + json.dumps(payload, indent=2)
    )


def main() -> None:
    env = load_env(ENV_FILE)
    agent_name = env.get("SNOWFLAKE_TEST_CASE_GENERATION_AGENT") or (
        f"{env['SNOWFLAKE_DATABASE']}.{env['SNOWFLAKE_SCHEMA']}.AGT_DBT_TEST_GENERATION"
    )
    print(f"Using agent: {agent_name}", flush=True)
    request_payload = build_request_payload()
    request_body = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": build_prompt(request_payload),
                    }
                ],
            }
        ]
    }

    print("Opening Snowflake connection...", flush=True)
    conn = snowflake.connector.connect(
        account=env["SNOWFLAKE_ACCOUNT"],
        user=env["SNOWFLAKE_USER"],
        password=env["SNOWFLAKE_PASSWORD"],
        role=env["SNOWFLAKE_ROLE"],
        database=env["SNOWFLAKE_DATABASE"],
        schema=env["SNOWFLAKE_SCHEMA"],
        warehouse=env["SNOWFLAKE_WAREHOUSE"],
        login_timeout=30,
        network_timeout=360,
    )
    try:
        cursor = conn.cursor()
        cursor.execute("ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = 300")
        print("Connected. Invoking agent...", flush=True)
        cursor.execute(
            "SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN(%s, %s)",
            (agent_name, json.dumps(request_body)),
        )
        row = cursor.fetchone()
    finally:
        conn.close()

    result = (row[0] or "") if row else ""
    print("Agent call completed.", flush=True)
    print(result[:12000])
    try:
        raw_payload = json.loads(result)
        parser = TestCaseGenerationService.__new__(TestCaseGenerationService)
        parser._agent_name = agent_name  # type: ignore[attr-defined]
        parsed, _, _, _ = parser._parse_response("", raw_payload=raw_payload)  # type: ignore[attr-defined]
        print(
            json.dumps(
                {
                    "status": parsed.status,
                    "target_model": parsed.target_model,
                    "test_group_count": len(parsed.test_groups),
                    "seed_file_count": len(parsed.seed_files),
                    "test_case_count": len(parsed.test_case_document),
                },
                indent=2,
            )
        )
    except Exception as exc:
        print(f"Parser summary failed: {exc}", flush=True)


if __name__ == "__main__":
    main()
