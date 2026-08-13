import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.config import Settings
from app.core.conversation_memory import ConversationMemoryService
from app.core.exceptions import SnowflakeQueryError


class _Query:
    def __init__(self, session: "_Session", sql: str) -> None:
        self._session = session
        self._sql = sql

    def collect(self):
        return self._session.collect(self._sql)


class _Files:
    def __init__(self) -> None:
        self.puts: list[tuple[str, str]] = []
        self.fail_put = False

    def put(self, source: str, destination: str, **_kwargs):
        if self.fail_put:
            raise RuntimeError("stage is unavailable")
        assert source.startswith("file://")
        assert Path(source.removeprefix("file://")).exists()
        self.puts.append((source, destination))
        return []

    def get(self, _source: str, _directory: str):
        return []


class _Session:
    def __init__(self) -> None:
        self.file = _Files()
        self.insert_count = 0
        self.last_artifact_id: str | None = None
        self.artifact_row: dict | None = None
        self.authorized_fingerprint = "owner-1"
        self.last_insert_sql = ""

    def sql(self, sql: str) -> _Query:
        return _Query(self, sql)

    def collect(self, sql: str):
        normalized = " ".join(sql.split())
        if normalized.startswith("SELECT ARTIFACT_ID, ARTIFACT_TYPE"):
            if self.authorized_fingerprint not in normalized or self.artifact_row is None:
                return []
            return [SimpleNamespace(as_dict=lambda: self.artifact_row)]
        if normalized.startswith("SELECT ARTIFACT_ID") and "CONTENT_HASH" in normalized:
            if self.last_artifact_id:
                return [SimpleNamespace(as_dict=lambda: {"ARTIFACT_ID": self.last_artifact_id})]
            return []
        if normalized.startswith("INSERT INTO") and "TBL_AGENT_ARTIFACTS" in normalized:
            match = re.search(r"'(artifact_[0-9a-f]+)'", normalized)
            assert match
            self.last_artifact_id = match.group(1)
            self.insert_count += 1
            self.last_insert_sql = normalized
            return []
        return []


def _service(
    session: _Session,
    *,
    inline_limit: int = 32768,
    caller_runtime: bool = False,
    fallback_limit: int = 1048576,
) -> ConversationMemoryService:
    settings = Settings(
        _env_file=None,
        snowflake_database="DB",
        snowflake_schema="SCHEMA",
        snowflake_agent_artifacts_table="TBL_AGENT_ARTIFACTS",
        snowflake_agent_artifact_stage="DB.SCHEMA.AI_WORKBENCH_ARTIFACTS",
        agent_inline_artifact_limit_bytes=inline_limit,
        agent_caller_inline_fallback_limit_bytes=fallback_limit,
        auth_mode="custom_oauth" if caller_runtime else "ingress_headers",
        spcs_execute_as_caller_enabled=caller_runtime,
    )
    service = ConversationMemoryService(session, settings)
    service.ensure_storage_exists = lambda: None  # type: ignore[method-assign]
    return service


def _record(service: ConversationMemoryService, payload: dict) -> str:
    return service.record_agent_artifact(
        request_id="request-1",
        session_id="session-1",
        thread_id="thread-1",
        agent_name="AGT_STTM_BUILDER",
        artifact_type="sql",
        payload=payload,
        access_fingerprint="owner-1",
    )


def test_identical_inline_artifact_reuses_existing_content_hash() -> None:
    session = _Session()
    service = _service(session)

    first = _record(service, {"sql": "SELECT 1"})
    second = _record(service, {"sql": "SELECT 1"})

    assert second == first
    assert session.insert_count == 1
    assert session.file.puts == []


def test_concurrent_identical_artifact_writes_are_single_flight() -> None:
    session = _Session()
    service = _service(session)

    with ThreadPoolExecutor(max_workers=5) as executor:
        artifact_ids = list(
            executor.map(
                lambda _index: _record(service, {"sql": "SELECT 1"}),
                range(5),
            )
        )

    assert len(set(artifact_ids)) == 1
    assert session.insert_count == 1


def test_large_artifact_is_compressed_to_content_addressed_stage() -> None:
    session = _Session()
    service = _service(session, inline_limit=32)

    artifact_id = _record(service, {"sql": "SELECT " + ("x" * 2000)})

    assert artifact_id.startswith("artifact_")
    assert session.insert_count == 1
    assert len(session.file.puts) == 1
    _source, destination = session.file.puts[0]
    assert destination.startswith('@"DB"."SCHEMA"."AI_WORKBENCH_ARTIFACTS"/sha256/')


def test_caller_runtime_keeps_bounded_artifact_inline_without_stage_retry() -> None:
    session = _Session()
    service = _service(session, inline_limit=32, caller_runtime=True)

    _record(service, {"sql": "SELECT " + ("x" * 2000)})

    assert session.file.puts == []
    assert "stage_upload_disabled_for_caller_rights_runtime" not in session.last_insert_sql
    assert "SELECT" in session.last_insert_sql


def test_stage_failure_falls_back_to_metadata_for_oversized_artifact() -> None:
    session = _Session()
    session.file.fail_put = True
    service = _service(session, inline_limit=32, fallback_limit=64)

    _record(service, {"sql": "SELECT " + ("x" * 2000)})

    assert session.insert_count == 1
    assert "metadata_only" in session.last_insert_sql
    assert "stage_upload_failed" in session.last_insert_sql


def test_artifact_hydration_requires_owner_and_supports_bounded_section() -> None:
    session = _Session()
    session.artifact_row = {
        "ARTIFACT_ID": "artifact-1",
        "ARTIFACT_TYPE": "sql",
        "MIME_TYPE": "application/json",
        "CONTENT_HASH": "hash-1",
        "PAYLOAD": {"sql": "SELECT 12345", "other": []},
        "SUMMARY": "SQL",
        "STAGE_PATH": "",
        "PROJECT_ID": "903",
        "MAPPING_ID": "1101",
    }
    service = _service(session)

    hydrated = service.get_agent_artifact(
        "artifact-1",
        access_fingerprint="owner-1",
        section="sql",
        start=7,
        end=12,
    )

    assert hydrated["payload"] == "12345"
    with pytest.raises(SnowflakeQueryError):
        service.get_agent_artifact(
            "artifact-1",
            access_fingerprint="different-owner",
        )
