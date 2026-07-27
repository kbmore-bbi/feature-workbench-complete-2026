from app.guardrails.config.loader import build_default_config
from app.guardrails.runtime.preflight import PreflightGuard


def test_preflight_redacts_message_and_strips_sample_values() -> None:
    guard = PreflightGuard(build_default_config())

    payload = {
        "contract_version": "1.0",
        "request_id": "req-1",
        "operation": "sttm.chat",
        "context": {
            "workspace_context": {
                "captured_at": "2026-07-20T05:19:27.123456+00:00",
            },
            "semantic_context": [
                {
                    "table": {"database": "DB", "schema": "SCH", "table": "SRC"},
                    "semantic_model": {
                        "attributes": [
                            {
                                "name": "EMAIL",
                                "sample_values": ["person@example.com"],
                            }
                        ]
                    },
                }
            ],
        },
        "data": {
            "intent": "CHAT",
            "message": "Please email person@example.com with the latest mapping.",
        },
        "warnings": [],
        "meta": {},
    }

    sanitized, decision = guard.apply_to_sttm_request(
        payload,
        trace_id="trace-1",
        persona="PUBLISHER",
    )

    assert sanitized["context"]["trace_id"] == "trace-1"
    assert (
        sanitized["context"]["workspace_context"]["captured_at"]
        == "2026-07-20T05:19:27.123456+00:00"
    )
    assert sanitized["data"]["message"] == "Please email [REDACTED_EMAIL] with the latest mapping."
    assert (
        sanitized["context"]["semantic_context"][0]["semantic_model"]["attributes"][0]["sample_values"]
        == []
    )
    assert decision.redaction_count >= 1
    assert "EMAIL" in decision.detected_pii
