from app.core.project_service import ProjectService
from app.schema.project import STTMAutosaveRequest


def _service_with_event_recorder() -> tuple[ProjectService, list[dict]]:
    service = ProjectService.__new__(ProjectService)
    recorded: list[dict] = []
    service._record_fir = lambda **kwargs: recorded.append(kwargs)
    return service, recorded


def test_ordinary_autosave_emits_no_fir_learning_event() -> None:
    service, recorded = _service_with_event_recorder()

    count = service._record_autosave_fir_events(
        project_id="project_1",
        sttm_id="sttm_1",
        payload=STTMAutosaveRequest(
            workspace_snapshot={},
            action="workspace.autosaved",
        ),
        snapshot={
            "context_hash": "workspace_hash_2",
            "mapping_rows": [{"target_column": "CUSTOMER_ID"}],
            "validation_history": [],
        },
        previous_snapshot={
            "context_hash": "workspace_hash_1",
            "validation_history": [],
        },
        user_id="user_1",
    )

    assert count == 0
    assert recorded == []


def test_autosave_emits_only_new_validation_results() -> None:
    service, recorded = _service_with_event_recorder()
    prior_validation = {"valid": True, "sql": "select 1", "errors": []}
    new_validation = {
        "valid": False,
        "sql": "select missing_column",
        "errors": ["invalid identifier"],
    }

    count = service._record_autosave_fir_events(
        project_id="project_1",
        sttm_id="sttm_1",
        payload=STTMAutosaveRequest(workspace_snapshot={}),
        snapshot={
            "context_hash": "workspace_hash_2",
            "validation_history": [prior_validation, new_validation],
        },
        previous_snapshot={"validation_history": [prior_validation]},
        user_id="user_1",
    )

    assert count == 1
    assert [event["event_type"] for event in recorded] == [
        "sql.validation_failed"
    ]
    assert {
        key: recorded[0]["payload"][key]
        for key in new_validation
    } == new_validation
    assert recorded[0]["payload"]["validation_cursor"]
    assert recorded[0]["payload"]["previous_validation_cursor"]
    assert recorded[0]["request_id"].startswith("fir-autosave-")


def test_validation_action_does_not_duplicate_incremental_result() -> None:
    service, recorded = _service_with_event_recorder()
    validation = {"valid": True, "sql": "select 1", "errors": []}

    count = service._record_autosave_fir_events(
        project_id="project_1",
        sttm_id="sttm_1",
        payload=STTMAutosaveRequest(
            workspace_snapshot={},
            action="sql.validation_passed",
        ),
        snapshot={"validation_history": [validation]},
        previous_snapshot={"validation_history": []},
        user_id="user_1",
    )

    assert count == 1
    assert recorded[0]["event_type"] == "sql.validation_passed"
    assert {
        key: recorded[0]["payload"][key]
        for key in validation
    } == validation
    assert recorded[0]["payload"]["validation_cursor"]


def test_meaningful_autosave_event_is_idempotency_keyed() -> None:
    service, recorded = _service_with_event_recorder()
    payload = STTMAutosaveRequest(
        workspace_snapshot={},
        action="mapping.corrected",
    )
    snapshot = {
        "context_hash": "workspace_hash",
        "mapping_rows": [{"target_column": "CUSTOMER_ID"}],
    }

    for _ in range(2):
        service._record_autosave_fir_events(
            project_id="project_1",
            sttm_id="sttm_1",
            payload=payload,
            snapshot=snapshot,
            previous_snapshot=None,
            user_id="user_1",
        )

    assert len(recorded) == 2
    assert recorded[0]["event_type"] == "mapping.corrected"
    assert recorded[0]["request_id"] == recorded[1]["request_id"]


def test_normalized_workspace_hash_ignores_capture_and_navigation_metadata() -> None:
    first = {
        "captured_at": "2026-07-28T01:00:00Z",
        "action": "workspace.autosaved",
        "page": "mapping",
        "mapping_rows": [{"target_column": "ID", "status": "MAPPED"}],
    }
    second = {
        **first,
        "captured_at": "2026-07-28T01:02:00Z",
        "action": "recommendation.preview",
        "page": "summary",
    }

    assert ProjectService._normalized_workspace_hash(
        first
    ) == ProjectService._normalized_workspace_hash(second)
