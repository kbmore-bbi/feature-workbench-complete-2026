from __future__ import annotations

import hashlib
import json
import logging
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from snowflake.snowpark import Session

from app.core.config import Settings

logger = logging.getLogger(__name__)

_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="agent-artifact-job")
_ACTIVE: set[str] = set()
_LOCK = threading.Lock()


class AgentArtifactJobService:
    """Durable status/result store for UI-triggered long-running agent artifacts."""

    def __init__(self, session: Session, settings: Settings) -> None:
        self._session = session
        self._table = settings.qualify_metadata_object_name("TBL_AGENT_ARTIFACT_JOBS")

    def start(
        self,
        *,
        job_type: str,
        request_id: str | None,
        requested_by: str | None,
        project_id: str | None,
        sttm_id: str | None,
        payload: dict[str, Any],
        runner: Callable[[], dict[str, Any]],
    ) -> dict[str, Any]:
        fingerprint = hashlib.sha256(
            json.dumps({"job_type": job_type, "payload": payload}, sort_keys=True, default=str).encode()
        ).hexdigest()
        job_id = f"artifact_{uuid.uuid4().hex}"
        self._session.sql(
            f"""
            INSERT INTO {self._table} (
                JOB_ID, JOB_TYPE, REQUEST_ID, REQUESTED_BY, PROJECT_ID, STTM_ID,
                CONTEXT_HASH, STATUS, STAGE, REQUEST_PAYLOAD, CREATED_AT, UPDATED_AT
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', PARSE_JSON(?),
                   CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
            """,
            params=[
                job_id,
                job_type,
                request_id or "",
                requested_by or "",
                project_id or "",
                sttm_id or "",
                fingerprint,
                json.dumps(payload, default=str),
            ],
        ).collect()

        def execute() -> None:
            with _LOCK:
                if job_id in _ACTIVE:
                    return
                _ACTIVE.add(job_id)
            try:
                self._update(job_id, status="running", stage="agent_running")
                result = runner()
                self._update(
                    job_id,
                    status="completed",
                    stage="completed",
                    result=result,
                )
            except Exception as exc:
                logger.exception("Long-running agent artifact job failed: job_id=%s", job_id)
                self._update(
                    job_id,
                    status="failed",
                    stage="failed",
                    error=str(exc)[:4000],
                )
            finally:
                with _LOCK:
                    _ACTIVE.discard(job_id)

        _EXECUTOR.submit(execute)
        return self.get(job_id, requested_by=requested_by) or {
            "job_id": job_id,
            "job_type": job_type,
            "status": "queued",
            "stage": "queued",
        }

    def get(self, job_id: str, *, requested_by: str | None = None) -> dict[str, Any] | None:
        owner_filter = ""
        params: list[Any] = [job_id]
        if requested_by:
            owner_filter = " AND REQUESTED_BY = ?"
            params.append(requested_by)
        rows = self._session.sql(
            f"""
            SELECT JOB_ID, JOB_TYPE, REQUEST_ID, PROJECT_ID, STTM_ID, STATUS, STAGE,
                   RESULT_PAYLOAD, ERROR_MESSAGE, CREATED_AT, STARTED_AT, COMPLETED_AT, UPDATED_AT
            FROM {self._table}
            WHERE JOB_ID = ?{owner_filter}
            LIMIT 1
            """,
            params=params,
        ).collect()
        if not rows:
            return None
        row = rows[0].as_dict(recursive=True)
        return {
            "job_id": str(row.get("JOB_ID") or ""),
            "job_type": str(row.get("JOB_TYPE") or ""),
            "request_id": str(row.get("REQUEST_ID") or "") or None,
            "project_id": str(row.get("PROJECT_ID") or "") or None,
            "sttm_id": str(row.get("STTM_ID") or "") or None,
            "status": str(row.get("STATUS") or "queued").lower(),
            "stage": str(row.get("STAGE") or "queued"),
            "result": self._json_value(row.get("RESULT_PAYLOAD")),
            "error": str(row.get("ERROR_MESSAGE") or "") or None,
            "created_at": row.get("CREATED_AT"),
            "started_at": row.get("STARTED_AT"),
            "completed_at": row.get("COMPLETED_AT"),
            "updated_at": row.get("UPDATED_AT"),
        }

    def _update(
        self,
        job_id: str,
        *,
        status: str,
        stage: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        self._session.sql(
            f"""
            UPDATE {self._table}
            SET STATUS = ?,
                STAGE = ?,
                RESULT_PAYLOAD = IFF(? IS NULL, RESULT_PAYLOAD, PARSE_JSON(?)),
                ERROR_MESSAGE = ?,
                STARTED_AT = IFF(? = 'running' AND STARTED_AT IS NULL, CURRENT_TIMESTAMP(), STARTED_AT),
                COMPLETED_AT = IFF(? IN ('completed', 'failed'), CURRENT_TIMESTAMP(), COMPLETED_AT),
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE JOB_ID = ?
            """,
            params=[
                status,
                stage,
                None if result is None else "present",
                json.dumps(result or {}, default=str),
                error,
                status,
                status,
                job_id,
            ],
        ).collect()

    @staticmethod
    def _json_value(value: Any) -> dict[str, Any] | None:
        if isinstance(value, dict):
            return value
        if isinstance(value, str) and value:
            try:
                parsed = json.loads(value)
                return parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                return None
        return None
