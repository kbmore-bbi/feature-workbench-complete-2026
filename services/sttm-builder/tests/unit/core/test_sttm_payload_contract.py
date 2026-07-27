import asyncio
import json
from types import SimpleNamespace

from app.core.config import Settings
from app.core.exceptions import SemanticRelationshipInvalidError
from app.core.sttm_builder import STTMBuilderService
from app.schema.semantic_context import SemanticBundleStatus, SemanticContextSummary, SemanticLevel
from app.schema.sttm_builder import (
    Interface,
    LearningContext,
    MappingPrecedentContext,
    RelationGraphContext,
    STTMAgentRequestEnvelope,
    STTMBuilderEnvelopeRequest,
    STTMBuilderResponse,
    STTMOperation,
    STTMStatus,
    SubAgent,
    ValueBinding,
    normalize_sttm_builder_invoke_body,
)
from app.schema.sttm_builder import STTMArtifactType
from app.schema.workspace_context import WorkspaceBrowsingContext


def _table(name: str = "SRC") -> dict:
    return {"database": "DB", "schema": "SCH", "table": name}


def test_browsing_context_normalizes_candidate_table_objects_to_fqns() -> None:
    context = WorkspaceBrowsingContext.model_validate(
        {
            "side": "source",
            "database": "DB",
            "schema": "SCH",
            "visible_candidate_tables": [
                {"database": "DB", "schema": "SCH", "table": "CUSTOMER"},
                {
                    "database_name": "DB",
                    "schema_name": "SCH",
                    "table_name": "NOTE",
                },
                {"qualifiedName": "DB.SCH.LOAN"},
                "DB.SCH.CUSTOMER",
            ],
        }
    )

    assert context.visible_candidate_tables == [
        "DB.SCH.CUSTOMER",
        "DB.SCH.LOAN",
        "DB.SCH.NOTE",
    ]


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


def test_graph_backed_derived_join_drops_invalid_legacy_table_ref_copy() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "operation": "sttm.auto_map",
            "context": {
                "source_tables": [_table("SRC")],
                "target_table": _table("TGT"),
                "relationships": [
                    {
                        "left_table": _table("SRC"),
                        "right_table": {"database": "derived_household"},
                        "join_type": "LEFT",
                        "conditions": [
                            {"left_column": "ID", "right_column": "CONTACT_ID"}
                        ],
                    }
                ],
                "relation_graph": {
                    "nodes": [
                        {
                            "relation_id": "DB.SCH.SRC",
                            "kind": "PHYSICAL_TABLE",
                            "alias": "src",
                            "table": _table("SRC"),
                        },
                        {
                            "relation_id": "derived_household",
                            "kind": "DERIVED_SOURCE",
                            "alias": "household",
                            "derived_source_id": "derived_household",
                        },
                    ],
                    "edges": [
                        {
                            "edge_id": "src-to-household",
                            "left_relation_id": "DB.SCH.SRC",
                            "right_relation_id": "derived_household",
                            "join_type": "LEFT",
                            "conditions": [
                                {"left_column": "ID", "right_column": "CONTACT_ID"}
                            ],
                        }
                    ],
                },
            },
            "data": {
                "intent": "AUTO_MAP",
                "attributes": [
                    {
                        "target_table": _table("TGT"),
                        "target_attribute": "HOUSEHOLD_ID",
                    }
                ],
            },
        }
    )

    assert envelope.context.relationships is None
    assert envelope.context.relation_graph is not None
    assert envelope.context.relation_graph.edges[0].right_relation_id == "derived_household"


def test_workspace_snapshot_hydrates_legacy_context_and_reaches_agent() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "operation": "sttm.chat",
            "context": {
                "workspace_context": {
                    "context_version": "1.0",
                    "context_hash": "ctx1-test",
                    "captured_at": "2026-06-23T00:00:00Z",
                    "page": "mapping",
                    "surface": "MAPPING",
                    "source_tables": [_table("SRC")],
                    "target_table": _table("TGT"),
                    "selected_columns_by_table": {"DB.SCH.SRC": ["COL_A"]},
                    "derived_sources": [],
                    "relationships": [],
                    "filters": {"groups": []},
                    "mapping_intent": {"business_goal": "Map customer data"},
                    "mapping_rows": [],
                    "checked_mapping_row_ids": [],
                    "semantic": {"asset_versions": {}},
                }
            },
            "data": {"intent": "CHAT", "message": "hello"},
        }
    )

    assert envelope.context.source_tables is not None
    assert envelope.context.source_tables[0].table == "SRC"
    assert envelope.context.mapping_intent == {"business_goal": "Map customer data"}
    agent = STTMAgentRequestEnvelope.from_builder_request(envelope)
    assert agent.context.workspace_context is not None
    assert agent.context.workspace_context.context_hash == "ctx1-test"


