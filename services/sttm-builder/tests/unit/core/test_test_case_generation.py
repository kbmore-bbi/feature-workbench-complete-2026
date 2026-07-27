import json

from app.core.test_case_generation import (
    TEST_CASE_GENERATION_OPERATION,
    TestCaseGenerationService as _TestCaseGenerationService,
)
from app.schema.test_case_generation import TestCaseGenerationRequest as _TestCaseGenerationRequest


def _table(name: str = "SRC") -> dict:
    return {"database": "DB", "schema": "SCH", "table": name}


def test_build_agent_request_uses_standard_envelope() -> None:
    service = _TestCaseGenerationService.__new__(_TestCaseGenerationService)
    service._agent_name = "DB.SCH.AGT_DBT_TEST_GENERATION"  # type: ignore[attr-defined]

    payload = _TestCaseGenerationRequest.model_validate(
        {
            "target_table": _table("ACCOUNT_DETAILS"),
            "source_tables": [_table("DS_ACCOUNTS")],
            "relationships": [],
            "validated_sql": "select ACCT_ID as ACCOUNT_ID from DB.SCH.DS_ACCOUNTS",
            "mappings": [
                {
                    "target_column": "ACCOUNT_ID",
                    "target_type": "NUMBER",
                    "source_column": "DB.SCH.DS_ACCOUNTS.ACCT_ID",
                    "source_columns": ["DB.SCH.DS_ACCOUNTS.ACCT_ID"],
                    "rule": "Direct",
                    "status": "MAPPED",
                }
            ],
            "semantic_context": [],
            "derived_sources": [],
        }
    )

    built = service._build_agent_request(  # type: ignore[attr-defined]
        payload,
        request_id="req-test-1",
        actor=None,
        context={},
        meta={},
    )

    assert built["contract_version"] == "1.0"
    assert built["operation"] == TEST_CASE_GENERATION_OPERATION
    assert built["data"]["target_table"]["table"] == "ACCOUNT_DETAILS"
    assert built["data"]["attribute_mappings"]["ACCOUNT_ID"]["source_attributes"] == [
        "DB.SCH.DS_ACCOUNTS.ACCT_ID"
    ]
    assert built["meta"]["transport"] == "workbench_standard_envelope"


def test_parse_legacy_cortex_payload_with_embedded_json() -> None:
    service = _TestCaseGenerationService.__new__(_TestCaseGenerationService)
    service._agent_name = "DB.SCH.AGT_DBT_TEST_GENERATION"  # type: ignore[attr-defined]

    raw_payload = {
        "content": [
            {
                "type": "text",
                "text": (
                    "Reasoning omitted.\n"
                    + json.dumps(
                        {
                            "status": "completed",
                            "domain_name": "account_billing",
                            "target_layer": "curated",
                            "materialization": "incremental",
                            "target_model": "account_details",
                            "target_table": "DB.SCH.ACCOUNT_DETAILS",
                            "test_groups": [
                                {"group": "direct", "target_columns": ["ACCOUNT_ID"]}
                            ],
                            "seed_files": [
                                {
                                    "file_path": "seeds/account_billing/input.csv",
                                    "file_type": "SEED_INPUT",
                                    "content": "ACCOUNT_ID\n101\n",
                                }
                            ],
                            "test_case_document": [
                                {
                                    "test_case_id": "TC_001",
                                    "group": "direct",
                                    "target_attribute": "ACCOUNT_ID",
                                    "source_columns": "DS_ACCOUNTS.ACCT_ID",
                                    "mapping_rule": "Direct",
                                    "test_case_description": "Account id copies directly.",
                                    "test_type": "Positive",
                                    "sample_source_input": "ACCT_ID=101",
                                    "expected_target_value": "ACCOUNT_ID=101",
                                    "confidence": "HIGH",
                                }
                            ],
                        }
                    )
                ),
            }
        ]
    }

    response, warnings, error, meta = service._parse_response("", raw_payload=raw_payload)  # type: ignore[attr-defined]

    assert response.status == "completed"
    assert response.target_model == "account_details"
    assert response.test_groups[0].group == "direct"
    assert response.seed_files[0].file_type == "SEED_INPUT"
    assert response.test_case_document[0].test_case_id == "TC_001"
    assert warnings == []
    assert error is None
    assert meta["raw_payload_present"] is True
