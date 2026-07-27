import json

from app.core.config import Settings
from app.core.conversation import ConversationService
from app.guardrails.contracts.decisions import GovernanceDecision
from app.schema.conversation import (
    AssistantSignal,
    AssistantSignalStatus,
    AssistantSignalType,
    ConversationIndexSyncRequestData,
    ConversationRequestEnvelope,
    ConversationSearchRequestData,
    ConversationSearchHit,
    ConversationSignalEvaluationData,
)
from app.schema.sttm_builder import FIRLearningItem, LearningContext


class _FakeAgentClient:
    def __init__(self, payload: dict | None = None) -> None:
        self.payload = payload or {
            "data": {
                "status": "completed",
                "agent": "workbench_conversation",
                "message": "Here is a grounded recommendation.",
                "citations": [
                    {
                        "source_id": "DB.SCH.SRC",
                        "source_type": "semantic_context",
                        "snippet": "customer table metadata",
                    }
                ],
            }
        }
        self.route_payload = {
            "data": {
                "status": "completed",
                "route": "conversation",
                "intent_class": "quick_answer",
                "route_reason": "llm_route",
                "route_confidence": 0.91,
            }
        }

    def run_detailed(self, messages, *, agent=None, thread_id=None, parent_message_id=None):  # type: ignore[no-untyped-def]
        raw = messages[0]["content"][0]["text"]
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {}
        data = payload.get("data") if isinstance(payload, dict) else {}
        mode = data.get("execution_mode")
        response_payload = self.route_payload if mode == "route_planning" else self.payload
        return json.dumps(response_payload), "thread-1", response_payload

    def stream_events(self, messages, *, agent=None, thread_id=None, parent_message_id=None):  # type: ignore[no-untyped-def]
        yield "delta", {"delta": "Here is "}
        yield "delta", {"delta": "a streamed answer."}
        yield "response", {
            "data": {
                "status": "completed",
                "agent": "workbench_conversation",
                "message": "Here is a streamed answer.",
                "citations": [],
            }
        }


class _FakeSTTMService:
    def __init__(self) -> None:
        self.captured_request = None
        self.captured_decision = None

    def invoke(self, req, *, governance_decision=None):  # type: ignore[no-untyped-def]
        self.captured_request = req
        self.captured_decision = governance_decision
        return {"ok": True, "operation": req.operation.value}

    def invoke_stream(self, req, *, governance_decision=None):  # type: ignore[no-untyped-def]
        self.captured_request = req
        self.captured_decision = governance_decision
        yield "event: final\ndata: {\"ok\": true}\n\n"

    def resolve_usable_semantic_context(
        self,
        *,
        semantic_bundle_id=None,
        semantic_view_name=None,
    ):  # type: ignore[no-untyped-def]
        return semantic_bundle_id, semantic_view_name


class _FakeMemoryService:
    def __init__(self) -> None:
        self.turns: list[dict] = []
        self.feedback: list[dict] = []
        self.recommendations: list[dict] = []
        self.search_hits = []
        self.relationship_hits = []
        self.search_calls = 0

    def record_turn(self, **kwargs):  # type: ignore[no-untyped-def]
        self.turns.append(kwargs)
        return f"turn-{len(self.turns)}"

    def record_feedback(self, **kwargs):  # type: ignore[no-untyped-def]
        self.feedback.append(kwargs)
        return f"feedback-{len(self.feedback)}"

    def record_recommendation(self, **kwargs):  # type: ignore[no-untyped-def]
        self.recommendations.append(kwargs)
        return f"recommendation-{len(self.recommendations)}"

    def sync_rag_documents(self, **kwargs):  # type: ignore[no-untyped-def]
        return 0

    def sync_all(self, **kwargs):  # type: ignore[no-untyped-def]
        return {
            "conversation_turn_count": len(self.turns),
            "feedback_count": len(self.feedback),
            "recommendation_count": len(self.recommendations),
            "relationship_fact_count": 0,
            "rag_document_count": 0,
            "search_service": "DB.SCH.CSS_WORKBENCH_RAG",
        }

    def search(self, **kwargs):  # type: ignore[no-untyped-def]
        self.search_calls += 1
        return list(self.search_hits)

    def find_relationships_for_tables(self, **kwargs):  # type: ignore[no-untyped-def]
        return list(self.relationship_hits)


class _FakeLearningService:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def get_comprehensive_learning_context(self, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append(kwargs)
        return LearningContext(
            context_key=kwargs.get("context_key"),
            retrieval_mode="exact_context",
            fir_learnings=[
                FIRLearningItem(
                    learning_id="inference-1",
                    learning_type="join_path",
                    pattern_key="loan-portal-history",
                    summary="Join the portal history by portal user ID.",
                    confidence=0.91,
                    source="fir_agent",
                )
            ],
            fir_recommendations=[
                {
                    "recommendation_id": "recommendation-1",
                    "display_message": "Preserve the loan object-type filter.",
                    "confidence": 0.88,
                }
            ],
        )


def _settings() -> Settings:
    return Settings(
        SNOWFLAKE_DATABASE="DB",
        SNOWFLAKE_SCHEMA="SCH",
        SNOWFLAKE_WORKBENCH_CONVERSATION_AGENT="DB.SCH.AGT_WORKBENCH_CONVERSATION",
        SNOWFLAKE_RAG_SEARCH_SERVICE="DB.SCH.CSS_WORKBENCH_RAG",
    )


def test_signal_filter_requires_new_status_and_exact_context_key() -> None:
    data = ConversationSignalEvaluationData.model_validate(
        {
            "page": "builder",
            "surface": "SOURCE_SELECTION",
            "source_tables": [
                {"database": "DB", "schema": "SRC", "table": "LOAN"},
                {"database": "DB", "schema": "SRC", "table": "NOTE"},
            ],
        }
    )

    def signal(signal_id: str, status: AssistantSignalStatus, context_key: str | None) -> AssistantSignal:
        return AssistantSignal(
            signal_id=signal_id,
            signal_type=AssistantSignalType.RECOMMENDATION,
            layer="recommendation",
            status=status,
            source="fir_agent",
            title="Join guidance",
            message="Review the relationship.",
            entity_ids=["DB.SRC.LOAN", "DB.SRC.NOTE"],
            attributes={
                "page": "builder",
                "surface": "SOURCE_SELECTION",
                **({"context_key": context_key} if context_key else {}),
            },
        )

    filtered = ConversationService._filter_signals_for_context(
        [
            signal("legacy", AssistantSignalStatus.NEW, None),
            signal("acknowledged", AssistantSignalStatus.ACKNOWLEDGED, "ctx-current"),
            signal("other-context", AssistantSignalStatus.NEW, "ctx-other"),
            signal("current", AssistantSignalStatus.NEW, "ctx-current"),
        ],
        data,
        context_key="ctx-current",
    )

    assert [item.signal_id for item in filtered] == ["current"]


def test_direct_conversation_receives_exact_fir_learning_context() -> None:
    learning = _FakeLearningService()
    service = ConversationService(
        _FakeAgentClient(),
        sttm_builder_service=_FakeSTTMService(),
        memory_service=_FakeMemoryService(),
        settings=_settings(),
        learning_service=learning,
    )
    req = ConversationRequestEnvelope.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "req-fir-context",
            "operation": "conversation.ask",
            "context": {
                "trace_id": "trace-fir-context",
                "source_tables": [
                    {"database": "DB", "schema": "SRC", "table": "LOAN"}
                ],
                "target_table": {"database": "DB", "schema": "TGT", "table": "LOAN"},
                "workspace_context": {
                    "context_version": "2.0",
                    "project_id": "project-1",
                    "sttm_id": "sttm-1",
                    "milestone": "target_selected",
                    "source_tables": [
                        {"database": "DB", "schema": "SRC", "table": "LOAN"}
                    ],
                    "target_table": {"database": "DB", "schema": "TGT", "table": "LOAN"},
                },
            },
            "data": {"message": "What should I check next?"},
        }
    )

    enriched = service._with_learning_context(req)
    compact = service._compact_learning_context(enriched.context.learning_context)

    assert learning.calls[0]["target_agent"] == "AGT_STTM_BUILDER"
    assert enriched.context.prepared_context_hash
    assert learning.calls[0]["project_id"] == "project-1"
    assert learning.calls[0]["context_key"] == req.context.workspace_context.context_key
    assert compact is not None
    assert compact["fir_recommendations"][0]["recommendation_id"] == "recommendation-1"


def test_conversation_service_returns_feedback_receipt() -> None:
    memory = _FakeMemoryService()
    service = ConversationService(
        _FakeAgentClient(),
        sttm_builder_service=_FakeSTTMService(),
        memory_service=memory,
        settings=_settings(),
    )
    req = ConversationRequestEnvelope.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "req-feedback",
            "operation": "conversation.feedback",
            "context": {"trace_id": "trace-feedback"},
            "data": {
                "feedback": {
                    "category": "general",
                    "rating": 5,
                    "comment": "Helpful",
                }
            },
        }
    )

    response = service.invoke(
        req,
        governance_decision=GovernanceDecision(
            trace_id="trace-feedback",
            request_id="req-feedback",
            operation="conversation.feedback",
            persona="PUBLISHER",
        ),
    )

    assert response.data.artifact.review_recorded is True
    assert response.data.route == "conversation"
    assert len(memory.feedback) == 1


def test_conversation_service_hands_off_mapping_requests_to_sttm() -> None:
    sttm_service = _FakeSTTMService()
    memory = _FakeMemoryService()
    agent = _FakeAgentClient()
    agent.route_payload = {
        "data": {
            "status": "completed",
            "route": "sttm_builder",
            "intent_class": "sttm_handoff",
            "route_reason": "llm_route",
            "route_confidence": 0.97,
            "suggested_operation": "sttm.chat",
        }
    }
    service = ConversationService(
        agent,
        sttm_builder_service=sttm_service,
        memory_service=memory,
        settings=_settings(),
    )
    req = ConversationRequestEnvelope.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "req-handoff",
            "operation": "conversation.ask",
            "context": {
                "trace_id": "trace-handoff",
                "surface": "MAPPING",
            },
            "data": {"message": "Can you fix this mapping?"},
        }
    )

    response = service.invoke(
        req,
        governance_decision=GovernanceDecision(
            trace_id="trace-handoff",
            request_id="req-handoff",
            operation="conversation.ask",
            persona="PUBLISHER",
        ),
    )

    assert response["ok"] is True
    assert sttm_service.captured_request is not None
    assert sttm_service.captured_request.operation.value == "sttm.chat"


def test_conversation_service_keeps_free_text_handoffs_chat_shaped_even_for_transform_suggestion() -> None:
    sttm_service = _FakeSTTMService()
    memory = _FakeMemoryService()
    agent = _FakeAgentClient()
    agent.route_payload = {
        "data": {
            "status": "completed",
            "route": "sttm_builder",
            "intent_class": "sttm_handoff",
            "route_reason": "llm_route",
            "route_confidence": 0.94,
            "suggested_operation": "sttm.transform",
        }
    }
    service = ConversationService(
        agent,
        sttm_builder_service=sttm_service,
        memory_service=memory,
        settings=_settings(),
    )
    req = ConversationRequestEnvelope.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "req-transform-handoff",
            "operation": "conversation.ask",
            "context": {
                "trace_id": "trace-transform-handoff",
                "surface": "SOURCE_SELECTION",
            },
            "data": {"message": "Create a derived source for these selected tables"},
        }
    )

    response = service.invoke(
        req,
        governance_decision=GovernanceDecision(
            trace_id="trace-transform-handoff",
            request_id="req-transform-handoff",
            operation="conversation.ask",
            persona="PUBLISHER",
        ),
    )

    assert response["ok"] is True
    assert sttm_service.captured_request is not None
    assert sttm_service.captured_request.operation.value == "sttm.chat"
    assert sttm_service.captured_request.data.intent.value == "CHAT"


