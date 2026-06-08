#!/usr/bin/env python3
"""Seed deterministic mock data into BBI_STTM_TEST_DB for richer semantic context."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime

import snowflake.connector


def connect():
    kwargs = {
        "account": os.environ["SNOWFLAKE_ACCOUNT"],
        "user": os.environ["SNOWFLAKE_USER"],
        "warehouse": os.environ["SNOWFLAKE_WAREHOUSE"],
        "database": os.environ["SNOWFLAKE_DATABASE"],
        "schema": os.environ["SNOWFLAKE_SCHEMA"],
        "role": os.environ["SNOWFLAKE_ROLE"],
    }
    authenticator = (os.environ.get("SNOWFLAKE_AUTHENTICATOR") or "").strip().lower()
    if authenticator == "externalbrowser":
        kwargs["authenticator"] = "externalbrowser"
    else:
        kwargs["password"] = os.environ["SNOWFLAKE_PASSWORD"]
    host = (os.environ.get("SNOWFLAKE_HOST") or "").strip()
    if host:
        kwargs["host"] = host
    return snowflake.connector.connect(**kwargs)


def sql_literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, datetime):
        return f"TO_TIMESTAMP_NTZ('{value.strftime('%Y-%m-%d %H:%M:%S')}')"
    if isinstance(value, dict):
        payload = json.dumps(value, separators=(",", ":"), ensure_ascii=True).replace("'", "''")
        return f"PARSE_JSON('{payload}')"
    text = str(value).replace("'", "''")
    return f"'{text}'"


def merge_rows(cursor, *, table: str, key_columns: list[str], rows: list[dict[str, object]]) -> None:
    if not rows:
        return
    columns = list(rows[0].keys())
    union_rows = []
    for row in rows:
        select_list = [f"{sql_literal(row[column])} AS {column}" for column in columns]
        union_rows.append("SELECT " + ", ".join(select_list))
    source_sql = "\nUNION ALL\n".join(union_rows)
    key_match = " AND ".join([f"target.{column} = source.{column}" for column in key_columns])
    update_assignments = ", ".join([f"{column} = source.{column}" for column in columns if column not in key_columns])
    insert_columns = ", ".join(columns)
    insert_values = ", ".join([f"source.{column}" for column in columns])
    sql = f"""
    MERGE INTO {table} AS target
    USING (
      {source_sql}
    ) AS source
    ON {key_match}
    WHEN MATCHED THEN UPDATE SET {update_assignments}
    WHEN NOT MATCHED THEN INSERT ({insert_columns}) VALUES ({insert_values})
    """
    cursor.execute(sql)


DL_AMOUNT_ROWS = [
    {
        "VERIFIED_INCOME_ID": "vi_bbi_1001",
        "CREATED_TIME": "2026-05-01 09:15:00",
        "UPDATED_TIME": datetime(2026, 5, 1, 10, 0, 0),
        "AUTO_CALCULATED": "FALSE",
        "PORTAL_USER_ID": 7001,
        "VERIFICATION_TASK_NAME": "enter_net_inc",
        "TOTAL_AMOUNT_CENTS": "573077",
        "CLAIMED_INCOME": 6100,
        "DATA": {
            "result": "5730.77",
            "incomeSources": [
                {
                    "incomeType": "customer",
                    "frequency": "biweekly",
                    "deposits": [
                        {"id": "dep_1001_a", "amount": "2644.97"},
                        {"id": "dep_1001_b", "amount": "2644.97"},
                    ],
                }
            ],
            "validIncomesCount": 1,
        },
        "OUTCOME": "approved",
        "REJECTED_FLAG": False,
        "ORIGINAL_APR_PERCENTAGE": 18.9900,
        "ORIGINAL_LOAN_AMOUNT_PENNIES": 1550000,
        "ORIGINAL_TERM": 48,
        "PARTNER": "bbi",
        "LOAN_UUID": "loan_uuid_1001",
        "LOAN_ID": 9001001,
        "CUSTOMER_APPLICATION_UUID": "cust_app_uuid_1001",
        "CUSTOMER_APPLICATION_ID": 8801001,
        "CUSTOMER_UUID": "cust_uuid_1001",
        "CUSTOMER_ID": 7701001,
        "REVIEWED_BY_CALC_ID": None,
        "REVIEWED_CALC_ID": None,
        "ERROR_REASON_FLAG": False,
        "ERROR_REASON": None,
        "SIMULATED_TERMS_FLAG": False,
        "SIMULATED_TERMS": None,
        "SIMULATED_TERMS_TABLE": None,
        "ADMIN_USER_UUID": "admin_uuid_7001",
        "LEGACY_SYSTEM_ID": 101,
    },
    {
        "VERIFIED_INCOME_ID": "vi_bbi_1002",
        "CREATED_TIME": "2026-05-03 11:00:00",
        "UPDATED_TIME": datetime(2026, 5, 3, 12, 30, 0),
        "AUTO_CALCULATED": "FALSE",
        "PORTAL_USER_ID": 7002,
        "VERIFICATION_TASK_NAME": "team_lead_enter_net_inc",
        "TOTAL_AMOUNT_CENTS": "421540",
        "CLAIMED_INCOME": 4500,
        "DATA": {
            "result": "4215.40",
            "exists": True,
            "monthly_net": 4215.40,
            "monthly_gross": 5032.00,
            "reviewReason": "Team lead discrepancy review",
        },
        "OUTCOME": "manual_review",
        "REJECTED_FLAG": False,
        "ORIGINAL_APR_PERCENTAGE": 24.5000,
        "ORIGINAL_LOAN_AMOUNT_PENNIES": 920000,
        "ORIGINAL_TERM": 36,
        "PARTNER": "bbi",
        "LOAN_UUID": "loan_uuid_1002",
        "LOAN_ID": 9001002,
        "CUSTOMER_APPLICATION_UUID": "cust_app_uuid_1002",
        "CUSTOMER_APPLICATION_ID": 8801002,
        "CUSTOMER_UUID": "cust_uuid_1002",
        "CUSTOMER_ID": 7701002,
        "REVIEWED_BY_CALC_ID": "calc_review_1002",
        "REVIEWED_CALC_ID": "calc_1002",
        "ERROR_REASON_FLAG": True,
        "ERROR_REASON": "Income variance requires team lead note",
        "SIMULATED_TERMS_FLAG": True,
        "SIMULATED_TERMS": {"new_term": 48, "new_monthly_payment": 282.14},
        "SIMULATED_TERMS_TABLE": {"36": 315.12, "48": 282.14, "60": 260.88},
        "ADMIN_USER_UUID": "admin_uuid_7002",
        "LEGACY_SYSTEM_ID": 102,
    },
    {
        "VERIFIED_INCOME_ID": "vi_bbi_1003",
        "CREATED_TIME": "2026-05-06 08:45:00",
        "UPDATED_TIME": datetime(2026, 5, 6, 8, 59, 0),
        "AUTO_CALCULATED": "TRUE",
        "PORTAL_USER_ID": 7,
        "VERIFICATION_TASK_NAME": "system_auto_run",
        "TOTAL_AMOUNT_CENTS": "758605",
        "CLAIMED_INCOME": 8000,
        "DATA": {
            "exists": True,
            "twn_income": 7586.05,
            "monthly_net": 583.81,
            "monthly_gross": 632.17,
            "current_product_amount": 7600.00,
            "current_attempt_number": 1,
        },
        "OUTCOME": "rejected",
        "REJECTED_FLAG": True,
        "ORIGINAL_APR_PERCENTAGE": 29.7500,
        "ORIGINAL_LOAN_AMOUNT_PENNIES": 760000,
        "ORIGINAL_TERM": 24,
        "PARTNER": "bbi",
        "LOAN_UUID": "loan_uuid_1003",
        "LOAN_ID": 9001003,
        "CUSTOMER_APPLICATION_UUID": "cust_app_uuid_1003",
        "CUSTOMER_APPLICATION_ID": 8801003,
        "CUSTOMER_UUID": "cust_uuid_1003",
        "CUSTOMER_ID": 7701003,
        "REVIEWED_BY_CALC_ID": None,
        "REVIEWED_CALC_ID": "calc_1003",
        "ERROR_REASON_FLAG": True,
        "ERROR_REASON": "Documentation mismatch",
        "SIMULATED_TERMS_FLAG": False,
        "SIMULATED_TERMS": None,
        "SIMULATED_TERMS_TABLE": None,
        "ADMIN_USER_UUID": "admin_uuid_system",
        "LEGACY_SYSTEM_ID": 103,
    },
]

NOTE_ROWS = [
    {
        "NOTE_ID": 81001,
        "NOTE_TEXT": "Team lead reviewed the income amount and confirmed the monthly net income based on direct deposit cadence.",
        "NOTABLE_ID": 9001001,
        "NOTABLE_TYPE": "loan",
        "NOTE_TYPE": "Verifications",
        "ACTION": "Team Lead Review",
        "ACTIVITY": "Income Amount",
        "CREATED_TIME": datetime(2026, 5, 1, 10, 5, 0),
        "UPDATED_TIME": datetime(2026, 5, 1, 10, 7, 0),
        "AUTHOR_ID": 7001,
    },
    {
        "NOTE_ID": 81002,
        "NOTE_TEXT": "Team lead identified an income calculation discrepancy and asked for documentation follow-up before approving mapping.",
        "NOTABLE_ID": 9001002,
        "NOTABLE_TYPE": "loan",
        "NOTE_TYPE": "Verifications",
        "ACTION": "Team Lead Review",
        "ACTIVITY": "Team Lead Identify Income Calculation Error",
        "CREATED_TIME": datetime(2026, 5, 3, 12, 10, 0),
        "UPDATED_TIME": datetime(2026, 5, 3, 12, 15, 0),
        "AUTHOR_ID": 7002,
    },
    {
        "NOTE_ID": 81003,
        "NOTE_TEXT": "Documentation error: the uploaded proof of income did not match the customer-entered amount.",
        "NOTABLE_ID": 9001003,
        "NOTABLE_TYPE": "loan",
        "NOTE_TYPE": "Verifications",
        "ACTION": "Document Review",
        "ACTIVITY": "Income Amount Documentation Error",
        "CREATED_TIME": datetime(2026, 5, 6, 9, 1, 0),
        "UPDATED_TIME": datetime(2026, 5, 6, 9, 2, 0),
        "AUTHOR_ID": 7,
    },
]

PORTAL_USER_HISTORY_ROWS = [
    {
        "PORTAL_USER_HISTORY_ID": 7001001,
        "PORTAL_USER_UUID": "admin_uuid_7001",
        "PORTAL_USER_ID": "7001",
        "EMAIL": "amy.specialist@bbi.test",
        "FIRST_NAME": "Amy",
        "LAST_NAME": "Specialist",
        "PARTNER": "bbi",
        "ROLE": "income_specialist",
        "IS_ACTIVE": True,
        "EFFECTIVE_TO": None,
        "CREATED_AT": datetime(2026, 1, 1, 8, 0, 0),
        "UPDATED_AT": datetime(2026, 5, 1, 8, 0, 0),
    },
    {
        "PORTAL_USER_HISTORY_ID": 7001002,
        "PORTAL_USER_UUID": "admin_uuid_7002",
        "PORTAL_USER_ID": "7002",
        "EMAIL": "trent.teamlead@bbi.test",
        "FIRST_NAME": "Trent",
        "LAST_NAME": "Lead",
        "PARTNER": "bbi",
        "ROLE": "team_lead",
        "IS_ACTIVE": True,
        "EFFECTIVE_TO": None,
        "CREATED_AT": datetime(2026, 1, 1, 8, 0, 0),
        "UPDATED_AT": datetime(2026, 5, 3, 8, 0, 0),
    },
    {
        "PORTAL_USER_HISTORY_ID": 7001003,
        "PORTAL_USER_UUID": "admin_uuid_system",
        "PORTAL_USER_ID": "7",
        "EMAIL": "system.auto@bbi.test",
        "FIRST_NAME": "System",
        "LAST_NAME": "Automation",
        "PARTNER": "bbi",
        "ROLE": "system",
        "IS_ACTIVE": True,
        "EFFECTIVE_TO": None,
        "CREATED_AT": datetime(2026, 1, 1, 8, 0, 0),
        "UPDATED_AT": datetime(2026, 5, 6, 8, 0, 0),
    },
]

DW_OPS_ROWS = [
    {
        "LOAN_INCOME_AMOUNT_CALCULATION_UUID": "vi_bbi_1001",
        "CREATED_TIME": datetime(2026, 5, 1, 9, 15, 0),
        "UPDATED_TIME": datetime(2026, 5, 1, 10, 0, 0),
        "AUTO_CALCULATED": "FALSE",
        "CALCULATION_TYPE": "specialist_calculation",
        "CALCULATED_MNI_AMOUNT": 5730.77,
        "CUSTOMER_CLAIMED_INCOME_AMOUNT": 6100.00,
        "DATA": json.dumps({"result": "5730.77", "incomeSourceCount": 1}),
        "OUTCOME": "approved",
        "REJECTED_FLAG": False,
        "ORIGINAL_APR_PERCENTAGE": 18.9900,
        "ORIGINAL_LOAN_AMOUNT": 15500.00,
        "ORIGINAL_TERM": 48,
        "PARTNER": "bbi",
        "PORTAL_USER_ID": 7001,
        "AGENT_EMAIL": "amy.specialist@bbi.test",
        "LOAN_UUID": "loan_uuid_1001",
        "LOAN_ID": 9001001,
        "LOAN_CUSTOMER_APPLICATION_UUID": "cust_app_uuid_1001",
        "LOAN_CUSTOMER_APPLICATION_ID": 8801001,
        "CUSTOMER_UUID": "cust_uuid_1001",
        "CUSTOMER_ID": 7701001,
        "REVIEWED_BY_CALCULATION_ID": None,
        "REVIEWED_CALCULATION_ID": None,
        "ERROR_REASON_FLAG": False,
        "ERROR_REASON": None,
        "DOC_ERROR_FLAG": False,
        "DOCUMENTATION_ERROR_NOTE": None,
        "TEAM_LEAD_INCOME_DISCREPANCY_ERROR_NOTE": None,
        "SIMULATED_TERMS_FLAG": False,
        "SIMULATED_TERMS_TABLE": None,
        "INCOME_REVIEW_DOCUMENT": "deposit_statement_march.pdf",
        "NOTE_ID": 81001,
    },
    {
        "LOAN_INCOME_AMOUNT_CALCULATION_UUID": "vi_bbi_1002",
        "CREATED_TIME": datetime(2026, 5, 3, 11, 0, 0),
        "UPDATED_TIME": datetime(2026, 5, 3, 12, 30, 0),
        "AUTO_CALCULATED": "FALSE",
        "CALCULATION_TYPE": "tl_review",
        "CALCULATED_MNI_AMOUNT": 4215.40,
        "CUSTOMER_CLAIMED_INCOME_AMOUNT": 4500.00,
        "DATA": json.dumps({"result": "4215.40", "reviewReason": "team lead discrepancy"}),
        "OUTCOME": "manual_review",
        "REJECTED_FLAG": False,
        "ORIGINAL_APR_PERCENTAGE": 24.5000,
        "ORIGINAL_LOAN_AMOUNT": 9200.00,
        "ORIGINAL_TERM": 36,
        "PARTNER": "bbi",
        "PORTAL_USER_ID": 7002,
        "AGENT_EMAIL": "trent.teamlead@bbi.test",
        "LOAN_UUID": "loan_uuid_1002",
        "LOAN_ID": 9001002,
        "LOAN_CUSTOMER_APPLICATION_UUID": "cust_app_uuid_1002",
        "LOAN_CUSTOMER_APPLICATION_ID": 8801002,
        "CUSTOMER_UUID": "cust_uuid_1002",
        "CUSTOMER_ID": 7701002,
        "REVIEWED_BY_CALCULATION_ID": "calc_review_1002",
        "REVIEWED_CALCULATION_ID": "calc_1002",
        "ERROR_REASON_FLAG": True,
        "ERROR_REASON": "Income variance requires review",
        "DOC_ERROR_FLAG": False,
        "DOCUMENTATION_ERROR_NOTE": None,
        "TEAM_LEAD_INCOME_DISCREPANCY_ERROR_NOTE": "Customer-entered income differs from payroll deposits; confirm the correct monthly amount before mapping.",
        "SIMULATED_TERMS_FLAG": True,
        "SIMULATED_TERMS_TABLE": {"36": 315.12, "48": 282.14, "60": 260.88},
        "INCOME_REVIEW_DOCUMENT": "payroll_register_april.pdf",
        "NOTE_ID": 81002,
    },
    {
        "LOAN_INCOME_AMOUNT_CALCULATION_UUID": "vi_bbi_1003",
        "CREATED_TIME": datetime(2026, 5, 6, 8, 45, 0),
        "UPDATED_TIME": datetime(2026, 5, 6, 8, 59, 0),
        "AUTO_CALCULATED": "TRUE",
        "CALCULATION_TYPE": "system_calculation",
        "CALCULATED_MNI_AMOUNT": 7586.05,
        "CUSTOMER_CLAIMED_INCOME_AMOUNT": 8000.00,
        "DATA": json.dumps({"twn_income": 7586.05, "monthly_net": 583.81}),
        "OUTCOME": "rejected",
        "REJECTED_FLAG": True,
        "ORIGINAL_APR_PERCENTAGE": 29.7500,
        "ORIGINAL_LOAN_AMOUNT": 7600.00,
        "ORIGINAL_TERM": 24,
        "PARTNER": "bbi",
        "PORTAL_USER_ID": 7,
        "AGENT_EMAIL": "system.auto@bbi.test",
        "LOAN_UUID": "loan_uuid_1003",
        "LOAN_ID": 9001003,
        "LOAN_CUSTOMER_APPLICATION_UUID": "cust_app_uuid_1003",
        "LOAN_CUSTOMER_APPLICATION_ID": 8801003,
        "CUSTOMER_UUID": "cust_uuid_1003",
        "CUSTOMER_ID": 7701003,
        "REVIEWED_BY_CALCULATION_ID": None,
        "REVIEWED_CALCULATION_ID": "calc_1003",
        "ERROR_REASON_FLAG": True,
        "ERROR_REASON": "Documentation mismatch",
        "DOC_ERROR_FLAG": True,
        "DOCUMENTATION_ERROR_NOTE": "The supporting income document did not align to the claimed amount and triggered rejection.",
        "TEAM_LEAD_INCOME_DISCREPANCY_ERROR_NOTE": None,
        "SIMULATED_TERMS_FLAG": False,
        "SIMULATED_TERMS_TABLE": None,
        "INCOME_REVIEW_DOCUMENT": "twn_verification_export.json",
        "NOTE_ID": 81003,
    },
]

WORKFLOW_SESSION_TYPE_ROWS = [
    {"WORKFLOW_SESSION_TYPE_ID": 501, "SESSION_TYPE_NAME": "income_verification", "WORKFLOW_TYPE": "verification", "IS_ACTIVE": True, "CREATED_AT": datetime(2026, 1, 1, 8, 0, 0)},
    {"WORKFLOW_SESSION_TYPE_ID": 502, "SESSION_TYPE_NAME": "team_lead_review", "WORKFLOW_TYPE": "review", "IS_ACTIVE": True, "CREATED_AT": datetime(2026, 1, 1, 8, 0, 0)},
]

WORKFLOW_SESSION_ROWS = [
    {"WORKFLOW_SESSION_ID": 6001, "WORKFLOW_SESSION_TYPE_ID": 501, "LOAN_ID": 9001001, "CUSTOMER_ID": 7701001, "SESSION_STATUS": "completed", "SESSION_STARTED_AT": "2026-05-01 09:15:00", "SESSION_COMPLETED_AT": datetime(2026, 5, 1, 10, 5, 0), "TOTAL_STEPS": 3, "PARTNER": "bbi", "CREATED_AT": datetime(2026, 5, 1, 9, 15, 0), "UPDATED_AT": datetime(2026, 5, 1, 10, 5, 0)},
    {"WORKFLOW_SESSION_ID": 6002, "WORKFLOW_SESSION_TYPE_ID": 502, "LOAN_ID": 9001002, "CUSTOMER_ID": 7701002, "SESSION_STATUS": "completed", "SESSION_STARTED_AT": "2026-05-03 11:00:00", "SESSION_COMPLETED_AT": datetime(2026, 5, 3, 12, 20, 0), "TOTAL_STEPS": 4, "PARTNER": "bbi", "CREATED_AT": datetime(2026, 5, 3, 11, 0, 0), "UPDATED_AT": datetime(2026, 5, 3, 12, 20, 0)},
]

WORKFLOW_STEP_ROWS = [
    {"WORKFLOW_STEP_ID": 6101, "WORKFLOW_SESSION_ID": 6001, "STEP_NAME": "collect_income_documents", "STEP_STATUS": "completed", "STEP_STARTED_AT": datetime(2026, 5, 1, 9, 15, 0), "STEP_COMPLETED_AT": datetime(2026, 5, 1, 9, 28, 0), "STEP_DURATION_SECONDS": 780.0, "LOAN_ID": 9001001, "PARTNER": "bbi", "CREATED_AT": datetime(2026, 5, 1, 9, 15, 0)},
    {"WORKFLOW_STEP_ID": 6102, "WORKFLOW_SESSION_ID": 6001, "STEP_NAME": "calculate_monthly_net_income", "STEP_STATUS": "completed", "STEP_STARTED_AT": datetime(2026, 5, 1, 9, 28, 0), "STEP_COMPLETED_AT": datetime(2026, 5, 1, 9, 53, 0), "STEP_DURATION_SECONDS": 1500.0, "LOAN_ID": 9001001, "PARTNER": "bbi", "CREATED_AT": datetime(2026, 5, 1, 9, 28, 0)},
    {"WORKFLOW_STEP_ID": 6201, "WORKFLOW_SESSION_ID": 6002, "STEP_NAME": "team_lead_compare_claimed_vs_verified_income", "STEP_STATUS": "completed", "STEP_STARTED_AT": datetime(2026, 5, 3, 11, 15, 0), "STEP_COMPLETED_AT": datetime(2026, 5, 3, 11, 55, 0), "STEP_DURATION_SECONDS": 2400.0, "LOAN_ID": 9001002, "PARTNER": "bbi", "CREATED_AT": datetime(2026, 5, 3, 11, 15, 0)},
]


def main() -> int:
    with connect() as connection, connection.cursor() as cursor:
        merge_rows(
            cursor,
            table="BBI_STTM_TEST_DB.DL_AMOUNT.LOAN_INCOME_AMOUNT_CALCULATION",
            key_columns=["VERIFIED_INCOME_ID"],
            rows=DL_AMOUNT_ROWS,
        )
        merge_rows(
            cursor,
            table="BBI_STTM_TEST_DB.DL_AMOUNT.NOTE",
            key_columns=["NOTE_ID"],
            rows=NOTE_ROWS,
        )
        merge_rows(
            cursor,
            table="BBI_STTM_TEST_DB.DW_OPS.PORTAL_USER_HISTORY",
            key_columns=["PORTAL_USER_HISTORY_ID"],
            rows=PORTAL_USER_HISTORY_ROWS,
        )
        merge_rows(
            cursor,
            table="BBI_STTM_TEST_DB.DW_OPS.LOAN_INCOME_AMOUNT_CALCULATION",
            key_columns=["LOAN_INCOME_AMOUNT_CALCULATION_UUID"],
            rows=DW_OPS_ROWS,
        )
        merge_rows(
            cursor,
            table="BBI_STTM_TEST_DB.DW_OPS.WORKFLOW_SESSION_TYPE",
            key_columns=["WORKFLOW_SESSION_TYPE_ID"],
            rows=WORKFLOW_SESSION_TYPE_ROWS,
        )
        merge_rows(
            cursor,
            table="BBI_STTM_TEST_DB.DW_OPS.WORKFLOW_SESSION",
            key_columns=["WORKFLOW_SESSION_ID"],
            rows=WORKFLOW_SESSION_ROWS,
        )
        merge_rows(
            cursor,
            table="BBI_STTM_TEST_DB.DW_OPS.WORKFLOW_STEP",
            key_columns=["WORKFLOW_STEP_ID"],
            rows=WORKFLOW_STEP_ROWS,
        )
        connection.commit()

        for label, table in [
            ("DL_AMOUNT.LOAN_INCOME_AMOUNT_CALCULATION", "BBI_STTM_TEST_DB.DL_AMOUNT.LOAN_INCOME_AMOUNT_CALCULATION"),
            ("DL_AMOUNT.NOTE", "BBI_STTM_TEST_DB.DL_AMOUNT.NOTE"),
            ("DW_OPS.PORTAL_USER_HISTORY", "BBI_STTM_TEST_DB.DW_OPS.PORTAL_USER_HISTORY"),
            ("DW_OPS.LOAN_INCOME_AMOUNT_CALCULATION", "BBI_STTM_TEST_DB.DW_OPS.LOAN_INCOME_AMOUNT_CALCULATION"),
            ("DW_OPS.WORKFLOW_SESSION", "BBI_STTM_TEST_DB.DW_OPS.WORKFLOW_SESSION"),
            ("DW_OPS.WORKFLOW_STEP", "BBI_STTM_TEST_DB.DW_OPS.WORKFLOW_STEP"),
        ]:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            print(f"{label}\t{count}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise
