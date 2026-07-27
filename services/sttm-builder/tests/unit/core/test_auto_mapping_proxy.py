import threading
import time

from fastapi import Request
from fastapi import testclient as fastapi_testclient

from app.auth.models import AppPersona, CurrentPrincipal, PermissionSet
from app.core.auto_mapping_proxy import AutoMappingProxyClient
from app.core.config import Settings
from app.schema.common import TableRef
from app.schema.sttm_builder import (
    AttributeMapping,
    Interface,
    LearningContext,
    MappingPrecedentContext,
    RelationGraphContext,
    RelationNode,
    RelationNodeKind,
    SourceMappingResult,
    STTMBuilderContext,
    STTMBuilderEnvelopeRequest,
    STTMBuilderRequestData,
    STTMBuilderResponse,
    STTMOperation,
    STTMStatus,
    SubAgent,
    TargetAttributeItem,
)


def _request(attribute_count: int = 6) -> STTMBuilderEnvelopeRequest:
    source = TableRef(database="DB", schema="SRC", table="SOURCE")
    target = TableRef(database="DB", schema="TGT", table="TARGET")
    return STTMBuilderEnvelopeRequest(
        request_id="request-123",
        operation=STTMOperation.AUTO_MAP,
        context=STTMBuilderContext(source_tables=[source], target_table=target),
        data=STTMBuilderRequestData(
            intent=Interface.AUTO_MAP,
            attributes=[
                TargetAttributeItem(
                    target_table=target,
                    target_attribute=f"COL_{index}",
                )
                for index in range(attribute_count)
            ],
        ),
    )


def _response(req: STTMBuilderEnvelopeRequest) -> STTMBuilderResponse:
    mappings = {
        item.target_attribute: AttributeMapping(
            source_attributes=[f"DB.SRC.SOURCE.{item.target_attribute}"],
            confidence_score=0.9,
        )
        for item in req.data.attributes or []
    }
    return STTMBuilderResponse.from_invocation(
        req,
        thread_id="worker-thread",
        parent_message_id=None,
        agent=SubAgent.SOURCE_MAPPING_AGENT,
        result=SourceMappingResult(mappings=mappings),
        message="ok",
        status=STTMStatus.COMPLETED,
    )


def test_local_v2_defaults_to_private_inprocess_worker() -> None:
    local = Settings(
        _env_file=None,
        APP_ENV="local",
        AUTO_MAP_PIPELINE_V2=True,
        AUTO_MAPPING_SERVICE_URL="",
    )
    deployed = Settings(
        _env_file=None,
        APP_ENV="production",
        AUTO_MAP_PIPELINE_V2=True,
        AUTO_MAPPING_SERVICE_URL="",
    )

    assert local.resolved_auto_mapping_service_url == "inprocess"
    assert local.auto_mapping_service_enabled is True
    assert AutoMappingProxyClient(local).enabled is True
    assert deployed.resolved_auto_mapping_service_url == ""
    assert deployed.auto_mapping_service_enabled is False
    assert AutoMappingProxyClient(deployed).enabled is False


def test_proxy_fans_out_two_batches_and_preserves_mapping_order(monkeypatch) -> None:
    settings = Settings(
        _env_file=None,
        AUTH_MODE="custom_oauth",
        AUTO_MAPPING_SERVICE_URL="http://worker.internal:8000",
        AUTO_MAPPING_PROXY_BATCH_SIZE=2,
        AUTO_MAPPING_PROXY_MAX_IN_FLIGHT=2,
    )
    proxy = AutoMappingProxyClient(settings)
    envelope = _request()
    http_request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    http_request.state.current_principal = CurrentPrincipal(
        user_id=1,
        snowflake_user="ALICE",
        email="alice@example.com",
        display_name="Alice",
        app_persona=AppPersona.ADMIN,
        permissions=PermissionSet(can_read=True, can_edit=True),
        snowflake_user_token="oauth-secret-token",
        snowflake_role="FOCUS_ADMIN",
    )

    lock = threading.Lock()
    active = 0
    max_active = 0
    captured_headers: list[dict[str, str]] = []
    captured_payloads: list[str] = []

    def fake_invoke_batch(req, *, headers, batch_index):  # type: ignore[no-untyped-def]
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
            captured_headers.append(headers)
            captured_payloads.append(req.model_dump_json())
        time.sleep(0.03 if batch_index == 0 else 0.01)
        with lock:
            active -= 1
        return _response(req)

    monkeypatch.setattr(proxy, "_invoke_batch", fake_invoke_batch)

    result = proxy.invoke(http_request, envelope)

    assert max_active == 2
    assert list(result.result.mappings) == [f"COL_{index}" for index in range(6)]
    assert result.contract_version == "1.0"
    assert result.meta["auto_mapping_dispatch"] == {
        "attribute_count": 6,
        "batch_count": 3,
        "batch_size": 2,
        "batch_sizes": [2, 2, 2],
        "batching_mode": "adaptive_complexity_token_budget",
        "max_in_flight": 2,
        "resumed_batch_indices": [],
        "failed_batches": [],
    }
    assert result.meta["auto_mapping_review"]["headline"] == (
        "Auto-map completed: 6/6 targets mapped. No mapping issues were detected."
    )
    assert result.meta["auto_mapping_review"]["recommendations"] == []
    assert all(item["X-Workbench-OAuth-Access-Token"] == "oauth-secret-token" for item in captured_headers)
    assert all("oauth-secret-token" not in item for item in captured_payloads)