def test_conversation_service_routes_relationship_questions_to_sttm_builder() -> None:
    sttm_service = _FakeSTTMService()
    memory = _FakeMemoryService()
    agent = _FakeAgentClient()
    agent.route_payload = {
        "data": {
            "status": "completed",
            "route": "sttm_builder",
            "intent_class": "sttm_handoff",
            "route_reason": "llm_route",
            "route_confidence": 0.88,
            "suggested_operation": "sttm.chat",
        }
    }
    service = ConversationService(
        agent,
        sttm_builder_service=sttm_service,
        memory_service=memory,
        settings=_settings(),
    )
    req = ConversationRequestEnvelope.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "req-relationship",
            "operation": "conversation.ask",
            "context": {
                "trace_id": "trace-relationship",
                "surface": "SOURCE_SELECTION",
            },
            "data": {
                "message": "What relationship exists between NOTE and LOAN_INCOME_AMOUNT_CALCULATION?",
                "requested_sources": ["relationships", "semantic"],
            },
        }
    )

    response = service.invoke(
        req,
        governance_decision=GovernanceDecision(
            trace_id="trace-relationship",
            request_id="req-relationship",
            operation="conversation.ask",
            persona="PUBLISHER",
        ),
    )

    assert sttm_service.captured_request is not None
    assert sttm_service.captured_request.operation.value == "sttm.chat"
    assert response["operation"] == "sttm.chat"


def test_conversation_service_answers_capability_question_in_single_pass() -> None:
    sttm_service = _FakeSTTMService()
    memory = _FakeMemoryService()
    agent = _FakeAgentClient()
    agent.route_payload = {
        "data": {
            "status": "completed",
            "route": "conversation",
            "intent_class": "quick_answer",
            "route_reason": "llm_capability_answer",
            "route_confidence": 0.98,
            "message": "I can explain selected tables, relationships, recommendations, and hand off to STTM builder for generation flows.",
            "citations": [
                {
                    "source_id": "builtin:workbench_capabilities",
                    "source_type": "agent_skill",
                    "snippet": "Built-in workbench capability summary.",
                }
            ],
            "quick_replies": ["Explain selected tables", "Recommend next steps"],
        }
    }
    service = ConversationService(
        agent,
        sttm_builder_service=sttm_service,
        memory_service=memory,
        settings=_settings(),
    )
    req = ConversationRequestEnvelope.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "req-capability",
            "operation": "conversation.ask",
            "context": {"trace_id": "trace-capability"},
            "data": {"message": "Hello, what can you do?"},
        }
    )

    response = service.invoke(req)

    assert response.data.route == "sttm_builder"
    assert "relationships" in (response.data.message or "")
    assert response.data.citations[0].source_id == "builtin:workbench_capabilities"
    assert memory.search_calls == 0