def test_workspace_context_compaction_preserves_trimmed_conversation_history() -> None:
    compact = STTMBuilderService._compact_workspace_context(
        {
            "context_version": "2.0",
            "context_hash": "ctx-history",
            "page": "mapping",
            "surface": "MAPPING",
            "conversation_history": [
                {"role": "user", "content": "  map the household owner  "},
                {"role": "assistant", "content": "Use the validated owner identifier."},
                {"role": "system", "content": "must not be forwarded"},
                {"role": "user", "content": "   "},
            ],
        }
    )

    assert compact is not None
    assert compact["conversation_history"] == [
        {"role": "user", "content": "map the household owner"},
        {"role": "assistant", "content": "Use the validated owner identifier."},
    ]


def test_v2_snapshot_generates_exact_context_and_survives_subagent_conversion() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "req-v2",
            "operation": "sttm.auto_map",
            "context": {
                "project_id": "project-1",
                "sttm_id": "sttm-1",
                "learning_context": {
                    "used_inference_ids": ["inf-1"],
                    "used_recommendation_ids": ["rec-1"],
                },
                "workspace_context": {
                    "context_version": "2.0",
                    "captured_at": "2026-07-14T00:00:00Z",
                    "page": "mapping",
                    "surface": "MAPPING",
                    "action": "auto_map.requested",
                    "milestone": "before_auto_map",
                    "project_id": "project-1",
                    "sttm_id": "sttm-1",
                    "mapping_lifecycle": "update",
                    "source_tables": [_table("SRC")],
                    "target_table": _table("TGT"),
                    "selected_columns_by_table": {"DB.SCH.SRC": ["CUSTOMER_ID"]},
                    "derived_sources": [],
                    "relationships": [],
                    "filters": {"groups": []},
                    "mapping_rows": [],
                    "checked_mapping_row_ids": [],
                    "semantic": {"bundle_id": "sem-1", "asset_versions": {}},
                },
            },
            "data": {
                "intent": "AUTO_MAP",
                "attributes": [
                    {
                        "target_table": _table("TGT"),
                        "target_attribute": "CUSTOMER_ID",
                    }
                ],
            },
        }
    )

    workspace = envelope.context.workspace_context
    assert workspace is not None
    assert workspace.context_key.startswith("ctx_")
    assert workspace.source_set_hash
    agent = STTMAgentRequestEnvelope.from_builder_request(envelope)
    assert agent.context.project_id == "project-1"
    assert agent.context.sttm_id == "sttm-1"
    assert agent.context.learning_context is not None
    assert agent.context.learning_context.used_recommendation_ids == ["rec-1"]
    assert agent.context.workspace_context is not None
    assert agent.context.workspace_context.context_key == workspace.context_key


def test_with_semantic_context_updates_workspace_snapshot_from_pydantic_summary() -> None:
    service = STTMBuilderService.__new__(STTMBuilderService)
    summary = SemanticContextSummary(
        bundle_id="sem_1",
        bundle_hash="bundle-hash",
        bundle_label="source to target",
        source_table_count=1,
        derived_source_count=0,
        relationship_count=0,
        semantic_level=SemanticLevel.L2_ANALYST_READY,
        asset_versions={"DB.SCH.SRC": "v1"},
        composed_model_hash="model-hash",
    )

    class _SemanticContextService:
        def refresh_bundle(self, *_args, **_kwargs):
            return SimpleNamespace(
                semantic_context=[],
                semantic_view_name=None,
                bundle_id="sem_1",
                bundle_hash="bundle-hash",
                bundle_label="source to target",
                achieved_level=SemanticLevel.L2_ANALYST_READY,
                requested_level=SemanticLevel.L2_ANALYST_READY,
                status=SemanticBundleStatus.READY,
                promoted=False,
                cache_hit=True,
                summary=summary,
                lineage=[],
                datahub_context=None,
            )

    service._semantic_context_service = _SemanticContextService()
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "operation": "sttm.chat",
            "context": {
                "source_tables": [_table("SRC")],
                "workspace_context": {
                    "context_version": "1.0",
                    "context_hash": "ctx1-test",
                    "captured_at": "2026-06-23T00:00:00Z",
                    "page": "builder",
                    "surface": "SOURCE_SELECTION",
                    "source_tables": [_table("SRC")],
                    "selected_columns_by_table": {"DB.SCH.SRC": ["COL_A"]},
                    "derived_sources": [],
                    "relationships": [],
                    "filters": {"groups": []},
                    "mapping_rows": [],
                    "checked_mapping_row_ids": [],
                    "semantic": {"asset_versions": {}},
                },
            },
            "data": {"intent": "CHAT", "message": "hello"},
        }
    )

    updated, refresh = service._with_semantic_context(envelope)

    assert refresh is not None
    assert updated.context.workspace_context is not None
    assert updated.context.workspace_context.semantic.composed_model_hash == "model-hash"
    assert updated.context.workspace_context.semantic.asset_versions == {"DB.SCH.SRC": "v1"}


