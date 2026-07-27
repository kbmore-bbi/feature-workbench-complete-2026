from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.learning_retrieval import LearningRetrievalService
from app.core.semantic_context import SemanticContextService
from app.schema.prepared_context import (
    PreparedWorkspaceContextRequest,
    PreparedWorkspaceContextResponse,
)
from app.schema.semantic_context import SemanticContextRefreshRequest, SemanticLevel

logger = logging.getLogger(__name__)

_CACHE_LOCK = threading.Lock()
_CACHE: dict[str, tuple[float, PreparedWorkspaceContextResponse]] = {}
_HYDRATED_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_INFLIGHT: dict[str, threading.Event] = {}
_FIR_EPOCH_CACHE: tuple[float, str] | None = None


def merge_workspace_overlay(
    prepared_workspace: Any,
    live_workspace: Any,
) -> Any:
    """Merge a current UI snapshot over an immutable prepared baseline."""

    if live_workspace is None:
        return prepared_workspace

    def as_plain_mapping(value: Any) -> dict[str, Any]:
        if value is None:
            return {}
        if hasattr(value, "model_dump"):
            return value.model_dump(mode="python", exclude_none=True)
        if isinstance(value, Mapping):
            return dict(value)
        return {}

    def merge(base: Any, overlay: Any) -> Any:
        if isinstance(base, Mapping) and isinstance(overlay, Mapping):
            result = dict(base)
            for key, value in overlay.items():
                result[key] = merge(result.get(key), value)
            return result
        # Lists and scalar values are complete current-state replacements.
        return overlay

    merged = merge(
        as_plain_mapping(prepared_workspace),
        as_plain_mapping(live_workspace),
    )
    live_type = type(live_workspace)
    if hasattr(live_type, "model_validate"):
        return live_type.model_validate(merged)
    return merged


def invalidate_prepared_workspace_context_cache() -> None:
    global _FIR_EPOCH_CACHE
    with _CACHE_LOCK:
        _CACHE.clear()
        _HYDRATED_CACHE.clear()
        _FIR_EPOCH_CACHE = None


