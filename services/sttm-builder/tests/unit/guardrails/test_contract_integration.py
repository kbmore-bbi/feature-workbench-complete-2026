from starlette.requests import Request

from app.guardrails.contracts.decisions import GovernanceDecision, GovernanceWarning
from app.schema.contracts import build_response_envelope


def _request_with_state() -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/test",
        "headers": [],
    }
    request = Request(scope)
    request.state.trace_id = "trace-1"
    request.state.governance_decision = GovernanceDecision(
        trace_id="trace-1",
        request_id="req-1",
        operation="workbench.info",
        persona="VIEWER",
        warnings=[GovernanceWarning(code="TEST_WARNING", message="guardrails warning")],
        redaction_count=2,
    )
    return request


def test_build_response_envelope_merges_governance_metadata() -> None:
    request = _request_with_state()

    response = build_response_envelope(
        operation="workbench.info",
        request=request,
        data={"ok": True},
    )

    assert response.context["trace_id"] == "trace-1"
    assert any(warning.code == "TEST_WARNING" for warning in response.warnings)
    assert response.meta["guardrails"]["request_id"] == "req-1"
    assert response.meta["guardrails"]["redaction_count"] == 2
