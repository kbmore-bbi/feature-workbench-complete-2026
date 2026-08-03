import json
import logging
import re
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError, as_completed
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import HTTPException, Request

from app.auth.models import AppPersona
from app.core.config import Settings
from app.core.exceptions import SnowflakeAgentError
from app.core.snowflake import SnowflakeClient
from app.schema.contracts import ApiWarning
from app.schema.sttm_builder import (
    AttributeMapping,
    Interface,
    SourceMappingResult,
    STTMBuilderEnvelopeRequest,
    STTMBuilderResponse,
    STTMStatus,
    SubAgent,
)

logger = logging.getLogger(__name__)

_AUTO_MAP_JOBS: dict[str, dict[str, Any]] = {}
_AUTO_MAP_JOBS_LOCK = threading.Lock()
_AUTO_MAP_ACTIVE_RUNNERS: set[str] = set()
_AUTO_MAP_JOB_TTL_SECONDS = 60 * 60
_AUTO_MAP_LEASE_SECONDS = 210

_FORWARDED_HEADER_NAMES = (
    "Sf-Context-Current-User",
    "Sf-Context-Current-User-Email",
    "Sf-Context-Current-User-Token",
    "X-Request-Id",
    "X-Trace-Id",
)
_OAUTH_FORWARDED_HEADER_NAMES = (
    "X-Workbench-OAuth-Access-Token",
    "X-Workbench-OAuth-User",
    "X-Workbench-OAuth-Email",
    "X-Workbench-OAuth-Role",
)


class AutoMappingProxyClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._base_url = settings.resolved_auto_mapping_service_url.rstrip("/")
        self._timeout = settings.auto_mapping_service_timeout_seconds
        self._retry_attempts = max(1, settings.auto_mapping_service_retry_attempts)
        self._batch_size = max(1, settings.auto_mapping_proxy_batch_size)
        self._max_in_flight = max(1, settings.auto_mapping_proxy_max_in_flight)

    @property
    def enabled(self) -> bool:
        return bool(self._base_url)

    @staticmethod
    def _build_mapping_review(
        mappings: dict[str, AttributeMapping],
    ) -> tuple[str, dict[str, Any]]:
        """Build a deterministic, actionable review of the validated agent output."""
        recommendations: list[dict[str, Any]] = []
        mapped_count = 0
        unresolved_count = 0
        low_confidence_count = 0
        override_count = 0
        missing_derived_count = 0

        for target, mapping in mappings.items():
            is_unresolved = (
                mapping.precedent_decision == "unresolved"
                or mapping.transformation_classification == "unresolved"
                or (
                    mapping.mapping_mode not in {"constant", "attribute"}
                    and not mapping.source_attributes
                    and not mapping.source_dependencies
                )
                or (mapping.mapping_mode == "constant" and mapping.constant_value is None)
                or (
                    mapping.mapping_mode == "attribute"
                    and (
                        not mapping.attribute_name
                        or mapping.constant_value is None
                        or not mapping.value_binding_ids
                    )
                )
            )
            if is_unresolved:
                unresolved_count += 1
            else:
                mapped_count += 1

            reason = str(mapping.unmatched_reason or "").strip()
            evidence_ids = list(
                dict.fromkeys(
                    [
                        *mapping.used_inference_ids,
                        *mapping.used_recommendation_ids,
                        *mapping.used_learning_ids,
                    ]
                )
            )
            candidate_sources = list(
                dict.fromkeys(
                    [
                        *mapping.candidate_source_attributes,
                        *mapping.source_attributes,
                        *mapping.source_dependencies,
                    ]
                )
            )[:6]

            if "derived source output contract" in reason.lower():
                missing_derived_count += 1
                recommendations.append(
                    {
                        "target_attribute": target,
                        "category": "missing_derived_output",
                        "severity": "action_required",
                        "title": "Update the selected derived source or choose an available output",
                        "detail": reason,
                        "recommended_action": (
                            "Open Source Selection, edit the relevant derived source, add the "
                            "business-approved output with lineage and semantics, validate/save it, "
                            "then rerun Auto-map. If the historical field is not valid for this "
                            "source, choose one of the available candidates instead."
                        ),
                        "candidate_sources": candidate_sources,
                        "evidence_ids": evidence_ids,
                    }
                )
                continue

            if is_unresolved:
                recommendations.append(
                    {
                        "target_attribute": target,
                        "category": "unresolved_mapping",
                        "severity": "action_required",
                        "title": "Resolve the source or Value binding",
                        "detail": reason or mapping.confidence_reason or (
                            "The current source graph does not contain enough validated evidence."
                        ),
                        "recommended_action": (
                            "Review the suggested candidates and linked evidence. Select or prepare "
                            "the required source, then rerun Auto-map for this target."
                        ),
                        "candidate_sources": candidate_sources,
                        "evidence_ids": evidence_ids,
                    }
                )
                continue

            if mapping.confidence_score < 0.8:
                low_confidence_count += 1
                recommendations.append(
                    {
                        "target_attribute": target,
                        "category": "low_confidence",
                        "severity": "review",
                        "title": f"Review low-confidence mapping ({mapping.confidence_score:.0%})",
                        "detail": mapping.confidence_reason or (
                            "The mapping passed structural validation but has weak semantic evidence."
                        ),
                        "recommended_action": (
                            "Compare the proposed source and preprocessing rule with the target's "
                            "business meaning and sample data before accepting it."
                        ),
                        "candidate_sources": candidate_sources,
                        "evidence_ids": evidence_ids,
                    }
                )

            if mapping.precedent_decision == "override_precedent":
                override_count += 1
                recommendations.append(
                    {
                        "target_attribute": target,
                        "category": "precedent_override",
                        "severity": "review",
                        "title": "Review the change from linked precedent",
                        "detail": mapping.confidence_reason or (
                            "The agent selected a current-source mapping that differs from history."
                        ),
                        "recommended_action": (
                            "Confirm that the cited evidence and current source structure justify "
                            "the override before publishing."
                        ),
                        "candidate_sources": candidate_sources,
                        "evidence_ids": list(
                            dict.fromkeys([*mapping.override_evidence, *evidence_ids])
                        ),
                    }
                )

        total_count = len(mappings)
        action_required_targets = {
            item["target_attribute"]
            for item in recommendations
            if item["severity"] == "action_required"
        }
        mapped_review_targets = {
            item["target_attribute"]
            for item in recommendations
            if item["severity"] == "review"
        } - action_required_targets
        review_count = len(action_required_targets | mapped_review_targets)
        completed_without_review_count = max(0, mapped_count - len(mapped_review_targets))
        headline = f"Auto-map completed: {mapped_count}/{total_count} targets mapped."
        if review_count:
            headline += (
                f" {completed_without_review_count} mapped target(s) need no further action; "
                f"{len(mapped_review_targets)} mapped target(s) need review; "
                f"{len(action_required_targets)} target(s) still require input."
            )
        else:
            headline += " No mapping issues were detected."
        if missing_derived_count:
            headline += (
                f" {missing_derived_count} learned mapping(s) require outputs that the current "
                "derived source does not expose."
            )

        return headline, {
            "headline": headline,
            "total_count": total_count,
            "mapped_count": mapped_count,
            "unresolved_count": unresolved_count,
            "low_confidence_count": low_confidence_count,
            "precedent_override_count": override_count,
            "missing_derived_output_count": missing_derived_count,
            "completed_without_review_count": completed_without_review_count,
            "mapped_with_review_count": len(mapped_review_targets),
            "action_required_count": len(action_required_targets),
            "recommendations": recommendations,
        }

    def should_delegate(self, req: STTMBuilderEnvelopeRequest) -> bool:
        return self.enabled and req.data.intent == Interface.AUTO_MAP

    def start_job(
        self,
        request: Request,
        req: STTMBuilderEnvelopeRequest,
        *,
        session: Any | None = None,
    ) -> dict[str, Any]:
        """Run long Cortex mapping work outside the public ingress request."""
        principal = getattr(request.state, "current_principal", None)
        owner = str(
            getattr(principal, "snowflake_user", None)
            or getattr(principal, "user_id", None)
            or ""
        )
        headers = self._forward_headers(request)
        job_id = str(uuid.uuid4())
        created_at = datetime.now(UTC)
        record: dict[str, Any] = {
            "job_id": job_id,
            "request_id": req.request_id,
            "owner": owner,
            "status": "queued",
            "created_at": created_at.isoformat(),
            "updated_at": created_at.isoformat(),
            "attribute_count": len(req.data.attributes or []),
            "batch_count": len(self._build_batches(req)),
            "completed_batch_count": 0,
            "completed_attribute_count": 0,
            "partial_responses": [],
            "response": None,
            "error": None,
            "stage": "queued",
            "prepared_context_hash": req.context.prepared_context_hash,
            "context_hash": req.context.prepared_context_hash,
            "semantic_bundle_id": req.context.semantic_bundle_id,
            "semantic_bundle_label": req.context.semantic_bundle_label,
            "agent_spec_hashes": dict(req.meta.get("agent_spec_hashes") or {}),
            "retrieved_evidence_ids": list(
                req.context.execution_context.evidence_ids
                if req.context.execution_context
                else []
            ),
            "retrieved_precedent_ids": list(
                req.context.learning_context.linked_mapping_ids
                if req.context.learning_context
                else []
            ),
            "pipeline_version": "v2" if self._settings.auto_map_pipeline_v2 else "legacy_adapter",
            "request_envelope": (
                req.model_dump(mode="json")
                if self._settings.auto_map_pipeline_v2
                else None
            ),
            "state_version": 0,
            "timings_ms": {},
        }
        self._prune_jobs()
        with _AUTO_MAP_JOBS_LOCK:
            _AUTO_MAP_JOBS[job_id] = record
        if self._settings.auto_map_pipeline_v2:
            self._persist_job(record, headers=headers, session=session, required=True)

        self._launch_job_runner(
            job_id,
            req=req,
            headers=headers,
            owner=owner,
            record=record,
        )
        return self._public_job(record)

    def _launch_job_runner(
        self,
        job_id: str,
        *,
        req: STTMBuilderEnvelopeRequest,
        headers: dict[str, str],
        owner: str,
        record: dict[str, Any],
    ) -> bool:
        """Start or resume one durable job once per local replica and lease."""
        with _AUTO_MAP_JOBS_LOCK:
            if job_id in _AUTO_MAP_ACTIVE_RUNNERS:
                return False
            _AUTO_MAP_ACTIVE_RUNNERS.add(job_id)

        def run() -> None:
            started = time.perf_counter()
            durable_client: SnowflakeClient | None = None
            durable_session: Any | None = None
            try:
                if self._settings.auto_map_pipeline_v2:
                    durable_client = self._open_job_client(headers)
                    durable_session = durable_client.session
                    if not self._claim_job_lease(
                        job_id,
                        owner=owner,
                        headers=headers,
                        session=durable_session,
                    ):
                        logger.info(
                            "Auto-map job %s is already leased by another replica",
                            job_id,
                        )
                        return
                self._update_job(
                    job_id,
                    headers=headers,
                    session=durable_session,
                    status="running",
                    stage="source_mapping",
                )
                try:
                    invoke_kwargs: dict[str, Any] = {
                        "progress_callback": lambda batch_index, batch_attributes, batch_response: self._record_partial_response(
                            job_id,
                            batch_index=batch_index,
                            batch_attributes=batch_attributes,
                            response=batch_response,
                            headers=headers,
                            session=durable_session,
                        )
                    }
                    persisted_partials = list(record.get("partial_responses") or [])
                    if persisted_partials:
                        invoke_kwargs["resume_partials"] = persisted_partials
                    response = self._invoke_with_headers(
                        req,
                        headers=headers,
                        **invoke_kwargs,
                    )
                except TypeError as exc:
                    # Some unit tests and legacy integrations monkeypatch this
                    # internal method without the progress_callback kwarg. Keep
                    # that compatibility while production calls still receive
                    # partial batch updates.
                    if not any(
                        keyword in str(exc)
                        for keyword in ("progress_callback", "resume_partials")
                    ):
                        raise
                    response = self._invoke_with_headers(req, headers=headers)
            except Exception as exc:
                logger.exception(
                    "Async Auto-map job failed: job_id=%s request_id=%s error_type=%s",
                    job_id,
                    req.request_id,
                    type(exc).__name__,
                )
                self._update_job(
                    job_id,
                    headers=headers,
                    session=durable_session,
                    status="failed",
                    error={
                        "code": "AUTO_MAPPING_JOB_FAILED",
                        "message": "The Auto-map Agent job could not be completed.",
                    },
                    stage="failed",
                    timings_ms={"total": round((time.perf_counter() - started) * 1000, 2)},
                )
                return
            else:
                self._ensure_missing_partial_responses(
                    job_id,
                    req=req,
                    response=response,
                    headers=headers,
                    session=durable_session,
                )
                self._update_job(
                    job_id,
                    headers=headers,
                    session=durable_session,
                    status="completed",
                    response=response.model_dump(mode="json"),
                    completed_batch_count=record.get("batch_count"),
                    completed_attribute_count=record.get("attribute_count"),
                    stage="completed",
                    timings_ms={"total": round((time.perf_counter() - started) * 1000, 2)},
                )
            finally:
                if durable_client is not None:
                    durable_client.close()
                with _AUTO_MAP_JOBS_LOCK:
                    _AUTO_MAP_ACTIVE_RUNNERS.discard(job_id)

        threading.Thread(
            target=run,
            name=f"auto-map-job-{job_id[:8]}",
            daemon=True,
        ).start()
        return True

    def _ensure_missing_partial_responses(
        self,
        job_id: str,
        *,
        req: STTMBuilderEnvelopeRequest,
        response: STTMBuilderResponse,
        headers: dict[str, str],
        session: Any | None,
    ) -> None:
        """Guarantee a terminal job exposes one idempotent partial per batch."""
        batches = self._build_batches(req)
        with _AUTO_MAP_JOBS_LOCK:
            record = _AUTO_MAP_JOBS.get(job_id) or {}
            present = {
                int(item.get("batch_index", -1))
                for item in record.get("partial_responses") or []
            }
        for batch_index, batch in enumerate(batches):
            if batch_index in present:
                continue
            batch_targets = {
                str(getattr(attribute, "target_attribute", "") or "")
                for attribute in batch
            }
            batch_response = self._response_for_targets(response, batch_targets)
            self._record_partial_response(
                job_id,
                batch_index=batch_index,
                batch_attributes=batch,
                response=batch_response,
                headers=headers,
                session=session,
            )

    @staticmethod
    def _response_for_targets(
        response: STTMBuilderResponse,
        target_attributes: set[str],
    ) -> STTMBuilderResponse:
        """Return a compact response containing only one batch's mappings."""
        result = response.data.result if response.data else None
        if not isinstance(result, SourceMappingResult):
            result = response.result
        if not isinstance(result, SourceMappingResult):
            return response
        normalized_targets = {
            str(target).rsplit(".", 1)[-1].upper()
            for target in target_attributes
            if target
        }
        selected = SourceMappingResult(
            mappings={
                target: mapping
                for target, mapping in result.mappings.items()
                if str(target).rsplit(".", 1)[-1].upper() in normalized_targets
            }
        )
        data = (
            response.data.model_copy(update={"result": selected})
            if response.data is not None
            else None
        )
        return response.model_copy(update={"data": data, "result": selected})

    def get_job(
        self,
        request: Request,
        job_id: str,
        *,
        session: Any | None = None,
    ) -> dict[str, Any]:
        principal = getattr(request.state, "current_principal", None)
        owner = str(
            getattr(principal, "snowflake_user", None)
            or getattr(principal, "user_id", None)
            or ""
        )
        headers = self._forward_headers(request)
        record = None
        if self._settings.auto_map_pipeline_v2:
            record = self._load_persisted_job(
                job_id,
                owner=owner,
                headers=headers,
                session=session,
            )
            if record is not None:
                with _AUTO_MAP_JOBS_LOCK:
                    _AUTO_MAP_JOBS[job_id] = record
                if record.get("status") in {"queued", "running"}:
                    raw_envelope = record.get("request_envelope")
                    if isinstance(raw_envelope, dict):
                        try:
                            resumable_req = STTMBuilderEnvelopeRequest.model_validate(
                                raw_envelope
                            )
                        except Exception:
                            logger.exception(
                                "Durable Auto-map job %s contains an invalid request envelope",
                                job_id,
                            )
                        else:
                            self._launch_job_runner(
                                job_id,
                                req=resumable_req,
                                headers=headers,
                                owner=owner,
                                record=record,
                            )
        with _AUTO_MAP_JOBS_LOCK:
            record = record or _AUTO_MAP_JOBS.get(job_id)
            if record is None:
                raise HTTPException(status_code=404, detail="Auto-map job was not found")
            if record.get("owner") != owner:
                raise HTTPException(status_code=403, detail="Auto-map job belongs to another user")
            return self._public_job(record)

    @staticmethod
    def _public_job(record: dict[str, Any]) -> dict[str, Any]:
        private_fields = {"owner", "request_envelope"}
        return {key: value for key, value in record.items() if key not in private_fields}

    def _claim_job_lease(
        self,
        job_id: str,
        *,
        owner: str,
        headers: dict[str, str],
        session: Any | None = None,
    ) -> bool:
        """Atomically claim an expired/available durable job lease."""
        own_client: SnowflakeClient | None = None
        try:
            active_session = session
            if active_session is None:
                own_client = self._open_job_client(headers)
                active_session = own_client.session
            table = self._settings.qualify_metadata_object_name("TBL_AUTO_MAP_JOBS")
            lease_owner = f"{self._settings.app_name}:{uuid.uuid4()}"
            active_session.sql(
                f"""
                UPDATE {table}
                SET LEASE_OWNER = ?,
                    LEASE_EXPIRES_AT = DATEADD('second', ?, CURRENT_TIMESTAMP()),
                    ATTEMPT_COUNT = COALESCE(ATTEMPT_COUNT, 0) + 1,
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE JOB_ID = ?
                  AND OWNER_ID = ?
                  AND STATUS IN ('queued', 'running')
                  AND (LEASE_EXPIRES_AT IS NULL OR LEASE_EXPIRES_AT < CURRENT_TIMESTAMP())
                """,
                params=[lease_owner, _AUTO_MAP_LEASE_SECONDS, job_id, owner],
            ).collect()
            rows = active_session.sql(
                f"""
                SELECT LEASE_OWNER
                FROM {table}
                WHERE JOB_ID = ? AND OWNER_ID = ?
                LIMIT 1
                """,
                params=[job_id, owner],
            ).collect()
            if not rows:
                return False
            row = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
            return str(row.get("LEASE_OWNER") or "") == lease_owner
        finally:
            if own_client is not None:
                own_client.close()

    def _update_job(
        self,
        job_id: str,
        *,
        headers: dict[str, str] | None = None,
        session: Any | None = None,
        **updates: Any,
    ) -> None:
        snapshot: dict[str, Any] | None = None
        with _AUTO_MAP_JOBS_LOCK:
            record = _AUTO_MAP_JOBS.get(job_id)
            if record is None:
                return
            record.update(updates)
            record["updated_at"] = datetime.now(UTC).isoformat()
            record["state_version"] = int(record.get("state_version") or 0) + 1
            snapshot = dict(record)
        if self._settings.auto_map_pipeline_v2 and snapshot is not None:
            self._persist_job(
                snapshot,
                headers=headers or {},
                session=session,
                required=False,
            )

    def _record_partial_response(
        self,
        job_id: str,
        *,
        batch_index: int,
        batch_attributes: list[Any],
        response: STTMBuilderResponse,
        headers: dict[str, str] | None = None,
        session: Any | None = None,
    ) -> None:
        snapshot: dict[str, Any] | None = None
        with _AUTO_MAP_JOBS_LOCK:
            record = _AUTO_MAP_JOBS.get(job_id)
            if record is None:
                return
            partials = list(record.get("partial_responses") or [])
            partials = [
                item
                for item in partials
                if int(item.get("batch_index", -1)) != batch_index
            ]
            partials.append(
                {
                    "batch_index": batch_index,
                    "attribute_count": len(batch_attributes),
                    "target_attributes": [
                        getattr(attribute, "target_attribute", None)
                        for attribute in batch_attributes
                    ],
                    "response": response.model_dump(mode="json"),
                    "completed_at": datetime.now(UTC).isoformat(),
                }
            )
            partials.sort(key=lambda item: int(item.get("batch_index", 0)))
            record["partial_responses"] = partials
            record["completed_batch_count"] = len(partials)
            record["completed_attribute_count"] = sum(
                int(item.get("attribute_count") or 0) for item in partials
            )
            record["updated_at"] = datetime.now(UTC).isoformat()
            record["state_version"] = int(record.get("state_version") or 0) + 1
            record["stage"] = "transformation" if any(
                str(value.transformation_classification or "") == "complex"
                for value in (
                    response.data.result.mappings.values()
                    if response.data and isinstance(response.data.result, SourceMappingResult)
                    else []
                )
            ) else "source_mapping"
            snapshot = dict(record)
        if self._settings.auto_map_pipeline_v2 and snapshot is not None:
            self._persist_job(
                snapshot,
                headers=headers or {},
                session=session,
                required=False,
            )

    def _open_job_client(self, headers: dict[str, str]) -> SnowflakeClient:
        token = (
            headers.get("X-Workbench-OAuth-Access-Token")
            or headers.get("Sf-Context-Current-User-Token")
            or ""
        )
        role = headers.get("X-Workbench-OAuth-Role") or None
        return SnowflakeClient(self._settings, user_token=token, role=role)

    @staticmethod
    def _sql_literal(value: Any) -> str:
        return "'" + str(value if value is not None else "").replace("'", "''") + "'"

    def _persist_job(
        self,
        record: dict[str, Any],
        *,
        headers: dict[str, str],
        session: Any | None = None,
        required: bool,
    ) -> None:
        own_client: SnowflakeClient | None = None
        try:
            active_session = session
            if active_session is None:
                own_client = self._open_job_client(headers)
                active_session = own_client.session
            table = self._settings.qualify_metadata_object_name("TBL_AUTO_MAP_JOBS")
            payload = json.dumps(record, separators=(",", ":"), default=str)
            sql = f"""
                MERGE INTO {table} target
                USING (
                    SELECT ? AS JOB_ID,
                           ? AS REQUEST_ID,
                           ? AS OWNER_ID,
                           ? AS STATUS,
                           ? AS STAGE,
                           ? AS CONTEXT_HASH,
                           ? AS SEMANTIC_BUNDLE_ID,
                           PARSE_JSON(?) AS AGENT_SPEC_HASHES,
                           PARSE_JSON(?) AS JOB_STATE
                ) source
                ON target.JOB_ID = source.JOB_ID
                WHEN MATCHED
                  AND COALESCE(target.JOB_STATE:state_version::NUMBER, 0)
                      <= COALESCE(source.JOB_STATE:state_version::NUMBER, 0)
                THEN UPDATE SET
                    REQUEST_ID = source.REQUEST_ID,
                    OWNER_ID = source.OWNER_ID,
                    STATUS = source.STATUS,
                    STAGE = source.STAGE,
                    CONTEXT_HASH = source.CONTEXT_HASH,
                    SEMANTIC_BUNDLE_ID = source.SEMANTIC_BUNDLE_ID,
                    AGENT_SPEC_HASHES = source.AGENT_SPEC_HASHES,
                    JOB_STATE = source.JOB_STATE,
                    UPDATED_AT = CURRENT_TIMESTAMP(),
                    EXPIRES_AT = DATEADD('day', 7, CURRENT_TIMESTAMP())
                WHEN NOT MATCHED THEN INSERT (
                    JOB_ID, REQUEST_ID, OWNER_ID, STATUS, STAGE, CONTEXT_HASH,
                    SEMANTIC_BUNDLE_ID, AGENT_SPEC_HASHES, JOB_STATE
                ) VALUES (
                    source.JOB_ID, source.REQUEST_ID, source.OWNER_ID, source.STATUS,
                    source.STAGE, source.CONTEXT_HASH, source.SEMANTIC_BUNDLE_ID,
                    source.AGENT_SPEC_HASHES, source.JOB_STATE
                )
            """
            active_session.sql(
                sql,
                params=[
                    str(record.get("job_id") or ""),
                    str(record.get("request_id") or ""),
                    str(record.get("owner") or ""),
                    str(record.get("status") or ""),
                    str(record.get("stage") or ""),
                    str(record.get("context_hash") or ""),
                    str(record.get("semantic_bundle_id") or ""),
                    json.dumps(record.get("agent_spec_hashes") or {}, separators=(",", ":")),
                    payload,
                ],
            ).collect()
        except Exception as exc:
            logger.exception("Could not persist Auto-map job %s", record.get("job_id"))
            if required:
                with _AUTO_MAP_JOBS_LOCK:
                    _AUTO_MAP_JOBS.pop(str(record.get("job_id")), None)
                raise HTTPException(
                    status_code=503,
                    detail="Durable Auto-map job storage is unavailable; the job was not started.",
                ) from exc
        finally:
            if own_client is not None:
                own_client.close()

    def _load_persisted_job(
        self,
        job_id: str,
        *,
        owner: str,
        headers: dict[str, str],
        session: Any | None = None,
    ) -> dict[str, Any] | None:
        own_client: SnowflakeClient | None = None
        try:
            active_session = session
            if active_session is None:
                own_client = self._open_job_client(headers)
                active_session = own_client.session
            table = self._settings.qualify_metadata_object_name("TBL_AUTO_MAP_JOBS")
            rows = active_session.sql(
                f"""
                SELECT JOB_STATE
                FROM {table}
                WHERE JOB_ID = ?
                  AND OWNER_ID = ?
                  AND EXPIRES_AT > CURRENT_TIMESTAMP()
                LIMIT 1
                """,
                params=[job_id, owner],
            ).collect()
            if not rows:
                return None
            row = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
            state = row.get("JOB_STATE")
            if isinstance(state, str):
                state = json.loads(state)
            return dict(state) if isinstance(state, dict) else None
        except Exception as exc:
            logger.exception("Could not load durable Auto-map job %s", job_id)
            raise HTTPException(
                status_code=503,
                detail="Durable Auto-map job storage is temporarily unavailable.",
            ) from exc
        finally:
            if own_client is not None:
                own_client.close()

    @staticmethod
    def _prune_jobs() -> None:
        cutoff = time.time() - _AUTO_MAP_JOB_TTL_SECONDS
        with _AUTO_MAP_JOBS_LOCK:
            expired = []
            for job_id, record in _AUTO_MAP_JOBS.items():
                created_at = str(record.get("created_at") or "")
                try:
                    timestamp = datetime.fromisoformat(created_at).timestamp()
                except ValueError:
                    timestamp = 0
                if timestamp < cutoff:
                    expired.append(job_id)
            for job_id in expired:
                _AUTO_MAP_JOBS.pop(job_id, None)

    def invoke(
        self,
        request: Request,
        req: STTMBuilderEnvelopeRequest,
    ) -> STTMBuilderResponse:
        if not self.should_delegate(req):
            raise SnowflakeAgentError("Auto-mapping worker service is not configured.")

        headers = self._forward_headers(request)
        return self._invoke_with_headers(req, headers=headers)

    def _invoke_with_headers(
        self,
        req: STTMBuilderEnvelopeRequest,
        *,
        headers: dict[str, str],
        progress_callback: Callable[[int, list[Any], STTMBuilderResponse], None] | None = None,
        resume_partials: list[dict[str, Any]] | None = None,
    ) -> STTMBuilderResponse:
        attributes = list(req.data.attributes or [])
        resumed_responses: dict[int, STTMBuilderResponse] = {}
        for partial in resume_partials or []:
            try:
                batch_index = int(partial.get("batch_index", -1))
                partial_response = STTMBuilderResponse.model_validate(
                    partial.get("response")
                )
            except Exception:
                logger.warning(
                    "Ignoring invalid persisted Auto-map partial for request_id=%s",
                    req.request_id,
                )
                continue
            if batch_index >= 0:
                resumed_responses[batch_index] = partial_response
        precedent_response = self._exact_precedent_response(req)
        if precedent_response is not None:
            if 0 in resumed_responses:
                return resumed_responses[0]
            if progress_callback is not None:
                progress_callback(0, attributes, precedent_response)
            return precedent_response
        batches = self._build_batches(req)
        if len(batches) == 1:
            if 0 in resumed_responses:
                return resumed_responses[0]
            response = self._invoke_batch(req, headers=headers, batch_index=0)
            if progress_callback is not None:
                progress_callback(0, attributes, response)
            return response

        logger.info(
            "Dispatching auto-map request_id=%s attributes=%s batches=%s max_in_flight=%s",
            req.request_id,
            len(attributes),
            len(batches),
            self._max_in_flight,
        )
        responses: dict[int, STTMBuilderResponse] = {
            index: response
            for index, response in resumed_responses.items()
            if 0 <= index < len(batches)
        }
        failures: dict[int, Exception] = {}
        pending_indices = [
            index for index in range(len(batches)) if index not in responses
        ]
        with ThreadPoolExecutor(
            max_workers=min(self._max_in_flight, max(1, len(pending_indices)))
        ) as executor:
            futures = {
                executor.submit(
                    self._invoke_batch,
                    req.model_copy(
                        update={
                            "data": req.data.model_copy(update={"attributes": batch}),
                            "meta": {**req.meta, "auto_mapping_batch_index": index},
                        }
                    ),
                    headers=headers,
                    batch_index=index,
                ): index
                for index, batch in enumerate(batches)
                if index in pending_indices
            }
            for future in as_completed(futures):
                index = futures[future]
                try:
                    responses[index] = future.result()
                    if progress_callback is not None:
                        progress_callback(index, batches[index], responses[index])
                except Exception as exc:
                    failures[index] = exc

        if not responses:
            first_failure = failures[min(failures)]
            raise SnowflakeAgentError(
                f"All Auto-map worker batches failed: {first_failure}"
            ) from first_failure

        first = responses[min(responses)]
        merged_mappings: dict[str, AttributeMapping] = {}
        merged_warnings = list(first.warnings)
        for index, batch in enumerate(batches):
            response = responses.get(index)
            response_result = response.data.result if response and response.data else None
            if not isinstance(response_result, SourceMappingResult):
                response_result = response.result if response else None
            if isinstance(response_result, SourceMappingResult):
                merged_mappings.update(response_result.mappings)
                if response is not first:
                    merged_warnings.extend(response.warnings)
                continue
            failure = failures.get(index)
            for attribute in batch:
                key = attribute.target_attribute
                merged_mappings[key] = AttributeMapping(
                    source_attributes=[],
                    confidence_score=0.0,
                    unmatched_reason=(
                        "The dedicated Auto-map worker could not process this target attribute."
                    ),
                )
                merged_warnings.append(
                    ApiWarning(
                        code="AUTO_MAPPING_BATCH_FAILED",
                        message=f"Auto-map batch {index + 1} failed: {failure}",
                        field=key,
                    )
                )

        merged_result = SourceMappingResult(mappings=merged_mappings)
        review_message, mapping_review = self._build_mapping_review(merged_mappings)
        merged_data = first.data.model_copy(
            update={
                "result": merged_result,
                "message": review_message,
            }
        ) if first.data else None
        return first.model_copy(
            update={
                "data": merged_data,
                "result": merged_result,
                "message": review_message,
                "warnings": merged_warnings,
                "meta": {
                    **first.meta,
                    "auto_mapping_dispatch": {
                        "attribute_count": len(attributes),
                        "batch_count": len(batches),
                        "batch_size": self._batch_size,
                        "batch_sizes": [len(batch) for batch in batches],
                        "batching_mode": "adaptive_complexity_token_budget",
                        "max_in_flight": self._max_in_flight,
                        "resumed_batch_indices": sorted(responses.keys() & resumed_responses.keys()),
                        "failed_batches": sorted(failures),
                    },
                    "auto_mapping_review": mapping_review,
                },
            }
        )

    def _build_batches(self, req: STTMBuilderEnvelopeRequest) -> list[list[Any]]:
        attributes = list(req.data.attributes or [])
        if not attributes:
            return [[]]
        if self._exact_precedent(req) is not None:
            return [attributes]
        precedent_by_target: dict[str, dict[str, Any]] = {}
        learning = req.context.learning_context
        if learning is not None:
            for precedent in learning.mapping_precedents:
                for mapping in precedent.mappings:
                    target = str(mapping.get("target_column") or "").upper()
                    if target and target not in precedent_by_target:
                        precedent_by_target[target] = mapping

        complex_tokens = (
            "CASE ", "COALESCE(", "CONCAT", "CAST(", "TO_CHAR(",
            "DATE", "SUBSTRING", "REPLACE(", "NULLIF(",
        )

        def rank(attribute: Any) -> tuple[int, int, str]:
            target = str(getattr(attribute, "target_attribute", "") or "")
            precedent = precedent_by_target.get(target.upper())
            if precedent:
                if str(precedent.get("mapping_mode") or "source") == "constant":
                    complexity = 0
                else:
                    rule = str(precedent.get("preprocessing_rule") or "").upper()
                    rule_type = str(precedent.get("preprocessing_rule_type") or "DIRECT").upper()
                    complexity = 3 if rule_type == "CUSTOM" or any(token in rule for token in complex_tokens) else 1
            else:
                description = str(getattr(attribute, "target_description", "") or "").upper()
                complexity = 3 if any(token in description for token in complex_tokens) else 2
            payload_size = len(json.dumps(attribute.model_dump(mode="json"), default=str))
            return (complexity, payload_size, target)

        ordered = sorted(attributes, key=rank)
        batches: list[list[Any]] = []
        current: list[Any] = []
        current_chars = 0
        current_complexity = 0
        for attribute in ordered:
            complexity, payload_chars, _target = rank(attribute)
            max_items = min(self._batch_size, 6 if complexity >= 3 else 16)
            token_budget_chars = 24000 if complexity >= 3 else 48000
            must_flush = bool(current) and (
                len(current) >= max_items
                or current_chars + payload_chars > token_budget_chars
                or (current_complexity < 3 <= complexity)
            )
            if must_flush:
                batches.append(current)
                current = []
                current_chars = 0
            current.append(attribute)
            current_chars += payload_chars
            current_complexity = complexity
        if current:
            batches.append(current)
        return batches

    @staticmethod
    def _exact_precedent(req: STTMBuilderEnvelopeRequest) -> Any | None:
        """Return a precedent only for an explicit diagnostic replay request.

        Exact target coverage does not establish that the current source graph is
        identical to the historical graph. Production Auto-map therefore sends the
        precedent to AGT_SOURCE_MAPPING as evidence. Deterministic replay remains
        available for controlled cache/compiler diagnostics only.
        """
        if (
            not req.context.replay_exact_precedent
            or req.context.omit_linked_precedent
            or str(req.data.message or "").strip()
        ):
            return None
        learning = req.context.learning_context
        if learning is None:
            return None
        requested = {
            str(attribute.target_attribute).upper()
            for attribute in (req.data.attributes or [])
        }
        corrected_targets = {
            str(item.target_column).upper() for item in learning.correction_history
        }
        if requested & corrected_targets:
            return None
        for recommendation in learning.fir_recommendations:
            payload = recommendation.get("payload") if isinstance(recommendation, dict) else None
            if isinstance(payload, dict) and (
                payload.get("override_precedent") is True
                or str(payload.get("precedent_decision") or "").lower() == "override_precedent"
            ):
                return None
        for precedent in learning.mapping_precedents:
            if str(precedent.compatibility or "").strip().lower() != "exact":
                continue
            if precedent.confidence < 0.95:
                continue
            by_target = {
                str(item.get("target_column") or "").upper(): item
                for item in precedent.mappings
                if item.get("target_column")
            }
            if requested and requested.issubset(by_target):
                return precedent
        return None

    @classmethod
    def _exact_precedent_response(
        cls,
        req: STTMBuilderEnvelopeRequest,
    ) -> STTMBuilderResponse | None:
        precedent = cls._exact_precedent(req)
        if precedent is None:
            return None
        by_target = {
            str(item.get("target_column") or "").upper(): item
            for item in precedent.mappings
            if item.get("target_column")
        }
        mappings: dict[str, AttributeMapping] = {}
        for index, attribute in enumerate(req.data.attributes or [], start=1):
            source = by_target[attribute.target_attribute.upper()]
            mode = str(source.get("mapping_mode") or "source").lower()
            constant_value = source.get("constant_value")
            source_columns = [str(value) for value in source.get("source_columns") or [] if value]
            rule_type = str(
                source.get("preprocessing_rule_type")
                or ("Value" if mode == "constant" else "Direct")
            )
            rule = source.get("preprocessing_rule")
            mappings[attribute.target_attribute] = AttributeMapping(
                source_attributes=source_columns,
                mapping_mode=(
                    "attribute"
                    if mode in {"attribute", "project_attribute", "project_value"}
                    else "constant"
                    if mode in {"constant", "value"}
                    else "source"
                ),
                constant_value=str(constant_value) if constant_value is not None else None,
                attribute_name=(
                    str(source.get("attribute_name"))
                    if source.get("attribute_name") is not None
                    else None
                ),
                source_dependencies=source_columns,
                value_binding_ids=[
                    binding.binding_id
                    for binding in (
                        req.context.relation_graph.value_bindings
                        if req.context.relation_graph is not None
                        else []
                    )
                    if mode in {"attribute", "project_attribute", "project_value"}
                    and str(binding.attribute_name or "").upper()
                    == str(source.get("attribute_name") or "").upper()
                ],
                transformation_classification=(
                    "value"
                    if mode in {"constant", "value", "attribute", "project_attribute", "project_value"}
                    else "reused"
                    if rule_type.upper() == "CUSTOM"
                    else "direct"
                ),
                precedent_decision="accept_precedent",
                precedent_mapping_id=precedent.precedent_sttm_id,
                override_evidence=[],
                confidence_score=min(1.0, max(0.0, float(precedent.confidence))),
                confidence_reason=(
                    f"Accepted exact compatible completed mapping {precedent.precedent_sttm_id}; "
                    "no user correction or explicit FIR override evidence was present."
                ),
                preprocessing_rule=str(rule) if rule is not None else None,
                preprocessing_rule_type=rule_type,
                preprocessing_nl_rule=(
                    f"Reuse the validated {rule_type} rule from completed mapping "
                    f"{precedent.precedent_sttm_id}."
                ),
                processing_order=index,
                description=source.get("description"),
                used_learning_ids=[
                    value for value in [str(source.get("mapping_id") or "")] if value
                ],
            )
        response = STTMBuilderResponse.from_invocation(
            req,
            thread_id=f"precedent-cache:{precedent.precedent_sttm_id}",
            parent_message_id=None,
            agent=SubAgent.SOURCE_MAPPING_AGENT,
            result=SourceMappingResult(mappings=mappings),
            message=(
                f"Accepted {len(mappings)} mappings from exact completed precedent "
                f"{precedent.precedent_sttm_id}."
            ),
            status=STTMStatus.COMPLETED,
        )
        return response.model_copy(
            update={
                "warnings": list(req.warnings),
                "meta": {
                    **response.meta,
                    "auto_mapping_dispatch": {
                        "attribute_count": len(mappings),
                        "batch_count": 1,
                        "batch_sizes": [len(mappings)],
                        "batching_mode": "exact_precedent_cache",
                        "max_in_flight": 0,
                        "failed_batches": [],
                    },
                    "accepted_precedent": {
                        "sttm_id": precedent.precedent_sttm_id,
                        "project_id": precedent.precedent_project_id,
                        "raw_sql_hash": precedent.raw_sql_hash,
                        "mapping_count": len(precedent.mappings),
                        "cte_count": len(precedent.ctes),
                        "business_rule_count": len(precedent.business_rules),
                    },
                },
            }
        )

    def _invoke_batch(
        self,
        req: STTMBuilderEnvelopeRequest,
        *,
        headers: dict[str, str],
        batch_index: int,
    ) -> STTMBuilderResponse:
        payload = req.model_dump(mode="json")
        last_error: Exception | None = None
        if self._base_url == "inprocess":
            # Local/integration compatibility adapter: exercise the private worker
            # ASGI application without opening a second listening socket. SPCS keeps
            # using its internal service URL and therefore never enters this branch.
            from fastapi.testclient import TestClient

            from app.auto_mapping_worker.main import app as worker_app

            logger.info(
                "Dispatching auto-map request_id=%s batch=%s to in-process worker",
                req.request_id,
                batch_index + 1,
            )
            for attempt in range(1, self._retry_attempts + 1):
                with TestClient(worker_app) as client:
                    response = client.post(
                        "/api/v1/auto-mapping/invoke",
                        headers=headers,
                        json=payload,
                    )
                if response.status_code == 200:
                    try:
                        parsed = STTMBuilderResponse.model_validate(response.json())
                    except Exception as exc:
                        raise SnowflakeAgentError(
                            "In-process Auto-mapping worker returned an invalid "
                            f"response payload: {exc}"
                        ) from exc
                    self._validate_worker_response(parsed, req=req, batch_index=batch_index)
                    return parsed

                error_detail = self._worker_error_detail(response)
                message = (
                    f"In-process Auto-mapping worker returned HTTP {response.status_code}"
                    + (f": {error_detail}" if error_detail else "")
                )
                if response.status_code < 500 and response.status_code != 429:
                    raise SnowflakeAgentError(message)
                last_error = SnowflakeAgentError(message)
                if attempt >= self._retry_attempts:
                    break
                logger.warning(
                    "In-process Auto-mapping worker returned a transient error "
                    "(attempt %s/%s). Retrying: %s",
                    attempt,
                    self._retry_attempts,
                    response.status_code,
                )
                time.sleep(1.0)

            raise SnowflakeAgentError(
                f"In-process Auto-mapping worker request failed: {last_error}"
            ) from last_error

        endpoint = f"{self._base_url}/api/v1/auto-mapping/invoke"
        logger.info(
            "Dispatching auto-map request_id=%s batch=%s to worker endpoint=%s",
            req.request_id,
            batch_index + 1,
            endpoint,
        )

        for attempt in range(1, self._retry_attempts + 1):
            try:
                with httpx.Client(timeout=self._timeout) as client:
                    response = client.post(
                        endpoint,
                        headers=headers,
                        json=payload,
                    )
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt >= self._retry_attempts:
                    break
                logger.warning(
                    "Auto-mapping worker call failed (attempt %s/%s). Retrying: %s",
                    attempt,
                    self._retry_attempts,
                    exc,
                )
                time.sleep(1.0)
                continue

            if response.status_code == 200:
                logger.info(
                    "Auto-mapping worker request_id=%s completed with HTTP 200",
                    req.request_id,
                )
                try:
                    parsed = STTMBuilderResponse.model_validate(response.json())
                except Exception as exc:
                    raise SnowflakeAgentError(
                        f"Auto-mapping worker returned an invalid response payload: {exc}"
                    ) from exc
                self._validate_worker_response(parsed, req=req, batch_index=batch_index)
                return parsed

            if response.status_code < 500 and response.status_code != 429:
                logger.warning(
                    "Auto-mapping worker request_id=%s failed with HTTP %s",
                    req.request_id,
                    response.status_code,
                )
                raise SnowflakeAgentError(
                    f"Auto-mapping worker returned HTTP {response.status_code}"
                )

            error_detail = self._worker_error_detail(response)
            last_error = SnowflakeAgentError(
                f"Auto-mapping worker returned HTTP {response.status_code}"
                + (f": {error_detail}" if error_detail else "")
            )
            if attempt >= self._retry_attempts:
                break
            logger.warning(
                "Auto-mapping worker returned a transient error (attempt %s/%s). Retrying: %s",
                attempt,
                self._retry_attempts,
                response.status_code,
            )
            time.sleep(1.0)

        raise SnowflakeAgentError(
            f"Auto-mapping worker request failed: {last_error}"
        ) from last_error

    @staticmethod
    def _worker_error_detail(response: Any) -> str | None:
        try:
            payload = response.json()
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        error = payload.get("error")
        if isinstance(error, dict):
            code = str(error.get("code") or "").strip()
            detail = str(error.get("detail") or error.get("title") or "").strip()
            combined = " - ".join(value for value in (code, detail) if value)
            return combined[:500] or None
        detail = payload.get("detail")
        return str(detail)[:500] if detail else None

    @staticmethod
    def _validate_worker_response(
        response: STTMBuilderResponse,
        *,
        req: STTMBuilderEnvelopeRequest,
        batch_index: int,
    ) -> None:
        """Reject HTTP-200 envelopes that contain an Agent or contract failure."""
        if response.error is not None:
            code = response.error.code or "AUTO_MAPPING_AGENT_ERROR"
            raise SnowflakeAgentError(
                f"Auto-map batch {batch_index + 1} failed with {code}: "
                f"{response.error.title}"
            )
        response_data = response.data
        if response_data is None or response_data.status.value == "failed":
            raise SnowflakeAgentError(
                f"Auto-map batch {batch_index + 1} returned a failed response envelope."
            )
        result = response_data.result
        if not isinstance(result, SourceMappingResult):
            result = response.result
        if not isinstance(result, SourceMappingResult) or not result.mappings:
            raise SnowflakeAgentError(
                f"Auto-map batch {batch_index + 1} returned no source-mapping result."
            )

        learning = req.context.learning_context
        precedents_by_id = {
            str(precedent.precedent_sttm_id): precedent
            for precedent in (learning.mapping_precedents if learning else [])
            if precedent.precedent_sttm_id
        }
        allowed_precedent_ids = {
            precedent_id for precedent_id in precedents_by_id
        }
        if req.context.omit_linked_precedent:
            allowed_precedent_ids.clear()

        normalized_targets: list[str] = []

        def normalized_mode(value: Any) -> str:
            return "constant" if str(value or "source").lower() in {
                "constant", "value", "literal", "placeholder"
            } else "source"

        def normalized_rule(value: Any) -> str:
            return " ".join(str(value or "").strip().upper().split())

        def accepted_contract_matches(
            target: str,
            mapping: AttributeMapping,
            precedent_id: str,
        ) -> bool:
            precedent = precedents_by_id.get(precedent_id)
            if precedent is None or not precedent.mappings:
                return True
            target_leaf = str(target).rsplit(".", 1)[-1].upper()
            historical = next(
                (
                    item
                    for item in precedent.mappings
                    if str(item.get("target_column") or "").rsplit(".", 1)[-1].upper()
                    == target_leaf
                ),
                None,
            )
            if historical is None:
                return False
            if normalized_mode(historical.get("mapping_mode")) != normalized_mode(
                mapping.mapping_mode
            ):
                return False
            if normalized_mode(mapping.mapping_mode) == "constant":
                if str(historical.get("constant_value") or "").strip() != str(
                    mapping.constant_value or ""
                ).strip():
                    return False
            historical_type = normalized_rule(
                historical.get("preprocessing_rule_type")
            )
            current_type = normalized_rule(mapping.preprocessing_rule_type)
            if historical_type and current_type and historical_type != current_type:
                return False
            historical_rule = normalized_rule(historical.get("preprocessing_rule"))
            current_rule = normalized_rule(mapping.preprocessing_rule)
            if historical_rule and current_rule and historical_rule != current_rule:
                return False
            return True

        for target, mapping in result.mappings.items():
            decision = mapping.precedent_decision
            precedent_id = str(mapping.precedent_mapping_id or "")
            valid_link = bool(precedent_id and precedent_id in allowed_precedent_ids)
            invalid_accept = decision == "accept_precedent" and (
                not valid_link
                or not accepted_contract_matches(target, mapping, precedent_id)
            )
            invalid_override = decision == "override_precedent" and (
                not valid_link or not mapping.override_evidence
            )
            missing_decision = decision is None
            if not (invalid_accept or invalid_override or missing_decision):
                continue
            mapping.precedent_decision = "unresolved"
            mapping.precedent_mapping_id = None
            mapping.confidence_reason = " ".join(
                value
                for value in (
                    mapping.confidence_reason,
                    "The linked precedent does not support this exact accepted contract; "
                    "the inferred mapping is retained for review.",
                )
                if value
            )
            normalized_targets.append(target)

        if normalized_targets:
            response.warnings.append(
                ApiWarning(
                    code="AUTO_MAPPING_PRECEDENT_DECISION_NORMALIZED",
                    message=(
                        "Unsupported precedent decisions were changed to unresolved for: "
                        + ", ".join(normalized_targets)
                    ),
                    field="precedent_decision",
                )
            )

        graph = req.context.relation_graph
        invalid_graph_targets: list[str] = []
        if graph is not None:
            relation_contracts: list[tuple[str, set[str], bool]] = []
            for node in graph.nodes:
                columns = {
                    str(item.get("name") or item.get("column_name") or "").strip().upper()
                    for item in node.output_columns
                    if isinstance(item, dict)
                    and str(item.get("name") or item.get("column_name") or "").strip()
                }
                identifiers = {
                    str(node.relation_id or "").strip(),
                    str(node.alias or "").strip(),
                    str(node.physical_view_name or "").strip(),
                }
                if node.table is not None:
                    identifiers.add(node.table.qualified_name)
                for identifier in identifiers:
                    if identifier:
                        relation_contracts.append(
                            (
                                identifier.upper(),
                                columns,
                                node.kind.value in {"DERIVED_SOURCE", "CTE"},
                            )
                        )
            relation_contracts.sort(key=lambda item: len(item[0]), reverse=True)

            def invalid_derived_reference(value: str) -> str | None:
                upper = str(value or "").upper()
                for identifier, columns, is_derived in relation_contracts:
                    for match in re.finditer(
                        rf"(?<![A-Z0-9_$]){re.escape(identifier)}\.([A-Z_][A-Z0-9_$]*)",
                        upper,
                    ):
                        column = match.group(1)
                        if is_derived and (not columns or column not in columns):
                            return f"{identifier}.{column}"
                return None

            for target, mapping in result.mappings.items():
                if mapping.mapping_mode == "constant":
                    continue
                values = [
                    *mapping.source_attributes,
                    *mapping.source_dependencies,
                    str(mapping.preprocessing_rule or ""),
                ]
                invalid_reference = next(
                    (
                        invalid
                        for value in values
                        if (invalid := invalid_derived_reference(str(value))) is not None
                    ),
                    None,
                )
                if invalid_reference is None:
                    continue
                original_sources = [
                    *mapping.source_attributes,
                    *mapping.source_dependencies,
                ]
                mapping.candidate_source_attributes = list(
                    dict.fromkeys([*mapping.candidate_source_attributes, *original_sources])
                )[:6]
                mapping.source_attributes = []
                mapping.source_dependencies = []
                mapping.preprocessing_rule = None
                mapping.preprocessing_rule_type = None
                mapping.precedent_decision = "unresolved"
                mapping.precedent_mapping_id = None
                mapping.confidence_score = 0.0
                mapping.unmatched_reason = (
                    f"The proposed source {invalid_reference} is not present in the selected "
                    "derived source output contract. Update and revalidate the derived source "
                    "through the derived-source workflow, or select an existing output column."
                )
                invalid_graph_targets.append(target)

        if invalid_graph_targets:
            response.warnings.append(
                ApiWarning(
                    code="AUTO_MAPPING_DERIVED_OUTPUT_NOT_FOUND",
                    message=(
                        "Mappings that referenced absent derived outputs were left unresolved: "
                        + ", ".join(invalid_graph_targets)
                    ),
                    field="source_attributes",
                )
            )

    def invoke_stream(
        self,
        request: Request,
        req: STTMBuilderEnvelopeRequest,
        *,
        prepare_request: Callable[[STTMBuilderEnvelopeRequest], STTMBuilderEnvelopeRequest] | None = None,
    ) -> Iterator[str]:
        def emit(event: str, data: dict[str, object]) -> str:
            return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"

        try:
            if prepare_request is not None:
                yield emit(
                    "status",
                    {
                        "phase": "automap_bundle_resolution",
                        "message": "Resolving the saved source and target semantic assets.",
                    },
                )
                req = prepare_request(req)
                semantic = req.context.workspace_context.semantic if req.context.workspace_context else None
                yield emit(
                    "status",
                    {
                        "phase": "automap_bundle_validated",
                        "message": "The composed semantic bundle is valid and ready for worker dispatch.",
                        "bundle_id": req.context.semantic_bundle_id,
                        "bundle_hash": semantic.bundle_hash if semantic else None,
                        "context_hash": (
                            req.context.workspace_context.context_hash
                            if req.context.workspace_context
                            else None
                        ),
                    },
                )
            yield emit(
                "status",
                {
                    "phase": "automap_batch_assignment",
                    "message": (
                        "Assigning ordered target-attribute batches across up to two "
                        "Auto-map service instances."
                    ),
                    "attribute_count": len(req.data.attributes or []),
                    "batch_size": self._batch_size,
                    "max_in_flight": self._max_in_flight,
                },
            )
            # Keep the browser-facing SSE connection active while the two private
            # service instances wait for their Cortex Agent responses.
            started_at = time.monotonic()
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(self.invoke, request, req)
                while True:
                    try:
                        response = future.result(timeout=10.0)
                        break
                    except FutureTimeoutError:
                        yield emit(
                            "status",
                            {
                                "phase": "automap_workers_running",
                                "message": (
                                    "AGT_SOURCE_MAPPING is processing semantic mapping batches "
                                    "across the Auto-map service instances."
                                ),
                                "elapsed_seconds": int(time.monotonic() - started_at),
                                "max_in_flight": self._max_in_flight,
                            },
                        )
            yield emit(
                "status",
                {
                    "phase": "automap_worker_completed",
                    "message": "All completed worker batches were merged in target order.",
                },
            )
            yield emit("final", response.model_dump(mode="json"))
        except Exception as exc:
            logger.exception(
                "Auto-map stream failed: request_id=%s error_type=%s",
                req.request_id,
                type(exc).__name__,
            )
            yield emit(
                "error",
                {
                    "contract_version": "1.0",
                    "request_id": req.request_id,
                    "operation": req.operation.value,
                    "data": None,
                    "warnings": [],
                    "error": {
                        "type": "about:blank",
                        "title": "Auto-map worker request failed",
                        "status": 502,
                        "detail": "The Auto-map worker could not complete the request.",
                        "code": "AUTO_MAPPING_WORKER_ERROR",
                    },
                    "message": "The Auto-map worker could not complete the request.",
                },
            )

    def _forward_headers(self, request: Request) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        forwarded_header_names = (
            _OAUTH_FORWARDED_HEADER_NAMES if self._settings.uses_custom_oauth else _FORWARDED_HEADER_NAMES
        )
        for header_name in forwarded_header_names:
            value = request.headers.get(header_name)
            if value:
                headers[header_name] = value
        principal = getattr(request.state, "current_principal", None)
        if principal is not None:
            if self._settings.uses_custom_oauth and principal.snowflake_user_token:
                headers["X-Workbench-OAuth-Access-Token"] = principal.snowflake_user_token
                headers["X-Workbench-OAuth-User"] = principal.snowflake_user
                headers["X-Workbench-OAuth-Email"] = principal.email
                if principal.snowflake_role:
                    headers["X-Workbench-OAuth-Role"] = principal.snowflake_role
            caller_role = None
            if principal.app_persona is AppPersona.ADMIN:
                caller_role = self._settings.app_role_admin
            elif principal.app_persona is AppPersona.PUBLISHER:
                caller_role = self._settings.app_role_publisher
            elif principal.app_persona is AppPersona.VIEWER:
                caller_role = self._settings.app_role_viewer
            if caller_role:
                headers["X-Workbench-Caller-Role"] = caller_role
        return headers