def test_full_registry_derived_source_stays_with_orchestrator() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "operation": "sttm.chat",
            "context": {
                "surface": "DERIVED_SOURCE",
                "semantic_level_requested": "FULL_REGISTRY",
                "source_tables": [_table("SRC")],
            },
            "data": {
                "intent": "CHAT",
                "message": "Create a reusable household-level derived source.",
            },
        }
    )
    semantic_refresh = SimpleNamespace(
        achieved_level=SemanticLevel.FULL_REGISTRY,
        semantic_view_name=None,
        semantic_model_yaml="name: INLINE_TEST\ntables: []\n",
    )

    assert STTMBuilderService._should_use_analyst(envelope, semantic_refresh) is False


def test_direct_analyst_bypass_requires_explicit_internal_authorization() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "operation": "sttm.chat",
            "context": {
                "surface": "SOURCE_SELECTION",
                "semantic_level_requested": "FULL_REGISTRY",
                "source_tables": [_table("SRC")],
            },
            "data": {
                "intent": "CHAT",
                "message": "How many active contacts are there?",
            },
            "meta": {"allow_direct_analyst_bypass": True},
        }
    )
    semantic_refresh = SimpleNamespace(
        achieved_level=SemanticLevel.FULL_REGISTRY,
        semantic_view_name="DB.SCH.SEMANTIC_VIEW",
        semantic_model_yaml=None,
    )

    assert STTMBuilderService._should_use_analyst(envelope, semantic_refresh) is True


def test_analyst_delegation_is_a_typed_orchestrator_decision() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "operation": "sttm.chat",
            "context": {},
            "data": {
                "intent": "CHAT",
                "message": "This wording is deliberately unrelated to routing.",
            },
        }
    )
    response = STTMBuilderResponse.from_invocation(
        envelope,
        thread_id="thread-orchestrator",
        parent_message_id=7,
        agent=None,
        result=None,
        message="I need the Analyst to compute this result.",
        status=STTMStatus.COMPLETED,
        meta={
            "delegation": {
                "tool": "CORTEX_ANALYST",
                "requires_actual_rows": True,
                "question": "Return the current aggregate result.",
                "reason": "The answer depends on current rows.",
            }
        },
    )

    assert STTMBuilderService._analyst_delegation(response) == {
        "tool": "CORTEX_ANALYST",
        "requires_actual_rows": True,
        "question": "Return the current aggregate result.",
        "reason": "The answer depends on current rows.",
    }

    response.meta["delegation"]["requires_actual_rows"] = False
    assert STTMBuilderService._analyst_delegation(response) is None


