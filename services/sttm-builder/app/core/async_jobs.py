"""Durable post-save job lifecycle storage."""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.performance import increment


class AsyncJobService:
    def __init__(self, session: Session, settings: Settings) -> None:
        self._session = session
        self._table = settings.qualify_metadata_object_name("TBL_WORKBENCH_ASYNC_JOBS")

    def enqueue(
        self,
        *,
        snapshot_id: str,
        sttm_id: str,
        project_id: str,
        job_type: str,
        payload: dict[str, Any],
    ) -> tuple[str, str]:
        idempotency_key = hashlib.sha256(
            f"{snapshot_id}\x1f{job_type}".encode("utf-8")
        ).hexdigest()
        job_id = f"job_{uuid.uuid4().hex}"
        self._session.sql(
            f"""
            MERGE INTO {self._table} target
            USING (
                SELECT ? JOB_ID, ? IDEMPOTENCY_KEY, ? SNAPSHOT_ID, ? STTM_ID,
                       ? PROJECT_ID, ? JOB_TYPE, PARSE_JSON(?) PAYLOAD
            ) source
            ON target.IDEMPOTENCY_KEY = source.IDEMPOTENCY_KEY
            WHEN NOT MATCHED THEN INSERT (
                JOB_ID, IDEMPOTENCY_KEY, SNAPSHOT_ID, STTM_ID, PROJECT_ID,
                JOB_TYPE, PAYLOAD, STATUS
            ) VALUES (
                source.JOB_ID, source.IDEMPOTENCY_KEY, source.SNAPSHOT_ID,
                source.STTM_ID, source.PROJECT_ID, source.JOB_TYPE,
                source.PAYLOAD, 'queued'
            )
            """,
            params=[
                job_id,
                idempotency_key,
                snapshot_id,
                sttm_id,
                project_id,
                job_type,
                json.dumps(payload, default=str),
            ],
        ).collect()
        rows = self._session.sql(
            f"SELECT JOB_ID, STATUS FROM {self._table} WHERE IDEMPOTENCY_KEY = ? LIMIT 1",
            params=[idempotency_key],
        ).collect()
        data = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
        increment("autosave.async_job.enqueued", job_type=job_type)
        return str(data.get("JOB_ID")), str(data.get("STATUS") or "queued")

    def mark_failed(
        self,
        job_id: str,
        error: dict[str, Any],
        *,
        worker_id: str,
    ) -> None:
        self._session.sql(
            f"""
            UPDATE {self._table}
            SET STATUS = IFF(ATTEMPT_COUNT >= 5, 'failed', 'queued'),
                LEASE_OWNER = NULL,
                LEASE_EXPIRES_AT = NULL,
                NEXT_ATTEMPT_AT = DATEADD('second', POWER(2, LEAST(ATTEMPT_COUNT, 8)), CURRENT_TIMESTAMP()),
                ERROR_DETAILS = PARSE_JSON(?),
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE JOB_ID = ? AND LEASE_OWNER = ? AND STATUS = 'running'
            """,
            params=[json.dumps(error, default=str), job_id, worker_id],
        ).collect()
        increment("autosave.async_job.failed")

    def claim_next(
        self,
        *,
        worker_id: str,
        lease_seconds: int = 120,
        snapshot_id: str | None = None,
    ) -> dict[str, Any] | None:
        snapshot_filter = ""
        params: list[Any] = []
        if snapshot_id:
            snapshot_filter = "AND SNAPSHOT_ID = ?"
            params.append(snapshot_id)
        rows = self._session.sql(
            f"""
            SELECT JOB_ID
            FROM {self._table}
            WHERE STATUS = 'queued'
              AND NEXT_ATTEMPT_AT <= CURRENT_TIMESTAMP()
              AND (LEASE_EXPIRES_AT IS NULL OR LEASE_EXPIRES_AT < CURRENT_TIMESTAMP())
              {snapshot_filter}
            ORDER BY CREATED_AT
            LIMIT 1
            """,
            params=params,
        ).collect()
        if not rows:
            return None
        row = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
        job_id = str(row.get("JOB_ID"))
        claimed = self._session.sql(
            f"""
            UPDATE {self._table}
            SET STATUS = 'running', LEASE_OWNER = ?,
                LEASE_EXPIRES_AT = DATEADD('second', ?, CURRENT_TIMESTAMP()),
                ATTEMPT_COUNT = ATTEMPT_COUNT + 1,
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE JOB_ID = ?
              AND STATUS = 'queued'
              AND (LEASE_EXPIRES_AT IS NULL OR LEASE_EXPIRES_AT < CURRENT_TIMESTAMP())
            """,
            params=[worker_id, max(1, lease_seconds), job_id],
        ).collect()
        if not claimed:
            return None
        details = self._session.sql(
            f"SELECT * FROM {self._table} WHERE JOB_ID = ? AND LEASE_OWNER = ? LIMIT 1",
            params=[job_id, worker_id],
        ).collect()
        if not details:
            return None
        increment("autosave.async_job.claimed")
        return details[0].as_dict() if hasattr(details[0], "as_dict") else dict(details[0])

    def mark_complete(self, job_id: str, *, worker_id: str) -> None:
        self._session.sql(
            f"""
            UPDATE {self._table}
            SET STATUS = 'completed', COMPLETED_AT = CURRENT_TIMESTAMP(),
                UPDATED_AT = CURRENT_TIMESTAMP(), LEASE_EXPIRES_AT = NULL,
                LEASE_OWNER = NULL
            WHERE JOB_ID = ? AND LEASE_OWNER = ? AND STATUS = 'running'
            """,
            params=[job_id, worker_id],
        ).collect()
        increment("autosave.async_job.completed")

    def incomplete_count(self, *, snapshot_id: str) -> int:
        rows = self._session.sql(
            f"""
            SELECT COUNT(*) AS INCOMPLETE_COUNT
            FROM {self._table}
            WHERE SNAPSHOT_ID = ? AND STATUS <> 'completed'
            """,
            params=[snapshot_id],
        ).collect()
        if not rows:
            return 0
        row = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
        return int(row.get("INCOMPLETE_COUNT") or 0)
