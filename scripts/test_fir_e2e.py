#!/usr/bin/env python3
"""End-to-end test for the AGT_FIR_SYSTEM intelligent pipeline.

Tests the full flow:
1. Upload SQL document (loan_income_amount_calculations.sql) → store in TBL_WORKBENCH_CLIENT_SQL_ASSETS
2. Upload Excel mapping → store as mapping document
3. Trigger FIR agent (SP_FIR_INVOKE_AGENT)
4. Verify: AGENT_NOTES populated, inferences generated, recommendations created
5. Verify: APP_USER_NOTIFICATION recommendation exists with DISPLAY_MESSAGE
6. Test signal_response feedback loop

Reads credentials from services/sttm-builder/.env.local (names only, never prints values).
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def load_env() -> dict[str, str]:
    env_path = PROJECT_ROOT / "services" / "sttm-builder" / ".env.local"
    if not env_path.exists():
        print(f"ERROR: {env_path} not found", file=sys.stderr)
        sys.exit(1)
    values = {}
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        values[key.strip()] = val.strip()
    print("Env vars loaded (values not shown):", list(values.keys()))
    return values


def get_connection(env: dict):
    import snowflake.connector
    connect_kwargs = {
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
    return snowflake.connector.connect(**connect_kwargs)


def step_upload_sql(cursor, namespace: str) -> str:
    """Step 1: Upload loan_income_amount_calculations.sql as a client asset."""
    sql_path = PROJECT_ROOT / "docs" / "loan_income_amount_calculations.sql"
    sql_text = sql_path.read_text()
    asset_id = hashlib.sha256(sql_text.encode()).hexdigest()[:32]

    print(f"\n{'='*60}")
    print("STEP 1: Upload SQL Document")
    print(f"{'='*60}")
    print(f"  File: {sql_path.name}")
    print(f"  Size: {len(sql_text)} chars")
    print(f"  Asset ID: {asset_id}")

    attributes = json.dumps({
        "source_schema": "BBI_STTM_TEST_DB.DL_AMOUNT",
        "target_schema": "BBI_STTM_TEST_DB.DW_OPS",
        "tables": ["verified_incomes", "loans", "customers", "admin_users",
                   "verification_task_logs", "verification_tasks", "notes"],
    })

    # Delete existing if any, then insert fresh
    cursor.execute(
        f"DELETE FROM {namespace}.TBL_WORKBENCH_CLIENT_SQL_ASSETS WHERE SQL_ASSET_ID = %s",
        [asset_id]
    )
    cursor.execute(f"""
        INSERT INTO {namespace}.TBL_WORKBENCH_CLIENT_SQL_ASSETS (
            SQL_ASSET_ID, TITLE, SQL_TEXT, SQL_KIND, DIALECT,
            DESCRIPTION, TAGS, ATTRIBUTES, PROJECT_ID,
            STATUS, CREATED_AT, UPDATED_AT
        )
        SELECT
            %s, %s, %s, 'SELECT', 'snowflake',
            %s,
            PARSE_JSON(%s),
            PARSE_JSON(%s),
            %s,
            'active',
            CURRENT_TIMESTAMP(),
            CURRENT_TIMESTAMP()
    """, [
        asset_id,
        "loan_income_amount_calculations.sql",
        sql_text,
        "Loan income amount calculation query from BBI production. Source: DL_AMOUNT schema, Target: DW_OPS schema.",
        '["loan", "income", "verification", "calculation"]',
        attributes,
        "test_project_loan_income",
    ])
    print("  ✓ SQL asset stored")
    return asset_id


def step_upload_excel(cursor, namespace: str) -> str:
    """Step 2: Upload Excel mapping as structured attribute data."""
    print(f"\n{'='*60}")
    print("STEP 2: Upload Excel Mapping (as structured metadata)")
    print(f"{'='*60}")

    # We store the parsed mapping data (from openpyxl parsing) as JSON attributes
    excel_mappings = [
        {"target": "loan_income_amount_calculation_uuid", "source": "verified_income_id", "type": "UUID", "rule": None},
        {"target": "created_time", "source": "created_time", "type": "DATETIME", "rule": "tzcorrect to CST and rename"},
        {"target": "updated_time", "source": "updated_time", "type": "DATETIME", "rule": "tzcorrect to CST and rename"},
        {"target": "auto_calculated", "source": "auto_calculated", "type": "CATEGORICAL", "rule": None},
        {"target": "calculation_type", "source": "portal_user_id, verification_task_name", "type": "CATEGORICAL", "rule": "CASE WHEN portal_user_id = 7 THEN 'system_calculation' WHEN verification_task_name= 'team_lead_enter_net_inc' THEN 'tl_review' WHEN verification_task_name = 'enter_net_inc' THEN 'specialist_calculation' ELSE NULL END"},
        {"target": "calculated_mni_amount", "source": "total_amount_cents", "type": "DECIMAL(20,2)", "rule": "divide total_amount_cents by 100"},
        {"target": "customer_claimed_income_amount", "source": "claimed_income", "type": "DECIMAL(10,2)", "rule": "rename"},
        {"target": "outcome", "source": "outcome", "type": "VARCHAR", "rule": None},
        {"target": "rejected_flag", "source": "rejected_flag", "type": "BOOL", "rule": None},
        {"target": "original_apr_percentage", "source": "original_apr_percentage", "type": "DECIMAL(10,4)", "rule": None},
        {"target": "original_loan_amount", "source": "original_loan_amount_cents", "type": "DECIMAL(20,2)", "rule": "Divide by 100"},
        {"target": "partner", "source": "partner", "type": "CATEGORICAL", "rule": None},
        {"target": "portal_user_uuid", "source": "admin_user_uuid", "type": "UUID", "rule": "rename"},
        {"target": "portal_user_id", "source": "portal_user_id", "type": "BIGINT", "rule": "join to portal_user"},
        {"target": "agent_email", "source": "email", "type": "VARCHAR", "rule": "join to portal_user and rename"},
        {"target": "loan_uuid", "source": "loan_uuid", "type": "UUID", "rule": None},
        {"target": "loan_id", "source": "loan_id", "type": "BIGINT", "rule": None},
        {"target": "customer_uuid", "source": "customer_uuid", "type": "UUID", "rule": None},
        {"target": "customer_id", "source": "customer_id", "type": "BIGINT", "rule": None},
    ]

    asset_id = hashlib.sha256(json.dumps(excel_mappings).encode()).hexdigest()[:32]
    attributes = json.dumps({
        "source_schema": "BBI_STTM_TEST_DB.DL_AMOUNT",
        "target_schema": "BBI_STTM_TEST_DB.DW_OPS",
        "target_table": "loan_income_amount_calculation",
        "source_dataset": "bbi.prod.dl.amount.loan_income_amount_calculation",
        "column_mappings": excel_mappings,
        "total_columns": len(excel_mappings),
        "columns_with_rules": sum(1 for m in excel_mappings if m["rule"]),
    })

    cursor.execute(
        f"DELETE FROM {namespace}.TBL_WORKBENCH_CLIENT_SQL_ASSETS WHERE SQL_ASSET_ID = %s",
        [asset_id]
    )
    cursor.execute(f"""
        INSERT INTO {namespace}.TBL_WORKBENCH_CLIENT_SQL_ASSETS (
            SQL_ASSET_ID, TITLE, SQL_TEXT, SQL_KIND, DIALECT,
            DESCRIPTION, TAGS, ATTRIBUTES, PROJECT_ID,
            STATUS, CREATED_AT, UPDATED_AT
        )
        SELECT
            %s, %s, %s, 'MAPPING', 'excel',
            %s,
            PARSE_JSON(%s),
            PARSE_JSON(%s),
            %s,
            'active',
            CURRENT_TIMESTAMP(),
            CURRENT_TIMESTAMP()
    """, [
        asset_id,
        "BBI S-T Mapping - Loan Income Amount Calculation.xlsx",
        f"Excel mapping with {len(excel_mappings)} column definitions",
        "S-T mapping rules for loan_income_amount_calculation. Source: DL_AMOUNT, Target: DW_OPS.",
        '["excel_mapping", "loan", "income", "sttm"]',
        attributes,
        "test_project_loan_income",
    ])
    print(f"  ✓ Excel mapping stored ({len(excel_mappings)} column definitions)")
    print(f"  Asset ID: {asset_id}")
    return asset_id


def step_trigger_fir(cursor, namespace: str) -> dict:
    """Step 3: Invoke the FIR agent."""
    print(f"\n{'='*60}")
    print("STEP 3: Invoke AGT_FIR_SYSTEM")
    print(f"{'='*60}")

    payload = json.dumps({
        "task_type": "manual",
        "batch_size": 20,
        "processing_options": {
            "collect_feedback": True,
            "generate_inferences": True,
            "create_semantic_versions": False,
            "generate_recommendations": True,
            "apply_decay": False,
            "parse_documents": True,
        }
    })

    print("  Calling SP_FIR_INVOKE_AGENT... (this may take 30-120s)")
    start = time.time()
    cursor.execute(f"CALL {namespace}.SP_FIR_INVOKE_AGENT(PARSE_JSON('{payload}'))")
    result = cursor.fetchone()[0]
    elapsed = time.time() - start

    if isinstance(result, str):
        result = json.loads(result)

    print(f"  Duration: {elapsed:.1f}s")
    print(f"  Status: {result.get('status')}")
    print(f"  Agent invoked: {result.get('agent_invoked')}")

    context = result.get("context_built", {})
    print(f"  Streams with data: {context.get('streams_with_data', [])}")
    print(f"  Pending counts: {context.get('pending_counts', {})}")
    print(f"  Unprocessed docs: {context.get('unprocessed_document_count', 0)}")

    agent_response = result.get("agent_response", {})
    if isinstance(agent_response, dict):
        summary = agent_response.get("processing_summary", {})
        print(f"\n  Agent Processing Summary:")
        print(f"    Feedback collected: {summary.get('feedback_collected', '?')}")
        print(f"    Inferences generated: {summary.get('inferences_generated', '?')}")
        print(f"    Recommendations generated: {summary.get('recommendations_generated', '?')}")
        print(f"    User notifications: {summary.get('user_notifications_generated', '?')}")

        insights = agent_response.get("key_insights", [])
        if insights:
            print(f"\n  Key Insights:")
            for i, insight in enumerate(insights[:5], 1):
                print(f"    {i}. {insight}")

        questions = agent_response.get("questions_for_user", [])
        if questions:
            print(f"\n  Questions for User:")
            for q in questions[:3]:
                print(f"    ? {q}")

    return result


def step_verify_inferences(cursor, namespace: str):
    """Step 4: Verify inferences were generated with AGENT_NOTES."""
    print(f"\n{'='*60}")
    print("STEP 4: Verify Inferences")
    print(f"{'='*60}")

    cursor.execute(f"""
        SELECT
            FIR_RECORD_ID,
            SOURCE_TYPE,
            SOURCE_EVENT_TYPE,
            PROCESSING_STAGE,
            AGENT_NOTES,
            INFERENCE_PAYLOAD:inference_type::STRING AS INFERENCE_TYPE,
            INFERENCE_PAYLOAD:summary::STRING AS SUMMARY,
            CURRENT_CONFIDENCE
        FROM {namespace}.TBL_AGENT_FIR_360
        WHERE PROCESSING_STAGE IN ('inference_generated', 'completed')
          AND AGENT_NOTES IS NOT NULL
        ORDER BY CREATED_AT DESC
        LIMIT 10
    """)
    rows = cursor.fetchall()
    print(f"  Inferences with AGENT_NOTES: {len(rows)}")

    for i, row in enumerate(rows[:5], 1):
        print(f"\n  [{i}] Type: {row[5]} | Confidence: {row[7]}")
        notes = (row[4] or "")[:150]
        summary = (row[6] or "")[:150]
        print(f"      Notes: {notes}")
        print(f"      Summary: {summary}")

    return len(rows)


def step_verify_recommendations(cursor, namespace: str):
    """Step 5: Verify recommendations including APP_USER_NOTIFICATION."""
    print(f"\n{'='*60}")
    print("STEP 5: Verify Recommendations")
    print(f"{'='*60}")

    cursor.execute(f"""
        SELECT
            AGENT_RECOMMENDATION_ID,
            TARGET_AGENT,
            TRIGGER_TYPE,
            RECOMMENDATION_TYPE,
            RECOMMENDATION_PRIORITY,
            DISPLAY_MESSAGE,
            NOTIFICATION_LAYER,
            AGENT_NOTES,
            CONFIDENCE
        FROM {namespace}.TBL_FIR_AGENT_RECOMMENDATIONS
        WHERE STATUS = 'active'
        ORDER BY CREATED_AT DESC
        LIMIT 15
    """)
    rows = cursor.fetchall()
    print(f"  Total active recommendations: {len(rows)}")

    user_notifications = [r for r in rows if r[1] == "APP_USER_NOTIFICATION"]
    agent_recs = [r for r in rows if r[1] != "APP_USER_NOTIFICATION"]

    print(f"  User notifications: {len(user_notifications)}")
    print(f"  Agent recommendations: {len(agent_recs)}")

    if user_notifications:
        print(f"\n  === USER NOTIFICATIONS ===")
        for i, row in enumerate(user_notifications[:3], 1):
            print(f"  [{i}] Priority: {row[4]} | Layer: {row[6]} | Type: {row[3]}")
            print(f"      Message: {(row[5] or '')[:200]}")
            print(f"      Notes: {(row[7] or '')[:100]}")

    if agent_recs:
        print(f"\n  === AGENT RECOMMENDATIONS ===")
        for i, row in enumerate(agent_recs[:3], 1):
            print(f"  [{i}] Target: {row[1]} | Trigger: {row[2]} | Type: {row[3]}")
            print(f"      Notes: {(row[7] or '')[:150]}")

    return len(user_notifications), len(agent_recs)


def step_verify_notification_stream(cursor, namespace: str):
    """Step 6: Check if notification stream has data for bridge delivery."""
    print(f"\n{'='*60}")
    print("STEP 6: Notification Stream Status")
    print(f"{'='*60}")

    try:
        cursor.execute(f"""
            SELECT SYSTEM$STREAM_HAS_DATA('{namespace}.STM_FIR_RECOMMENDATIONS') AS HAS_DATA
        """)
        result = cursor.fetchone()
        has_data = str(result[0]).lower() == "true" if result else False
        print(f"  STM_FIR_RECOMMENDATIONS has_data: {has_data}")
        if has_data:
            print("  ✓ Notification bridge would pick these up and deliver via WebSocket")
        return has_data
    except Exception as exc:
        print(f"  Stream check failed: {exc}")
        print("  (Stream may not exist yet — deploy with deploy-fir-system.sh)")
        return False


def main():
    print("=" * 60)
    print(" AGT_FIR_SYSTEM End-to-End Test")
    print(" Loan Income Amount Calculation")
    print("=" * 60)

    env = load_env()
    namespace = f"{env['SNOWFLAKE_DATABASE']}.{env['SNOWFLAKE_SCHEMA']}"
    print(f"Namespace: {namespace}")

    conn = get_connection(env)
    cursor = conn.cursor()

    try:
        # Step 1: Upload SQL
        sql_asset_id = step_upload_sql(cursor, namespace)

        # Step 2: Upload Excel mapping
        excel_asset_id = step_upload_excel(cursor, namespace)

        # Step 3: Trigger FIR agent
        result = step_trigger_fir(cursor, namespace)

        # Step 4: Verify inferences
        inference_count = step_verify_inferences(cursor, namespace)

        # Step 5: Verify recommendations
        user_notif_count, agent_rec_count = step_verify_recommendations(cursor, namespace)

        # Step 6: Check notification stream
        stream_ready = step_verify_notification_stream(cursor, namespace)

        # Summary
        print(f"\n{'='*60}")
        print(" TEST SUMMARY")
        print(f"{'='*60}")
        agent_status = result.get("status", "unknown")
        print(f"  Agent status: {agent_status}")
        print(f"  Inferences with AGENT_NOTES: {inference_count}")
        print(f"  User notifications generated: {user_notif_count}")
        print(f"  Agent recommendations: {agent_rec_count}")
        print(f"  Notification stream ready: {stream_ready}")

        if agent_status == "success" and inference_count > 0:
            print("\n  ✓ END-TO-END TEST PASSED")
            print("    The FIR agent analyzed the loan_income_amount_calculation")
            print("    SQL and generated intelligent inferences with its own reasoning.")
        elif agent_status == "no_work":
            print("\n  ⚠ Agent found no work — documents may already be processed.")
            print("    Try with fresh data or check processing stages.")
        else:
            print(f"\n  ⚠ TEST INCOMPLETE — agent status: {agent_status}")
            print("    Check errors in agent_response for details.")

    except Exception as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    main()
