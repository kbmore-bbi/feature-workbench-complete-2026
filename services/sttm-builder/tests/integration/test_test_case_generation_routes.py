from fastapi.testclient import TestClient

from app.api.deps import get_test_case_generation_service
from app.main import app
from app.core.test_case_generation import TestCaseGenerationOutcome as _TestCaseGenerationOutcome
from app.schema.test_case_generation import TestCaseGenerationResponse as _TestCaseGenerationResponse


class _FakeTestCaseGenerationService:
    def __init__(self) -> None:
        self.captured_payload = None

    def generate(self, payload, *, request_id=None, actor=None, context=None, warnings=None, meta=None):  # type: ignore[no-untyped-def]
        self.captured_payload = payload
        return _TestCaseGenerationOutcome(
            data=_TestCaseGenerationResponse(
                status="completed",
                domain_name="account_billing",
                target_layer="curated",
                materialization="incremental",
                target_model="account_details",
                target_table="DB.SCH.ACCOUNT_DETAILS",
                test_groups=[{"group": "direct", "target_columns": ["ACCOUNT_ID"]}],
                seed_files=[
                    {
                        "file_path": "seeds/account_billing/input.csv",
                        "file_type": "SEED_INPUT",
                        "content": "ACCOUNT_ID\n101\n",
                    }
                ],
                test_case_document=[
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
                agent_name="DB.SCH.AGT_DBT_TEST_GENERATION",
            ),
            context={"thread_id": "thread-1"},
            warnings=[],
            error=None,
            meta={"agent_name": "DB.SCH.AGT_DBT_TEST_GENERATION"},
        )


def test_test_case_generation_route_returns_standard_envelope() -> None:
    client = TestClient(app)
    service = _FakeTestCaseGenerationService()
    app.dependency_overrides[get_test_case_generation_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/workbench/test-cases",
            json={
                "contract_version": "1.0",
                "request_id": "req-test-cases-1",
                "operation": "test_cases.generate",
                "context": {},
                "data": {
                    "target_table": {
                        "database": "DB",
                        "schema": "SCH",
                        "table": "ACCOUNT_DETAILS",
                    },
                    "source_tables": [
                        {
                            "database": "DB",
                            "schema": "SCH",
                            "table": "DS_ACCOUNTS",
                        }
                    ],
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
                },
                "warnings": [],
                "error": None,
                "meta": {},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["operation"] == "test_cases.generate"
    assert payload["data"]["target_model"] == "account_details"
    assert service.captured_payload is not None
    assert service.captured_payload.target_table.table == "ACCOUNT_DETAILS"