class PreparedWorkspaceContextService:
    """Build and hydrate one immutable handle for an exact mapping workspace."""

    def __init__(
        self,
        *,
        session: Session,
        settings: Settings,
        semantic_service: SemanticContextService,
        learning_service: LearningRetrievalService,
        access_scope: str,
    ) -> None:
        self._session = session
        self._settings = settings
        self._semantic_service = semantic_service
        self._learning_service = learning_service
        self._table = settings.qualify_table_name(
            settings.snowflake_prepared_workspace_contexts_table
        )
        self._access_fingerprint = hashlib.sha256(
            access_scope.encode("utf-8")
        ).hexdigest()

    @staticmethod
    def _quote(value: Any) -> str:
        return "'" + str(value).replace("'", "''") + "'"

    def _dependency_payload(
        self, request: PreparedWorkspaceContextRequest
    ) -> dict[str, Any]:
        workspace = request.workspace
        mapping_sql = (
            workspace.compiled_mapping_sql
            or workspace.raw_mapping_sql
            or workspace.mapping_sql
            or ""
        )
        return {
            "access": self._access_fingerprint,
            "source_set_hash": workspace.source_set_hash,
            "derived_set_hash": workspace.derived_set_hash,
            "selected_columns": workspace.selected_columns_by_table,
            "derived_sources": [
                {
                    "id": item.id,
                    "sql_hash": item.sql_hash,
                    "selected_columns": item.selected_columns_by_table,
                    "lineage": item.lineage,
                }
                for item in workspace.derived_sources
            ],
            "relationships": workspace.relationships,
            "relation_graph": workspace.relation_graph,
            "driving_table": (
                workspace.driving_table.qualified_name
                if workspace.driving_table
                else None
            ),
            "target_table": (
                workspace.target_table.qualified_name
                if workspace.target_table
                else None
            ),
            "mapping_intent": workspace.mapping_intent or {},
            "mapping_rows": [
                row.model_dump(mode="json")
                for row in workspace.mapping_rows
            ],
            "filters": workspace.filters.model_dump(mode="json"),
            "mapping_sql_hash": hashlib.sha256(
                mapping_sql.encode("utf-8")
            ).hexdigest() if mapping_sql else None,
            "semantic_registry_version": request.semantic_registry_version,
            "fir_epoch": request.fir_epoch,
            "precedent_version": request.precedent_version,
            "correction_version": request.correction_version,
            "project_id": workspace.project_id,
            "sttm_id": workspace.sttm_id,
        }

    def _identity(
        self, request: PreparedWorkspaceContextRequest
    ) -> tuple[str, str]:
        payload = json.dumps(
            self._dependency_payload(request),
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        )
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return f"wctx_{digest[:20]}", digest

    def _resolve_fir_epoch(
        self, request: PreparedWorkspaceContextRequest
    ) -> PreparedWorkspaceContextRequest:
        """Resolve a durable FIR version only when a context is being prepared.

        Warm assistant turns hydrate the prepared handle and never execute this
        query. New mappings and explicit refreshes include the current pattern
        epoch in the dependency hash, so an older L2 context cannot hide newly
        uploaded or corrected target-column evidence after a replica restart.
        """
        if request.fir_epoch or not self._settings.fir_target_mapping_patterns_v2:
            return request
        global _FIR_EPOCH_CACHE
        with _CACHE_LOCK:
            cached_epoch = _FIR_EPOCH_CACHE
            if (
                cached_epoch is not None
                and time.monotonic() - cached_epoch[0]
                <= self._settings.prepared_context_l1_idle_seconds
            ):
                return request.model_copy(update={"fir_epoch": cached_epoch[1]})
        table_name = self._settings.qualify_table_name(
            self._settings.snowflake_target_mapping_patterns_table
        )
        try:
            rows = self._session.sql(
                f"""
                SELECT
                    COALESCE(TO_VARCHAR(MAX(UPDATED_AT)), 'empty')
                    || ':' || TO_VARCHAR(COUNT(*)) AS FIR_EPOCH
                FROM {table_name}
                WHERE STATUS = 'active'
                """
            ).collect()
            epoch = (
                str(rows[0].as_dict().get("FIR_EPOCH") or "empty:0")
                if rows
                else "empty:0"
            )
            with _CACHE_LOCK:
                _FIR_EPOCH_CACHE = (time.monotonic(), epoch)
            return request.model_copy(update={"fir_epoch": epoch})
        except Exception as exc:
            logger.warning("Unable to resolve target-pattern FIR epoch: %s", exc)
            return request

    def prepare(
        self, request: PreparedWorkspaceContextRequest
    ) -> PreparedWorkspaceContextResponse:
        request = self._resolve_fir_epoch(request)
        workspace_context_id, workspace_context_hash = self._identity(request)
        cache_key = f"{self._access_fingerprint}:{workspace_context_hash}"
        if not request.force:
            hit = self._l1(cache_key)
            if hit is not None:
                return hit
            durable = self.get(workspace_context_id)
            if (
                durable is not None
                and durable.workspace_context_hash == workspace_context_hash
            ):
                durable.cache_status = "l2"
                with _CACHE_LOCK:
                    _CACHE[cache_key] = (
                        time.monotonic(),
                        durable.model_copy(deep=True),
                    )
                return durable

        with _CACHE_LOCK:
            waiter = _INFLIGHT.get(cache_key)
            if waiter is None:
                waiter = threading.Event()
                _INFLIGHT[cache_key] = waiter
                owns_build = True
            else:
                owns_build = False
        if not owns_build:
            waiter.wait(timeout=180)
            hit = self._l1(cache_key)
            if hit is not None:
                hit.cache_status = "coalesced"
                return hit

        try:
            result = self._build(
                request,
                workspace_context_id=workspace_context_id,
                workspace_context_hash=workspace_context_hash,
            )
            workspace_payload = request.workspace.model_dump(mode="json")
            workspace_payload["conversation_history"] = []
            self._persist(result, workspace=workspace_payload)
            with _CACHE_LOCK:
                _CACHE[cache_key] = (
                    time.monotonic(),
                    result.model_copy(deep=True),
                )
                _HYDRATED_CACHE[
                    f"{self._access_fingerprint}:{workspace_context_id}"
                ] = (
                    time.monotonic(),
                    {
                        "prepared": result.model_dump(mode="json"),
                        "workspace": workspace_payload,
                    },
                )
            return result
        finally:
            if owns_build:
                with _CACHE_LOCK:
                    event = _INFLIGHT.pop(cache_key, None)
                    if event:
                        event.set()

    def _l1(self, key: str) -> PreparedWorkspaceContextResponse | None:
        with _CACHE_LOCK:
            cached = _CACHE.get(key)
            if cached is None:
                return None
            touched_at, value = cached
            if (
                time.monotonic() - touched_at
                > self._settings.prepared_context_l1_idle_seconds
            ):
                _CACHE.pop(key, None)
                return None
            _CACHE[key] = (time.monotonic(), value)
            result = value.model_copy(deep=True)
        result.cache_status = "l1"
        return result

    def _build(
        self,
        request: PreparedWorkspaceContextRequest,
        *,
        workspace_context_id: str,
        workspace_context_hash: str,
    ) -> PreparedWorkspaceContextResponse:
        started = time.perf_counter()
        timings: dict[str, float] = {}
        warnings: list[str] = []
        workspace = request.workspace

        semantic_started = time.perf_counter()
        semantic = None
        try:
            semantic = self._semantic_service.refresh_bundle(
                SemanticContextRefreshRequest(
                    selected_source_tables=workspace.source_tables,
                    selected_derived_sources=workspace.selected_derived_source_ids(),
                    target_table=workspace.target_table,
                    relationships=workspace.relationships,
                    selected_columns_by_table=workspace.selected_columns_by_table,
                    requested_level=SemanticLevel.FULL_REGISTRY,
                    force=request.force,
                )
            )
        except Exception as exc:
            logger.warning("Prepared semantic context failed: %s", exc)
            warnings.append(f"semantic context unavailable: {exc}")
        timings["semantic"] = (time.perf_counter() - semantic_started) * 1000

        target_columns = sorted(
            {
                row.target_column
                for row in workspace.mapping_rows
                if row.target_column
            }
            | {
                column
                for table, columns in workspace.selected_columns_by_table.items()
                if workspace.target_table
                and table.upper() == workspace.target_table.qualified_name.upper()
                for column in columns
            }
        )
        learning = None
        learning_started = time.perf_counter()
        if workspace.project_id and workspace.target_table:
            try:
                learning = self._learning_service.get_comprehensive_learning_context(
                    project_id=workspace.project_id,
                    sttm_id=workspace.sttm_id,
                    source_tables=[
                        table.qualified_name for table in workspace.source_tables
                    ],
                    target_table=workspace.target_table.qualified_name,
                    target_columns=target_columns,
                    mapping_intent=workspace.mapping_intent,
                    context_key=workspace.context_key,
                    source_set_hash=workspace.source_set_hash,
                    derived_set_hash=workspace.derived_set_hash,
                    fir_epoch=request.fir_epoch,
                    milestone=workspace.milestone,
                    target_agent="AGT_STTM_BUILDER",
                )
            except Exception as exc:
                logger.warning("Prepared FIR context failed: %s", exc)
                warnings.append(f"learning context unavailable: {exc}")
        timings["learning"] = (time.perf_counter() - learning_started) * 1000
        timings["total"] = (time.perf_counter() - started) * 1000

        readiness = {
            "semantic": semantic is not None,
            "learning": learning is not None or not bool(workspace.project_id),
            "precedent": learning is not None,
            "artifacts": True,
        }
        status = (
            "ready"
            if all(readiness.values())
            else "partial"
            if any(readiness.values())
            else "failed"
        )
        now = datetime.now(timezone.utc)
        return PreparedWorkspaceContextResponse(
            workspace_context_id=workspace_context_id,
            workspace_context_hash=workspace_context_hash,
            workspace_version=workspace.context_version,
            semantic_bundle_id=semantic.bundle_id if semantic else None,
            semantic_bundle_hash=semantic.bundle_hash if semantic else None,
            semantic_registry_version=semantic.registry_version if semantic else None,
            learning_context_id=(
                learning.learning_context_id if learning else None
            ),
            learning_context_hash=(
                learning.learning_context_hash if learning else None
            ),
            fir_epoch=request.fir_epoch,
            precedent_version=request.precedent_version,
            correction_version=request.correction_version,
            artifact_refs=workspace.mapping_artifacts,
            status=status,
            cache_status="miss",
            readiness=readiness,
            stage_timings_ms=timings,
            warnings=warnings,
            created_at=now,
            updated_at=now,
        )

    def get(
        self, workspace_context_id: str
    ) -> PreparedWorkspaceContextResponse | None:
        # A prepare response is usable immediately, even when the durable L2
        # table has not been bootstrapped yet or its MERGE is temporarily
        # unavailable.  Previously GET skipped this access-scoped L1 entry and
        # queried L2 directly, so POST /prepare could return `ready` and the
        # very next GET returned 404.
        hydrated_key = f"{self._access_fingerprint}:{workspace_context_id}"
        with _CACHE_LOCK:
            cached = _HYDRATED_CACHE.get(hydrated_key)
            if cached is not None:
                touched_at, payload = cached
                if (
                    time.monotonic() - touched_at
                    <= self._settings.prepared_context_l1_idle_seconds
                ):
                    _HYDRATED_CACHE[hydrated_key] = (
                        time.monotonic(),
                        payload,
                    )
                    prepared = payload.get("prepared")
                    if isinstance(prepared, dict):
                        result = PreparedWorkspaceContextResponse.model_validate(
                            prepared
                        )
                        result.cache_status = "l1"
                        return result
                else:
                    _HYDRATED_CACHE.pop(hydrated_key, None)
        try:
            rows = self._session.sql(
                f"""
                SELECT CONTEXT_PAYLOAD
                FROM {self._table}
                WHERE WORKSPACE_CONTEXT_ID = {self._quote(workspace_context_id)}
                  AND ACCESS_FINGERPRINT = {self._quote(self._access_fingerprint)}
                  AND STATUS <> 'deleted'
                ORDER BY UPDATED_AT DESC
                LIMIT 1
                """
            ).collect()
            if not rows:
                return None
            payload = rows[0].as_dict().get("CONTEXT_PAYLOAD")
            if isinstance(payload, str):
                payload = json.loads(payload)
            return (
                PreparedWorkspaceContextResponse.model_validate(payload)
                if isinstance(payload, dict)
                else None
            )
        except Exception as exc:
            logger.debug("Prepared workspace L2 unavailable: %s", exc)
            return None

    def hydrate(self, workspace_context_id: str) -> dict[str, Any] | None:
        """Return access-checked internal context for an agent invocation."""
        hydrated_key = f"{self._access_fingerprint}:{workspace_context_id}"
        with _CACHE_LOCK:
            cached = _HYDRATED_CACHE.get(hydrated_key)
            if cached is not None:
                touched_at, cached_payload = cached
                if (
                    time.monotonic() - touched_at
                    <= self._settings.prepared_context_l1_idle_seconds
                ):
                    _HYDRATED_CACHE[hydrated_key] = (
                        time.monotonic(),
                        cached_payload,
                    )
                    payload = json.loads(json.dumps(cached_payload, default=str))
                else:
                    _HYDRATED_CACHE.pop(hydrated_key, None)
                    payload = None
            else:
                payload = None
        if isinstance(payload, dict):
            public = PreparedWorkspaceContextResponse.model_validate(
                payload.get("prepared")
            )
            learning = None
            if public.learning_context_id:
                learning = self._learning_service.get_prepared_learning_context(
                    learning_context_id=public.learning_context_id,
                    learning_context_hash=public.learning_context_hash,
                )
            return {
                "prepared": public,
                "workspace": payload.get("workspace"),
                "learning_context": learning,
            }
        try:
            rows = self._session.sql(
                f"""
                SELECT CONTEXT_PAYLOAD
                FROM {self._table}
                WHERE WORKSPACE_CONTEXT_ID = {self._quote(workspace_context_id)}
                  AND ACCESS_FINGERPRINT = {self._quote(self._access_fingerprint)}
                  AND STATUS <> 'deleted'
                ORDER BY UPDATED_AT DESC
                LIMIT 1
                """
            ).collect()
            if not rows:
                return None
            payload = rows[0].as_dict().get("CONTEXT_PAYLOAD")
            if isinstance(payload, str):
                payload = json.loads(payload)
            if not isinstance(payload, dict):
                return None
            public = PreparedWorkspaceContextResponse.model_validate(payload)
            workspace = payload.get("_workspace_snapshot")
            if not isinstance(workspace, dict):
                return None
            with _CACHE_LOCK:
                _HYDRATED_CACHE[hydrated_key] = (
                    time.monotonic(),
                    {
                        "prepared": public.model_dump(mode="json"),
                        "workspace": workspace,
                    },
                )
            learning = None
            if public.learning_context_id:
                learning = self._learning_service.get_prepared_learning_context(
                    learning_context_id=public.learning_context_id,
                    learning_context_hash=public.learning_context_hash,
                )
            return {
                "prepared": public,
                "workspace": workspace,
                "learning_context": learning,
            }
        except Exception as exc:
            logger.debug("Prepared workspace handle hydration unavailable: %s", exc)
            return None

    def _persist(
        self,
        context: PreparedWorkspaceContextResponse,
        *,
        workspace: dict[str, Any],
    ) -> None:
        try:
            context_payload = context.model_dump(mode="json")
            context_payload["_workspace_snapshot"] = workspace
            payload = json.dumps(
                context_payload,
                sort_keys=True,
                default=str,
                separators=(",", ":"),
            )
            self._session.sql(
                f"""
                MERGE INTO {self._table} target
                USING (
                    SELECT
                        {self._quote(context.workspace_context_id)} AS WORKSPACE_CONTEXT_ID,
                        {self._quote(context.workspace_context_hash)} AS WORKSPACE_CONTEXT_HASH,
                        {self._quote(self._access_fingerprint)} AS ACCESS_FINGERPRINT,
                        {self._quote(context.status)} AS STATUS,
                        PARSE_JSON({self._quote(payload)}) AS CONTEXT_PAYLOAD
                ) source
                ON target.WORKSPACE_CONTEXT_ID = source.WORKSPACE_CONTEXT_ID
                   AND target.ACCESS_FINGERPRINT = source.ACCESS_FINGERPRINT
                WHEN MATCHED THEN UPDATE SET
                    WORKSPACE_CONTEXT_HASH = source.WORKSPACE_CONTEXT_HASH,
                    STATUS = source.STATUS,
                    CONTEXT_PAYLOAD = source.CONTEXT_PAYLOAD,
                    LAST_ACCESSED_AT = CURRENT_TIMESTAMP(),
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT (
                    WORKSPACE_CONTEXT_ID, WORKSPACE_CONTEXT_HASH,
                    ACCESS_FINGERPRINT, STATUS, CONTEXT_PAYLOAD,
                    CREATED_AT, LAST_ACCESSED_AT, UPDATED_AT
                ) VALUES (
                    source.WORKSPACE_CONTEXT_ID, source.WORKSPACE_CONTEXT_HASH,
                    source.ACCESS_FINGERPRINT, source.STATUS, source.CONTEXT_PAYLOAD,
                    CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
                )
                """
            ).collect()
        except Exception as exc:
            logger.debug("Unable to persist prepared workspace context: %s", exc)
