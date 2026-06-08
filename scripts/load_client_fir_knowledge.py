#!/usr/bin/env python3
"""Load client notes and historical SQL assets into Snowflake knowledge tables."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = REPO_ROOT / "services" / "sttm-builder"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.core.config import Settings
from app.core.conversation_memory import ConversationMemoryService
from app.core.snowflake import get_local_cached_client


def _quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _json_literal(value: Any) -> str:
    payload = json.dumps(value, default=str, ensure_ascii=True).replace("$$", "$ $")
    return f"$${payload}$$"


def _stable_id(prefix: str, seed: str) -> str:
    return f"{prefix}_{hashlib.sha256(seed.encode('utf-8')).hexdigest()[:16]}"


def _load_notes(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Notes file must contain a JSON array.")
    return [item for item in payload if isinstance(item, dict)]


def _collect_sql_assets(sql_dir: Path, glob_pattern: str) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    for path in sorted(sql_dir.rglob(glob_pattern)):
        if not path.is_file():
            continue
        sql_text = path.read_text(encoding="utf-8")
        title = path.stem.replace("_", " ").replace("-", " ").strip()
        assets.append(
            {
                "title": title or path.name,
                "sql_text": sql_text,
                "source_label": str(path.relative_to(sql_dir.parent)),
                "tags": [part for part in path.relative_to(sql_dir).parts[:-1]],
            }
        )
    return assets


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Load client notes and historical SQL into Snowflake FIR knowledge tables.",
    )
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--notes-json", help="JSON file containing note objects.")
    parser.add_argument("--sql-dir", help="Directory containing historical SQL files.")
    parser.add_argument("--sql-glob", default="*.sql")
    parser.add_argument("--entity-type", default="sttm_migration")
    parser.add_argument("--entity-ids-json", help="Optional JSON array of entity ids shared by loaded assets.")
    parser.add_argument(
        "--rebuild-search",
        action="store_true",
        help="Resync RAG documents and ensure Cortex Search after loading.",
    )
    args = parser.parse_args()

    settings = Settings(_env_file=str(APP_ROOT / ".env.local"), DATAHUB_ENABLED=False)
    client = get_local_cached_client(settings)
    memory = ConversationMemoryService(client.session, settings)
    memory.ensure_storage_exists()

    entity_ids = json.loads(Path(args.entity_ids_json).read_text(encoding="utf-8")) if args.entity_ids_json else []
    if entity_ids and not isinstance(entity_ids, list):
        raise ValueError("--entity-ids-json must contain a JSON array.")

    notes_loaded = 0
    sql_loaded = 0

    if args.notes_json:
        for note in _load_notes(Path(args.notes_json)):
            title = str(note.get("title") or "").strip() or "Client note"
            note_text = str(note.get("note_text") or note.get("text") or "").strip()
            if not note_text:
                continue
            note_id = str(note.get("note_id") or _stable_id("note", f"{args.project_id}|{title}|{note_text}"))
            statement = f"""
                MERGE INTO {memory._client_notes_table} AS tgt
                USING (
                    SELECT
                        {_quote_literal(note_id)} AS NOTE_ID,
                        {_quote_literal(args.project_id)} AS PROJECT_ID,
                        {_quote_literal(str(note.get('entity_type') or args.entity_type))} AS ENTITY_TYPE,
                        PARSE_JSON({_json_literal(note.get('entity_ids') or entity_ids)}) AS ENTITY_IDS,
                        {_quote_literal(title)} AS TITLE,
                        {_quote_literal(note_text)} AS NOTE_TEXT,
                        {_quote_literal(str(note.get('source_label') or 'client_notes'))} AS SOURCE_LABEL,
                        {_quote_literal(str(note.get('author_name') or 'client'))} AS AUTHOR_NAME,
                        PARSE_JSON({_json_literal(note.get('tags') or [])}) AS TAGS,
                        PARSE_JSON({_json_literal(note.get('attributes') or {})}) AS ATTRIBUTES,
                        {_quote_literal(str(note.get('status') or 'active'))} AS STATUS,
                        CURRENT_TIMESTAMP() AS NOW
                ) src
                ON tgt.NOTE_ID = src.NOTE_ID
                WHEN MATCHED THEN UPDATE SET
                    PROJECT_ID = src.PROJECT_ID,
                    ENTITY_TYPE = src.ENTITY_TYPE,
                    ENTITY_IDS = src.ENTITY_IDS,
                    TITLE = src.TITLE,
                    NOTE_TEXT = src.NOTE_TEXT,
                    SOURCE_LABEL = src.SOURCE_LABEL,
                    AUTHOR_NAME = src.AUTHOR_NAME,
                    TAGS = src.TAGS,
                    ATTRIBUTES = src.ATTRIBUTES,
                    STATUS = src.STATUS,
                    UPDATED_AT = src.NOW
                WHEN NOT MATCHED THEN INSERT (
                    NOTE_ID, PROJECT_ID, ENTITY_TYPE, ENTITY_IDS, TITLE, NOTE_TEXT,
                    SOURCE_LABEL, AUTHOR_NAME, TAGS, ATTRIBUTES, STATUS, UPDATED_AT, CREATED_AT
                ) VALUES (
                    src.NOTE_ID, src.PROJECT_ID, src.ENTITY_TYPE, src.ENTITY_IDS, src.TITLE, src.NOTE_TEXT,
                    src.SOURCE_LABEL, src.AUTHOR_NAME, src.TAGS, src.ATTRIBUTES, src.STATUS, src.NOW, src.NOW
                )
            """
            client.session.sql(statement).collect()
            notes_loaded += 1

    if args.sql_dir:
        for asset in _collect_sql_assets(Path(args.sql_dir), args.sql_glob):
            title = str(asset["title"]).strip()
            sql_text = str(asset["sql_text"]).strip()
            if not sql_text:
                continue
            sql_asset_id = _stable_id("sql", f"{args.project_id}|{title}|{sql_text}")
            statement = f"""
                MERGE INTO {memory._client_sql_assets_table} AS tgt
                USING (
                    SELECT
                        {_quote_literal(sql_asset_id)} AS SQL_ASSET_ID,
                        {_quote_literal(args.project_id)} AS PROJECT_ID,
                        {_quote_literal(args.entity_type)} AS ENTITY_TYPE,
                        PARSE_JSON({_json_literal(entity_ids)}) AS ENTITY_IDS,
                        {_quote_literal(title)} AS TITLE,
                        {_quote_literal(sql_text)} AS SQL_TEXT,
                        'historical_mapping' AS SQL_KIND,
                        'snowflake' AS DIALECT,
                        {_quote_literal('Imported historical migration SQL')} AS DESCRIPTION,
                        {_quote_literal(str(asset['source_label']))} AS SOURCE_LABEL,
                        'client' AS AUTHOR_NAME,
                        PARSE_JSON({_json_literal(asset.get('tags') or [])}) AS TAGS,
                        PARSE_JSON({_json_literal({})}) AS ATTRIBUTES,
                        'active' AS STATUS,
                        CURRENT_TIMESTAMP() AS NOW
                ) src
                ON tgt.SQL_ASSET_ID = src.SQL_ASSET_ID
                WHEN MATCHED THEN UPDATE SET
                    PROJECT_ID = src.PROJECT_ID,
                    ENTITY_TYPE = src.ENTITY_TYPE,
                    ENTITY_IDS = src.ENTITY_IDS,
                    TITLE = src.TITLE,
                    SQL_TEXT = src.SQL_TEXT,
                    SQL_KIND = src.SQL_KIND,
                    DIALECT = src.DIALECT,
                    DESCRIPTION = src.DESCRIPTION,
                    SOURCE_LABEL = src.SOURCE_LABEL,
                    AUTHOR_NAME = src.AUTHOR_NAME,
                    TAGS = src.TAGS,
                    ATTRIBUTES = src.ATTRIBUTES,
                    STATUS = src.STATUS,
                    UPDATED_AT = src.NOW
                WHEN NOT MATCHED THEN INSERT (
                    SQL_ASSET_ID, PROJECT_ID, ENTITY_TYPE, ENTITY_IDS, TITLE, SQL_TEXT,
                    SQL_KIND, DIALECT, DESCRIPTION, SOURCE_LABEL, AUTHOR_NAME, TAGS,
                    ATTRIBUTES, STATUS, UPDATED_AT, CREATED_AT
                ) VALUES (
                    src.SQL_ASSET_ID, src.PROJECT_ID, src.ENTITY_TYPE, src.ENTITY_IDS, src.TITLE, src.SQL_TEXT,
                    src.SQL_KIND, src.DIALECT, src.DESCRIPTION, src.SOURCE_LABEL, src.AUTHOR_NAME, src.TAGS,
                    src.ATTRIBUTES, src.STATUS, src.NOW, src.NOW
                )
            """
            client.session.sql(statement).collect()
            sql_loaded += 1

    if args.rebuild_search:
        memory.sync_rag_documents()
        memory.ensure_search_service(rebuild=True)

    print(
        json.dumps(
            {
                "project_id": args.project_id,
                "notes_loaded": notes_loaded,
                "sql_loaded": sql_loaded,
                "search_rebuilt": bool(args.rebuild_search),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
