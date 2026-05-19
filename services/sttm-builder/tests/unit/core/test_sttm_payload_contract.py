import json

from app.core.sttm_builder import STTMBuilderService
from app.schema.sttm_builder import (
    Interface,
    STTMAgentRequestEnvelope,
    STTMBuilderEnvelopeRequest,
    STTMOperation,
    STTMStatus,
    SubAgent,
    normalize_sttm_builder_invoke_body,
)


def _table(name: str = "SRC") -> dict:
    return {"database": "DB", "schema": "SCH", "table": name}


def test_legacy_workbench_payload_normalizes_to_standard_envelope() -> None:
    envelope = normalize_sttm_builder_invoke_body(
        {
            "interface": "AUTO_MAP",
            "thread_id": "thread-1",
            "source_tables": [_table("SRC")],
            "attributes": [
                {
                    "target_table": _table("TGT"),
                    "target_attribute": "CUSTOMER_ID",
                    "source_mappings": None,
                }
            ],
        }
    )

    assert envelope.contract_version == "1.0"
    assert envelope.operation == STTMOperation.AUTO_MAP
    assert envelope.context.thread_id == "thread-1"
    assert envelope.data.intent == Interface.AUTO_MAP
    assert envelope.warnings[0].code == "LEGACY_PAYLOAD"


def test_standard_envelope_requires_operation_to_match_intent() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "operation": "sttm.chat",
            "context": {},
            "data": {"intent": "CHAT", "message": "hello"},
            "warnings": [],
            "error": None,
            "meta": {},
        }
    )

    assert envelope.operation == STTMOperation.CHAT
    assert envelope.to_flat_request().interface == Interface.CHAT


def test_chat_envelope_normalizes_empty_source_tables_to_none() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "operation": "sttm.chat",
            "context": {
                "thread_id": None,
                "source_tables": [],
                "driving_table": None,
                "relationships": [],
                "semantic_context": None,
                "selected_columns_by_table": None,
            },
            "data": {"intent": "CHAT", "message": "hello"},
            "warnings": [],
            "error": None,
            "meta": {},
        }
    )

    assert envelope.context.source_tables is None
    assert envelope.to_flat_request().source_tables is None


def test_agent_request_omits_transport_only_fields() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "req-1",
            "operation": "sttm.chat",
            "actor": {"user_id": "u1", "role": "admin"},
            "context": {
                "thread_id": "thread-1",
                "source_tables": [_table("SRC")],
                "relationships": [],
            },
            "data": {"intent": "CHAT", "message": "hello"},
            "warnings": [{"code": "LEGACY", "message": "legacy"}],
            "error": None,
            "meta": {"trace": "t1"},
        }
    )

    agent_request = STTMAgentRequestEnvelope.from_builder_request(envelope)
    dumped = agent_request.model_dump(mode="json", exclude_none=True)

    assert dumped["request_id"] == "req-1"
    assert dumped["operation"] == "sttm.chat"
    assert "thread_id" not in dumped["context"]
    assert "actor" not in dumped
    assert "warnings" not in dumped
    assert "meta" not in dumped


def test_canonical_agent_response_parses_to_typed_mapping_result() -> None:
    service = STTMBuilderService.__new__(STTMBuilderService)
    raw = json.dumps(
        {
            "contract_version": "1.0",
            "request_id": "req-1",
            "operation": "sttm.auto_map",
            "context": {},
            "data": {
                "intent": "AUTO_MAP",
                "status": "completed",
                "agent": "SOURCE_MAPPING_AGENT",
                "result": {
                    "mappings": {
                        "DB.SCH.TGT.CUSTOMER_ID": {
                            "source_attributes": ["DB.SCH.SRC.CUST_ID"],
                            "confidence_score": 0.92,
                        }
                    }
                },
                "message": "Mapped one column.",
            },
            "warnings": [],
            "error": None,
            "meta": {"orchestration_model": "claude-haiku-4-5"},
        }
    )

    agent, result, message, warnings, error, meta, status = service._parse_envelope(raw)

    assert agent == SubAgent.SOURCE_MAPPING_AGENT
    assert result is not None
    assert result.mappings["DB.SCH.TGT.CUSTOMER_ID"].confidence_score == 0.92
    assert message == "Mapped one column."
    assert warnings == []
    assert error is None
    assert meta["orchestration_model"] == "claude-haiku-4-5"
    assert status == STTMStatus.COMPLETED


def test_legacy_agent_mapping_array_is_normalized_temporarily() -> None:
    service = STTMBuilderService.__new__(STTMBuilderService)
    raw = json.dumps(
        {
            "agent": "AGT_SOURCE_MAPPING",
            "result": {
                "mappings": [
                    {
                        "target": "DB.SCH.TGT.CUSTOMER_ID",
                        "sources": [
                            {
                                "table": "DB.SCH.SRC",
                                "column": "CUST_ID",
                                "confidence": "HIGH",
                            }
                        ],
                    }
                ]
            },
        }
    )

    agent, result, _, _, _, _, _ = service._parse_envelope(raw)

    assert agent == SubAgent.SOURCE_MAPPING_AGENT
    assert result is not None
    mapping = result.mappings["DB.SCH.TGT.CUSTOMER_ID"]
    assert mapping.source_attributes == ["DB.SCH.SRC.CUST_ID"]
    assert mapping.confidence_score == 0.9
