import json

import pytest

from app.core.agent_payload_budget import (
    AgentPayloadBudgetError,
    budget_agent_payload,
)


def _large_envelope(size: int) -> dict:
    target = "HOUSEHOLD_ID"
    filler = "semantic evidence " + ("x" * size)
    return {
        "contract_version": "1.0",
        "request_id": "req-1",
        "operation": "auto_map",
        "data": {
            "intent": "auto_map",
            "message": "Map the selected target using approved evidence.",
            "attributes": [{"target_attribute": target}],
            "previous_response": {"body": filler, "artifact_id": "old-response"},
        },
        "context": {
            "source_tables": ["DB.SRC.CONTACTS"],
            "target_table": "DB.TGT.HOUSEHOLDS",
            "relationships": [
                {
                    "left_table": "DB.SRC.CONTACTS",
                    "right_table": "DB.SRC.FAMILIES",
                    "condition": "CONTACTS.ID = FAMILIES.CONTACT_ID",
                    "confidence": 0.96,
                }
            ],
            "workspace_context": {
                "mapping_rows": [
                    {
                        "target_column": target,
                        "source_column": "CONTACTS.ID",
                        "transformation": "TO_VARCHAR(CONTACTS.ID)",
                    }
                ],
                "conversation_history": [filler],
                "mapping_artifacts": [{"artifact_id": "artifact-1", "body": filler}],
            },
            "semantic_context": [
                {
                    "table_fqn": "DB.SRC.CONTACTS",
                    "semantic_model": {
                        "description": filler,
                        "attributes": [
                            {
                                "name": target,
                                "physical_column": "ID",
                                "evidence_id": "sem-evidence-1",
                                "confidence": 0.96,
                            },
                            *[
                                {"name": f"UNRELATED_{index}", "description": filler[:5000]}
                                for index in range(80)
                            ],
                        ],
                    },
                }
            ],
            "learning_context": {
                "fir_recommendations": [
                    {
                        "target_column": target,
                        "evidence_ids": ["fir-evidence-1"],
                        "confidence": 0.91,
                        "rationale": "Approved household identifier precedent.",
                        "transformation": "TO_VARCHAR(CONTACTS.ID)",
                    },
                    *[
                        {"target_column": f"OTHER_{index}", "body": filler[:8000]}
                        for index in range(50)
                    ],
                ],
                "correction_history": [
                    {
                        "target_column": target,
                        "evidence_id": "correction-1",
                        "rationale": "Keep the source identifier as text.",
                    }
                ],
                "target_mapping_patterns": [
                    {
                        "target_column": target,
                        "evidence_id": "pattern-1",
                        "transformation": "TO_VARCHAR(CONTACTS.ID)",
                    }
                ],
            },
            "execution_context": {
                "response": filler,
                "exact_fir_recommendations": [filler],
            },
        },
    }


@pytest.mark.parametrize("size", [650_000, 1_450_000, 1_700_000])
def test_large_envelopes_fit_and_preserve_target_evidence(size: int) -> None:
    result = budget_agent_payload(
        _large_envelope(size),
        max_chars=60_000,
        max_bytes=65_536,
    )

    assert len(result.text) <= 60_000
    assert len(result.text.encode("utf-8")) <= 65_536
    assert "fir-evidence-1" in result.text
    assert "correction-1" in result.text
    assert "pattern-1" in result.text
    assert "TO_VARCHAR(CONTACTS.ID)" in result.text
    assert "CONTACTS.ID = FAMILIES.CONTACT_ID" in result.text
    assert result.diagnostics["artifact_bodies_removed"] >= 2
    assert result.diagnostics["original_chars"] > result.diagnostics["final_chars"]


def test_previous_response_body_is_replaced_by_descriptor() -> None:
    result = budget_agent_payload(
        _large_envelope(1000),
        max_chars=60_000,
        max_bytes=65_536,
    )
    data = result.payload["data"]
    assert "previous_response" not in data
    assert data["artifact_refs"][0]["content_omitted"] is True
    assert "content_hash" in data["artifact_refs"][0]


def test_unicode_byte_budget_is_enforced() -> None:
    payload = _large_envelope(1000)
    payload["data"]["message"] = "界" * 30_000
    with pytest.raises(AgentPayloadBudgetError):
        budget_agent_payload(payload, max_chars=60_000, max_bytes=65_536)


def test_under_budget_request_keeps_structure_except_echoed_artifacts() -> None:
    payload = _large_envelope(10)
    payload["context"]["semantic_context"] = []
    payload["context"]["learning_context"] = {}
    payload["context"]["workspace_context"]["conversation_history"] = []
    result = budget_agent_payload(payload, max_chars=60_000, max_bytes=65_536)
    assert result.payload["operation"] == payload["operation"]
    assert result.payload["context"]["relationships"] == payload["context"]["relationships"]
    assert result.diagnostics["compacted"] is False
    json.loads(result.text)
