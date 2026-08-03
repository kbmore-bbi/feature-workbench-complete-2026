from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.auth.models import PermissionSet
from app.core.config import Settings
from app.core.conversation_memory import ConversationMemoryService
from app.core.recommendation_actions import (
    RecommendationActionService,
    RecommendationBlockedError,
    RecommendationPermissionError,
    RecommendationStaleError,
    ensure_recommendation_apply_permission,
)


class _Row:
    def __init__(self, values: dict) -> None:
        self._values = values

    def as_dict(self) -> dict:
        return self._values


class _Query:
    def __init__(self, session: "_Session", sql: str) -> None:
        self._session = session
        self._sql = sql

    def collect(self):
        if "TBL_FIR_AGENT_RECOMMENDATIONS" in self._sql:
            return [_Row(self._session.recommendation)]
        if "WHERE IDEMPOTENCY_KEY" in self._sql:
            return (
                [_Row(self._session.existing_action)]
                if self._session.existing_action
                else []
            )
        if "WHERE ACTION_HISTORY_ID" in self._sql:
            return (
                [_Row(self._session.action_history)]
                if self._session.action_history
                else []
            )
        return []


class _Session:
    def __init__(self, recommendation: dict) -> None:
        self.recommendation = recommendation
        self.existing_action: dict | None = None
        self.action_history: dict | None = None
        self.statements: list[str] = []

    def sql(self, statement: str):
        self.statements.append(statement)
        return _Query(self, statement)


class _Projects:
    def __init__(self, snapshot: dict) -> None:
        self.latest = snapshot
        self.autosaves: list[object] = []

    def _latest_snapshot(self, _sttm_id: str):
        return self.latest

    def get_sttm_record(self, _sttm_id: str):
        return SimpleNamespace(project_id="project_1")

    def autosave_sttm(self, _sttm_id: str, payload, *, user_id: str):
        self.autosaves.append((payload, user_id))
        self.latest = dict(payload.workspace_snapshot)
        return SimpleNamespace(snapshot_id="snapshot_2")


class _Memory:
    def __init__(self) -> None:
        self.outcomes: list[dict] = []

    def record_fir_recommendation_outcome(self, **kwargs):
        self.outcomes.append(kwargs)
        return "outcome_1"


class _DerivedSources:
    def __init__(self) -> None:
        self.saved: list[object] = []

    def save_source(self, definition):
        self.saved.append(definition)
        return definition


def _direct_recommendation() -> dict:
    return {
        "AGENT_RECOMMENDATION_ID": "rec_1",
        "STATUS": "active",
        "CONTENT_VERSION": 3,
        "RECOMMENDATION_TYPE": "column_mapping_hint",
        "DISPLAY_MESSAGE": "Map CUSTOMER_ID from the current CRM identifier.",
        "CONFIDENCE": 0.93,
        "EVIDENCE_SUMMARY": "Validated published precedent.",
        "ACTION_CONTRACT": [
            {
                "id": "apply_customer_id",
                "action": "apply_direct_mapping",
                "payload": {
                    "target_column": "CUSTOMER_ID",
                    "source_columns": ["RAW.CRM.CONTACT.ID"],
                },
                "requires_confirmation": False,
            }
        ],
        "AGENT_PAYLOAD": {
            "business_rationale": "Reuse the validated identifier mapping."
        },
    }


def _snapshot() -> dict:
    return {
        "context_hash": "workspace_hash_1",
        "mapping_rows": [
            {
                "target_column": "CUSTOMER_ID",
                "source_column": None,
                "source_columns": [],
                "status": "UNMAPPED",
            }
        ],
    }


def _service(recommendation: dict | None = None):
    snapshot = _snapshot()
    session = _Session(recommendation or _direct_recommendation())
    projects = _Projects(snapshot)
    memory = _Memory()
    service = RecommendationActionService(
        session=session,
        settings=Settings(),
        project_service=projects,
        memory_service=memory,
    )
    return service, session, projects, memory