def test_typed_analyst_delegation_executes_without_keyword_routing() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "operation": "sttm.chat",
            "context": {},
            "data": {
                "intent": "CHAT",
                "message": "Use the appropriate capability.",
            },
        }
    )
    orchestrator_response = STTMBuilderResponse.from_invocation(
        envelope,
        thread_id="thread-orchestrator",
        parent_message_id=9,
        agent=None,
        result=None,
        message="Delegating.",
        status=STTMStatus.COMPLETED,
        meta={
            "delegation": {
                "tool": "CORTEX_ANALYST",
                "requires_actual_rows": True,
                "question": "Compute the requested live result.",
            }
        },
    )
    analyst_response = STTMBuilderResponse.from_invocation(
        envelope,
        thread_id="thread-analyst",
        parent_message_id=None,
        agent=None,
        result=None,
        message="The computed result is 42.",
        status=STTMStatus.COMPLETED,
    )
    calls: list[str] = []
    service = STTMBuilderService.__new__(STTMBuilderService)

    def invoke_analyst(
        delegated_request: STTMBuilderEnvelopeRequest,
        semantic_refresh: object,
        decision: object,
    ) -> STTMBuilderResponse:
        calls.append(delegated_request.data.message or "")
        return analyst_response

    service._invoke_analyst = invoke_analyst  # type: ignore[method-assign]
    result = service._execute_requested_analyst_delegation(
        envelope,
        orchestrator_response,
        semantic_refresh=SimpleNamespace(
            semantic_view_name="DB.SCH.SEMANTIC_VIEW",
            semantic_model_yaml=None,
        ),
        decision=SimpleNamespace(),
    )

    assert calls == ["Compute the requested live result."]
    assert result is analyst_response
    assert result.meta["delegation"]["decided_by"] == "AGT_STTM_BUILDER"
    assert result.meta["delegation"]["executed_by"] == "CORTEX_ANALYST"
    assert result.meta["orchestrator_thread_id"] == "thread-orchestrator"


def test_derived_source_recommendation_stays_learning_backed_until_generation() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "operation": "sttm.chat",
            "context": {
                "surface": "SOURCE_SELECTION",
                "semantic_level_requested": "FULL_REGISTRY",
                "source_tables": [_table("SRC")],
            },
            "data": {
                "intent": "CHAT",
                "message": "Recommend the best derived sources for this selection",
            },
        }
    )
    semantic_refresh = SimpleNamespace(
        achieved_level=SemanticLevel.FULL_REGISTRY,
        semantic_view_name="DB.SCH.SEMANTIC_VIEW",
        semantic_model_yaml=None,
    )

    assert STTMBuilderService._is_derived_source_request(envelope) is False
    assert STTMBuilderService._should_use_analyst(envelope, semantic_refresh) is False
    assert STTMBuilderService._is_derived_source_generation_text(
        "any advice on what derived source should be created for this mapping"
    ) is False
    assert STTMBuilderService._is_derived_source_generation_text(
        "create this derived source now"
    ) is True
    assert STTMBuilderService._is_derived_source_generation_text(
        "Prepare one reusable household-level source for the EverNest household migration."
    ) is True


def test_chat_continues_when_durable_conversation_storage_is_unavailable() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "operation": "sttm.chat",
            "context": {},
            "data": {"intent": "CHAT", "message": "Explain this selection"},
        }
    )

    class UnavailableContinuity:
        @staticmethod
        def prepare(**_: object) -> object:
            raise RuntimeError("conversation storage is unavailable")

    service = STTMBuilderService.__new__(STTMBuilderService)
    service._conversation_continuity = UnavailableContinuity()

    assert (
        service._prepare_conversation_continuity(
            envelope,
            "Explain this selection",
        )
        is None
    )


def test_analyst_question_includes_recent_conversation_for_pronoun_followup() -> None:
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "operation": "sttm.chat",
            "context": {
                "surface": "SOURCE_SELECTION",
                "workspace_context": {
                    "context_version": "2.0",
                    "context_hash": "ctx-followup",
                    "page": "source_selection",
                    "surface": "SOURCE_SELECTION",
                    "source_tables": [],
                    "target_table": None,
                    "relationships": [],
                    "derived_sources": [],
                    "mapping_rows": [],
                    "checked_mapping_row_ids": [],
                    "conversation_history": [
                        {"role": "user", "content": "How can portfolio ID be mapped?"},
                        {"role": "assistant", "content": "Use a mapper-table join; no derived update is required."},
                        {"role": "user", "content": "So does this need a derived update?"},
                    ],
                    "semantic": {"asset_versions": {}},
                },
            },
            "data": {"intent": "CHAT", "message": "So does this need a derived update?"},
        }
    )

    question = STTMBuilderService._build_analyst_question(envelope)

    assert "Use a mapper-table join" in question
    assert question.count("So does this need a derived update?") == 1
    assert "Resolve pronouns" in question


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
                            "confidence_reason": "Column names and semantic descriptions align.",
                            "candidate_source_attributes": ["DB.SCH.SRC.CUSTOMER_KEY"],
                            "preprocessing_rule": "Direct",
                            "preprocessing_rule_type": "Direct",
                            "preprocessing_nl_rule": "Use the source value directly.",
                            "processing_order": 1,
                            "description": "Customer identifier copied from the source record.",
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

    agent, result, message, warnings, error, meta, status, *_ = service._parse_envelope(raw)

    assert agent == SubAgent.SOURCE_MAPPING_AGENT
    assert result is not None
    mapping = result.mappings["DB.SCH.TGT.CUSTOMER_ID"]
    assert mapping.confidence_score == 0.92
    assert mapping.confidence_reason == "Column names and semantic descriptions align."
    assert mapping.candidate_source_attributes == ["DB.SCH.SRC.CUSTOMER_KEY"]
    assert mapping.preprocessing_rule == "Direct"
    assert mapping.preprocessing_nl_rule == "Use the source value directly."
    assert mapping.processing_order == 1
    assert message == "Mapped one column."
    assert warnings == []
    assert error is None
    assert meta["orchestration_model"] == "claude-haiku-4-5"
    assert status == STTMStatus.COMPLETED


