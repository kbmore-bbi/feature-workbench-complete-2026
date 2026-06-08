#!/usr/bin/env python3
"""List or drop semantic view assets no longer referenced by active bundles."""

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
    parser.add_argument("--apply", action="store_true", help="Actually drop stale semantic view assets.")
    parser.add_argument(
        "--prefix",
        action="append",
        default=["SV_STTM_%", "SV_SEM_%"],
        help="Optional semantic-view name pattern to inspect. Repeat for multiple patterns.",
    )
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

    view_rows = []
    seen_names: set[str] = set()
    for prefix in args.prefix:
        rows = session.sql(f"SHOW SEMANTIC VIEWS LIKE '{prefix}' IN SCHEMA {semantic_schema}").collect()
        for row in rows:
            data = row.as_dict()
            qualified = f"{data.get('database_name')}.{data.get('schema_name')}.{data.get('name')}".upper()
            if qualified not in seen_names:
                seen_names.add(qualified)
                view_rows.append(row)
    stale_views: list[str] = []
    for row in view_rows:
        data = row.as_dict()
        qualified = f"{data.get('database_name')}.{data.get('schema_name')}.{data.get('name')}".upper()
        if qualified not in active_views:
            stale_views.append(qualified)

    if not args.apply:
        print("Stale semantic views:")
        for item in stale_views:
            print(f"  {item}")
        return 0

    for item in stale_views:
        session.sql(f"DROP SEMANTIC VIEW IF EXISTS {item}").collect()

    print(f"Dropped {len(stale_views)} stale semantic views.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
