from __future__ import annotations

from pathlib import Path

from app.core.sql_parser import parse_sql_document
from app.schema.common import TableRef
from app.schema.workspace_context import WorkbenchContextSnapshotV2


REPO_ROOT = Path(__file__).resolve().parents[5]
EVERNEST_SQL = REPO_ROOT / "docs" / "01-EverNest-HHs-reference.sql"


def test_evernest_sql_preserves_raw_bytes_and_full_projection() -> None:
    raw = EVERNEST_SQL.read_bytes()
    assert len(raw) == 13_688

    parsed = parse_sql_document(raw.decode("utf-8"))

    assert len(parsed.source_tables) == 20
    assert len(parsed.ctes) == 18
    assert len(parsed.column_mappings) == 26
    assert len(parsed.join_patterns) == 30
    assert len(parsed.business_rules) == 39
    assert sum(item.is_derived_source for item in parsed.ctes) == 10
    assert any(item.mapping_mode == "constant" for item in parsed.column_mappings)
    assert any(item.transformation for item in parsed.column_mappings)
    assert all(not name.upper().startswith("USE ") for name in parsed.source_tables)
    assert all("IDENTIFIER(" not in name.upper() for name in parsed.source_tables)
    assert all(not name.startswith("$") for name in parsed.source_tables)


def test_workspace_identity_is_mapping_scoped() -> None:
    common = {
        "project_id": "903",
        "source_tables": [TableRef(database="DB", schema="SRC", table="CONTACT")],
        "target_table": TableRef(database="DB", schema="TGT", table="HOUSEHOLD"),
        "scope_type": "mapping",
        "action": "before_auto_map",
    }
    first = WorkbenchContextSnapshotV2(sttm_id="1101", **common)
    second = WorkbenchContextSnapshotV2(sttm_id="1102", **common)

    assert first.context_key != second.context_key
    assert first.scope_key != second.scope_key
