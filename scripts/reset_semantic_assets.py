#!/usr/bin/env python3
"""Reset semantic bundles, semantic models, and semantic view objects for a table family."""

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


def _quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--table-name", action="append", required=True, help="Table name to reset, e.g. LOAN_INCOME_AMOUNT_CALCULATION")
    parser.add_argument("--schema-name", action="append", default=[], help="Optional schema name filter, e.g. DL_AMOUNT")
    parser.add_argument("--bundle-like", action="append", default=[], help="Optional bundle/view label pattern, e.g. %LOAN_INCOME%")
    parser.add_argument("--apply", action="store_true", help="Actually delete assets. Default is dry-run.")
    args = parser.parse_args()

    settings = _settings()
    session = get_local_cached_client(settings).session
    semantic_schema = f"{settings.snowflake_database}.{settings.snowflake_schema}"
    model_table = settings.snowflake_semantic_model_table
    bundle_table = settings.snowflake_semantic_bundles_table

    table_names = [name.strip().upper() for name in args.table_name if name.strip()]
    schema_names = [name.strip().upper() for name in args.schema_name if name.strip()]
    bundle_patterns = [pattern.strip().upper() for pattern in args.bundle_like if pattern.strip()]

    table_predicates = [f"UPPER(TABLE_NAME) IN ({', '.join(_quote(name) for name in table_names)})"]
    if schema_names:
        table_predicates.append(f"UPPER(SCHEMA_NAME) IN ({', '.join(_quote(name) for name in schema_names)})")
    table_where = " AND ".join(table_predicates)

    bundle_predicates = []
    if table_names:
        for name in table_names:
            bundle_predicates.append(f"UPPER(COALESCE(BUNDLE_LABEL, '')) LIKE '%{name}%'")
            bundle_predicates.append(f"UPPER(COALESCE(SEMANTIC_VIEW_NAME, '')) LIKE '%{name}%'")
            bundle_predicates.append(f"UPPER(COALESCE(TARGET_TABLE::STRING, '')) LIKE '%{name}%'")
            bundle_predicates.append(f"UPPER(COALESCE(SOURCE_TABLES::STRING, '')) LIKE '%{name}%'")
    for pattern in bundle_patterns:
        bundle_predicates.append(f"UPPER(COALESCE(BUNDLE_LABEL, '')) LIKE {_quote(pattern)}")
        bundle_predicates.append(f"UPPER(COALESCE(SEMANTIC_VIEW_NAME, '')) LIKE {_quote(pattern)}")
    if not bundle_predicates:
        raise SystemExit("At least one --table-name or --bundle-like filter is required.")
    bundle_where = " OR ".join(bundle_predicates)

    bundle_rows = session.sql(
        f"""
        SELECT SEMANTIC_BUNDLE_ID, SEMANTIC_VIEW_NAME, STATUS, BUNDLE_LABEL, SOURCE_TABLES, TARGET_TABLE
        FROM {bundle_table}
        WHERE {bundle_where}
        ORDER BY UPDATED_AT DESC
        """
    ).collect()

    semantic_views = []
    for row in bundle_rows:
        view_name = str(row["SEMANTIC_VIEW_NAME"] or "").strip()
        if view_name:
            semantic_views.append(view_name)

    print("Matching semantic bundles:")
    for row in bundle_rows:
        print(
            f"  {row['SEMANTIC_BUNDLE_ID']} | {row['STATUS']} | {row['SEMANTIC_VIEW_NAME'] or '<none>'} | {row['BUNDLE_LABEL']}"
        )

    model_rows = session.sql(
        f"""
        SELECT SCOPE, DB_NAME, SCHEMA_NAME, TABLE_NAME, ATTRIBUTE_NAME, UPDATED_AT
        FROM {model_table}
        WHERE {table_where}
        ORDER BY UPDATED_AT DESC
        """
    ).collect()

    print("\nMatching semantic model rows:")
    for row in model_rows[:20]:
        print(
            f"  {row['SCOPE']} | {row['DB_NAME']}.{row['SCHEMA_NAME']}.{row['TABLE_NAME']}"
            + (f".{row['ATTRIBUTE_NAME']}" if row["ATTRIBUTE_NAME"] else "")
        )
    if len(model_rows) > 20:
        print(f"  ... and {len(model_rows) - 20} more rows")

    if not args.apply:
        print("\nDry run only. Re-run with --apply to delete these assets.")
        return 0

    for view_name in semantic_views:
        session.sql(f"DROP SEMANTIC VIEW IF EXISTS {view_name}").collect()

    session.sql(f"DELETE FROM {bundle_table} WHERE {bundle_where}").collect()
    session.sql(f"DELETE FROM {model_table} WHERE {table_where}").collect()

    print(f"\nDropped {len(semantic_views)} semantic view object(s).")
    print("Deleted matching semantic bundle and semantic model rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
