from __future__ import annotations

from types import SimpleNamespace

from app.core.target_mapping_patterns import (
    TargetMappingPatternService,
    _vendor_family_from_sources,
)


class _Settings:
    snowflake_target_mapping_patterns_table = "PATTERNS"
    snowflake_fir_learning_jobs_table = "JOBS"
    snowflake_fir_learning_work_items_table = "ITEMS"

    @staticmethod
    def qualify_table_name(name: str) -> str:
        return name


def _service() -> TargetMappingPatternService:
    return TargetMappingPatternService(SimpleNamespace(), _Settings())  # type: ignore[arg-type]


def test_extracts_one_pattern_per_target_and_preserves_placeholders() -> None:
    patterns = _service().extract_document_patterns(
        asset_id="asset-1",
        project_id="project-1",
        evidence_class="validated_mapping",
        base_confidence=0.9,
        parsed_document={
            "target_table": "TARGET.ACCOUNT",
            "source_tables": ["REDTAIL.CONTACTS"],
            "source_system": "REDTAIL",
            "column_mappings": [
                {
                    "target_alias": "PARENTID",
                    "transformation": "$ParentOfficeID",
                },
                {
                    "target_alias": "LEGACY_ID__C",
                    "source_columns": ["REDTAIL.CONTACTS.LEGACY_HH_ID"],
                    "transformation": "CONCAT('HH-', LEGACY_HH_ID)",
                },
            ],
        },
    )

    assert len(patterns) == 2
    assert patterns[0].mapping_recipe["mode"] == "value"
    assert patterns[0].mapping_recipe["placeholder"] == "$ParentOfficeID"
    assert patterns[0].scope == "client"
    assert patterns[1].mapping_recipe["mode"] == "complex"
    assert patterns[1].target_contract["semantic_role"] == "LEGACY"


def test_project_literal_is_not_promoted_as_client_wide_learning() -> None:
    pattern = _service().extract_document_patterns(
        asset_id="asset-2",
        project_id="project-2",
        evidence_class="unvalidated_authored_mapping_workbook",
        base_confidence=0.68,
        parsed_document={
            "target_table": "TARGET.ACCOUNT",
            "column_mappings": [
                {
                    "target_alias": "OWNERID",
                    "constant_value": "'005-project-specific'",
                }
            ],
        },
    )[0]

    assert pattern.scope == "project"
    assert pattern.mapping_recipe["expression"] is None
    assert pattern.mapping_recipe["has_project_specific_literal"] is True
    assert "Do not reuse" in pattern.exclusions[0]


def test_vendor_compatibility_requires_both_current_and_historical_vendor() -> None:
    assert _vendor_family_from_sources(["DB.REDTAIL.CONTACTS"]) == "REDTAIL"
    assert _vendor_family_from_sources(["DB.UNRECOGNIZED.CONTACTS"]) is None
