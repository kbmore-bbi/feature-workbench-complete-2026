from __future__ import annotations

from pathlib import Path

from app.core.config import Settings
from app.core.sql_parser import bind_sql_document_context, parse_sql_document
from app.core.target_mapping_patterns import TargetMappingPatternService
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


def test_evernest_select_binds_target_and_resolves_recursive_column_lineage() -> None:
    parsed = bind_sql_document_context(
        parse_sql_document(EVERNEST_SQL.read_text(encoding="utf-8")),
        workspace_target="CRM_TARGET.PUBLIC.ACCOUNT",
    )

    assert parsed.target_table == "CRM_TARGET.PUBLIC.ACCOUNT"
    assert parsed.target_binding["binding_source"] == "workspace_selection"
    assert all(
        mapping.target_table == "CRM_TARGET.PUBLIC.ACCOUNT"
        for mapping in parsed.column_mappings
    )
    source_backed = [
        mapping for mapping in parsed.column_mappings if mapping.source_columns
    ]
    assert len(source_backed) == 21
    assert all(not mapping.unresolved_references for mapping in source_backed)

    by_target = {
        mapping.target_alias: mapping for mapping in parsed.column_mappings
    }
    assert set(by_target["Household_Type__c"].physical_source_columns) == {
        "CONTACT_STATUSES.name",
        "CONTACTS.type",
    }
    assert set(by_target["BillingStreet"].physical_source_columns) == {
        "ADDRESSES.street_address",
        "ADDRESSES.secondary_address",
    }
    assert set(by_target["included_in_household"].physical_source_columns) >= {
        "CONTACTS.id",
        "CONTACTS.dob",
        "CONTACT_FAMILY_MEMBERS.hoh",
        "CONTACT_FAMILY_MEMBERS.relationship",
    }
    assert sum(
        mapping.constant_value is not None
        for mapping in parsed.column_mappings
    ) == 5
    assert len(parsed.knowledge_graph["nodes"]) > 100
    assert all(cte.output_columns for cte in parsed.ctes)
    assert next(cte for cte in parsed.ctes if cte.name == "SOURCE").derived_source_candidate
    assert not next(
        cte for cte in parsed.ctes if cte.name == "UserMaster"
    ).derived_source_candidate
    patterns = TargetMappingPatternService(
        object(), Settings()
    ).extract_document_patterns(
        asset_id="evernest_asset",
        project_id="evernest_project",
        parsed_document=parsed.to_dict(),
        evidence_class="unvalidated_authored_sql",
        base_confidence=0.72,
    )
    assert len(patterns) == 26
    assert all(
        len(pattern.derived_dependencies) < len(parsed.ctes)
        for pattern in patterns
    )
    assert all(
        pattern.source_system_profile["source_tables"]
        != parsed.source_tables
        for pattern in patterns
        if pattern.mapping_recipe["source_dependencies"]
    )


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
