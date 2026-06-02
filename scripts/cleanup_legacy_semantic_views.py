#!/usr/bin/env python3
"""List or drop legacy semantic views and analyst tools no longer referenced by active bundles."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = REPO_ROOT / "services" / "sttm-builder"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.core.config import Settings
from app.core.snowflake import get_local_cached_client


def _settings() -> Settings:
    return Settings(_env_file=str(APP_ROOT / ".env.local"), DATAHUB_ENABLED=False)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually drop stale legacy assets.")
    parser.add_argument("--include-analyst-tools", action="store_true", help="Also inspect ANALYST_SEM_* tools.")
    args = parser.parse_args()

    settings = _settings()
    session = get_local_cached_client(settings).session
    bundle_table = settings.snowflake_semantic_bundles_table
    semantic_schema = f"{settings.snowflake_database}.{settings.snowflake_schema}"

    active_view_rows = session.sql(
        f"""
        SELECT DISTINCT UPPER(SEMANTIC_VIEW_NAME) AS OBJECT_NAME
        FROM {bundle_table}
        WHERE COALESCE(SEMANTIC_VIEW_NAME, '') <> ''
        """
    ).collect()
    active_views = {str(row.as_dict()["OBJECT_NAME"]).strip() for row in active_view_rows}

    view_rows = session.sql(f"SHOW VIEWS LIKE 'SV_SEM_%' IN SCHEMA {semantic_schema}").collect()
    stale_views: list[str] = []
    for row in view_rows:
        data = row.as_dict()
        qualified = f"{data.get('database_name')}.{data.get('schema_name')}.{data.get('name')}".upper()
        if qualified not in active_views:
            stale_views.append(qualified)

    stale_tools: list[str] = []
    if args.include_analyst_tools:
        tool_rows = session.sql(f"SHOW CORTEX ANALYST SEMANTIC VIEWS IN SCHEMA {semantic_schema}").collect()
        active_tool_names = {
            view.replace(".SV_", ".ANALYST_")
            for view in active_views
            if ".SV_" in view
        }
        for row in tool_rows:
            data = row.as_dict()
            qualified = f"{data.get('database_name')}.{data.get('schema_name')}.{data.get('name')}".upper()
            if qualified.startswith(f"{semantic_schema}.ANALYST_SEM_") and qualified not in active_tool_names:
                stale_tools.append(qualified)

    if not args.apply:
        print("Stale legacy semantic views:")
        for item in stale_views:
            print(f"  {item}")
        if args.include_analyst_tools:
            print("\nStale legacy analyst tools:")
            for item in stale_tools:
                print(f"  {item}")
        return 0

    for item in stale_views:
        session.sql(f"DROP VIEW IF EXISTS {item}").collect()
    if args.include_analyst_tools:
        for item in stale_tools:
            session.sql(f"DROP CORTEX ANALYST SEMANTIC VIEW IF EXISTS {item}").collect()

    print(f"Dropped {len(stale_views)} stale semantic views.")
    if args.include_analyst_tools:
        print(f"Dropped {len(stale_tools)} stale analyst tools.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
