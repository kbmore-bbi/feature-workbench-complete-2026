#!/usr/bin/env python3
"""Normalize and publish native semantic views from the configured registry."""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = REPO_ROOT / "services" / "sttm-builder"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.core.config import Settings
from app.core.snowflake import get_local_cached_connector


def _candidate_score(candidate: dict[str, Any]) -> tuple[int, int, int, float]:
    confidence = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}.get(
        str(candidate.get("confidence") or "").upper(),
        0,
    )
    relationship_type = 1 if str(candidate.get("type") or "").upper() == "FORMAL" else 0
    reviewed = 1 if isinstance(candidate.get("semantic_review"), dict) else 0
    overlap = float(candidate.get("value_overlap_pct") or 0)
    return confidence, relationship_type, reviewed, overlap


def normalize_relationship_aliases(payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Keep one active relationship per logical table and retain every alternative."""
    normalized = copy.deepcopy(payload)
    semantic_model = normalized.get("semantic_model")
    if not isinstance(semantic_model, dict):
        return normalized, False
    relationships = semantic_model.get("relationships")
    if not isinstance(relationships, dict):
        return normalized, False

    owner_database = str(normalized.get("database") or "").upper()
    changed = False
    archived: list[dict[str, Any]] = list(
        semantic_model.get("native_view_alternative_relationships") or []
    )
    for direction in ("outgoing", "incoming"):
        candidates = [
            item for item in (relationships.get(direction) or []) if isinstance(item, dict)
        ]
        grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
        order: list[tuple[str, str, str]] = []
        for candidate in candidates:
            identity = (
                str(candidate.get("database") or owner_database).upper(),
                str(candidate.get("schema") or "").upper(),
                str(candidate.get("table") or "").upper(),
            )
            if identity not in grouped:
                grouped[identity] = []
                order.append(identity)
            grouped[identity].append(candidate)

        active: list[dict[str, Any]] = []
        for identity in order:
            alternatives = grouped[identity]
            if len(alternatives) == 1:
                active.append(alternatives[0])
                continue
            changed = True
            ranked = sorted(alternatives, key=_candidate_score, reverse=True)
            kept = copy.deepcopy(ranked[0])
            active.append(kept)
            archived.extend(
                {
                    "direction": direction,
                    "logical_table": ".".join(identity),
                    "reason": "duplicate_native_logical_table_alias",
                    "candidate": copy.deepcopy(candidate),
                }
                for candidate in ranked[1:]
            )
        relationships[direction] = active

    if changed:
        semantic_model["native_view_alternative_relationships"] = archived
    return normalized, changed


def prepare_latest_asset(
    connection: Any,
    *,
    registry: str,
    database: str,
    schema: str,
    table: str,
) -> dict[str, Any]:
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT VIEW_ID, VERSION, SEMANTIC_VIEW
            FROM {registry}.SEM_TABLE_VIEWS
            WHERE DATABASE_NAME = %s
              AND SCHEMA_NAME = %s
              AND TABLE_NAME = %s
              AND STATUS = 'ACTIVE'
            ORDER BY GENERATED_AT DESC
            LIMIT 1
            """,
            (database, schema, table),
        )
        row = cursor.fetchone()
    if not row:
        raise RuntimeError(f"No active semantic asset found for {database}.{schema}.{table}")

    view_id, version, payload = row
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, dict):
        raise RuntimeError(f"Semantic asset is not an object for {database}.{schema}.{table}")
    normalized, changed = normalize_relationship_aliases(payload)
    save_result = None
    if changed:
        with connection.cursor() as cursor:
            cursor.execute(
                f"CALL {registry}.SAVE_SEMANTIC_VIEW(%s)",
                (json.dumps(normalized, separators=(",", ":")),),
            )
            saved_row = cursor.fetchone()
        save_result = saved_row[0] if saved_row else None
        if isinstance(save_result, str):
            save_result = json.loads(save_result)
        if not isinstance(save_result, dict) or str(save_result.get("status") or "").upper() != "OK":
            raise RuntimeError(
                f"Failed to save normalized semantic asset for {database}.{schema}.{table}: {save_result}"
            )
        view_id = save_result.get("view_id") or view_id
        version = save_result.get("version") or version
    return {
        "view_id": view_id,
        "version": version,
        "normalized": changed,
        "save_result": save_result,
    }


def publish_native_view(
    connection: Any,
    *,
    registry: str,
    database: str,
    schema: str,
    table: str,
) -> dict[str, Any]:
    prepared = prepare_latest_asset(
        connection,
        registry=registry,
        database=database,
        schema=schema,
        table=table,
    )
    with connection.cursor() as cursor:
        cursor.execute(
            f"CALL {registry}.CREATE_TABLE_SEMANTIC_VIEW(%s, %s, %s, TRUE)",
            (database, schema, table),
        )
        row = cursor.fetchone()
    publication = row[0] if row else None
    if isinstance(publication, str):
        publication = json.loads(publication)
    if not isinstance(publication, dict) or str(publication.get("status") or "").upper() != "OK":
        raise RuntimeError(
            f"Native semantic publication failed for {database}.{schema}.{table}: {publication}"
        )
    return {**prepared, "publication": publication}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", default=str(APP_ROOT / ".env.local"))
    parser.add_argument("--table", action="append", required=True, help="DATABASE.SCHEMA.TABLE")
    args = parser.parse_args()

    settings = Settings(_env_file=args.env_file)
    registry = (
        f"{settings.snowflake_semantic_views_database}."
        f"{settings.snowflake_semantic_views_schema}"
    )
    connection = get_local_cached_connector(settings)
    results = []
    for fqn in args.table:
        parts = str(fqn).strip().split(".")
        if len(parts) != 3:
            raise SystemExit(f"Expected DATABASE.SCHEMA.TABLE, got {fqn!r}")
        result = publish_native_view(
            connection,
            registry=registry,
            database=parts[0],
            schema=parts[1],
            table=parts[2],
        )
        results.append({"fqn": ".".join(parts), **result})
    print(json.dumps({"status": "OK", "assets": results}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
