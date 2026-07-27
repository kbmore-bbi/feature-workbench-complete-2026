#!/usr/bin/env python3
"""Load client documents into the complete offline FIR evidence pipeline."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = REPO_ROOT / "services" / "sttm-builder"
DEFAULT_ENV_FILE = REPO_ROOT / "infra" / "snowflake" / "env" / "client.env"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.core.config import Settings
from app.core.conversation_memory import ConversationMemoryService
from app.core.derived_source import DerivedSourceService
from app.core.exceptions import AppError
from app.core.excel_parser import parse_excel_mapping
from app.core.fir_asset_resolver import FIRAssetTableResolver
from app.core.fir_document_ingestion import (
    enqueue_fir_document_event,
    merge_table_hints,
    store_excel_asset,
    store_sql_asset,
)
from app.core.project_service import ProjectService
from app.core.semantic_context import SemanticContextService
from app.core.semantic_model import SemanticModelService
from app.core.snowflake import get_local_cached_client
from app.core.sql_parser import parse_sql_document
from app.core.table_selection import TableSelectionService
from app.schema.common import TableRef
from app.schema.derived_source import DerivedSourceDefinition
from app.schema.project import (
    ProjectCreateRequest,
    STTMAutosaveRequest,
    STTMCreateRequest,
    STTMPublishRequest,
)
from app.schema.semantic_context import SemanticContextRefreshRequest, SemanticLevel
from app.schema.workspace_context import WorkbenchContextSnapshotV1


def _quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _json_literal(value: Any) -> str:
    payload = json.dumps(value, default=str, ensure_ascii=True).replace("$$", "$ $")
    return f"$${payload}$$"


def _stable_id(prefix: str, seed: str) -> str:
    return f"{prefix}_{hashlib.sha256(seed.encode('utf-8')).hexdigest()[:16]}"


def _historical_import_key(
    *,
    project_id: str,
    sql_asset_hashes: list[str],
    target_table: TableRef,
    import_mode: str,
) -> str:
    identity = "|".join(
        [
            project_id,
            *sorted(set(sql_asset_hashes)),
            target_table.qualified_name.upper(),
            import_mode.strip().lower(),
        ]
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _find_historical_mapping(
    *,
    project_service: ProjectService,
    project_id: str,
    mapping_name: str,
    target_table: TableRef,
    asset_ids: list[str],
    sql_asset_hashes: list[str],
    import_mode: str,
) -> tuple[Any | None, list[Any]]:
    expected_assets = sorted(set(asset_ids))
    expected_target = target_table.qualified_name.upper()
    import_key = _historical_import_key(
        project_id=project_id,
        sql_asset_hashes=sql_asset_hashes,
        target_table=target_table,
        import_mode=import_mode,
    )
    matches = []
    for sttm in project_service.list_sttms(project_id):
        metadata = sttm.metadata or {}
        same_key = str(metadata.get("import_key") or "") == import_key
        legacy_match = (
            str(metadata.get("source") or "") == "historical_import"
            and str(sttm.sttm_name or "").strip().upper() == mapping_name.strip().upper()
            and str(sttm.target_table or "").strip().upper() == expected_target
            and sorted(set(metadata.get("source_asset_ids") or [])) == expected_assets
        )
        if same_key or legacy_match:
            matches.append(sttm)
    return (matches[0] if matches else None), matches[1:]


def _mark_duplicate_mappings_superseded(
    *,
    session: Any,
    settings: Settings,
    duplicates: list[Any],
) -> None:
    if not duplicates:
        return
    table = settings.qualify_table_name(settings.snowflake_sttm_table)
    ids = ", ".join(_quote_literal(str(sttm.sttm_id)) for sttm in duplicates)
    session.sql(
        f"UPDATE {table} SET STATUS = 'SUPERSEDED', "
        f"LAST_MODIFIED_DATETIME = CURRENT_TIMESTAMP() WHERE STTM_ID IN ({ids})"
    ).collect()


def _record_import_identity(
    *,
    session: Any,
    settings: Settings,
    sttm_id: str,
    import_key: str,
    snapshot_hash: str,
    asset_ids: list[str],
    published: bool,
) -> None:
    table = settings.qualify_table_name(settings.snowflake_sttm_table)
    metadata = {
        "source": "historical_import",
        "source_asset_ids": sorted(set(asset_ids)),
        "import_key": import_key,
        "import_snapshot_hash": snapshot_hash,
        "import_contract_version": 2,
    }
    lifecycle = (
        ", IMPORT_STATE = 'COMPLETE', RUNTIME_SUPPRESSED = FALSE"
        if published
        else ", IMPORT_STATE = 'IMPORTING', RUNTIME_SUPPRESSED = TRUE"
    )
    session.sql(
        f"UPDATE {table} SET STTM_METADATA = PARSE_JSON({_json_literal(metadata)}), "
        f"IMPORT_KEY = {_quote_literal(import_key)}{lifecycle}, "
        f"LAST_MODIFIED_DATETIME = CURRENT_TIMESTAMP() "
        f"WHERE STTM_ID = {_quote_literal(sttm_id)}"
    ).collect()


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


def _collect_asset_paths(
    *,
    explicit_files: list[str],
    sql_dir: str | None,
    sql_glob: str,
    excel_dir: str | None,
    excel_glob: str,
) -> list[Path]:
    paths = [Path(value).expanduser().resolve() for value in explicit_files]
    if sql_dir:
        paths.extend(
            path.resolve()
            for path in sorted(Path(sql_dir).expanduser().rglob(sql_glob))
            if path.is_file()
        )
    if excel_dir:
        paths.extend(
            path.resolve()
            for path in sorted(Path(excel_dir).expanduser().rglob(excel_glob))
            if path.is_file()
        )
    seen: set[str] = set()
    result: list[Path] = []
    for path in paths:
        key = str(path)
        if key in seen:
            continue
        if not path.is_file():
            raise FileNotFoundError(f"Asset not found: {path}")
        seen.add(key)
        result.append(path)
    return result


def _load_asset_manifest(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Asset manifest must contain a JSON array.")
    result: list[dict[str, Any]] = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict) or not str(item.get("file") or "").strip():
            raise ValueError(f"Asset manifest row {index + 1} must contain a file.")
        result.append(item)
    return result


def _asset_entries(args: argparse.Namespace) -> list[dict[str, Any]]:
    entries = [
        {
            "file": str(path),
            "project_id": args.project_id,
            "mode": args.mode,
            "source_table_hints": args.source_table_hint,
            "target_table_hint": args.target_table_hint,
        }
        for path in _collect_asset_paths(
            explicit_files=args.file,
            sql_dir=args.sql_dir,
            sql_glob=args.sql_glob,
            excel_dir=args.excel_dir,
            excel_glob=args.excel_glob,
        )
    ]
    if args.asset_manifest:
        manifest_path = Path(args.asset_manifest).expanduser().resolve()
        for item in _load_asset_manifest(manifest_path):
            asset_path = Path(str(item["file"])).expanduser()
            if not asset_path.is_absolute():
                asset_path = manifest_path.parent / asset_path
            entries.append(
                {
                    **item,
                    "file": str(asset_path.resolve()),
                    "project_id": str(item.get("project_id") or args.project_id),
                    "mode": str(item.get("mode") or args.mode),
                    "source_table_hints": item.get("source_table_hints")
                    or args.source_table_hint,
                    "target_table_hint": item.get("target_table_hint")
                    or args.target_table_hint,
                }
            )
    return entries


def _hint_text(value: Any) -> str:
    if isinstance(value, list):
        return ",".join(str(item) for item in value if str(item).strip())
    return str(value or "")


def _inspect_asset(entry: dict[str, Any]) -> dict[str, Any]:
    path = Path(str(entry["file"])).expanduser().resolve()
    content = path.read_bytes()
    mode = str(entry.get("mode") or "learn_from_it")
    source_hints = _hint_text(entry.get("source_table_hints"))
    target_hint = _hint_text(entry.get("target_table_hint"))
    asset_id = hashlib.sha256(content).hexdigest()[:32]
    suffix = path.suffix.lower()

    if suffix == ".sql":
        sql_text = content.decode("utf-8", errors="replace")
        parsed = parse_sql_document(sql_text)
        source_candidates = merge_table_hints(parsed.source_tables, source_hints)
        target_candidates = merge_table_hints(
            [parsed.target_table] if parsed.target_table else [],
            target_hint,
        )
        parsed_summary = parsed.to_dict()
        event_type = "document.sql_upload"
        sql_text_value = sql_text
    elif suffix in {".xlsx", ".xls", ".csv"}:
        parsed = parse_excel_mapping(content, path.name)
        source_candidates = merge_table_hints(parsed.source_datasets, source_hints)
        target_candidates = merge_table_hints(parsed.target_tables, target_hint)
        parsed_summary = parsed.to_dict()
        event_type = (
            "document.csv_upload"
            if suffix == ".csv"
            else "document.excel_upload"
        )
        sql_text_value = None
    else:
        raise ValueError(f"Unsupported asset type for {path}; use SQL, XLSX, XLS, or CSV.")

    return {
        "asset_id": asset_id,
        "file": str(path),
        "path": path,
        "content": content,
        "suffix": suffix,
        "mode": mode,
        "parsed": parsed,
        "parsed_summary": parsed_summary,
        "source_candidates": source_candidates,
        "target_candidates": target_candidates,
        "event_type": event_type,
        "sql_text": sql_text_value,
        "detected_sources": parsed_summary.get("source_tables")
        or parsed_summary.get("source_datasets")
        or [],
        "detected_targets": (
            [parsed_summary.get("target_table")]
            if parsed_summary.get("target_table")
            else parsed_summary.get("target_tables") or []
        ),
    }


def _persist_asset(
    *,
    session: Any,
    settings: Settings,
    project_id: str,
    asset: dict[str, Any],
) -> list[dict[str, Any]]:
    print(
        f"Storing historical asset: {asset['path'].name}",
        file=sys.stderr,
    )
    if asset["suffix"] == ".sql":
        store_sql_asset(
            session,
            asset["asset_id"],
            asset["path"].name,
            asset["sql_text"],
            project_id,
            asset["parsed"],
        )
    else:
        store_excel_asset(
            session,
            asset["asset_id"],
            asset["path"].name,
            asset["parsed"],
            project_id,
        )
    print(
        f"Resolving source and target tables for: {asset['path'].name}",
        file=sys.stderr,
    )
    references = FIRAssetTableResolver(session, settings).resolve_and_store(
        asset_id=asset["asset_id"],
        project_id=project_id,
        references=[
            *[(table, "source") for table in asset["source_candidates"]],
            *[(table, "target") for table in asset["target_candidates"]],
        ],
    )
    enqueue_fir_document_event(
        session,
        asset["asset_id"],
        project_id,
        references,
        event_type=asset["event_type"],
        priority=asset["mode"] in {"learn_from_it", "auto_populate"},
    )
    return references


def _public_asset_result(
    asset: dict[str, Any],
    *,
    project_id: str,
    references: list[dict[str, Any]] | None = None,
    dry_run: bool,
) -> dict[str, Any]:
    return {
        "asset_id": asset["asset_id"],
        "file": asset["file"],
        "project_id": project_id,
        "mode": asset["mode"],
        "detected_sources": asset["detected_sources"],
        "detected_targets": asset["detected_targets"],
        "detected_ctes": [
            item.get("name")
            for item in (asset["parsed_summary"].get("ctes") or [])
            if isinstance(item, dict) and item.get("name")
        ],
        "resolved_references": references or [],
        "status": "parsed" if dry_run else "queued_for_fir",
    }


def _table_ref(value: str) -> TableRef:
    parts = [part.strip().strip('"') for part in str(value).split(".") if part.strip()]
    if len(parts) != 3:
        raise ValueError(
            f"Expected a fully qualified DATABASE.SCHEMA.TABLE name, got '{value}'."
        )
    return TableRef(database=parts[0], schema=parts[1], table=parts[2])


def _dedupe_table_refs(values: list[TableRef]) -> list[TableRef]:
    result: dict[str, TableRef] = {}
    for value in values:
        result[value.qualified_name.upper()] = value
    return [result[key] for key in sorted(result)]


def _resolved_table_refs(
    *,
    assets: list[dict[str, Any]],
    references_by_asset: dict[str, list[dict[str, Any]]],
    role: str,
    explicit_hints: list[str],
) -> list[TableRef]:
    refs: list[TableRef] = []
    for hint in explicit_hints:
        if str(hint).strip():
            refs.append(_table_ref(str(hint)))
    for asset in assets:
        for reference in references_by_asset.get(asset["asset_id"], []):
            if (
                str(reference.get("reference_role") or "").lower() == role
                and str(reference.get("resolution_status") or "").lower() == "resolved"
                and reference.get("resolved_fqn")
            ):
                refs.append(_table_ref(str(reference["resolved_fqn"])))
    return _dedupe_table_refs(refs)


def _source_fields(value: str) -> list[str]:
    return [
        item.strip()
        for item in re.split(r"[\n,]+", str(value or ""))
        if item.strip() and item.strip() not in {"/", "-"}
    ]


def _select_source_table(
    dataset: str,
    source_tables: list[TableRef],
) -> TableRef | None:
    if not source_tables:
        return None
    normalized = re.sub(r"[^A-Z0-9]+", "_", str(dataset or "").upper()).strip("_")
    if normalized in {"", "SELF"}:
        return source_tables[0]
    scored: list[tuple[int, TableRef]] = []
    for table in source_tables:
        table_name = table.table.upper()
        schema_name = table.schema.upper()
        score = 0
        if table_name and table_name in normalized:
            score += 100 + len(table_name)
        if schema_name and schema_name in normalized:
            score += 20
        for token in table_name.split("_"):
            if len(token) > 3 and token in normalized:
                score += 2
        scored.append((score, table))
    scored.sort(key=lambda item: (item[0], item[1].qualified_name), reverse=True)
    if scored[0][0] > 0:
        return scored[0][1]
    return source_tables[0] if len(source_tables) == 1 else None


def _qualify_source_column(
    *,
    source_field: str,
    source_dataset: str,
    source_tables: list[TableRef],
) -> str:
    field = source_field.strip()
    if not field:
        return ""
    if field.count(".") >= 2 or any(char in field for char in "()'\" "):
        return field
    table = _select_source_table(source_dataset, source_tables)
    if table is None:
        return field
    return f"{table.qualified_name}.{field}"


def _mapping_rows_from_excel(
    assets: list[dict[str, Any]],
    source_tables: list[TableRef],
) -> list[dict[str, Any]]:
    rows_by_target: dict[str, dict[str, Any]] = {}
    for asset in assets:
        if asset["suffix"] not in {".xlsx", ".xls", ".csv"}:
            continue
        for mapping in asset["parsed"].column_mappings:
            target_column = str(mapping.target_field or "").strip()
            if not target_column:
                continue
            source_columns = [
                _qualify_source_column(
                    source_field=field,
                    source_dataset=mapping.source_dataset,
                    source_tables=source_tables,
                )
                for field in _source_fields(mapping.source_field)
            ]
            source_columns = [value for value in source_columns if value]
            rule = str(mapping.preprocessing_rule or "").strip() or None
            rows_by_target[target_column.upper()] = {
                "id": _stable_id(
                    "mapping",
                    f"{asset['asset_id']}|{target_column}|{mapping.source_field}|{rule or ''}",
                ),
                "target_column": target_column,
                "target_type": str(mapping.target_data_type or "").strip() or None,
                "source_columns": source_columns,
                "mapping_mode": "source",
                "rule": rule,
                "natural_language_rule": rule,
                "description": str(mapping.field_definition or "").strip() or None,
                "load_order": (
                    str(mapping.processing_order)
                    if mapping.processing_order is not None
                    else None
                ),
                "confidence": 0.99,
                "confidence_reason": (
                    "Imported from a client-provided historical mapping workbook and "
                    "published as an authoritative precedent."
                ),
                "status": "mapped",
                "provenance": "historical_import",
                "ai_suggested": False,
                "accepted": True,
                "preprocessing_rule_type": "Historical",
                "source_asset_ids": [asset["asset_id"]],
            }
    return list(rows_by_target.values())


def _mapping_rows_from_sql(
    assets: list[dict[str, Any]],
    source_tables: list[TableRef],
) -> list[dict[str, Any]]:
    rows_by_target: dict[str, dict[str, Any]] = {}
    for asset in assets:
        if asset["suffix"] != ".sql":
            continue
        for mapping in asset["parsed"].column_mappings:
            target_column = str(mapping.target_alias or mapping.source_column or "").strip()
            if not target_column:
                continue
            source_field = str(mapping.source_column or "").strip()
            source_dataset = str(mapping.source_table or "")
            is_constant = bool(
                mapping.transformation
                and not mapping.source_table
                and re.fullmatch(
                    r"(?:NULL|TRUE|FALSE|[-+]?\d+(?:\.\d+)?|'(?:[^']|'')*')",
                    source_field,
                    flags=re.IGNORECASE,
                )
            )
            source_column = (
                ""
                if is_constant
                else _qualify_source_column(
                    source_field=source_field,
                    source_dataset=source_dataset,
                    source_tables=source_tables,
                )
            )
            rows_by_target[target_column.upper()] = {
                "id": _stable_id(
                    "mapping",
                    f"{asset['asset_id']}|{target_column}|{source_field}",
                ),
                "target_column": target_column,
                "source_columns": [source_column] if source_column else [],
                "mapping_mode": "constant" if is_constant else "source",
                "constant_value": source_field if is_constant else None,
                "expression": mapping.transformation,
                "rule": mapping.transformation,
                "confidence": 0.95,
                "confidence_reason": (
                    "Imported from client-provided historical SQL and published as an "
                    "authoritative precedent."
                ),
                "status": "mapped",
                "provenance": "historical_import",
                "ai_suggested": False,
                "accepted": True,
                "preprocessing_rule_type": "Historical",
                "source_asset_ids": [asset["asset_id"]],
            }
    return list(rows_by_target.values())


def _selected_columns_by_table(
    mapping_rows: list[dict[str, Any]],
    source_tables: list[TableRef],
) -> dict[str, list[str]]:
    selected: dict[str, set[str]] = {
        table.qualified_name: set() for table in source_tables
    }
    ordered_tables = sorted(
        source_tables,
        key=lambda table: len(table.qualified_name),
        reverse=True,
    )
    for row in mapping_rows:
        for source_column in row.get("source_columns") or []:
            source_upper = str(source_column).upper()
            for table in ordered_tables:
                prefix = f"{table.qualified_name}.".upper()
                if source_upper.startswith(prefix):
                    selected[table.qualified_name].add(str(source_column)[len(prefix):])
                    break
    return {
        table: sorted(columns)
        for table, columns in selected.items()
        if columns
    }


def _resolve_join_table(value: str, source_tables: list[TableRef]) -> TableRef | None:
    normalized = str(value or "").strip().upper()
    if not normalized:
        return None
    exact = [table for table in source_tables if table.qualified_name.upper() == normalized]
    if len(exact) == 1:
        return exact[0]
    table_name = normalized.split(".")[-1]
    matches = [table for table in source_tables if table.table.upper() == table_name]
    return matches[0] if len(matches) == 1 else None


def _relationships_from_sql(
    assets: list[dict[str, Any]],
    source_tables: list[TableRef],
) -> list[dict[str, Any]]:
    relationships: list[dict[str, Any]] = []
    seen: set[str] = set()
    equality_pattern = re.compile(
        r'(?:(?:"?([A-Za-z_][\w$]*)"?)\.)?"?([A-Za-z_][\w$]*)"?\s*=\s*'
        r'(?:(?:"?([A-Za-z_][\w$]*)"?)\.)?"?([A-Za-z_][\w$]*)"?',
        flags=re.IGNORECASE,
    )
    for asset in assets:
        if asset["suffix"] != ".sql":
            continue
        for index, pattern in enumerate(asset["parsed"].join_patterns):
            left = _resolve_join_table(pattern.left_table, source_tables)
            right = _resolve_join_table(pattern.right_table, source_tables)
            if not left or not right or left.qualified_name.upper() == right.qualified_name.upper():
                continue
            conditions = []
            for match in equality_pattern.finditer(pattern.condition or ""):
                expression_left_alias = match.group(1)
                expression_right_alias = match.group(3)
                left_column, right_column = match.group(2), match.group(4)
                aliases = asset["parsed"].table_aliases
                expression_left = _resolve_join_table(
                    aliases.get(str(expression_left_alias or "").upper(), expression_left_alias or ""),
                    source_tables,
                )
                expression_right = _resolve_join_table(
                    aliases.get(str(expression_right_alias or "").upper(), expression_right_alias or ""),
                    source_tables,
                )
                if (
                    expression_left is not None
                    and expression_right is not None
                    and expression_left.qualified_name.upper() == right.qualified_name.upper()
                    and expression_right.qualified_name.upper() == left.qualified_name.upper()
                ):
                    left_column, right_column = right_column, left_column
                elif (
                    expression_left is not None
                    and expression_right is not None
                    and (
                        expression_left.qualified_name.upper() != left.qualified_name.upper()
                        or expression_right.qualified_name.upper() != right.qualified_name.upper()
                    )
                ):
                    continue
                if left_column and right_column:
                    conditions.append(
                        {
                            "left_column": left_column,
                            "operator": "=",
                            "right_column": right_column,
                        }
                    )
            if not conditions:
                continue
            join_type = str(pattern.join_type or "INNER").upper().replace(" JOIN", "")
            if join_type not in {"INNER", "LEFT", "RIGHT", "FULL"}:
                join_type = "INNER"
            relationship_key = (
                f"{left.qualified_name}|{right.qualified_name}|"
                + "&".join(
                    f"{condition['left_column']}={condition['right_column']}"
                    for condition in conditions
                )
            ).upper()
            if relationship_key in seen:
                continue
            seen.add(relationship_key)
            relationships.append(
                {
                    "id": _stable_id(
                        "historical_join",
                        f"{asset['asset_id']}|{index}|{relationship_key}",
                    ),
                    "left_table": left.model_dump(mode="json"),
                    "right_table": right.model_dump(mode="json"),
                    "join_type": join_type,
                    "source": "USER_DEFINED",
                    "locked": False,
                    "conditions": conditions,
                    "evidence_id": asset["asset_id"],
                    "original_condition": pattern.condition,
                }
            )
    return relationships


def _materialize_ctes(
    *,
    session: Any,
    settings: Settings,
    assets: list[dict[str, Any]],
    source_tables: list[TableRef],
    mapping_name: str,
) -> list[Any]:
    service = DerivedSourceService(session, settings)
    records: list[Any] = []
    for asset in assets:
        if asset["suffix"] != ".sql":
            continue
        for cte in asset["parsed"].ctes:
            if not cte.sql_text:
                continue
            cte_sources = [
                table
                for table in source_tables
                if any(
                    table.table.upper() == str(reference).split(".")[-1].upper()
                    for reference in cte.tables_referenced
                )
            ] or source_tables
            record = service.save_source(
                DerivedSourceDefinition(
                    derived_source_name=f"{mapping_name} - {cte.name}",
                    sql_text=cte.sql_text,
                    source_tables=cte_sources,
                    driving_table=cte_sources[0] if cte_sources else None,
                    purpose=cte.purpose,
                    business_description=(
                        f"Historical CTE '{cte.name}' imported from {asset['path'].name}."
                    ),
                    generated_by_request_id=asset["asset_id"],
                )
            )
            records.append(record)
    return records


def _build_snapshot(
    *,
    project_id: str,
    project_name: str,
    project_description: str | None,
    project_domain: str | None,
    project_outcome: str | None,
    sttm_id: str | None,
    mapping_name: str,
    mapping_description: str | None,
    business_goal: str | None,
    source_tables: list[TableRef],
    target_table: TableRef,
    assets: list[dict[str, Any]],
    derived_records: list[Any],
) -> WorkbenchContextSnapshotV1:
    mapping_rows = _mapping_rows_from_excel(assets, source_tables)
    if not mapping_rows:
        mapping_rows = _mapping_rows_from_sql(assets, source_tables)
    if not mapping_rows:
        raise ValueError(
            "No column mappings were detected. Supply a mapping workbook or SQL SELECT aliases."
        )
    sql_assets = [asset for asset in assets if asset["suffix"] == ".sql"]
    filter_fragments = [
        rule.get("sql_fragment")
        for asset in sql_assets
        for rule in (asset["parsed_summary"].get("business_rules") or [])
        if isinstance(rule, dict)
        and rule.get("rule_type") == "where_filter"
        and rule.get("sql_fragment")
    ]
    artifacts = [
        {
            "artifact_id": asset["asset_id"],
            "artifact_type": "historical_sql" if asset["suffix"] == ".sql" else "historical_mapping_workbook",
            "agent_name": "HISTORICAL_IMPORTER",
            "artifact_status": "validated_precedent",
            "file_name": asset["path"].name,
            "provenance": "client_asset_import",
            "summary": (
                f"Client-provided historical mapping evidence from {asset['path'].name}."
            ),
            "detected_sources": asset["detected_sources"],
            "detected_targets": asset["detected_targets"],
            "join_patterns": asset["parsed_summary"].get("join_patterns") or [],
            "business_rules": asset["parsed_summary"].get("business_rules") or [],
        }
        for asset in assets
    ]
    derived_sources = [
        {
            "id": record.derived_source_id,
            "name": record.derived_source_name,
            "sql_hash": hashlib.sha256(record.sql_text.encode("utf-8")).hexdigest(),
            "lineage": [
                {
                    "source_table": table.qualified_name,
                    "physical_view_name": record.physical_view_name,
                }
                for table in record.base_source_tables
            ],
        }
        for record in derived_records
    ]
    relationships = _relationships_from_sql(assets, source_tables)
    return WorkbenchContextSnapshotV1(
        page="mapping",
        surface="MAPPING",
        action="historical_mapping.imported",
        milestone="mapping_ready",
        checkpoint="mapping_ready",
        scope_type="mapping",
        candidate_action="publish_historical_mapping",
        project_id=project_id,
        project_name=project_name,
        project_description=project_description,
        project_domain=project_domain,
        project_outcome=project_outcome,
        sttm_id=sttm_id,
        sttm_name=mapping_name,
        sttm_description=mapping_description,
        mapping_lifecycle="new",
        business_goal=business_goal,
        source_tables=source_tables,
        driving_table=source_tables[0],
        target_table=target_table,
        selected_columns_by_table=_selected_columns_by_table(mapping_rows, source_tables),
        derived_sources=derived_sources,
        relationships=relationships,
        filters={
            "filter_sql": "\n".join(filter_fragments) or None,
            "base_query_sql": sql_assets[0]["sql_text"] if sql_assets else None,
            "groups": [],
        },
        mapping_intent={
            "name": mapping_name,
            "description": mapping_description,
            "business_goal": business_goal,
            "lifecycle": "new",
            "source": "historical_import",
            "confidence": 0.99,
        },
        mapping_rows=mapping_rows,
        checked_mapping_row_ids=[row["id"] for row in mapping_rows],
        mapping_sql=sql_assets[0]["sql_text"] if sql_assets else None,
        mapping_preview_sql=sql_assets[0]["sql_text"] if sql_assets else None,
        mapping_artifacts=artifacts,
    )


def _attach_semantic_bundle(
    *,
    client: Any,
    settings: Settings,
    snapshot: WorkbenchContextSnapshotV1,
) -> tuple[WorkbenchContextSnapshotV1, Any]:
    semantic_service = SemanticContextService(
        session=client.session,
        settings=settings,
        semantic_model_service=SemanticModelService(settings),
        table_selection_service=TableSelectionService(client, settings),
        derived_source_service=DerivedSourceService(client.session, settings),
    )
    bundle = semantic_service.refresh_bundle(
        SemanticContextRefreshRequest(
            selected_source_tables=snapshot.source_tables,
            selected_derived_sources=[source.id for source in snapshot.derived_sources],
            target_table=snapshot.target_table,
            relationships=snapshot.relationships,
            selected_columns_by_table=snapshot.selected_columns_by_table,
            requested_level=SemanticLevel.FULL_REGISTRY,
            force=False,
        ),
        allow_agent_refresh=False,
    )
    payload = snapshot.model_dump(mode="json")
    summary = bundle.summary.model_dump(mode="json")
    payload["semantic"] = {
        "bundle_id": bundle.bundle_id,
        "bundle_hash": bundle.bundle_hash,
        "bundle_label": bundle.bundle_label,
        "level": bundle.achieved_level.value,
        "status": bundle.status.value,
        "view_name": bundle.semantic_view_name,
        "composed_model_hash": summary.get("composed_model_hash"),
        "asset_versions": summary.get("asset_versions") or {},
    }
    payload["semantic_bundle"] = {
        **payload["semantic"],
        "semantic_view_name": bundle.semantic_view_name,
        "source_tables": payload.get("source_tables") or [],
        "target_table": payload.get("target_table"),
        "driving_table": payload.get("driving_table"),
        "derived_source_ids": [source.id for source in snapshot.derived_sources],
    }
    payload["context_hash"] = ""
    return WorkbenchContextSnapshotV1.model_validate(payload), bundle


def _run_fir_now(
    *,
    session: Any,
    settings: Settings,
    batch_size: int,
    project_id: str | None = None,
    sttm_id: str | None = None,
    context_key: str | None = None,
    sql_asset_id: str | None = None,
) -> dict[str, Any]:
    """Run the offline FIR task phases synchronously without Snowflake tasks."""
    namespace = (
        f"{settings.resolved_metadata_database}."
        f"{settings.resolved_metadata_schema}"
    )
    task_payload = {
        "task_type": "document_learning",
        "batch_size": int(batch_size),
        "processing_options": {
            "collect_feedback": False,
            "generate_inferences": True,
            "create_semantic_versions": True,
            "generate_recommendations": True,
            "apply_decay": False,
            "parse_documents": True,
            "priority_asset_id": sql_asset_id,
        },
        "precomputation_context": {
            key: value
            for key, value in {
                "project_id": project_id,
                "sttm_id": sttm_id,
                "context_key": context_key,
                "sql_asset_id": sql_asset_id,
            }.items()
            if value
        },
    }
    phases: list[tuple[str, str, tuple[Any, ...]]] = [
        (
            "collect_feedback",
            f"{namespace}.SP_FIR_COLLECT_FEEDBACK",
            (),
        ),
        (
            "enrich_context",
            f"{namespace}.SP_FIR_ENRICH_CONTEXT",
            (int(batch_size),),
        ),
        (
            "invoke_agent",
            f"{namespace}.SP_FIR_INVOKE_AGENT",
            (task_payload,),
        ),
        (
            "score_recommendations",
            f"{namespace}.SP_FIR_SCORE_RECOMMENDATIONS",
            (),
        ),
    ]
    results: dict[str, Any] = {}
    for phase_name, procedure_name, procedure_args in phases:
        print(f"Running FIR phase: {phase_name}", file=sys.stderr)
        raw_result = session.call(procedure_name, *procedure_args)
        if isinstance(raw_result, str):
            try:
                raw_result = json.loads(raw_result)
            except json.JSONDecodeError:
                pass
        results[phase_name] = raw_result
    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Load client documents into FIR and optionally create and publish the same "
            "project-backed STTM that the workbench UI persists."
        ),
    )
    parser.add_argument("--project-id")
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help=(
            "Client environment file containing SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, "
            "SNOWFLAKE_ROLE, SNOWFLAKE_WAREHOUSE, SNOWFLAKE_DATABASE, and "
            "SNOWFLAKE_SCHEMA. Defaults to infra/snowflake/env/client.env."
        ),
    )
    parser.add_argument("--project-name")
    parser.add_argument("--project-description")
    parser.add_argument("--project-domain")
    parser.add_argument("--project-outcome")
    parser.add_argument("--default-database")
    parser.add_argument("--default-schema")
    parser.add_argument("--mapping-name")
    parser.add_argument("--mapping-description")
    parser.add_argument("--business-goal")
    parser.add_argument(
        "--create-mapping",
        action="store_true",
        help="Create a real project STTM from all supplied SQL/Excel assets.",
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Publish the imported STTM after autosaving its canonical workspace snapshot.",
    )
    parser.add_argument(
        "--force-new-mapping",
        action="store_true",
        help="Create another STTM even when the same historical assets were already imported.",
    )
    parser.add_argument(
        "--materialize-ctes",
        action="store_true",
        help=(
            "Create secure physical derived-source views for named CTEs. "
            "This is explicit because the CTE SQL must execute in the client environment."
        ),
    )
    parser.add_argument("--revision-note", default="Imported historical client mapping.")
    parser.add_argument("--user-id", default="client_import")
    parser.add_argument("--display-name", default="Client historical import")
    parser.add_argument("--notes-json", help="JSON file containing note objects.")
    parser.add_argument(
        "--file",
        action="append",
        default=[],
        help="SQL, XLSX, XLS, or CSV asset. Repeat for multiple files.",
    )
    parser.add_argument("--sql-dir", help="Directory containing historical SQL files.")
    parser.add_argument("--sql-glob", default="*.sql")
    parser.add_argument("--excel-dir", help="Directory containing historical mapping workbooks.")
    parser.add_argument("--excel-glob", default="*.xlsx")
    parser.add_argument(
        "--asset-manifest",
        help="JSON array describing files and optional per-file table hints.",
    )
    parser.add_argument(
        "--source-table-hint",
        action="append",
        default=[],
        help="Authoritative physical source-table FQN. Repeat as needed.",
    )
    parser.add_argument(
        "--target-table-hint",
        default="",
        help="Authoritative physical target-table FQN.",
    )
    parser.add_argument(
        "--mode",
        choices=["learn_from_it", "auto_populate"],
        default="learn_from_it",
    )
    parser.add_argument("--entity-type", default="sttm_migration")
    parser.add_argument("--entity-ids-json", help="Optional JSON array of entity ids shared by loaded assets.")
    parser.add_argument(
        "--rebuild-search",
        action="store_true",
        help="Resync RAG documents and ensure Cortex Search after loading.",
    )
    parser.add_argument(
        "--process-fir-now",
        action="store_true",
        help=(
            "Run collect, enrich, AGT_FIR_SYSTEM, and recommendation scoring "
            "immediately. This does not require Snowflake task execution."
        ),
    )
    parser.add_argument(
        "--fir-batch-size",
        type=int,
        default=100,
        help="Maximum FIR records to process when --process-fir-now is used.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and build the mapping plan without connecting to or writing Snowflake.",
    )
    args = parser.parse_args()

    create_mapping = bool(args.create_mapping or args.publish or args.mode == "auto_populate")
    if args.materialize_ctes and not create_mapping:
        parser.error("--materialize-ctes requires --create-mapping or --publish.")
    if args.fir_batch_size < 1:
        parser.error("--fir-batch-size must be at least 1.")
    if create_mapping and not args.target_table_hint:
        parser.error(
            "Creating an actual mapping requires --target-table-hint with an authoritative "
            "DATABASE.SCHEMA.TABLE target."
        )
    if not args.project_id and not args.project_name:
        parser.error("Supply --project-id or --project-name.")

    entity_ids = json.loads(Path(args.entity_ids_json).read_text(encoding="utf-8")) if args.entity_ids_json else []
    if entity_ids and not isinstance(entity_ids, list):
        raise ValueError("--entity-ids-json must contain a JSON array.")

    entries = _asset_entries(args)
    inspected_assets = [_inspect_asset(entry) for entry in entries]
    if create_mapping and not inspected_assets:
        parser.error("Creating a mapping requires at least one --file or manifest asset.")

    dry_project_id = str(args.project_id or "dry_run_project")
    dry_project_name = str(args.project_name or f"Project {dry_project_id}")
    if args.dry_run:
        source_tables = _resolved_table_refs(
            assets=inspected_assets,
            references_by_asset={},
            role="source",
            explicit_hints=args.source_table_hint,
        )
        if create_mapping and not source_tables:
            parser.error(
                "Dry-run mapping creation requires at least one fully qualified "
                "--source-table-hint."
            )
        target_table = _table_ref(args.target_table_hint) if create_mapping else None
        mapping_name = str(
            args.mapping_name
            or (f"{target_table.table} Historical Mapping" if target_table else "Historical Mapping")
        )
        snapshot = (
            _build_snapshot(
                project_id=dry_project_id,
                project_name=dry_project_name,
                project_description=args.project_description,
                project_domain=args.project_domain,
                project_outcome=args.project_outcome,
                sttm_id="dry_run_sttm",
                mapping_name=mapping_name,
                mapping_description=args.mapping_description,
                business_goal=args.business_goal,
                source_tables=source_tables,
                target_table=target_table,
                assets=inspected_assets,
                derived_records=[],
            )
            if create_mapping and target_table
            else None
        )
        print(
            json.dumps(
                {
                    "project_id": dry_project_id,
                    "project_name": dry_project_name,
                    "dry_run": True,
                    "assets": [
                        _public_asset_result(
                            asset,
                            project_id=dry_project_id,
                            dry_run=True,
                        )
                        for asset in inspected_assets
                    ],
                    "mapping_plan": (
                        {
                            "mapping_name": mapping_name,
                            "source_tables": [
                                table.qualified_name for table in source_tables
                            ],
                            "target_table": target_table.qualified_name,
                            "mapping_row_count": len(snapshot.mapping_rows),
                            "detected_cte_count": sum(
                                len(asset["parsed"].ctes)
                                for asset in inspected_assets
                                if asset["suffix"] == ".sql"
                            ),
                            "will_materialize_ctes": bool(args.materialize_ctes),
                            "will_publish": bool(args.publish),
                            "context_key": snapshot.context_key,
                        }
                        if snapshot and target_table
                        else None
                    ),
                },
                indent=2,
            )
        )
        return 0

    env_file = Path(args.env_file).expanduser().resolve()
    if not env_file.is_file():
        raise FileNotFoundError(
            f"Client environment file was not found: {env_file}. "
            "Pass --env-file with the same client.env used for bootstrap and SPCS."
        )
    settings = Settings(
        _env_file=str(env_file),
        app_env="local",
        local_dev_auth_enabled=True,
        spcs_execute_as_caller_enabled=False,
        datahub_enabled=False,
    )
    missing_connection_fields = [
        field
        for field, value in (
            ("SNOWFLAKE_ACCOUNT", settings.snowflake_account),
            ("SNOWFLAKE_USER", settings.snowflake_user),
            ("SNOWFLAKE_DATABASE", settings.snowflake_database),
            ("SNOWFLAKE_SCHEMA", settings.snowflake_schema),
        )
        if not str(value or "").strip()
    ]
    if missing_connection_fields:
        raise ValueError(
            f"Missing required connection values in {env_file}: "
            + ", ".join(missing_connection_fields)
        )
    if (
        not settings.local_dev_uses_externalbrowser
        and not settings.snowflake_password.strip()
    ):
        raise ValueError(
            "Set SNOWFLAKE_AUTHENTICATOR=externalbrowser or provide "
            f"SNOWFLAKE_PASSWORD in {env_file}."
        )
    auth_label = (
        "externalbrowser"
        if settings.local_dev_uses_externalbrowser
        else "password"
    )
    print(
        (
            "Connecting to Snowflake with "
            f"{settings.snowflake_user}@{settings.snowflake_account} "
            f"using {auth_label}; role={settings.snowflake_role or '<default>'}, "
            f"warehouse={settings.snowflake_warehouse or '<default>'}, "
            f"namespace={settings.snowflake_database}.{settings.snowflake_schema}"
        ),
        file=sys.stderr,
    )
    client = get_local_cached_client(settings)
    client.session.sql("SELECT 1").collect()
    print("Snowflake connection established.", file=sys.stderr)
    memory = ConversationMemoryService(client.session, settings)
    memory.ensure_storage_exists()
    project_service = ProjectService(
        session=client.session,
        settings=settings,
        memory_service=memory,
    )

    if args.project_id:
        print(f"Loading project {args.project_id}.", file=sys.stderr)
        project = project_service.get_project(str(args.project_id))
        if project is None:
            raise ValueError(f"Project {args.project_id} was not found.")
    else:
        project = project_service.create_project(
            ProjectCreateRequest(
                project_name=str(args.project_name),
                description=args.project_description,
                metadata={
                    "domain": args.project_domain,
                    "outcome": args.project_outcome,
                    "database": args.default_database,
                    "schema": args.default_schema,
                    "source": "historical_import",
                },
            ),
            user_id=args.user_id,
            display_name=args.display_name,
        )
    project_id = project.project_id

    notes_loaded = 0

    if args.notes_json:
        for note in _load_notes(Path(args.notes_json)):
            title = str(note.get("title") or "").strip() or "Client note"
            note_text = str(note.get("note_text") or note.get("text") or "").strip()
            if not note_text:
                continue
            note_id = str(note.get("note_id") or _stable_id("note", f"{project_id}|{title}|{note_text}"))
            statement = f"""
                MERGE INTO {memory._client_notes_table} AS tgt
                USING (
                    SELECT
                        {_quote_literal(note_id)} AS NOTE_ID,
                        {_quote_literal(project_id)} AS PROJECT_ID,
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

    references_by_asset: dict[str, list[dict[str, Any]]] = {}
    asset_results: list[dict[str, Any]] = []
    for asset in inspected_assets:
        try:
            references = _persist_asset(
                session=client.session,
                settings=settings,
                project_id=project_id,
                asset=asset,
            )
        except Exception as exc:
            raise RuntimeError(
                f"Failed while importing {asset['path'].name}: {exc}"
            ) from exc
        references_by_asset[asset["asset_id"]] = references
        asset_results.append(
            _public_asset_result(
                asset,
                project_id=project_id,
                references=references,
                dry_run=False,
            )
        )

    mapping_result: dict[str, Any] | None = None
    if create_mapping:
        source_tables = _resolved_table_refs(
            assets=inspected_assets,
            references_by_asset=references_by_asset,
            role="source",
            explicit_hints=args.source_table_hint,
        )
        if not source_tables:
            raise ValueError(
                "No source tables resolved. Supply authoritative --source-table-hint values "
                "instead of allowing the importer to guess."
            )
        target_tables = _resolved_table_refs(
            assets=inspected_assets,
            references_by_asset=references_by_asset,
            role="target",
            explicit_hints=[args.target_table_hint],
        )
        if len(target_tables) != 1:
            raise ValueError(
                f"Expected exactly one target table, resolved {len(target_tables)}."
            )
        target_table = target_tables[0]
        mapping_name = str(
            args.mapping_name or f"{target_table.table} Historical Mapping"
        )
        derived_records = (
            _materialize_ctes(
                session=client.session,
                settings=settings,
                assets=inspected_assets,
                source_tables=source_tables,
                mapping_name=mapping_name,
            )
            if args.materialize_ctes
            else []
        )
        asset_ids = [asset["asset_id"] for asset in inspected_assets]
        sql_asset_hashes = [
            asset["asset_id"] for asset in inspected_assets if asset.get("suffix") == ".sql"
        ]
        import_mode = "+".join(
            sorted({str(asset.get("mode") or "learn_from_it") for asset in inspected_assets})
        )
        import_key = _historical_import_key(
            project_id=project_id,
            sql_asset_hashes=sql_asset_hashes,
            target_table=target_table,
            import_mode=import_mode,
        )
        existing, duplicates = _find_historical_mapping(
            project_service=project_service,
            project_id=project_id,
            mapping_name=mapping_name,
            target_table=target_table,
            asset_ids=asset_ids,
            sql_asset_hashes=sql_asset_hashes,
            import_mode=import_mode,
        )
        if existing and not args.force_new_mapping:
            sttm = existing
            _mark_duplicate_mappings_superseded(
                session=client.session,
                settings=settings,
                duplicates=duplicates,
            )
            print(
                f"Reusing historical mapping STTM {sttm.sttm_id}; "
                f"superseded {len(duplicates)} exact duplicate(s).",
                file=sys.stderr,
            )
        else:
            sttm = project_service.create_sttm(
                project_id,
                STTMCreateRequest(
                    sttm_name=mapping_name,
                    description=args.mapping_description,
                    target_table=target_table,
                    metadata={
                        "source": "historical_import",
                        "source_asset_ids": asset_ids,
                        "import_key": import_key,
                        "import_contract_version": 2,
                    },
                ),
                user_id=args.user_id,
                session_id=f"historical_import:{project_id}",
                thread_id=None,
            )
        snapshot = _build_snapshot(
            project_id=project_id,
            project_name=project.project_name,
            project_description=project.description,
            project_domain=args.project_domain or project.metadata.get("domain"),
            project_outcome=args.project_outcome or project.metadata.get("outcome"),
            sttm_id=sttm.sttm_id,
            mapping_name=mapping_name,
            mapping_description=args.mapping_description,
            business_goal=args.business_goal,
            source_tables=source_tables,
            target_table=target_table,
            assets=inspected_assets,
            derived_records=derived_records,
        )
        try:
            snapshot, semantic_bundle = _attach_semantic_bundle(
                client=client,
                settings=settings,
                snapshot=snapshot,
            )
        except AppError as exc:
            if exc.details:
                print(
                    "Semantic bundle validation details: "
                    + json.dumps(exc.details, ensure_ascii=True),
                    file=sys.stderr,
                )
            raise
        published = None
        unchanged_published_import = bool(
            existing
            and str((existing.metadata or {}).get("import_snapshot_hash") or "")
            == snapshot.context_hash
            and int(existing.current_version or 0) > 0
        )
        if args.publish and unchanged_published_import:
            snapshot_id = existing.last_snapshot_id
            print(
                f"Historical import {import_key} already matches published STTM "
                f"{existing.sttm_id} version {existing.current_version}; no new version created.",
                file=sys.stderr,
            )
        elif args.publish:
            published = project_service.publish_sttm(
                sttm.sttm_id,
                STTMPublishRequest(
                    revision_note=args.revision_note,
                    workspace_snapshot=snapshot,
                    session_id=f"historical_import:{project_id}",
                    semantic_bundle_id=semantic_bundle.bundle_id,
                    semantic_bundle_hash=semantic_bundle.bundle_hash,
                    metadata={
                        "source": "historical_import",
                        "source_asset_ids": asset_ids,
                        "import_key": import_key,
                    },
                ),
                user_id=args.user_id,
            )
            snapshot_id = published.snapshot_id
        else:
            autosave = project_service.autosave_sttm(
                sttm.sttm_id,
                STTMAutosaveRequest(
                    workspace_snapshot=snapshot,
                    action="historical_mapping.imported",
                    session_id=f"historical_import:{project_id}",
                    semantic_bundle_id=semantic_bundle.bundle_id,
                    semantic_bundle_hash=semantic_bundle.bundle_hash,
                    fir_events=[
                        {
                            "event_type": "mapping.historical_imported",
                            "entity_type": "sttm",
                            "entity_ids": [project_id, sttm.sttm_id],
                            "event_payload": {
                                "source_asset_ids": [
                                    asset["asset_id"] for asset in inspected_assets
                                ],
                                "mapping_row_count": len(snapshot.mapping_rows),
                                "derived_source_ids": [
                                    record.derived_source_id
                                    for record in derived_records
                                ],
                            },
                        }
                    ],
                    metadata={"source": "historical_import"},
                ),
                user_id=args.user_id,
            )
            snapshot_id = autosave.snapshot_id
        _record_import_identity(
            session=client.session,
            settings=settings,
            sttm_id=sttm.sttm_id,
            import_key=import_key,
            snapshot_hash=snapshot.context_hash,
            asset_ids=asset_ids,
            published=bool(published or unchanged_published_import),
        )
        mapping_result = {
            "sttm_id": sttm.sttm_id,
            "mapping_name": mapping_name,
            "source_tables": [table.qualified_name for table in source_tables],
            "target_table": target_table.qualified_name,
            "relationship_count": len(snapshot.relationships),
            "semantic_bundle_id": semantic_bundle.bundle_id,
            "semantic_bundle_hash": semantic_bundle.bundle_hash,
            "mapping_row_count": len(snapshot.mapping_rows),
            "snapshot_id": snapshot_id,
            "context_key": snapshot.context_key,
            "derived_sources": [
                {
                    "derived_source_id": record.derived_source_id,
                    "name": record.derived_source_name,
                    "physical_view_name": record.physical_view_name,
                }
                for record in derived_records
            ],
            "published": bool(published or unchanged_published_import),
            "version_number": (
                published.version_number
                if published
                else int(existing.current_version or 0)
                if unchanged_published_import and existing
                else None
            ),
            "idempotent_reuse": unchanged_published_import,
        }

    if args.rebuild_search:
        memory.sync_rag_documents()
        memory.ensure_search_service(rebuild=True)

    fir_processing = (
        _run_fir_now(
            session=client.session,
            settings=settings,
            batch_size=args.fir_batch_size,
            project_id=project_id,
            sttm_id=(mapping_result or {}).get("sttm_id"),
            context_key=(mapping_result or {}).get("context_key"),
            sql_asset_id=(
                asset_results[0].get("asset_id")
                if len(asset_results) == 1
                else None
            ),
        )
        if args.process_fir_now
        else None
    )

    print(
        json.dumps(
            {
                "project_id": project_id,
                "project_name": project.project_name,
                "notes_loaded": notes_loaded,
                "assets_loaded": len(asset_results),
                "search_rebuilt": bool(args.rebuild_search),
                "fir_processed_now": bool(args.process_fir_now),
                "fir_processing": fir_processing,
                "dry_run": False,
                "assets": asset_results,
                "mapping": mapping_result,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