def test_agent_meta_merge_accepts_extra_routing_meta_for_direct_analyst_path() -> None:
    merged = STTMBuilderService._merge_agent_meta(
        {"existing": True},
        {"routing": {"bypassed_agent_orchestrator": True}},
        raw_payload={"status": "completed", "schema_version": "1.0", "sequence_number": 1},
        artifact_type=STTMArtifactType.ANALYST_ANSWER,
        artifact={"query_id": "01abc", "semantic_sql_used": True},
    )

    assert merged["existing"] is True
    assert merged["routing"]["bypassed_agent_orchestrator"] is True
    assert merged["agent_run"]["status"] == "completed"
    assert merged["analyst"]["query_id"] == "01abc"


def test_stream_converts_unhandled_generator_failure_to_terminal_error_event() -> None:
    service = STTMBuilderService.__new__(STTMBuilderService)
    service._with_intent_route = lambda request: request  # type: ignore[method-assign]
    service._sanitize_request_semantic_context = lambda request: request  # type: ignore[method-assign]

    def fail_before_first_event(_request):  # type: ignore[no-untyped-def]
        raise RuntimeError("simulated generator failure")

    service._build_governance_decision = fail_before_first_event  # type: ignore[method-assign]
    envelope = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "req-stream-failure",
            "operation": "sttm.chat",
            "context": {},
            "data": {"intent": "CHAT", "message": "hello"},
        }
    )

    events = list(service.invoke_stream(envelope))

    assert len(events) == 1
    assert events[0].startswith("event: error\n")
    assert '"code": "STTM_STREAM_INCOMPLETE"' in events[0]


def test_auto_map_worker_invokes_source_mapping_agent_once_per_batch() -> None:
    service = STTMBuilderService.__new__(STTMBuilderService)
    service._settings = Settings(_env_file=None, AUTO_MAPPING_WORKER_MAX_CONCURRENCY=5)
    calls: list[int] = []
    req = STTMBuilderEnvelopeRequest.model_validate(
        {
            "contract_version": "1.0",
            "request_id": "req-auto-1",
            "operation": "sttm.auto_map",
            "context": {
                "source_tables": [_table("SRC")],
                "target_table": _table("TGT"),
            },
            "data": {
                "intent": "AUTO_MAP",
                "attributes": [
                    {
                        "target_table": _table("TGT"),
                        "target_attribute": "COL_A",
                    },
                    {
                        "target_table": _table("TGT"),
                        "target_attribute": "COL_B",
                    },
                ],
            },
        }
    )

    def fake_invoke(
        request: STTMBuilderEnvelopeRequest,
        *,
        governance_decision=None,  # type: ignore[no-untyped-def]
    ) -> STTMBuilderResponse:
        calls.append(len(request.data.attributes or []))
        return STTMBuilderResponse.from_invocation(
            request,
            thread_id="thread-1",
            parent_message_id=None,
            agent=SubAgent.SOURCE_MAPPING_AGENT,
            result=None,
            message="ok",
            status=STTMStatus.COMPLETED,
            meta={},
        )

    service.invoke = fake_invoke  # type: ignore[method-assign]

    response = asyncio.run(service.invoke_auto_map_parallel(req))

    assert calls == [2]
    assert response.meta["auto_mapping_worker"]["batch_strategy"] == "single_agent_batch_call"


