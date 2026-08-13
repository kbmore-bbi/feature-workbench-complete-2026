from __future__ import annotations

import json
from types import SimpleNamespace

from app.core.async_jobs import AsyncJobService


class _Row:
    def __init__(self, **values):
        self._values = values

    def as_dict(self):
        return self._values


class _Query:
    def __init__(self, rows):
        self._rows = rows

    def collect(self):
        return self._rows


class _Session:
    def __init__(self):
        self.calls = []

    def sql(self, statement, params=None):
        self.calls.append((statement, params or []))
        if "SELECT JOB_ID, STATUS" in statement:
            return _Query([_Row(JOB_ID="job_existing", STATUS="queued")])
        if "SELECT JOB_ID\n" in statement:
            return _Query([_Row(JOB_ID="job_existing")])
        if "SELECT *" in statement:
            return _Query(
                [
                    _Row(
                        JOB_ID="job_existing",
                        LEASE_OWNER="worker_1",
                        JOB_TYPE="sttm_post_save_projection",
                    )
                ]
            )
        return _Query([_Row(number_of_rows_updated=1)])


def _service():
    session = _Session()
    settings = SimpleNamespace(
        qualify_metadata_object_name=lambda name: f"DB.SCHEMA.{name}"
    )
    return AsyncJobService(session, settings), session


def test_enqueue_binds_json_and_is_idempotency_keyed():
    service, session = _service()

    job_id, status = service.enqueue(
        snapshot_id="snapshot_1",
        sttm_id="sttm_1",
        project_id="project_1",
        job_type="sttm_post_save_projection",
        payload={"message": "safe — unicode \\u2013 text"},
    )

    merge_sql, params = session.calls[0]
    assert "PARSE_JSON(?)" in merge_sql
    assert "safe — unicode" not in merge_sql
    assert json.loads(params[-1])["message"] == "safe — unicode \\u2013 text"
    assert job_id == "job_existing"
    assert status == "queued"


def test_claim_can_be_narrowed_to_the_published_snapshot():
    service, session = _service()

    job = service.claim_next(
        worker_id="worker_1",
        snapshot_id="snapshot_1",
    )

    select_sql, params = session.calls[0]
    assert "AND SNAPSHOT_ID = ?" in select_sql
    assert params == ["snapshot_1"]
    assert job["JOB_ID"] == "job_existing"
