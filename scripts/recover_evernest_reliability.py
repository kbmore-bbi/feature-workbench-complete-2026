#!/usr/bin/env python3
"""Reconcile and repair the canonical EverNest import without deleting audit data.

The default mode is read-only. Use --apply-archive to suppress the five known
failed duplicate scopes, and --publish-repair only after reviewing the report.
The publication path re-projects SQL already stored on mapping 1101; the local
fixture is used only as a byte/hash guard and is never uploaded as a new asset.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = REPO_ROOT / "services" / "sttm-builder"
DEFAULT_ENV_FILE = REPO_ROOT / "infra" / "snowflake" / "env" / "client.env"
DEFAULT_SQL_FILE = REPO_ROOT / "docs" / "01-EverNest-HHs-reference.sql"
MIGRATION_FILE = REPO_ROOT / "infra" / "snowflake" / "scripts" / "20260719_evernest_import_reliability.sql"
CANONICAL_PROJECT_ID = "903"
CANONICAL_STTM_ID = "1101"
DUPLICATE_PROJECT_IDS = ("602", "902", "901", "801", "701")
EXPECTED_SQL_BYTES = 13_688
EXPECTED_COUNTS = {
    "physical_sources": 20,
    "ctes": 18,
    "mappings": 26,
}

if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.core.config import Settings
from app.core.conversation_memory import ConversationMemoryService
from app.core.mapping_sql import MappingSqlService
from app.core.project_service import ProjectService
from app.core.snowflake import get_local_cached_client
from app.core.sql_parser import parse_sql_document
from app.schema.common import TableRef
from app.schema.mapping_sql import MappingSqlParseRequest
from app.schema.project import STTMPublishRequest


def _quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _rows(session: Any, sql: str) -> list[dict[str, Any]]:
    return [
        row.as_dict() if hasattr(row, "as_dict") else dict(row)
        for row in session.sql(sql).collect()
    ]


def _namespace(settings: Settings, name: str) -> str:
    return settings.qualify_metadata_object_name(name)


def _columns(session: Any, table: str) -> set[str]:
    return {
        str(row.get("name") or row.get("NAME") or "").upper()
        for row in _rows(session, f"DESC TABLE {table}")
        if row.get("name") or row.get("NAME")
    }


def _reconciliation_report(session: Any, settings: Settings) -> dict[str, Any]:
    projects = settings.qualify_table_name(settings.snowflake_projects_table)
    sttms = settings.qualify_table_name(settings.snowflake_sttm_table)
    snapshots = _namespace(settings, "TBL_WORKSPACE_SNAPSHOTS")
    project_columns = _columns(session, projects)
    sttm_columns = _columns(session, sttms)
    snapshot_columns = _columns(session, snapshots)
    project_suppressed = (
        "COALESCE(RUNTIME_SUPPRESSED, FALSE)" if "RUNTIME_SUPPRESSED" in project_columns else "FALSE"
    )
    sttm_suppressed = (
        "COALESCE(RUNTIME_SUPPRESSED, FALSE)" if "RUNTIME_SUPPRESSED" in sttm_columns else "FALSE"
    )
    snapshot_suppressed = (
        "COALESCE(RUNTIME_SUPPRESSED, FALSE)" if "RUNTIME_SUPPRESSED" in snapshot_columns else "FALSE"
    )
    import_key = "IMPORT_KEY" if "IMPORT_KEY" in sttm_columns else "NULL"
    import_state = "IMPORT_STATE" if "IMPORT_STATE" in sttm_columns else "NULL"
    raw_sql_bytes = (
        "LENGTH(COALESCE(RAW_MAPPING_SQL, ''))" if "RAW_MAPPING_SQL" in sttm_columns else "NULL"
    )
    project_ids = ", ".join(_quote(value) for value in (*DUPLICATE_PROJECT_IDS, CANONICAL_PROJECT_ID))
    project_rows = _rows(
        session,
        f"""
        SELECT PROJECT_ID, PROJECT_NAME, STATUS,
               {project_suppressed} AS RUNTIME_SUPPRESSED
        FROM {projects}
        WHERE TO_VARCHAR(PROJECT_ID) IN ({project_ids})
        ORDER BY PROJECT_ID
        """,
    )
    mapping_rows = _rows(
        session,
        f"""
        SELECT STTM_ID, PROJECT_ID, STTM_NAME, STATUS, CURRENT_VERSION,
               HAS_UNPUBLISHED_DRAFT, LAST_SNAPSHOT_ID,
               {import_key} AS IMPORT_KEY, {import_state} AS IMPORT_STATE,
               {sttm_suppressed} AS RUNTIME_SUPPRESSED,
               {raw_sql_bytes} AS RAW_SQL_BYTES
        FROM {sttms}
        WHERE TO_VARCHAR(PROJECT_ID) IN ({project_ids})
        ORDER BY PROJECT_ID, STTM_ID
        """,
    )
    snapshot_rows = _rows(
        session,
        f"""
        SELECT PROJECT_ID, STTM_ID, COUNT(*) AS SNAPSHOT_COUNT,
               COUNT_IF({snapshot_suppressed}) AS SUPPRESSED_COUNT
        FROM {snapshots}
        WHERE PROJECT_ID IN ({project_ids})
        GROUP BY PROJECT_ID, STTM_ID
        ORDER BY PROJECT_ID, STTM_ID
        """,
    )
    return {
        "canonical": {
            "project_id": CANONICAL_PROJECT_ID,
            "sttm_id": CANONICAL_STTM_ID,
        },
        "duplicate_project_ids": list(DUPLICATE_PROJECT_IDS),
        "projects": project_rows,
        "mappings": mapping_rows,
        "snapshots": snapshot_rows,
    }


def _apply_migration(session: Any, settings: Settings) -> int:
    namespace = f"{settings.snowflake_database}.{settings.snowflake_schema}"
    sql_text = MIGRATION_FILE.read_text(encoding="utf-8").replace(
        "__STTM_METADATA_NAMESPACE__", namespace
    )
    sql_text = "\n".join(
        line for line in sql_text.splitlines() if not line.lstrip().startswith("--")
    )
    statements = [statement.strip() for statement in sql_text.split(";") if statement.strip()]
    for statement in statements:
        session.sql(statement).collect()
    return len(statements)


def _validate_report(report: dict[str, Any]) -> None:
    projects = {str(row.get("PROJECT_ID")) for row in report["projects"]}
    missing = set((*DUPLICATE_PROJECT_IDS, CANONICAL_PROJECT_ID)) - projects
    if missing:
        raise RuntimeError(f"Reconciliation is incomplete; missing projects: {sorted(missing)}")
    canonical = [
        row for row in report["mappings"]
        if str(row.get("PROJECT_ID")) == CANONICAL_PROJECT_ID
        and str(row.get("STTM_ID")) == CANONICAL_STTM_ID
    ]
    if len(canonical) != 1:
        raise RuntimeError("Canonical mapping 903/1101 was not found exactly once.")
    row = canonical[0]
    if str(row.get("STATUS") or "").upper() != "COMPLETE":
        raise RuntimeError(f"Canonical mapping is not COMPLETE: {row.get('STATUS')}")
    if int(row.get("CURRENT_VERSION") or 0) < 1:
        raise RuntimeError("Canonical mapping has no published version.")


def _archive_duplicates(session: Any, settings: Settings) -> dict[str, int]:
    projects = settings.qualify_table_name(settings.snowflake_projects_table)
    sttms = settings.qualify_table_name(settings.snowflake_sttm_table)
    snapshots = _namespace(settings, "TBL_WORKSPACE_SNAPSHOTS")
    recommendations = _namespace(settings, "TBL_FIR_AGENT_RECOMMENDATIONS")
    context_evidence = _namespace(settings, "TBL_FIR_CONTEXT_EVIDENCE")
    evidence_items = _namespace(settings, "TBL_FIR_EVIDENCE_ITEMS")
    required_columns = {
        projects: {"RUNTIME_SUPPRESSED", "ARCHIVED_AT"},
        sttms: {"IMPORT_STATE", "RUNTIME_SUPPRESSED", "SUPERSEDED_BY"},
        snapshots: {"RUNTIME_SUPPRESSED"},
        recommendations: {"PROJECT_ID"},
    }
    missing = {
        table: sorted(columns - _columns(session, table))
        for table, columns in required_columns.items()
        if columns - _columns(session, table)
    }
    if missing:
        raise RuntimeError(
            "Apply infra/snowflake/scripts/20260719_evernest_import_reliability.sql "
            f"before archive recovery; missing columns: {missing}"
        )
    ids = ", ".join(_quote(value) for value in DUPLICATE_PROJECT_IDS)
    applicable_project_match = " OR ".join(
        f"ARRAY_CONTAINS({_quote(value)}::VARIANT, APPLICABLE_PROJECTS)"
        for value in DUPLICATE_PROJECT_IDS
    )
    statements = {
        "projects_archived": f"""
            UPDATE {projects}
            SET STATUS = 'ARCHIVED', RUNTIME_SUPPRESSED = TRUE,
                ARCHIVED_AT = COALESCE(ARCHIVED_AT, CURRENT_TIMESTAMP()),
                LAST_MODIFIED_DATETIME = CURRENT_TIMESTAMP()
            WHERE TO_VARCHAR(PROJECT_ID) IN ({ids})
              AND (COALESCE(STATUS, 'ACTIVE') <> 'ARCHIVED'
                   OR COALESCE(RUNTIME_SUPPRESSED, FALSE) = FALSE)
        """,
        "mappings_superseded": f"""
            UPDATE {sttms}
            SET STATUS = 'SUPERSEDED', IMPORT_STATE = 'IMPORT_FAILED',
                RUNTIME_SUPPRESSED = TRUE, SUPERSEDED_BY = { _quote(CANONICAL_STTM_ID) },
                LAST_MODIFIED_DATETIME = CURRENT_TIMESTAMP()
            WHERE TO_VARCHAR(PROJECT_ID) IN ({ids})
              AND (COALESCE(STATUS, 'DRAFT') <> 'SUPERSEDED'
                   OR COALESCE(RUNTIME_SUPPRESSED, FALSE) = FALSE)
        """,
        "snapshots_suppressed": f"""
            UPDATE {snapshots}
            SET RUNTIME_SUPPRESSED = TRUE
            WHERE PROJECT_ID IN ({ids})
              AND COALESCE(RUNTIME_SUPPRESSED, FALSE) = FALSE
        """,
        "recommendations_archived": f"""
            UPDATE {recommendations}
            SET STATUS = 'archived', UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE STATUS = 'active'
              AND (
                PROJECT_ID IN ({ids})
                OR {applicable_project_match}
              )
        """,
        "context_evidence_suppressed": f"""
            UPDATE {context_evidence}
            SET EVIDENCE_STATUS = 'suppressed', UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE PROJECT_ID IN ({ids})
              AND COALESCE(EVIDENCE_STATUS, 'ready') <> 'suppressed'
        """,
        "evidence_items_suppressed": f"""
            UPDATE {evidence_items}
            SET STRUCTURED_PAYLOAD = OBJECT_INSERT(
                    COALESCE(STRUCTURED_PAYLOAD, OBJECT_CONSTRUCT()),
                    'runtime_suppressed', TRUE, TRUE
                ),
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE PROJECT_ID IN ({ids})
              AND COALESCE(STRUCTURED_PAYLOAD:runtime_suppressed::BOOLEAN, FALSE) = FALSE
        """,
    }
    counts: dict[str, int] = {}
    for name, statement in statements.items():
        result = session.sql(statement).collect()
        row = result[0].as_dict() if result and hasattr(result[0], "as_dict") else {}
        counts[name] = int(
            row.get("number of rows updated")
            or row.get("NUMBER OF ROWS UPDATED")
            or 0
        )
    return counts


def _table_ref(value: str) -> TableRef:
    database, schema, table = value.split(".", 2)
    return TableRef(database=database, schema=schema, table=table)


def _reproject_and_publish(
    session: Any,
    settings: Settings,
    *,
    fixture_path: Path,
    user_id: str,
) -> dict[str, Any]:
    memory = ConversationMemoryService(session, settings)
    service = ProjectService(session=session, settings=settings, memory_service=memory)
    detail = service.get_sttm_detail(CANONICAL_STTM_ID)
    if detail is None or detail.project is None:
        raise RuntimeError("Canonical mapping 903/1101 is not available for repair.")
    if detail.sttm.project_id != CANONICAL_PROJECT_ID:
        raise RuntimeError("Mapping 1101 does not belong to canonical project 903.")

    snapshot = dict(detail.latest_snapshot or {})
    stored_sql = str(
        snapshot.get("raw_mapping_sql")
        or snapshot.get("mapping_sql")
        or ""
    )
    fixture_bytes = fixture_path.read_bytes()
    if len(fixture_bytes) != EXPECTED_SQL_BYTES:
        raise RuntimeError(
            f"Fixture byte guard failed: {len(fixture_bytes)} != {EXPECTED_SQL_BYTES}"
        )
    try:
        fixture_sql = fixture_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError("EverNest fixture is not valid UTF-8.") from exc
    if stored_sql.encode("utf-8") != fixture_bytes:
        raise RuntimeError(
            "Stored mapping 1101 SQL does not byte-match the authoritative fixture; "
            "repair stopped without writing."
        )

    parsed = parse_sql_document(stored_sql)
    known_tables = [
        TableRef.model_validate(value)
        for value in snapshot.get("source_tables") or []
        if isinstance(value, dict)
    ]
    if not known_tables:
        known_tables = [
            TableRef(
                database=str(row.get("DATABASE_NAME") or row.get("database_name") or ""),
                schema=str(row.get("SCHEMA_NAME") or row.get("schema_name") or ""),
                table=str(row.get("TABLE_NAME") or row.get("table_name") or ""),
            )
            for row in detail.sources
            if str(row.get("DATABASE_NAME") or row.get("database_name") or "")
            and str(row.get("SCHEMA_NAME") or row.get("schema_name") or "")
            and str(row.get("TABLE_NAME") or row.get("table_name") or "")
        ]
    current_target = str(snapshot.get("target_table") or detail.sttm.target_table or "")
    if isinstance(snapshot.get("target_table"), dict):
        target_ref = TableRef.model_validate(snapshot["target_table"])
        current_target = target_ref.qualified_name
    if current_target:
        known_tables.append(_table_ref(current_target))
    projection = MappingSqlService(session=session, analyst_client=None).parse(
        MappingSqlParseRequest(
            sql=stored_sql,
            known_tables=known_tables,
            current_workspace={"target_table": current_target},
        )
    )
    if not projection.valid:
        raise RuntimeError(
            "EverNest projection is not safe to apply: "
            + json.dumps(
                {
                    "unresolved": projection.unresolved_references,
                    "ambiguous": projection.ambiguous_references,
                },
                sort_keys=True,
            )
        )
    workspace = projection.parsed_workspace
    physical_refs = [_table_ref(value) for value in workspace.get("source_tables") or []]
    actual_counts = {
        "physical_sources": len(workspace.get("source_tables") or []),
        "ctes": len(workspace.get("ctes") or []),
        "mappings": len(workspace.get("mapping_rows") or []),
    }
    if actual_counts != EXPECTED_COUNTS:
        raise RuntimeError(
            f"EverNest projection counts changed: {actual_counts} != {EXPECTED_COUNTS}"
        )

    if int(detail.sttm.current_version or 0) >= 2:
        parsed_model = snapshot.get("parsed_mapping_model") or {}
        stats = parsed_model.get("stats") if isinstance(parsed_model, dict) else {}
        if int((stats or {}).get("tables") or 0) == EXPECTED_COUNTS["physical_sources"]:
            return {
                "status": "already_repaired",
                "version_number": detail.sttm.current_version,
                "snapshot_id": detail.sttm.last_snapshot_id,
                "counts": actual_counts,
            }

    mapping_rows = []
    for index, row in enumerate(workspace.get("mapping_rows") or []):
        target = str(row.get("target_column") or f"COLUMN_{index + 1}")
        mapping_rows.append({"id": f"evernest:{index}:{target}", **row})
    derived_sources = [
        {
            "id": f"sql-cte:{item.get('name')}",
            "name": item.get("name"),
            "sql_hash": hashlib.sha256(
                str(item.get("sql_text") or "").encode("utf-8")
            ).hexdigest(),
            "lineage": [{"dependencies": item.get("dependencies") or []}],
        }
        for item in workspace.get("derived_sources") or []
    ]
    filter_rules = workspace.get("filters") or []
    snapshot.update(
        {
            "context_version": "2.0",
            "context_hash": "",
            "context_key": "",
            "scope_key": "",
            "snapshot_id": None,
            "page": "mapping",
            "surface": "MAPPING",
            "action": "sql.reprojected",
            "milestone": "sttm.published",
            "checkpoint": "sttm.published",
            "scope_type": "mapping",
            "project_id": CANONICAL_PROJECT_ID,
            "sttm_id": CANONICAL_STTM_ID,
            "source_tables": [ref.model_dump(mode="json") for ref in physical_refs],
            "target_table": _table_ref(str(workspace.get("target_table") or current_target)).model_dump(mode="json"),
            "mapping_rows": mapping_rows,
            "relationships": workspace.get("relationships") or [],
            "derived_sources": derived_sources,
            "filters": {
                "filter_sql": "\n".join(
                    str(item.get("sql_fragment") or "")
                    for item in filter_rules
                    if item.get("rule_type") in {"where_filter", "qualify_filter"}
                ),
                "group_by_sql": "\n".join(
                    str(item.get("sql_fragment") or "")
                    for item in filter_rules if item.get("rule_type") == "grouping"
                ),
                "order_by_sql": "\n".join(
                    str(item.get("sql_fragment") or "")
                    for item in filter_rules if item.get("rule_type") == "sorting"
                ),
                "groups": [],
            },
            "raw_mapping_sql": stored_sql,
            "mapping_sql": stored_sql,
            "mapping_preview_sql": str(snapshot.get("mapping_preview_sql") or ""),
            "parsed_mapping_model": parsed.to_dict(),
        }
    )
    result = service.publish_sttm(
        CANONICAL_STTM_ID,
        STTMPublishRequest(
            revision_note="EverNest reliability repair: re-projected canonical raw SQL.",
            workspace_snapshot=snapshot,
            session_id="evernest_reliability_repair",
            metadata={
                "source": "evernest_reliability_repair",
                "canonical_project_id": CANONICAL_PROJECT_ID,
                "canonical_sttm_id": CANONICAL_STTM_ID,
            },
        ),
        user_id=user_id,
    )
    if result.version_number != 2:
        raise RuntimeError(
            f"Repair published unexpected version {result.version_number}; expected version 2."
        )
    return {
        "status": "published",
        "version_number": result.version_number,
        "snapshot_id": result.snapshot_id,
        "counts": actual_counts,
        "raw_sql_bytes": len(stored_sql.encode("utf-8")),
        "raw_sql_sha256": hashlib.sha256(stored_sql.encode("utf-8")).hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE))
    parser.add_argument("--sql-file", default=str(DEFAULT_SQL_FILE))
    parser.add_argument(
        "--user-id",
        default="1",
        help="Legacy numeric actor id used by the canonical EverNest mapping (default: 1).",
    )
    parser.add_argument("--apply-migration", action="store_true")
    parser.add_argument("--apply-archive", action="store_true")
    parser.add_argument("--publish-repair", action="store_true")
    args = parser.parse_args()

    settings = Settings(
        _env_file=str(Path(args.env_file).expanduser().resolve()),
        app_env="local",
        local_dev_auth_enabled=True,
        spcs_execute_as_caller_enabled=False,
        datahub_enabled=False,
    )
    client = get_local_cached_client(settings)
    migration_count = _apply_migration(client.session, settings) if args.apply_migration else 0
    report_before = _reconciliation_report(client.session, settings)
    _validate_report(report_before)
    result: dict[str, Any] = {
        "report_before": report_before,
        "writes": {"migration_statements": migration_count} if migration_count else {},
    }
    if args.apply_archive:
        result["writes"]["archive"] = _archive_duplicates(client.session, settings)
    if args.publish_repair:
        if not args.apply_archive:
            archived = {
                str(row.get("PROJECT_ID"))
                for row in report_before["projects"]
                if str(row.get("STATUS") or "").upper() == "ARCHIVED"
                and bool(row.get("RUNTIME_SUPPRESSED"))
            }
            if set(DUPLICATE_PROJECT_IDS) - archived:
                raise RuntimeError(
                    "Archive/suppress duplicate scopes before publishing the repaired canonical version."
                )
        result["writes"]["publication"] = _reproject_and_publish(
            client.session,
            settings,
            fixture_path=Path(args.sql_file).expanduser().resolve(),
            user_id=args.user_id,
        )
    if args.apply_archive or args.publish_repair:
        result["report_after"] = _reconciliation_report(client.session, settings)
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
