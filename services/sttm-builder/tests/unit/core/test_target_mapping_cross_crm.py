import json

from app.core.config import Settings
from app.core.target_mapping_patterns import TargetMappingPatternService
from app.schema.fir_patterns import TargetMappingPatternV2


class _Row:
    def __init__(self, values: dict) -> None:
        self._values = values

    def as_dict(self) -> dict:
        return self._values


class _Query:
    def __init__(self, rows: list[_Row]) -> None:
        self._rows = rows

    def collect(self) -> list[_Row]:
        return self._rows


class _Session:
    def __init__(self, pattern: TargetMappingPatternV2) -> None:
        self.pattern = pattern

    def sql(self, statement: str):
        if "SELECT PATTERN_PAYLOAD" in statement:
            return _Query(
                [
                    _Row(
                        {
                            "PATTERN_PAYLOAD": json.dumps(
                                self.pattern.model_dump(mode="json"),
                                default=str,
                            ),
                            "SUPPORT_COUNT": 2,
                            "CONTRADICTION_COUNT": 0,
                            "VALIDATION_STATUS": "validated",
                            "CONFIDENCE": 0.92,
                        }
                    )
                ]
            )
        return _Query([])


def _pattern() -> TargetMappingPatternV2:
    return TargetMappingPatternV2(
        pattern_id="pattern_cross_crm",
        target_contract={
            "target_fqn": "CURATED.CRM.CUSTOMER",
            "target_column": "CUSTOMER_NAME",
            "type": "VARCHAR",
            "grain": "CUSTOMER",
        },
        source_system_profile={
            "vendor_family": "SALESFORCE",
            "source_tables": ["RAW.SALESFORCE.ACCOUNT"],
            "source_columns": [
                {
                    "physical_name": "RAW.SALESFORCE.ACCOUNT.FULL_NAME",
                    "semantic_role": "FULL",
                    "type": "VARCHAR",
                    "grain": "CUSTOMER",
                }
            ],
        },
        source_compatibility_signature="signature",
        mapping_recipe={
            "mode": "direct",
            "source_dependencies": ["RAW.SALESFORCE.ACCOUNT.FULL_NAME"],
        },
        validation_status="validated",
        confidence=0.92,
        provenance={"evidence_class": "validated_imported_sql"},
        content_hash="content_hash",
    )


def test_tier_three_adapts_roles_only_after_type_and_grain_checks() -> None:
    service = TargetMappingPatternService(_Session(_pattern()), Settings())
    candidate = service.retrieve_candidates(
        target_table="CURATED.CRM.CUSTOMER",
        target_columns=["CUSTOMER_NAME"],
        source_tables=["RAW.HUBSPOT.CONTACT"],
        source_columns=["RAW.HUBSPOT.CONTACT.FULL_NAME"],
        source_column_profiles=[
            {
                "physical_name": "RAW.HUBSPOT.CONTACT.FULL_NAME",
                "type": "VARCHAR",
                "grain": "CUSTOMER",
            }
        ],
        crm_family="HUBSPOT",
    )[0]

    assert candidate.compatibility_tier == 3
    assert candidate.decision == "adapt_pattern"
    assert candidate.adapted_source_columns == [
        "RAW.HUBSPOT.CONTACT.FULL_NAME"
    ]


def test_incompatible_cross_crm_pattern_returns_prepare_source() -> None:
    service = TargetMappingPatternService(_Session(_pattern()), Settings())
    candidate = service.retrieve_candidates(
        target_table="CURATED.CRM.CUSTOMER",
        target_columns=["CUSTOMER_NAME"],
        source_tables=["RAW.HUBSPOT.CONTACT"],
        source_columns=["RAW.HUBSPOT.CONTACT.FULL_NAME"],
        source_column_profiles=[
            {
                "physical_name": "RAW.HUBSPOT.CONTACT.FULL_NAME",
                "type": "NUMBER",
                "grain": "TRANSACTION",
            }
        ],
        crm_family="HUBSPOT",
    )[0]

    assert candidate.compatibility_tier == 4
    assert candidate.decision == "unresolved"
    assert candidate.prepare_source_action
    assert "compatible_source_types" in candidate.missing_dependencies
    assert "compatible_source_grain" in candidate.missing_dependencies