def test_auto_map_keeps_selected_join_when_analyst_relationship_is_not_publishable(
    monkeypatch,
) -> None:
    service = STTMBuilderService.__new__(STTMBuilderService)
    service._conversation_memory = None
    calls: list[int] = []
    request = STTMBuilderEnvelopeRequest.model_validate(
        {
            "operation": "sttm.auto_map",
            "context": {
                "source_tables": [_table("SRC"), _table("NOTE")],
                "target_table": _table("TGT"),
                "relationships": [
                    {
                        "left_table": _table("SRC"),
                        "right_table": _table("NOTE"),
                        "join_type": "LEFT",
                        "conditions": [
                            {"left_column": "ID", "right_column": "SOURCE_ID"}
                        ],
                        "source": "USER_DEFINED",
                    }
                ],
            },
            "data": {
                "intent": "AUTO_MAP",
                "attributes": [
                    {"target_table": _table("TGT"), "target_attribute": "ID"}
                ],
            },
        }
    )

    service._with_intent_route = lambda req: req
    service._sanitize_request_semantic_context = lambda req: req

    def semantic_context(req):
        calls.append(len(req.context.relationships or []))
        if req.context.relationships:
            raise SemanticRelationshipInvalidError("right-side uniqueness is unknown")
        return req, SimpleNamespace(bundle_id="bundle-1")

    service._with_semantic_context = semantic_context
    service._with_learning_context = lambda req: req
    monkeypatch.setattr(
        "app.core.sttm_builder.attach_agent_execution_context",
        lambda req, _memory: req,
    )

    prepared = service.prepare_auto_map_request(request)

    assert calls == [1, 0]
    assert len(prepared.context.relationships or []) == 1
    assert prepared.context.relationships[0].source == "USER_DEFINED"
    assert prepared.meta["auto_map_relationship_mode"] == "direct_selected_relationships"
    assert prepared.warnings[-1].code == "AUTO_MAP_RELATIONSHIP_NOT_PUBLISHED"


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
                        "candidates": [{"table": "DB.SCH.SRC", "column": "CUSTOMER_KEY"}],
                        "reason": "Best semantic match for the customer identifier.",
                        "processing_order": "2",
                    }
                ]
            },
        }
    )

    agent, result, *_ = service._parse_envelope(raw)

    assert agent == SubAgent.SOURCE_MAPPING_AGENT
    assert result is not None
    mapping = result.mappings["DB.SCH.TGT.CUSTOMER_ID"]
    assert mapping.source_attributes == ["DB.SCH.SRC.CUST_ID"]
    assert mapping.confidence_score == 0.9
    assert mapping.candidate_source_attributes == ["DB.SCH.SRC.CUSTOMER_KEY"]
    assert mapping.confidence_reason == "Best semantic match for the customer identifier."
    assert mapping.processing_order == 2


def test_chat_response_unwraps_structured_envelope_embedded_in_message() -> None:
    service = STTMBuilderService.__new__(STTMBuilderService)
    nested = {
        "contract_version": "1.0",
        "request_id": "req-transform-1",
        "operation": "sttm.transform",
        "context": {},
        "data": {
            "intent": "TRANSFORM",
            "status": "completed",
            "agent": "TRANSFORMATION_AGENT",
            "result": {
                "rules": [
                    {
                        "target_attribute": "DB.SCH.TGT.NOTE_ID",
                        "rule": "TRY_CAST(DB.SCH.SRC.VERIFIED_INCOME_ID AS NUMBER(20,0))",
                        "description": "Casts the UUID-shaped source into a numeric target with TRY_CAST.",
                    }
                ]
            },
            "message": "Generated transformation rule for NOTE_ID.",
            "artifact_type": "transformation_rules",
            "artifact": {
                "sql_text": "TRY_CAST(DB.SCH.SRC.VERIFIED_INCOME_ID AS NUMBER(20,0))",
            },
            "semantic_level_achieved": "L3_MAPPING_ENRICHED",
        },
        "warnings": [],
        "error": None,
        "meta": {"routed_by": "AGT_STTM_BUILDER"},
    }
    outer = json.dumps(
        {
            "contract_version": "1.0",
            "request_id": "req-chat-1",
            "operation": "sttm.chat",
            "context": {},
            "data": {
                "intent": "CHAT",
                "status": "completed",
                "agent": None,
                "result": None,
                "message": f"```json\n{json.dumps(nested, indent=2)}\n```",
                "artifact_type": "none",
                "artifact": None,
            },
            "warnings": [],
            "error": None,
            "meta": {"orchestration_model": "claude-sonnet-4-6"},
        }
    )

    agent, result, message, warnings, error, meta, status, artifact_type, artifact, *_ = (
        service._parse_chat_response(outer)
    )

    assert agent == SubAgent.TRANSFORMATION_AGENT
    assert result is not None
    assert result.rules[0].target_attribute == "DB.SCH.TGT.NOTE_ID"
    assert result.rules[0].rule == "TRY_CAST(DB.SCH.SRC.VERIFIED_INCOME_ID AS NUMBER(20,0))"
    assert message == "Generated transformation rule for NOTE_ID."
    assert warnings == []
    assert error is None
    assert meta["orchestration_model"] == "claude-sonnet-4-6"
    assert meta["routed_by"] == "AGT_STTM_BUILDER"
    assert status == STTMStatus.COMPLETED
    assert artifact_type is not None and artifact_type.value == "transformation_rules"
    assert artifact == {"sql_text": "TRY_CAST(DB.SCH.SRC.VERIFIED_INCOME_ID AS NUMBER(20,0))"}


