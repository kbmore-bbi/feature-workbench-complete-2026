from types import SimpleNamespace

from app.core.config import Settings
from app.core.conversation_continuity import (
    ConversationContinuityService,
    estimate_tokens,
)


class FakeMemory:
    def __init__(self, active=None):
        self.active = active
        self.created = []
        self.closed = []
        self.artifacts = []
        self.bound = []
        self.usage = []

    def load_active_conversation_segment(self, _logical_id, *, user_id=None):
        return self.active

    def load_conversation_segment_by_thread(self, _thread_id, *, user_id=None):
        return self.active

    def create_conversation_segment(self, **kwargs):
        self.created.append(kwargs)
        return f"segment-{kwargs['segment_number']}"

    def close_conversation_segment(self, segment_id, **kwargs):
        self.closed.append((segment_id, kwargs))

    def load_recent_turns(self, _logical_id, *, limit, user_id=None):
        return [{"role": "user", "content": "Keep this decision"}][-limit:]

    def record_agent_artifact(self, **kwargs):
        self.artifacts.append(kwargs)
        return "artifact-checkpoint"

    def bind_conversation_thread(self, *args):
        self.bound.append(args)

    def note_conversation_segment_usage(self, *args, **kwargs):
        self.usage.append((args, kwargs))


def _context(**updates):
    values = {
        "logical_conversation_id": "logical-1",
        "thread_id": "thread-1",
        "session_id": "session-1",
        "semantic_bundle_id": "bundle-1",
        "semantic_bundle_hash": "bundle-hash",
        "learning_context_id": "learning-1",
        "learning_context_hash": "learning-hash",
        "project_id": "903",
        "sttm_id": "1101",
        "artifact_refs": ["artifact-sql"],
        "workspace_context": {"driving_table": "CONTACTS"},
        "learning_context": None,
        "surface": "mapping",
        "routing_hint": "source_mapping",
    }
    values.update(updates)
    return SimpleNamespace(**values)


def test_first_request_creates_durable_logical_segment() -> None:
    memory = FakeMemory()
    service = ConversationContinuityService(
        memory,
        Settings(_env_file=None),
    )

    preparation = service.prepare(
        context=_context(),
        packed_request="hello",
        request_id="request-1",
        user_id="42",
    )

    assert preparation.segment_number == 1
    assert preparation.physical_thread_id == "thread-1"
    assert memory.created[0]["logical_conversation_id"] == "logical-1"


def test_legacy_physical_thread_resolves_existing_logical_conversation() -> None:
    memory = FakeMemory(
        {
            "SEGMENT_ID": "segment-1",
            "LOGICAL_CONVERSATION_ID": "logical-existing",
            "SEGMENT_NUMBER": 1,
            "PHYSICAL_THREAD_ID": "thread-legacy",
            "ESTIMATED_CONTEXT_TOKENS": 100,
            "TURN_COUNT": 2,
        }
    )
    service = ConversationContinuityService(memory, Settings(_env_file=None))

    preparation = service.prepare(
        context=_context(
            logical_conversation_id=None,
            thread_id="thread-legacy",
        ),
        packed_request="continue",
        request_id="request-legacy",
        user_id="42",
    )

    assert preparation.logical_conversation_id == "logical-existing"
    assert preparation.segment_id == "segment-1"
    assert memory.created == []


def test_turn_threshold_rolls_over_and_preserves_workspace_handles() -> None:
    memory = FakeMemory(
        {
            "SEGMENT_ID": "segment-1",
            "SEGMENT_NUMBER": 1,
            "PHYSICAL_THREAD_ID": "thread-1",
            "ESTIMATED_CONTEXT_TOKENS": 100,
            "TURN_COUNT": 60,
        }
    )
    service = ConversationContinuityService(
        memory,
        Settings(
            _env_file=None,
            agent_context_limit_tokens=90000,
            agent_max_turns_per_segment=60,
        ),
    )

    preparation = service.prepare(
        context=_context(),
        packed_request="continue",
        request_id="request-2",
        user_id="42",
    )

    assert preparation.rolled_over is True
    assert preparation.rollover_reason == "turn_threshold"
    assert preparation.segment_number == 2
    checkpoint = memory.artifacts[0]["payload"]
    assert checkpoint["semantic_context"]["bundle_id"] == "bundle-1"
    assert checkpoint["learning_context"]["context_id"] == "learning-1"
    assert checkpoint["artifact_refs"] == ["artifact-sql"]
    assert checkpoint["workspace_state"]["driving_table"] == "CONTACTS"
    assert memory.closed[0][0] == "segment-1"
    assert preparation.rollover_context_tokens == estimate_tokens(checkpoint)

    service.complete(
        preparation,
        physical_thread_id="thread-2",
        user_text="continue",
        assistant_text="continued",
    )
    assert memory.usage[0][1]["added_tokens"] == (
        preparation.rollover_context_tokens
        + estimate_tokens("continue")
        + estimate_tokens("continued")
    )


def test_expired_thread_forces_idempotent_rollover_reason() -> None:
    memory = FakeMemory(
        {
            "SEGMENT_ID": "segment-2",
            "SEGMENT_NUMBER": 2,
            "PHYSICAL_THREAD_ID": "expired-thread",
            "ESTIMATED_CONTEXT_TOKENS": 100,
            "TURN_COUNT": 2,
        }
    )
    service = ConversationContinuityService(memory, Settings(_env_file=None))

    preparation = service.prepare(
        context=_context(),
        packed_request="retry",
        request_id="request-3",
        user_id="42",
        force_rollover_reason="expired_thread",
    )

    assert preparation.rolled_over is True
    assert preparation.rollover_reason == "expired_thread"
    assert preparation.physical_thread_id is None