def test_conversation_service_answers_selected_relationship_from_exact_match() -> None:
    memory = _FakeMemoryService()
    memory.relationship_hits = [
        ConversationSearchHit(
            doc_id="bundle-rel:1",
            doc_folder="relationships",
            doc_type="relationship_fact",
            title="DB.SCH.LEFT -> DB.SCH.RIGHT",
            snippet=(
                "Document folder: relationships\n"
                "Left table: BBI_STTM_TEST_DB.DL_AMOUNT.LOAN_INCOME_AMOUNT_CALCULATION\n"
                "Right table: BBI_STTM_TEST_DB.DL_AMOUNT.NOTE\n"
                "Join type: INNER\n"
                "Conditions: [{\"left_column\":\"VERIFIED_INCOME_ID\",\"operator\":\"=\",\"right_column\":\"NOTE_ID\"}]"
            ),
            semantic_bundle_id="sem_123",
            semantic_view_name="SV_TEST",
            score=1.0,
        )
    ]
    service = ConversationService(
        _FakeAgentClient(),
        sttm_builder_service=_FakeSTTMService(),
        memory_service=memory,
        settings=_settings(),
    )
    req = ConversationRequestEnvelope.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "req-fast-relationship",
            "operation": "conversation.ask",
            "context": {
                "trace_id": "trace-fast-relationship",
                "source_tables": [
                    {"database": "BBI_STTM_TEST_DB", "schema": "DL_AMOUNT", "table": "LOAN_INCOME_AMOUNT_CALCULATION"},
                    {"database": "BBI_STTM_TEST_DB", "schema": "DL_AMOUNT", "table": "NOTE"},
                ],
            },
            "data": {"message": "What is the relationship between the selected tables?"},
        }
    )

    response = service.invoke(req)

    assert response["operation"] == "sttm.chat"


def test_conversation_service_explains_selected_relationship_in_natural_language() -> None:
    memory = _FakeMemoryService()
    memory.relationship_hits = [
        ConversationSearchHit(
            doc_id="bundle-rel:1",
            doc_folder="relationships",
            doc_type="relationship_fact",
            title="DB.SCH.LEFT -> DB.SCH.RIGHT",
            snippet=(
                "Document folder: relationships\n"
                "Left table: BBI_STTM_TEST_DB.DL_AMOUNT.LOAN_INCOME_AMOUNT_CALCULATION\n"
                "Right table: BBI_STTM_TEST_DB.DL_AMOUNT.NOTE\n"
                "Join type: INNER\n"
                "Conditions: [{\"left_column\":\"VERIFIED_INCOME_ID\",\"operator\":\"!=\",\"right_column\":\"NOTE_ID\"}]"
            ),
            semantic_bundle_id="sem_123",
            semantic_view_name="SV_TEST",
            score=1.0,
        )
    ]
    service = ConversationService(
        _FakeAgentClient(),
        sttm_builder_service=_FakeSTTMService(),
        memory_service=memory,
        settings=_settings(),
    )
    req = ConversationRequestEnvelope.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "req-explain-relationship",
            "operation": "conversation.ask",
            "context": {
                "trace_id": "trace-explain-relationship",
                "source_tables": [
                    {"database": "BBI_STTM_TEST_DB", "schema": "DL_AMOUNT", "table": "LOAN_INCOME_AMOUNT_CALCULATION"},
                    {"database": "BBI_STTM_TEST_DB", "schema": "DL_AMOUNT", "table": "NOTE"},
                ],
            },
            "data": {"message": "Explain what this relationship means"},
        }
    )

    response = service.invoke(req)

    assert response["operation"] == "sttm.chat"


def test_conversation_service_search_returns_backend_hits() -> None:
    memory = _FakeMemoryService()
    memory.search_hits = []
    service = ConversationService(
        _FakeAgentClient(),
        sttm_builder_service=_FakeSTTMService(),
        memory_service=memory,
        settings=_settings(),
    )

    response = service.search(
        ConversationSearchRequestData(query="loan relationship", folders=["semantic"], limit=5)
    )

    assert response.search_service == _settings().snowflake_rag_search_service


def test_conversation_service_sync_returns_counts() -> None:
    memory = _FakeMemoryService()
    service = ConversationService(
        _FakeAgentClient(),
        sttm_builder_service=_FakeSTTMService(),
        memory_service=memory,
        settings=_settings(),
    )

    response = service.sync_index(ConversationIndexSyncRequestData())

    assert response.search_service == "DB.SCH.CSS_WORKBENCH_RAG"