def test_role_aware_semantic_packing_keeps_target_and_derived_after_twenty_tables() -> None:
    physical = [
        {
            "table": _table(f"SRC_{index}"),
            "scope": "TABLE",
            "semantic_model": {"description": f"Physical source {index}"},
        }
        for index in range(35)
    ]
    target = {
        "table": _table("TGT"),
        "scope": "TABLE",
        "semantic_model": {
            "description": "Household migration target",
            "columns": [{"name": "OWNER_ID", "description": "Salesforce owner identifier"}],
        },
    }
    derived = {
        "table": _table("HOUSEHOLD_DERIVED"),
        "scope": "DERIVED_SOURCE",
        "semantic_model": {
            "purpose": "One eligible row per household",
            "grain": "household",
            "columns": [{"name": "HOUSEHOLD_ID", "description": "Stable household key"}],
        },
    }

    compact = STTMBuilderService._compact_semantic_context(
        [*physical, target, derived],
        {"DB.SCH.SRC_34": ["ID"]},
        {"DB.SCH.TGT": ["OWNER_ID"]},
        _table("SRC_34"),
        [],
    )

    assert compact is not None
    names = [item["table"]["table"] for item in compact]
    assert "TGT" in names
    assert "HOUSEHOLD_DERIVED" in names
    assert names.index("TGT") < names.index("SRC_0")
    assert names.index("HOUSEHOLD_DERIVED") < names.index("SRC_0")


def test_precedent_column_packing_limits_each_batch_to_relevant_sources() -> None:
    selected = STTMBuilderService._precedent_selected_columns(
        {
            "source_tables": [_table("CONTACTS"), _table("ADVISORS")],
            "driving_table": _table("CONTACTS"),
            "selected_columns_by_table": {},
            "relation_graph": {
                "nodes": [
                    {
                        "relation_id": "DB.SCH.CONTACTS",
                        "alias": "c",
                        "table": _table("CONTACTS"),
                    }
                ]
            },
            "learning_context": {
                "mapping_precedents": [
                    {
                        "alias_contract": {"c": "DB.SCH.CONTACTS"},
                        "mappings": [
                            {
                                "target_column": "OWNER_ID",
                                "source_dependencies": ["DB.SCH.CONTACTS.OWNER_ID"],
                                "preprocessing_rule": "COALESCE(c.OWNER_ID, $BackupOwnerID)",
                            },
                            {
                                "target_column": "CITY",
                                "source_dependencies": ["DB.SCH.CONTACTS.CITY"],
                            },
                        ],
                    }
                ]
            },
        },
        {"DB.SCH.TGT": ["OWNER_ID"]},
    )

    assert selected == {"DB.SCH.CONTACTS": ["OWNER_ID"]}