def test_inprocess_worker_adapter_uses_private_worker_contract(monkeypatch) -> None:
    settings = Settings(
        _env_file=None,
        AUTO_MAPPING_SERVICE_URL="inprocess",
    )
    proxy = AutoMappingProxyClient(settings)
    envelope = _request(attribute_count=2)
    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return _response(envelope).model_dump(mode="json")

    class FakeTestClient:
        def __init__(self, app):
            captured["app"] = app

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, path, *, headers, json):
            captured.update({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(fastapi_testclient, "TestClient", FakeTestClient)

    response = proxy._invoke_batch(
        envelope,
        headers={"Content-Type": "application/json"},
        batch_index=0,
    )

    assert captured["path"] == "/api/v1/auto-mapping/invoke"
    assert captured["json"]["request_id"] == "request-123"
    assert response.data is not None
    assert response.data.status == STTMStatus.COMPLETED


def test_inprocess_worker_retries_transient_response(monkeypatch) -> None:
    settings = Settings(
        _env_file=None,
        AUTO_MAPPING_SERVICE_URL="inprocess",
        AUTO_MAPPING_SERVICE_RETRY_ATTEMPTS=2,
    )
    proxy = AutoMappingProxyClient(settings)
    envelope = _request(attribute_count=2)
    attempts = 0

    class FakeResponse:
        def __init__(self, status_code: int):
            self.status_code = status_code

        def json(self):
            if self.status_code == 200:
                return _response(envelope).model_dump(mode="json")
            return {
                "error": {
                    "code": "SNOWFLAKE_AGENT_ERROR",
                    "detail": "Temporary Cortex failure",
                }
            }

    class FakeTestClient:
        def __init__(self, _app):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, _path, *, headers, json):
            nonlocal attempts
            attempts += 1
            return FakeResponse(503 if attempts == 1 else 200)

    monkeypatch.setattr(fastapi_testclient, "TestClient", FakeTestClient)
    monkeypatch.setattr(time, "sleep", lambda _seconds: None)

    response = proxy._invoke_batch(envelope, headers={}, batch_index=0)

    assert attempts == 2
    assert response.data is not None
    assert response.data.status == STTMStatus.COMPLETED


def test_worker_response_rejects_fabricated_precedent_claim_without_losing_mapping() -> None:
    envelope = _request(attribute_count=1)
    response = _response(envelope)
    result = response.data.result
    assert isinstance(result, SourceMappingResult)
    mapping = result.mappings["COL_0"]
    mapping.precedent_decision = "accept_precedent"
    mapping.precedent_mapping_id = "fabricated-semantic-pattern"

    AutoMappingProxyClient._validate_worker_response(
        response,
        req=envelope,
        batch_index=0,
    )

    assert mapping.source_attributes == ["DB.SRC.SOURCE.COL_0"]
    assert mapping.precedent_decision == "unresolved"
    assert mapping.precedent_mapping_id is None
    assert any(
        warning.code == "AUTO_MAPPING_PRECEDENT_DECISION_NORMALIZED"
        for warning in response.warnings
    )


def test_worker_response_accepts_only_an_actual_linked_precedent_id() -> None:
    envelope = _request(attribute_count=1)
    envelope = envelope.model_copy(
        update={
            "context": envelope.context.model_copy(
                update={
                    "learning_context": LearningContext(
                        mapping_precedents=[
                            MappingPrecedentContext(
                                precedent_sttm_id="1101",
                                precedent_project_id="903",
                                compatibility="similar",
                                confidence=0.9,
                            )
                        ]
                    )
                }
            )
        }
    )
    response = _response(envelope)
    result = response.data.result
    assert isinstance(result, SourceMappingResult)
    mapping = result.mappings["COL_0"]
    mapping.precedent_decision = "accept_precedent"
    mapping.precedent_mapping_id = "1101"

    AutoMappingProxyClient._validate_worker_response(
        response,
        req=envelope,
        batch_index=0,
    )

    assert mapping.precedent_decision == "accept_precedent"
    assert mapping.precedent_mapping_id == "1101"
    assert response.warnings == []


def test_worker_response_rejects_accept_when_value_contract_changed() -> None:
    envelope = _request(attribute_count=1)
    envelope = envelope.model_copy(
        update={
            "context": envelope.context.model_copy(
                update={
                    "learning_context": LearningContext(
                        mapping_precedents=[
                            MappingPrecedentContext(
                                precedent_sttm_id="1101",
                                mappings=[
                                    {
                                        "target_column": "COL_0",
                                        "mapping_mode": "constant",
                                        "constant_value": "$ClientStartDate",
                                        "preprocessing_rule_type": "Value",
                                    }
                                ],
                            )
                        ]
                    )
                }
            )
        }
    )
    response = _response(envelope)
    mapping = response.result.mappings["COL_0"]
    mapping.precedent_decision = "accept_precedent"
    mapping.precedent_mapping_id = "1101"
    mapping.mapping_mode = "source"

    AutoMappingProxyClient._validate_worker_response(
        response,
        req=envelope,
        batch_index=0,
    )

    assert mapping.precedent_decision == "unresolved"
    assert mapping.precedent_mapping_id is None
    assert any(
        warning.code == "AUTO_MAPPING_PRECEDENT_DECISION_NORMALIZED"
        for warning in response.warnings
    )


def test_worker_response_leaves_absent_derived_output_unresolved() -> None:
    envelope = _request(attribute_count=1)
    envelope = envelope.model_copy(
        update={
            "context": envelope.context.model_copy(
                update={
                    "relation_graph": RelationGraphContext(
                        nodes=[
                            RelationNode(
                                relation_id="derived_household",
                                kind=RelationNodeKind.DERIVED_SOURCE,
                                alias="derived_household_1",
                                output_columns=[
                                    {"name": "HOUSEHOLD_ID", "data_type": "NUMBER"}
                                ],
                            )
                        ]
                    )
                }
            )
        }
    )
    response = _response(envelope)
    mapping = response.result.mappings["COL_0"]
    mapping.source_attributes = ["derived_household.MISSING_FIELD"]
    mapping.source_dependencies = ["derived_household.MISSING_FIELD"]
    mapping.preprocessing_rule = "COALESCE(derived_household.MISSING_FIELD, '')"

    AutoMappingProxyClient._validate_worker_response(
        response,
        req=envelope,
        batch_index=0,
    )

    assert mapping.source_attributes == []
    assert mapping.source_dependencies == []
    assert mapping.preprocessing_rule is None
    assert mapping.precedent_decision == "unresolved"
    assert "not present" in str(mapping.unmatched_reason)
    assert any(
        warning.code == "AUTO_MAPPING_DERIVED_OUTPUT_NOT_FOUND"
        for warning in response.warnings
    )


def test_mapping_review_explains_missing_derived_outputs_and_next_action() -> None:
    mappings = {
        "LEGACY_FIRM_INFO__C": AttributeMapping(
            source_attributes=[],
            confidence_score=0.0,
            precedent_decision="unresolved",
            unmatched_reason=(
                "The proposed source derived_household.LEGACY_FIRM_INFO is not present "
                "in the selected derived source output contract."
            ),
            candidate_source_attributes=["CONTACT_UDFS.FIELD_VALUE"],
            used_learning_ids=["precedent-row-17"],
        ),
        "BILLINGCITY": AttributeMapping(
            source_attributes=["derived_household.BILLING_CITY"],
            confidence_score=0.72,
            confidence_reason="Only a semantic similarity match was available.",
            precedent_decision="override_precedent",
            override_evidence=["fir-12"],
        ),
    }

    message, review = AutoMappingProxyClient._build_mapping_review(mappings)

    assert "1/2 targets mapped" in message
    assert review["missing_derived_output_count"] == 1
    assert review["low_confidence_count"] == 1
    assert review["completed_without_review_count"] == 0
    assert review["mapped_with_review_count"] == 1
    assert review["action_required_count"] == 1
    categories = [item["category"] for item in review["recommendations"]]
    assert categories == [
        "missing_derived_output",
        "low_confidence",
        "precedent_override",
    ]
    missing = review["recommendations"][0]
    assert "Source Selection" in missing["recommended_action"]
    assert missing["candidate_sources"] == ["CONTACT_UDFS.FIELD_VALUE"]
    assert missing["evidence_ids"] == ["precedent-row-17"]


def test_exact_completed_precedent_replay_uses_zero_cortex_calls(monkeypatch) -> None:
    settings = Settings(
        _env_file=None,
        AUTO_MAPPING_SERVICE_URL="http://worker.internal:8000",
    )
    proxy = AutoMappingProxyClient(settings)
    envelope = _request(attribute_count=2)
    envelope = envelope.model_copy(
        update={
            "context": envelope.context.model_copy(
                update={
                    "replay_exact_precedent": True,
                    "learning_context": LearningContext(
                        mapping_precedents=[
                            MappingPrecedentContext(
                                precedent_sttm_id="1101",
                                precedent_project_id="903",
                                compatibility="exact",
                                confidence=1.0,
                                mappings=[
                                    {
                                        "mapping_id": "map-value",
                                        "target_column": "COL_0",
                                        "mapping_mode": "constant",
                                        "constant_value": "$ParentOfficeID",
                                        "preprocessing_rule": "Value",
                                        "preprocessing_rule_type": "Value",
                                    },
                                    {
                                        "mapping_id": "map-direct",
                                        "target_column": "COL_1",
                                        "mapping_mode": "source",
                                        "source_columns": ["SOURCE.COL_1"],
                                        "preprocessing_rule": "Direct",
                                        "preprocessing_rule_type": "Direct",
                                    },
                                ],
                                ctes=[{"name": "SOURCE"}],
                                business_rules=[{"rule_type": "filter"}],
                                raw_sql_hash="canonical-hash",
                            )
                        ]
                    )
                }
            )
        }
    )
    monkeypatch.setattr(
        proxy,
        "_invoke_batch",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Cortex called")),
    )

    response = proxy._invoke_with_headers(envelope, headers={})

    assert response.data is not None
    result = response.data.result
    assert isinstance(result, SourceMappingResult)
    assert result.mappings["COL_0"].mapping_mode == "constant"
    assert result.mappings["COL_0"].constant_value == "$ParentOfficeID"
    assert result.mappings["COL_1"].precedent_decision == "accept_precedent"
    assert response.meta["auto_mapping_dispatch"]["batching_mode"] == "exact_precedent_cache"
    assert response.meta["accepted_precedent"]["cte_count"] == 1


def test_exact_completed_precedent_is_evidence_and_invokes_agent_by_default(
    monkeypatch,
) -> None:
    settings = Settings(
        _env_file=None,
        AUTO_MAPPING_SERVICE_URL="http://worker.internal:8000",
    )
    proxy = AutoMappingProxyClient(settings)
    envelope = _request(attribute_count=1)
    envelope = envelope.model_copy(
        update={
            "context": envelope.context.model_copy(
                update={
                    "learning_context": LearningContext(
                        mapping_precedents=[
                            MappingPrecedentContext(
                                precedent_sttm_id="1101",
                                precedent_project_id="903",
                                compatibility="exact",
                                confidence=1.0,
                                mappings=[
                                    {
                                        "mapping_id": "map-direct",
                                        "target_column": "COL_0",
                                        "mapping_mode": "source",
                                        "source_columns": ["OLD_DB.SRC.CONTACTS.COL_0"],
                                    }
                                ],
                            )
                        ]
                    )
                }
            )
        }
    )
    invoked: list[STTMBuilderEnvelopeRequest] = []

    def fake_invoke_batch(req, *, headers, batch_index):  # type: ignore[no-untyped-def]
        invoked.append(req)
        return _response(req)

    monkeypatch.setattr(proxy, "_invoke_batch", fake_invoke_batch)

    response = proxy._invoke_with_headers(envelope, headers={})

    assert len(invoked) == 1
    assert invoked[0].context.learning_context is not None
    assert invoked[0].context.learning_context.mapping_precedents[0].precedent_sttm_id == "1101"
    assert response.meta.get("accepted_precedent") is None
    assert response.result.mappings["COL_0"].source_attributes == ["DB.SRC.SOURCE.COL_0"]


def test_terminal_partial_selection_matches_qualified_agent_target_keys() -> None:
    envelope = _request(attribute_count=2)
    response = _response(envelope)
    result = response.result
    assert isinstance(result, SourceMappingResult)
    result.mappings = {
        f"DB.TGT.TARGET.{target}": mapping
        for target, mapping in result.mappings.items()
    }

    partial = AutoMappingProxyClient._response_for_targets(response, {"COL_1"})

    assert list(partial.result.mappings) == ["DB.TGT.TARGET.COL_1"]


def test_async_job_completes_without_holding_the_ingress_request(monkeypatch) -> None:
    settings = Settings(
        _env_file=None,
        AUTH_MODE="custom_oauth",
        AUTO_MAPPING_SERVICE_URL="http://worker.internal:8000",
        AUTO_MAPPING_PROXY_BATCH_SIZE=2,
        AUTO_MAPPING_PROXY_MAX_IN_FLIGHT=2,
    )
    proxy = AutoMappingProxyClient(settings)
    envelope = _request(attribute_count=3)
    http_request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    http_request.state.current_principal = CurrentPrincipal(
        user_id=1,
        snowflake_user="ALICE",
        email="alice@example.com",
        display_name="Alice",
        app_persona=AppPersona.ADMIN,
        permissions=PermissionSet(can_read=True, can_edit=True),
        snowflake_user_token="oauth-secret-token",
        snowflake_role="FOCUS_ADMIN",
    )
    monkeypatch.setattr(
        proxy,
        "_invoke_with_headers",
        lambda req, *, headers: _response(req),
    )

    started = proxy.start_job(http_request, envelope)
    assert started["status"] in {"queued", "running", "completed"}
    for _ in range(100):
        job = proxy.get_job(http_request, started["job_id"])
        if job["status"] == "completed":
            break
        time.sleep(0.01)

    assert job["status"] == "completed"
    assert job["response"]["contract_version"] == "1.0"
    assert job["completed_batch_count"] == job["batch_count"]
    assert [item["batch_index"] for item in job["partial_responses"]] == [0, 1]
    assert [
        list(item["response"]["result"]["mappings"])
        for item in job["partial_responses"]
    ] == [["COL_0", "COL_1"], ["COL_2"]]
    assert "owner" not in job
    assert "request_envelope" not in job


def test_polling_resumes_an_expired_durable_job_on_a_new_replica(monkeypatch) -> None:
    settings = Settings(
        _env_file=None,
        AUTH_MODE="custom_oauth",
        AUTO_MAP_PIPELINE_V2=True,
        AUTO_MAPPING_SERVICE_URL="http://worker.internal:8000",
    )
    proxy = AutoMappingProxyClient(settings)
    envelope = _request(attribute_count=2)
    http_request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    http_request.state.current_principal = CurrentPrincipal(
        user_id=1,
        snowflake_user="ALICE",
        email="alice@example.com",
        display_name="Alice",
        app_persona=AppPersona.ADMIN,
        permissions=PermissionSet(can_read=True, can_edit=True),
        snowflake_user_token="replacement-poll-token",
        snowflake_role="FOCUS_ADMIN",
    )
    durable_record = {
        "job_id": "restart-job",
        "request_id": envelope.request_id,
        "owner": "ALICE",
        "status": "running",
        "request_envelope": envelope.model_dump(mode="json"),
        "partial_responses": [],
    }
    launched: dict[str, object] = {}
    monkeypatch.setattr(
        proxy,
        "_load_persisted_job",
        lambda *_args, **_kwargs: dict(durable_record),
    )

    def fake_launch(job_id, *, req, headers, owner, record):  # type: ignore[no-untyped-def]
        launched.update(
            {
                "job_id": job_id,
                "request_id": req.request_id,
                "headers": headers,
                "owner": owner,
                "record": record,
            }
        )
        return True

    monkeypatch.setattr(proxy, "_launch_job_runner", fake_launch)

    public = proxy.get_job(http_request, "restart-job", session=object())

    assert launched["job_id"] == "restart-job"
    assert launched["request_id"] == envelope.request_id
    assert launched["owner"] == "ALICE"
    assert launched["headers"]["X-Workbench-OAuth-Access-Token"] == "replacement-poll-token"
    assert "request_envelope" not in public


def test_durable_lease_allows_only_one_replica_to_claim_a_job() -> None:
    class LeaseRow:
        def __init__(self, owner):
            self.owner = owner

        def as_dict(self):
            return {"LEASE_OWNER": self.owner}

    class LeaseQuery:
        def __init__(self, session, sql, params):
            self.session = session
            self.sql = sql
            self.params = params

        def collect(self):
            if "UPDATE" in self.sql and self.session.lease_owner is None:
                self.session.lease_owner = self.params[0]
                return []
            if "SELECT LEASE_OWNER" in self.sql:
                return [LeaseRow(self.session.lease_owner)]
            return []

    class LeaseSession:
        def __init__(self):
            self.lease_owner = None

        def sql(self, sql, params=None):
            return LeaseQuery(self, sql, params or [])

    settings = Settings(
        _env_file=None,
        AUTO_MAP_PIPELINE_V2=True,
        AUTO_MAPPING_SERVICE_URL="http://worker.internal:8000",
    )
    session = LeaseSession()
    first = AutoMappingProxyClient(settings)
    second = AutoMappingProxyClient(settings)

    assert first._claim_job_lease(
        "job-1", owner="ALICE", headers={}, session=session
    ) is True
    assert second._claim_job_lease(
        "job-1", owner="ALICE", headers={}, session=session
    ) is False


def test_recovered_job_invokes_only_batches_missing_from_durable_partials(monkeypatch) -> None:
    settings = Settings(
        _env_file=None,
        AUTO_MAPPING_SERVICE_URL="http://worker.internal:8000",
        AUTO_MAPPING_PROXY_BATCH_SIZE=2,
        AUTO_MAPPING_PROXY_MAX_IN_FLIGHT=2,
    )
    proxy = AutoMappingProxyClient(settings)
    envelope = _request(attribute_count=6)
    first_batch_req = envelope.model_copy(
        update={
            "data": envelope.data.model_copy(
                update={"attributes": envelope.data.attributes[:2]}
            )
        }
    )
    partials = [
        {
            "batch_index": 0,
            "response": _response(first_batch_req).model_dump(mode="json"),
        }
    ]
    invoked: list[int] = []

    def fake_invoke(req, *, headers, batch_index):  # type: ignore[no-untyped-def]
        invoked.append(batch_index)
        return _response(req)

    monkeypatch.setattr(proxy, "_invoke_batch", fake_invoke)

    result = proxy._invoke_with_headers(
        envelope,
        headers={},
        resume_partials=partials,
    )

    assert sorted(invoked) == [1, 2]
    assert list(result.result.mappings) == [f"COL_{index}" for index in range(6)]
    assert result.meta["auto_mapping_dispatch"]["resumed_batch_indices"] == [0]


def test_v2_job_state_round_trips_through_durable_store() -> None:
    class DurableRow:
        def __init__(self, state):
            self.state = state

        def as_dict(self):
            return {"JOB_STATE": self.state}

    class DurableQuery:
        def __init__(self, session, sql, params=None):
            self.session = session
            self.sql = sql
            self.params = params or []

        def collect(self):
            self.session.queries.append((self.sql, self.params))
            if "SELECT JOB_STATE" in self.sql:
                return [DurableRow(self.session.state)]
            return []

    class DurableSession:
        def __init__(self):
            self.queries = []
            self.state = {
                "job_id": "job-1",
                "owner": "ALICE",
                "status": "running",
                "partial_responses": [],
            }

        def sql(self, sql, params=None):
            return DurableQuery(self, sql, params)

    settings = Settings(
        _env_file=None,
        AUTO_MAP_PIPELINE_V2=True,
        AUTO_MAPPING_SERVICE_URL="http://worker.internal:8000",
    )
    proxy = AutoMappingProxyClient(settings)
    session = DurableSession()
    record = dict(session.state)

    proxy._persist_job(record, headers={}, session=session, required=True)
    loaded = proxy._load_persisted_job(
        "job-1", owner="ALICE", headers={}, session=session
    )

    assert loaded == record
    assert any(
        "MERGE INTO" in query and "TBL_AUTO_MAP_JOBS" in query
        for query, _params in session.queries
    )
    assert any(
        "JOB_STATE:state_version" in query
        for query, _params in session.queries
        if "MERGE INTO" in query
    )
    assert any("SELECT JOB_STATE" in query for query, _params in session.queries)
    merge_params = next(params for query, params in session.queries if "MERGE INTO" in query)
    assert len(merge_params) == 9
