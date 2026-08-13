#!/usr/bin/env python3
"""Report rolling Workbench latency and Snowflake credit baselines.

This command is deliberately read-only. It uses the same client.env connection
configuration as the FIR learning utility and reads Snowflake ACCOUNT_USAGE.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "services" / "sttm-builder"
DEFAULT_ENV = ROOT / "infra" / "snowflake" / "env" / "client.env"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.core.config import Settings
from app.core.snowflake import get_local_cached_client


def _settings_and_session(env_file: str):
    path = Path(env_file).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Client environment file not found: {path}")
    settings = Settings(
        _env_file=str(path),
        app_env="local",
        local_dev_auth_enabled=True,
        spcs_execute_as_caller_enabled=False,
        datahub_enabled=False,
    )
    if not settings.local_dev_uses_externalbrowser and not settings.snowflake_password:
        raise ValueError(
            "Set SNOWFLAKE_AUTHENTICATOR=externalbrowser or SNOWFLAKE_PASSWORD."
        )
    return settings, get_local_cached_client(settings).session


def _rows(session: Any, statement: str, params: list[Any]) -> list[dict[str, Any]]:
    return [
        row.as_dict() if hasattr(row, "as_dict") else dict(row)
        for row in session.sql(statement, params=params).collect()
    ]


def collect_report(session: Any, settings: Settings, days: int) -> dict[str, Any]:
    latency = _rows(
        session,
        """
        WITH tagged AS (
          SELECT
            TRY_PARSE_JSON(QUERY_TAG) AS TAG,
            TOTAL_ELAPSED_TIME,
            COMPILATION_TIME,
            EXECUTION_TIME,
            QUEUED_PROVISIONING_TIME,
            QUEUED_OVERLOAD_TIME,
            BYTES_SCANNED
          FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
          WHERE START_TIME >= DATEADD('day', -?, CURRENT_TIMESTAMP())
            AND QUERY_TAG IS NOT NULL
        )
        SELECT
          COALESCE(TAG:workload::STRING, 'untagged') AS WORKLOAD,
          COUNT(*) AS QUERY_COUNT,
          ROUND(AVG(TOTAL_ELAPSED_TIME), 1) AS AVG_TOTAL_MS,
          ROUND(APPROX_PERCENTILE(TOTAL_ELAPSED_TIME, 0.50), 1) AS P50_TOTAL_MS,
          ROUND(APPROX_PERCENTILE(TOTAL_ELAPSED_TIME, 0.95), 1) AS P95_TOTAL_MS,
          ROUND(AVG(COMPILATION_TIME), 1) AS AVG_COMPILE_MS,
          ROUND(AVG(EXECUTION_TIME), 1) AS AVG_EXECUTION_MS,
          ROUND(AVG(QUEUED_PROVISIONING_TIME), 1) AS AVG_PROVISIONING_MS,
          ROUND(AVG(QUEUED_OVERLOAD_TIME), 1) AS AVG_OVERLOAD_MS,
          SUM(BYTES_SCANNED) AS BYTES_SCANNED
        FROM tagged
        WHERE TAG:app::STRING = ?
        GROUP BY 1
        ORDER BY 1
        """,
        [days, settings.app_name],
    )

    warehouses = sorted(
        {
            value.strip().upper()
            for value in (
                settings.snowflake_control_warehouse,
                settings.snowflake_agent_warehouse,
                settings.snowflake_execution_warehouse,
                settings.auto_mapping_warehouse,
                settings.snowflake_preparation_warehouse,
                settings.snowflake_warehouse,
            )
            if str(value or "").strip()
        }
    )
    credits: list[dict[str, Any]] = []
    if warehouses:
        placeholders = ", ".join("?" for _ in warehouses)
        credits = _rows(
            session,
            f"""
            SELECT
              WAREHOUSE_NAME,
              ROUND(SUM(CREDITS_USED), 4) AS CREDITS_USED,
              ROUND(SUM(CREDITS_USED_COMPUTE), 4) AS COMPUTE_CREDITS,
              ROUND(SUM(CREDITS_USED_CLOUD_SERVICES), 4) AS CLOUD_SERVICES_CREDITS
            FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
            WHERE START_TIME >= DATEADD('day', -?, CURRENT_TIMESTAMP())
              AND UPPER(WAREHOUSE_NAME) IN ({placeholders})
            GROUP BY 1
            ORDER BY 1
            """,
            [days, *warehouses],
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_days": days,
        "application": settings.app_name,
        "latency_by_workload": latency,
        "warehouse_credits": credits,
        "notes": [
            "ACCOUNT_USAGE can lag behind live activity.",
            "Warehouse credits include every workload using the named warehouse.",
            "Keep Medium disabled unless PREPARATION improves p95 by at least 30% "
            "and credits per successful benchmark stay within the approved gate.",
        ],
    }


def _index(rows: list[dict[str, Any]], key: str) -> dict[str, dict[str, Any]]:
    return {str(row.get(key, "")).upper(): row for row in rows}


def compare_reports(current: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    comparisons: list[dict[str, Any]] = []
    old = _index(baseline.get("latency_by_workload", []), "WORKLOAD")
    for row in current.get("latency_by_workload", []):
        workload = str(row.get("WORKLOAD", "")).upper()
        previous = old.get(workload)
        if not previous:
            continue
        before = float(previous.get("P95_TOTAL_MS") or 0)
        after = float(row.get("P95_TOTAL_MS") or 0)
        comparisons.append(
            {
                "workload": workload.lower(),
                "baseline_p95_ms": before,
                "current_p95_ms": after,
                "p95_change_percent": (
                    round(((after - before) / before) * 100, 2) if before else None
                ),
            }
        )
    return {"latency": comparisons}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=str(DEFAULT_ENV))
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--output", help="Optional JSON output path")
    parser.add_argument("--compare", help="Optional previous report JSON")
    args = parser.parse_args()
    if args.days < 1 or args.days > 90:
        parser.error("--days must be between 1 and 90")

    settings, session = _settings_and_session(args.env_file)
    report = collect_report(session, settings, args.days)
    if args.compare:
        baseline = json.loads(Path(args.compare).expanduser().read_text())
        report["comparison"] = compare_reports(report, baseline)
    rendered = json.dumps(report, indent=2, default=str)
    if args.output:
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered + "\n")
        print(f"Performance report written to {output}")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