def test_shadow_column_packing_does_not_forward_select_all_payload() -> None:
    selected = STTMBuilderService._precedent_selected_columns(
        {
            "source_tables": [_table("CONTACTS")],
            "driving_table": _table("CONTACTS"),
            "selected_columns_by_table": {
                "DB.SCH.CONTACTS": [f"COLUMN_{index}" for index in range(200)]
            },
            "relation_graph": {"nodes": [], "edges": []},
            "learning_context": {"mapping_precedents": []},
        },
        {"DB.SCH.TGT": ["OWNER_ID"]},
    )

    assert selected == {}


def test_derived_semantics_keep_complete_output_contract() -> None:
    outputs = [
        {"name": f"DERIVED_COLUMN_{index}", "description": f"Meaning {index}"}
        for index in range(33)
    ]
    compact = STTMBuilderService._compact_semantic_context(
        [
            {
                "table": _table("HOUSEHOLD_DERIVED"),
                "scope": "DERIVED_SOURCE",
                "semantic_model": {"attributes": outputs},
            }
        ],
        {},
        {"DB.SCH.TGT": ["OWNER_ID"]},
        _table("CONTACTS"),
        [],
    )

    assert compact is not None
    assert len(compact[0]["semantic_model"]["attributes"]) == 33


def test_unselected_physical_semantics_are_lexically_bounded() -> None:
    attributes = [
        {"name": f"UNRELATED_{index}", "data_type": "TEXT"}
        for index in range(100)
    ] + [{"name": "HOUSEHOLD_ID", "data_type": "TEXT"}]

    compact = STTMBuilderService._compact_semantic_model(
        _table("CONTACTS"),
        {"attributes": attributes},
        {},
        {"DB.SCH.TGT": ["SOURCE_HOUSEHOLD_ID"]},
    )

    assert [item["name"] for item in compact["attributes"]] == ["HOUSEHOLD_ID"]


def test_agent_mapping_contract_preserves_precedent_and_value_decisions() -> None:
    service = STTMBuilderService.__new__(STTMBuilderService)
    raw = json.dumps(
        {
            "data": {
                "agent": "SOURCE_MAPPING_AGENT",
                "result": {
                    "mappings": {
                        "DB.SCH.TGT.PARENT_ID": {
                            "mapping_mode": "VALUE",
                            "constant_value": "$ParentOfficeID",
                            "source_attributes": [],
                            "source_dependencies": [],
                            "value_binding_ids": ["parent-office"],
                            "transformation_classification": "VALUE",
                            "precedent_decision": "accept_precedent",
                            "precedent_mapping_id": "1101",
                            "override_evidence": [],
                            "confidence_score": 0.99,
                        }
                    }
                },
            }
        }
    )

    _agent, result, *_ = service._parse_envelope(raw)

    assert result is not None
    mapping = result.mappings["DB.SCH.TGT.PARENT_ID"]
    assert mapping.mapping_mode == "constant"
    assert mapping.constant_value == "$ParentOfficeID"
    assert mapping.value_binding_ids == ["parent-office"]
    assert mapping.transformation_classification == "value"
    assert mapping.precedent_decision == "accept_precedent"


def test_linked_precedent_placeholders_become_relation_graph_value_bindings() -> None:
    graph = RelationGraphContext(
        value_bindings=[
            ValueBinding(
                binding_id="existing-parent",
                value="$ParentOfficeID",
                is_placeholder=True,
                resolution_status="placeholder_contract",
            )
        ]
    )
    learning = LearningContext(
        mapping_precedents=[
            MappingPrecedentContext(
                precedent_sttm_id="1101",
                mappings=[
                    {
                        "target_column": "PARENTID",
                        "mapping_mode": "constant",
                        "constant_value": "$ParentOfficeID",
                    },
                    {
                        "target_column": "LEGACY_ID__C",
                        "mapping_mode": "source",
                        "preprocessing_rule": "$LegacyHHcPrefix || SOURCE.legacy_hh_id",
                    },
                    {
                        "target_column": "OWNERID",
                        "mapping_mode": "source",
                        "preprocessing_rule": "COALESCE(SOURCE.owner_id, $BackupOwnerID)",
                    },
                ],
            )
        ]
    )

    enriched = STTMBuilderService._add_precedent_value_bindings(graph, learning)

    assert enriched is not None
    assert {item.value for item in enriched.value_bindings} == {
        "$ParentOfficeID",
        "$LegacyHHcPrefix",
        "$BackupOwnerID",
    }
    assert len(enriched.value_bindings) == 3
    assert all(
        item.resolution_status == "placeholder_contract"
        for item in enriched.value_bindings
    )