def test_preview_returns_exact_mapping_diff_without_mutating_input() -> None:
    service, _session, _projects, _memory = _service()
    before = _snapshot()

    preview = service.preview(
        "rec_1",
        actor_id="USER_1",
        sttm_id="sttm_1",
        workspace_snapshot=before,
        expected_workspace_hash="workspace_hash_1",
        action_id="apply_customer_id",
    )

    assert preview.can_apply is True
    assert preview.recommendation.recommendation_version == 3
    assert preview.recommendation.action_kind == "apply_direct_mapping"
    assert preview.after_workspace_hash != preview.before_workspace_hash
    assert any(item.path == "/mapping_rows" for item in preview.workspace_diff)
    assert before["mapping_rows"][0]["status"] == "UNMAPPED"


def test_preview_rejects_stale_backend_workspace() -> None:
    service, _session, projects, _memory = _service()
    projects.latest = {**_snapshot(), "context_hash": "newer_hash"}

    with pytest.raises(RecommendationStaleError):
        service.preview(
            "rec_1",
            actor_id="USER_1",
            sttm_id="sttm_1",
            workspace_snapshot=_snapshot(),
            expected_workspace_hash="workspace_hash_1",
        )


def test_apply_persists_through_existing_autosave_and_records_outcome() -> None:
    service, session, projects, memory = _service()

    applied = service.apply(
        "rec_1",
        actor_id="USER_1",
        sttm_id="sttm_1",
        workspace_snapshot=_snapshot(),
        expected_workspace_hash="workspace_hash_1",
        idempotency_key="apply-rec-1-0001",
        action_id="apply_customer_id",
    )

    assert applied.status == "applied"
    assert len(projects.autosaves) == 1
    saved_payload, actor = projects.autosaves[0]
    assert actor == "USER_1"
    assert saved_payload.action == "recommendation.applied"
    assert (
        saved_payload.workspace_snapshot["mapping_rows"][0]["source_column"]
        == "RAW.CRM.CONTACT.ID"
    )
    assert memory.outcomes[0]["outcome_type"] == "applied"
    assert any(
        "MERGE INTO" in sql
        and "TBL_FIR_RECOMMENDATION_ACTION_HISTORY" in sql
        for sql in session.statements
    )


def test_duplicate_apply_returns_recorded_result_without_mutating() -> None:
    service, session, projects, _memory = _service()
    preview = service.preview(
        "rec_1",
        actor_id="USER_1",
        sttm_id="sttm_1",
        workspace_snapshot=_snapshot(),
        expected_workspace_hash="workspace_hash_1",
    )
    session.existing_action = {
        "ACTION_HISTORY_ID": "history_1",
        "RECOMMENDATION_ID": "rec_1",
        "RESULT": {
            **preview.model_dump(mode="json"),
            "status": "applied",
            "action_history_id": "history_1",
            "snapshot_id": "snapshot_2",
        },
    }

    result = service.apply(
        "rec_1",
        actor_id="USER_1",
        sttm_id="sttm_1",
        workspace_snapshot=_snapshot(),
        expected_workspace_hash="workspace_hash_1",
        idempotency_key="apply-rec-1-0001",
    )

    assert result.status == "already_applied"
    assert result.action_history_id == "history_1"
    assert projects.autosaves == []


def test_structural_apply_requires_confirmation() -> None:
    recommendation = {
        **_direct_recommendation(),
        "RECOMMENDATION_TYPE": "relationship_hint",
        "ACTION_CONTRACT": [
            {
                "id": "join_1",
                "action": "preview_join",
                "payload": {
                    "relationship": {
                        "left_table": "RAW.CRM.CONTACT",
                        "right_table": "RAW.CRM.ACCOUNT",
                        "join_type": "LEFT",
                        "condition": "CONTACT.ACCOUNT_ID = ACCOUNT.ID",
                    }
                },
            }
        ],
    }
    service, _session, _projects, _memory = _service(recommendation)

    with pytest.raises(
        RecommendationBlockedError, match="requires confirmation"
    ):
        service.apply(
            "rec_1",
            actor_id="USER_1",
            sttm_id="sttm_1",
            workspace_snapshot=_snapshot(),
            expected_workspace_hash="workspace_hash_1",
            idempotency_key="apply-join-0001",
            confirmed=False,
        )


