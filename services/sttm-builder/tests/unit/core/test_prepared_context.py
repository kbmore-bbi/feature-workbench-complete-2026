from __future__ import annotations

from types import SimpleNamespace
import threading
import time

from app.core import prepared_context as prepared_context_module
from app.core.prepared_context import (
    PreparedWorkspaceContextService,
    invalidate_prepared_workspace_context_cache,
    merge_workspace_overlay,
)
from app.schema.prepared_context import (
    PreparedWorkspaceContextRequest,
    PreparedWorkspaceContextResponse,
)
from app.schema.workspace_context import WorkbenchContextSnapshotV1


class _Row:
    def as_dict(self) -> dict[str, str]:
        return {"FIR_EPOCH": "2026-07-26T00:00:00Z:3"}


class _Query:
    def __init__(self, session: "_Session") -> None:
        self._session = session

    def collect(self) -> list[_Row]:
        self._session.collect_count += 1
        return [_Row()]


class _Session:
    def __init__(self) -> None:
        self.collect_count = 0

    def sql(self, _statement: str) -> _Query:
        return _Query(self)


def test_fir_epoch_manifest_is_reused_until_learning_invalidation() -> None:
    invalidate_prepared_workspace_context_cache()
    session = _Session()
    service = PreparedWorkspaceContextService.__new__(PreparedWorkspaceContextService)
    service._session = session
    service._settings = SimpleNamespace(
        fir_target_mapping_patterns_v2=True,
        prepared_context_l1_idle_seconds=3600,
        snowflake_target_mapping_patterns_table="PATTERNS",
        qualify_table_name=lambda name: name,
    )
    request = PreparedWorkspaceContextRequest(workspace={})

    first = service._resolve_fir_epoch(request)
    second = service._resolve_fir_epoch(request)

    assert first.fir_epoch == "2026-07-26T00:00:00Z:3"
    assert second.fir_epoch == first.fir_epoch
    assert session.collect_count == 1

    invalidate_prepared_workspace_context_cache()
    service._resolve_fir_epoch(request)
    assert session.collect_count == 2


def test_get_returns_access_scoped_l1_handle_before_querying_l2() -> None:
    invalidate_prepared_workspace_context_cache()
    session = _Session()
    service = PreparedWorkspaceContextService.__new__(PreparedWorkspaceContextService)
    service._session = session
    service._access_fingerprint = "access"
    service._settings = SimpleNamespace(prepared_context_l1_idle_seconds=3600)
    service._table = "PREPARED_CONTEXTS"
    prepared = PreparedWorkspaceContextResponse(
        workspace_context_id="wctx_test",
        workspace_context_hash="hash",
        workspace_version="2.0",
    )
    prepared_context_module._HYDRATED_CACHE["access:wctx_test"] = (
        __import__("time").monotonic(),
        {
            "prepared": prepared.model_dump(mode="json"),
            "workspace": {},
        },
    )

    result = service.get("wctx_test")

    assert result is not None
    assert result.workspace_context_id == "wctx_test"
    assert result.cache_status == "l1"
    assert session.collect_count == 0


def test_live_workspace_overlay_wins_during_background_revalidation() -> None:
    prepared = WorkbenchContextSnapshotV1.model_validate(
        {
            "context_hash": "prepared-hash",
            "source_tables": [
                {"database": "DB", "schema": "SCH", "table": "OLD_SOURCE"},
            ],
            "target_table": {
                "database": "DB",
                "schema": "SCH",
                "table": "TARGET",
            },
            "relationships": [
                {"left": "DB.SCH.OLD_SOURCE", "right": "DB.SCH.LOOKUP"},
            ],
            "semantic": {
                "bundle_id": "sem_prepared",
                "bundle_hash": "semantic-hash",
            },
        }
    )
    live = WorkbenchContextSnapshotV1.model_validate(
        {
            "context_hash": "live-hash",
            "source_tables": [
                {"database": "DB", "schema": "SCH", "table": "NEW_SOURCE"},
            ],
            "target_table": {
                "database": "DB",
                "schema": "SCH",
                "table": "TARGET",
            },
            # An empty relation list is intentional after changing selection.
            "relationships": [],
        }
    )

    merged = merge_workspace_overlay(prepared, live)

    assert merged.context_hash == "live-hash"
    assert [table.table for table in merged.source_tables] == ["NEW_SOURCE"]
    assert merged.relationships == []
    # Prepared sections omitted by the live overlay remain available.
    assert merged.semantic.bundle_id == "sem_prepared"


def test_build_runs_semantic_and_learning_in_parallel_when_enabled() -> None:
    barrier = threading.Barrier(2)

    class _Semantic:
        def refresh_bundle(self, _request):
            raise AssertionError("leased semantic refresh should be used")

    class _Learning:
        def get_comprehensive_learning_context(self, **_kwargs):
            barrier.wait(timeout=1)
            time.sleep(0.01)
            return SimpleNamespace(
                learning_context_id="learning_1",
                learning_context_hash="learning_hash",
            )

    service = PreparedWorkspaceContextService.__new__(
        PreparedWorkspaceContextService
    )
    service._settings = SimpleNamespace(prepare_parallel_v1=True)
    service._semantic_service = _Semantic()
    service._learning_service = _Learning()

    def semantic_refresh(_request):
        barrier.wait(timeout=1)
        time.sleep(0.01)
        return SimpleNamespace(
            bundle_id="bundle_1",
            bundle_hash="bundle_hash",
            registry_version="registry_1",
        )

    service._semantic_refresh = semantic_refresh
    request = PreparedWorkspaceContextRequest.model_validate(
        {
            "workspace": {
                "project_id": "project_1",
                "sttm_id": "sttm_1",
                "source_tables": [
                    {"database": "DB", "schema": "SCH", "table": "SOURCE"}
                ],
                "target_table": {
                    "database": "DB",
                    "schema": "SCH",
                    "table": "TARGET",
                },
            }
        }
    )

    result = service._build(
        request,
        workspace_context_id="wctx_1",
        workspace_context_hash="hash_1",
    )

    assert result.status == "ready"
    assert result.semantic_bundle_id == "bundle_1"
    assert result.learning_context_id == "learning_1"
