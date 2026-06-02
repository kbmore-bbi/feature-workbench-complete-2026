from fastapi.testclient import TestClient

from app.api.deps import get_conversation_service
from app.auth.models import AppPersona, CurrentPrincipal, PermissionSet
from app.main import app
from app.schema.contracts import build_response_envelope
from app.schema.conversation import (
    ConversationArtifact,
    ConversationIndexSyncResponseData,
    ConversationIntentClass,
    ConversationResponseData,
    ConversationRoute,
    ConversationSearchResponseData,
    ConversationSearchHit,
    ConversationStatus,
)


class _FakeConversationService:
    def __init__(self) -> None:
        self.captured_request = None
        self.captured_decision = None

    def invoke(self, req, *, governance_decision=None):  # type: ignore[no-untyped-def]
        self.captured_request = req
        self.captured_decision = governance_decision
        return build_response_envelope(
            operation=req.operation.value,
            request_id=req.request_id,
            context=req.context.model_dump(mode="json", exclude_none=True),
            data=ConversationResponseData(
                status=ConversationStatus.COMPLETED,
                route=ConversationRoute.CONVERSATION,
                intent_class=ConversationIntentClass.QUICK_ANSWER,
                agent="workbench_conversation",
                message=req.data.message,
                artifact=ConversationArtifact(),
                citations=[],
            ),
        )

    def invoke_stream(self, req, *, governance_decision=None):  # type: ignore[no-untyped-def]
        self.captured_request = req
        self.captured_decision = governance_decision
        yield "event: delta\ndata: {\"text\": \"Hello\"}\n\n"
        yield "event: final\ndata: {\"status\": \"completed\"}\n\n"

    def search(self, data):  # type: ignore[no-untyped-def]
        return ConversationSearchResponseData(
            hits=[
                ConversationSearchHit(
                    doc_id="bundle:1",
                    doc_folder="semantic",
                    doc_type="semantic_bundle",
                    title="Bundle 1",
                    snippet="Bundle text",
                )
            ],
            search_service="DB.SCH.CSS_WORKBENCH_RAG",
            source_table="DB.SCH.TBL_WORKBENCH_RAG_DOCUMENTS",
        )

    def sync_index(self, data):  # type: ignore[no-untyped-def]
        return ConversationIndexSyncResponseData(
            conversation_turn_count=1,
            feedback_count=1,
            recommendation_count=1,
            relationship_fact_count=2,
            rag_document_count=10,
            search_service="DB.SCH.CSS_WORKBENCH_RAG",
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


def test_conversation_invoke_redacts_message_and_attaches_trace(monkeypatch) -> None:
    client = TestClient(app)
    service = _FakeConversationService()
    app.dependency_overrides[get_conversation_service] = lambda: service
    monkeypatch.setattr("app.routers.conversation.get_current_principal", lambda *_: _principal())

    payload = {
        "contract_version": "1.0",
        "request_id": "req-convo-1",
        "operation": "conversation.ask",
        "context": {
            "semantic_context": [
                {
                    "table": {"database": "DB", "schema": "SCH", "table": "SRC"},
                    "semantic_model": {"description": "Customer table"},
                }
            ]
        },
        "data": {
            "message": "Email person@example.com the summary",
        },
    }

    try:
        response = client.post("/api/v1/workbench/conversation/invoke", json=payload)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert service.captured_request is not None
    assert service.captured_request.data.message == "Email [REDACTED_EMAIL] the summary"
    assert service.captured_request.meta["guardrails"]["trust_labels"]
    assert service.captured_decision is not None
    assert service.captured_decision.trace_id


def test_conversation_search_returns_standard_envelope() -> None:
    client = TestClient(app)
    service = _FakeConversationService()
    app.dependency_overrides[get_conversation_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/workbench/conversation/search",
            json={
                "contract_version": "1.0",
                "operation": "conversation.search",
                "data": {"query": "bundle", "limit": 3},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["operation"] == "conversation.search"
    assert payload["data"]["hits"][0]["doc_folder"] == "semantic"


def test_conversation_stream_route_returns_sse() -> None:
    client = TestClient(app)
    service = _FakeConversationService()
    app.dependency_overrides[get_conversation_service] = lambda: service
    from pytest import MonkeyPatch

    patcher = MonkeyPatch()
    patcher.setattr("app.routers.conversation.get_current_principal", lambda *_: _principal())

    try:
        response = client.post(
            "/api/v1/workbench/conversation/invoke/stream",
            json={
                "contract_version": "1.0",
                "operation": "conversation.ask",
                "data": {"message": "hello"},
            },
        )
    finally:
        patcher.undo()
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert "event: delta" in response.text