def test_undo_restores_only_exact_applied_workspace() -> None:
    service, session, projects, memory = _service()
    before = _snapshot()
    preview = service.preview(
        "rec_1",
        actor_id="USER_1",
        sttm_id="sttm_1",
        workspace_snapshot=before,
        expected_workspace_hash="workspace_hash_1",
    )
    after, _ = service._mutate(before, preview.recommendation)
    after["context_hash"] = preview.after_workspace_hash
    projects.latest = after
    session.action_history = {
        "ACTION_HISTORY_ID": "history_1",
        "RECOMMENDATION_ID": "rec_1",
        "RECOMMENDATION_VERSION": 3,
        "PROJECT_ID": "project_1",
        "STTM_ID": "sttm_1",
        "ACTOR_ID": "USER_1",
        "STATUS": "applied",
        "BEFORE_WORKSPACE_HASH": "workspace_hash_1",
        "AFTER_WORKSPACE_HASH": preview.after_workspace_hash,
        "BEFORE_SNAPSHOT": before,
    }

    undone = service.undo(
        recommendation_id="rec_1",
        actor_id="USER_1",
        sttm_id="sttm_1",
        action_history_id="history_1",
        expected_workspace_hash=preview.after_workspace_hash,
        idempotency_key="undo-rec-1-0001",
    )

    assert undone.status == "undone"
    assert projects.latest["mapping_rows"][0]["status"] == "UNMAPPED"
    assert memory.outcomes[-1]["outcome_type"] == "corrected"


def test_viewer_cannot_apply_recommendations() -> None:
    with pytest.raises(RecommendationPermissionError):
        ensure_recommendation_apply_permission(
            PermissionSet(can_read=True, can_edit=False)
        )


def test_derived_source_apply_validates_and_persists_catalog_record() -> None:
    recommendation = {
        **_direct_recommendation(),
        "RECOMMENDATION_TYPE": "derived_source_suggestion",
        "ACTION_CONTRACT": [
            {
                "id": "save_household_rollup",
                "action": "upsert_derived_source",
                "requires_confirmation": True,
                "payload": {
                    "derived_source": {
                        "derived_source_name": "HOUSEHOLD_ROLLUP",
                        "sql_text": "SELECT ID FROM RAW.CRM.CONTACT",
                        "source_tables": [
                            {
                                "database": "RAW",
                                "schema": "CRM",
                                "table": "CONTACT",
                            }
                        ],
                        "grain": "one row per household",
                        "keys": ["ID"],
                    }
                },
            }
        ],
    }
    service, _session, projects, _memory = _service(recommendation)
    derived_sources = _DerivedSources()
    service._derived_sources = derived_sources

    result = service.apply(
        "rec_1",
        actor_id="USER_1",
        sttm_id="sttm_1",
        workspace_snapshot=_snapshot(),
        expected_workspace_hash="workspace_hash_1",
        idempotency_key="apply-derived-0001",
        confirmed=True,
    )

    assert result.status == "applied"
    assert len(derived_sources.saved) == 1
    saved = derived_sources.saved[0]
    assert saved.derived_source_id.startswith("derived_fir_")
    assert (
        projects.latest["derived_sources"][0]["derived_source_id"]
        == saved.derived_source_id
    )


def test_feedback_outcome_uses_stable_idempotent_merge() -> None:
    session = _Session(_direct_recommendation())
    memory = ConversationMemoryService.__new__(ConversationMemoryService)
    memory._session = session
    memory._settings = Settings(
        SNOWFLAKE_DATABASE="TEST_DB",
        SNOWFLAKE_SCHEMA="TEST_SCHEMA",
    )

    first = memory.record_fir_recommendation_outcome(
        recommendation_id="rec_1",
        outcome_type="accepted",
        request_id="feedback-rec-1-0001",
        user_id="USER_1",
    )
    second = memory.record_fir_recommendation_outcome(
        recommendation_id="rec_1",
        outcome_type="accepted",
        request_id="feedback-rec-1-0001",
        user_id="USER_1",
    )

    assert first == second
    assert sum(
        "MERGE INTO" in sql and "TBL_FIR_RECOMMENDATION_OUTCOMES" in sql
        for sql in session.statements
    ) == 2
