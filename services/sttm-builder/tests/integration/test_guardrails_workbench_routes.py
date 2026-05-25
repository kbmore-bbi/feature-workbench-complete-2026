from fastapi.testclient import TestClient

from app.api.deps import get_sttm_builder_service
from app.auth.models import AppPersona, CurrentPrincipal, PermissionSet
from app.main import app
from app.schema.sttm_builder import STTMBuilderResponse, STTMStatus


class _FakeService:
    def __init__(self) -> None:
        self.captured_request = None
        self.captured_decision = None

    def invoke(self, req, *, governance_decision=None):  # type: ignore[no-untyped-def]
        self.captured_request = req
        self.captured_decision = governance_decision
        return STTMBuilderResponse.from_invocation(
            req,
            thread_id="thread-1",
            parent_message_id=None,
            agent=None,
            result=None,
            message=req.data.message,
            status=STTMStatus.COMPLETED,
        )


def _principal() -> CurrentPrincipal:
    return CurrentPrincipal(
        user_id=7,
        snowflake_user="PUBLISHER_USER",
        email="publisher@example.com",
        display_name="publisher",
        app_persona=AppPersona.PUBLISHER,
        permissions=PermissionSet(can_read=True, can_edit=True, can_publish=True),
        snowflake_user_token="snowflake-user-token",
    )


def test_workbench_invoke_redacts_free_text_and_strips_samples(monkeypatch) -> None:
    client = TestClient(app)
    service = _FakeService()
    app.dependency_overrides[get_sttm_builder_service] = lambda: service
    monkeypatch.setattr("app.routers.sttm_builder.get_current_principal", lambda *_: _principal())

    payload = {
        "contract_version": "1.0",
        "request_id": "req-1",
        "operation": "sttm.chat",
        "context": {
            "semantic_context": [
                {
                    "table": {"database": "DB", "schema": "SCH", "table": "SRC"},
                    "semantic_model": {"attributes": [{"name": "EMAIL", "sample_values": ["person@example.com"]}]},
                }
            ]
        },
        "data": {
            "intent": "CHAT",
            "message": "Please email person@example.com",
        },
    }

    try:
        response = client.post("/api/v1/workbench/invoke", json=payload)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert service.captured_request is not None
    assert service.captured_request.data.message == "Please email [REDACTED_EMAIL]"
    semantic_model = service.captured_request.context.semantic_context[0].semantic_model
    assert semantic_model["attributes"][0]["sample_values"] == []
    assert service.captured_decision is not None
    assert service.captured_decision.trace_id
