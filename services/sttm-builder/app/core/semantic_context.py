import hashlib
import copy
import json
import logging
import re
import threading
import time
from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from snowflake.snowpark import Session
import yaml

from app.core.config import Settings
from app.core.exceptions import SemanticAssetNotFoundError, SemanticRelationshipInvalidError
from app.core.datahub import DataHubAdapter
from app.core.derived_source import DerivedSourceService
from app.core.semantic_model import SemanticModelService
from app.core.snowflake_agent import SnowflakeAgentClient
from app.core.table_selection import TableSelectionService
from app.schema.common import TableRef
from app.schema.semantic_context import (
    SemanticBundleLineage,
    SemanticBundleStatus,
    SemanticContextBundleResponse,
    SemanticContextRefreshRequest,
    SemanticContextSummary,
    SemanticLevel,
    SemanticProjectionProfile,
    SemanticProjectionRequest,
    SemanticProjectionResponse,
    SemanticReadingInstructions,
)
from app.schema.sttm_builder import RelationshipContextItem, SemanticContextItem

logger = logging.getLogger(__name__)

_LEVEL_ORDER = {
    SemanticLevel.L0_RELATIONSHIP: 0,
    SemanticLevel.L1_CONTEXT: 1,
    SemanticLevel.L2_ANALYST_READY: 2,
    SemanticLevel.L3_MAPPING_ENRICHED: 3,
    SemanticLevel.FULL_REGISTRY: 4,  # Highest level - full semantic views
}

_BUNDLE_CACHE_IDLE_SECONDS = 3600.0
_BUNDLE_CACHE_LOCK = threading.Lock()
_BUNDLE_CACHE: dict[str, tuple[float, SemanticContextBundleResponse]] = {}
_BUNDLE_RECORD_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_BUNDLE_INFLIGHT: dict[str, threading.Event] = {}


def invalidate_semantic_bundle_cache() -> None:
    """Invalidate prepared bundles after workspace semantic inputs mutate."""
    with _BUNDLE_CACHE_LOCK:
        _BUNDLE_CACHE.clear()
        _BUNDLE_RECORD_CACHE.clear()


# Default confidence interpretation guide for reading instructions
_CONFIDENCE_GUIDE = """
Confidence levels in semantic views indicate reliability of inferred information:
- HIGH (0.9-1.0): Formally declared constraints or strongly validated patterns. Use directly.
- MEDIUM (0.7-0.89): Inferred with good evidence (name matching, overlap checks). Generally reliable.
- LOW (0.5-0.69): Plausible but needs verification. Flag in recommendations.
- FLAGGED: Previously marked as potentially incorrect. Review before using.

Relationship types:
- FORMAL: Defined via DDL constraint. Fully trusted.
- INFERRED: Matched via column naming + validation. Usually reliable.
- FUZZY: Matched via semantic similarity. Verify in important decisions.
"""


class SemanticContextService:
    def __init__(
        self,
        *,
        session: Session,
        settings: Settings,
        semantic_model_service: SemanticModelService,
        table_selection_service: TableSelectionService,
        derived_source_service: DerivedSourceService,
        datahub_adapter: DataHubAdapter | None = None,
        access_scope: str = "default",
    ) -> None:
        self._session = session
        self._settings = settings
        self._semantic_model_service = semantic_model_service
        self._table_selection_service = table_selection_service
        self._derived_source_service = derived_source_service
        self._datahub = datahub_adapter or DataHubAdapter(settings)
        self._bundle_table = settings.qualify_table_name(settings.snowflake_semantic_bundles_table)
        self._overrides_table = settings.qualify_table_name(settings.snowflake_semantic_overrides_table)
        self._projection_table = settings.qualify_table_name(settings.snowflake_semantic_projections_table)
        self._bundle_versions_table = settings.qualify_metadata_object_name(
            "TBL_SEMANTIC_BUNDLE_VERSIONS"
        )
        effective_scope = access_scope if access_scope != "default" else f"session:{id(session)}"
        self._access_fingerprint = hashlib.sha256(effective_scope.encode("utf-8")).hexdigest()

    def _active_curation_overlay(self, bundle_id: str) -> dict[str, Any]:
        """Return the promoted mapping overlay without making bundle refresh brittle."""
        try:
            rows = self._session.sql(
                f"""
                SELECT BUNDLE_VERSION_ID, MAPPING_SEMANTICS, KNOWLEDGE_GRAPH,
                       VALIDATION_SUMMARY
                FROM {self._bundle_versions_table}
                WHERE SEMANTIC_BUNDLE_ID = ? AND STATUS = 'active'
                ORDER BY PROMOTED_AT DESC, UPDATED_AT DESC
                LIMIT 1
                """,
                [bundle_id],
            ).collect()
        except Exception as exc:
            logger.debug("No active bundle curation overlay for %s: %s", bundle_id, exc)
            return {}
        if not rows:
            return {}
        row = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
        return {
            "active_bundle_curation_version": row.get("BUNDLE_VERSION_ID"),
            "curated_mapping_overlay": _variant_to_python(
                row.get("MAPPING_SEMANTICS")
            )
            or [],
            "curated_knowledge_graph": _variant_to_python(
                row.get("KNOWLEDGE_GRAPH")
            )
            or {},
            "curation_validation_summary": _variant_to_python(
                row.get("VALIDATION_SUMMARY")
            )
            or {},
        }

    def refresh_bundle(
        self,
        request: SemanticContextRefreshRequest,
        *,
        agent_client: SnowflakeAgentClient | None = None,
        allow_agent_refresh: bool = True,
    ) -> SemanticContextBundleResponse:
        # Physical-table semantics are produced by AGT_SEMANTIC_MODEL_V2 and its
        # scheduled pipeline. Request paths are deliberately read-only: they
        # resolve the canonical registry and compose an Analyst model in memory.
        normalized = request.model_copy(update={"requested_level": SemanticLevel.FULL_REGISTRY})
        selected_sources = _dedupe_tables(normalized.selected_source_tables)
        selection_key = self._bundle_selection_key(
            selected_source_tables=selected_sources,
            selected_derived_sources=sorted(set(normalized.selected_derived_sources)),
            target_table=normalized.target_table,
            selected_columns_by_table=normalized.selected_columns_by_table,
            relationships=_normalize_relationships(normalized.relationships),
        )
        cache_key = f"{self._access_fingerprint}:{selection_key}"
        if not normalized.force:
            cached = self._cached_bundle(cache_key)
            if cached is not None:
                return cached
            durable = self.get_bundle(selection_key=selection_key)
            artifact = durable.get("bundle_artifact") if durable else None
            updated_at = durable.get("updated_at") if durable else None
            if isinstance(artifact, dict) and self._durable_cache_is_valid(updated_at):
                hit = SemanticContextBundleResponse.model_validate(artifact)
                hit.cache_hit = True
                hit.cache_status = "l2"
                with _BUNDLE_CACHE_LOCK:
                    _BUNDLE_CACHE[cache_key] = (time.monotonic(), hit.model_copy(deep=True))
                return hit

        with _BUNDLE_CACHE_LOCK:
            waiter = _BUNDLE_INFLIGHT.get(cache_key)
            if waiter is None:
                waiter = threading.Event()
                _BUNDLE_INFLIGHT[cache_key] = waiter
                owns_build = True
            else:
                owns_build = False
        if not owns_build:
            waiter.wait(timeout=120)
            cached = self._cached_bundle(cache_key)
            if cached is not None:
                return cached

        try:
            result = self._resolve_registry_bundle(normalized)
            result.cache_hit = False
            result.cache_status = "miss"
            with _BUNDLE_CACHE_LOCK:
                _BUNDLE_CACHE[cache_key] = (time.monotonic(), result.model_copy(deep=True))
            return result
        finally:
            if owns_build:
                with _BUNDLE_CACHE_LOCK:
                    event = _BUNDLE_INFLIGHT.pop(cache_key, None)
                    if event is not None:
                        event.set()

    @staticmethod
    def _cached_bundle(cache_key: str) -> SemanticContextBundleResponse | None:
        now = time.monotonic()
        with _BUNDLE_CACHE_LOCK:
            cached = _BUNDLE_CACHE.get(cache_key)
            if cached is None:
                return None
            created_at, response = cached
            age = now - created_at
            if age > _BUNDLE_CACHE_IDLE_SECONDS:
                _BUNDLE_CACHE.pop(cache_key, None)
                return None
            hit = response.model_copy(deep=True)
        hit.cache_hit = True
        hit.cache_status = "l1"
        hit.cache_age_ms = int(age * 1000)
        return hit

    @staticmethod
    def _durable_cache_is_valid(updated_at: Any) -> bool:
        """Return whether an exact-selection artifact may be reused.

        The selection key is content-addressed by sources, targets, selected
        columns, derived sources, and relationships.  Age alone must not make
        an unchanged bundle invalid.  A 24-hour soft revalidation window is
        retained as a safety net for registry changes made outside the
        workbench's explicit invalidation paths.
        """
        if updated_at is None:
            return False
        value = updated_at
        if isinstance(value, str):
            try:
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return False
        if not isinstance(value, datetime):
            return False
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return (
            datetime.now(timezone.utc) - value
        ).total_seconds() <= 86400

    def _resolve_registry_bundle(
        self,
        request: SemanticContextRefreshRequest,
    ) -> SemanticContextBundleResponse:
        resolve_started = time.perf_counter()
        stage_timings_ms: dict[str, float] = {}
        notes: list[str] = []
        selected_source_tables = _dedupe_tables(request.selected_source_tables)
        selected_derived_ids = sorted({value for value in request.selected_derived_sources if value})
        normalized_relationships = _normalize_relationships(request.relationships)
        all_tables = list(selected_source_tables)
        if request.target_table and all(
            table.qualified_name.upper() != request.target_table.qualified_name.upper()
            for table in all_tables
        ):
            all_tables.append(request.target_table)

        selection_key = self._bundle_selection_key(
            selected_source_tables=selected_source_tables,
            selected_derived_sources=selected_derived_ids,
            target_table=request.target_table,
            selected_columns_by_table=request.selected_columns_by_table,
            relationships=normalized_relationships,
        )
        bundle_hash = self._bundle_hash(
            selected_source_tables=selected_source_tables,
            selected_derived_sources=selected_derived_ids,
            target_table=request.target_table,
            relationships=normalized_relationships,
            selected_columns_by_table=request.selected_columns_by_table,
        )
        bundle_id = f"sem_{hashlib.sha256(selection_key.encode('utf-8')).hexdigest()[:16]}"
        stage_started = time.perf_counter()
        derived_records = self._derived_source_service.get_sources_by_ids(selected_derived_ids)
        stage_timings_ms["derived_source_retrieval"] = (time.perf_counter() - stage_started) * 1000
        derived_semantic_warnings = self._derived_semantic_coverage_warnings(derived_records)
        notes.extend(derived_semantic_warnings)
        bundle_label = self._bundle_label(
            selected_source_tables=selected_source_tables,
            derived_records=derived_records,
            target_table=request.target_table,
        )
        stage_started = time.perf_counter()
        records = self._semantic_model_service.get_table_records(self._session, all_tables)
        stage_timings_ms["native_yaml_retrieval"] = (time.perf_counter() - stage_started) * 1000
        asset_versions = []
        for record in records:
            model = record.get("semantic_model")
            semantic_view = model.get("semantic_view") if isinstance(model, dict) else None
            asset_versions.append({
                "fqn": f"{record.get('database')}.{record.get('schema_name')}.{record.get('table_name')}".upper(),
                "version": (
                    semantic_view.get("yaml_hash")
                    if isinstance(semantic_view, dict) and semantic_view.get("yaml_hash")
                    else str(record.get("updated_at") or record.get("generated_at") or "")
                ),
            })
        versioned_hash_input = json.dumps(
            {"selection_hash": bundle_hash, "asset_versions": sorted(asset_versions, key=lambda item: item["fqn"])},
            sort_keys=True,
            separators=(",", ":"),
        )
        registry_version = hashlib.sha256(
            json.dumps(asset_versions, sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()
        bundle_hash = hashlib.sha256(versioned_hash_input.encode("utf-8")).hexdigest()
        records_by_name = {
            f"{record['database']}.{record['schema_name']}.{record['table_name']}".upper(): record
            for record in records
            if record.get("table_name")
        }
        missing = [
            table.qualified_name
            for table in all_tables
            if table.qualified_name.upper() not in records_by_name
        ]
        if missing:
            # A partial bundle would be semantically misleading: downstream
            # agents could interpret an omitted selected table as irrelevant.
            # Require the complete native registry set instead of silently
            # dropping missing source or target assets.
            raise SemanticAssetNotFoundError(
                (
                    "Authoritative native semantic YAML is missing for one or more "
                    "selected source or target tables. Refresh those registry assets "
                    "or narrow the selection before continuing."
                ),
                details=[
                    {"field": "semantic_asset", "message": qualified_name}
                    for qualified_name in sorted(missing)
                ]
                + [
                    {
                        "field": "semantic_native_registry",
                        "message": self._settings.resolved_semantic_native_views_table,
                    }
                ],
            )

        physical_views: list[str] = []
        for record in records:
            model = record.get("semantic_model")
            semantic_view = model.get("semantic_view") if isinstance(model, dict) else None
            name = semantic_view.get("name") if isinstance(semantic_view, dict) else None
            if isinstance(name, str) and name.strip():
                physical_views.append(name.strip())

        semantic_model_yaml: str | None = None
        excluded_relationships: list[dict[str, Any]] = []
        raw_assets: list[dict[str, Any]] = []
        composition_diagnostics: list[dict[str, Any]] = []
        derived_semantics: list[dict[str, Any]] = []
        # Compose the complete selected set. Missing physical assets are rejected
        # above so the resulting model can never look complete after dropping a
        # selected table.
        if all_tables:
            try:
                inline_name = (
                    f"INLINE_{hashlib.sha256(selection_key.encode('utf-8')).hexdigest()[:16].upper()}"
                )
                stage_started = time.perf_counter()
                semantic_model_yaml = self._build_semantic_view_yaml(
                    bundle_id=bundle_id,
                    semantic_view_name=inline_name,
                    selected_source_tables=all_tables,
                    derived_records=derived_records,
                    relationships=normalized_relationships,
                    target_table=request.target_table,
                    semantic_level=request.requested_level,
                    excluded_relationships=excluded_relationships,
                    table_records=records,
                    raw_assets=raw_assets,
                    composition_diagnostics=composition_diagnostics,
                    derived_semantics=derived_semantics,
                )
                stage_timings_ms["bundle_composition_validation"] = (
                    time.perf_counter() - stage_started
                ) * 1000
            except Exception as exc:
                logger.exception("Failed to compose registry semantic model for %s", bundle_id)
                raise SemanticAssetNotFoundError(
                    f"Authoritative native semantic bundle composition failed: {exc}",
                    details=[
                        {
                            "field": "native_semantic_registry",
                            "message": self._settings.resolved_semantic_native_views_table,
                        }
                    ],
                ) from exc
        if excluded_relationships:
            notes.append(
                f"{len(excluded_relationships)} relationship(s) remain available to mapping agents "
                "but were omitted from the Cortex Analyst model because uniqueness is unproven"
            )

        semantic_view_name = physical_views[0] if len(all_tables) == 1 and len(physical_views) == 1 else None
        achieved_level = (
            request.requested_level
            if semantic_view_name or semantic_model_yaml
            else SemanticLevel.FULL_REGISTRY  # Registry context only; not Analyst executable.
        )
        semantic_context = self._build_semantic_context_items(
            selected_source_tables=all_tables,
            derived_records=derived_records,
            relationships=normalized_relationships,
            requested_level=achieved_level,
        )
        lineage = [self._lineage_from_record(record) for record in derived_records]
        datahub_context = self._datahub.build_context(
            source_tables=selected_source_tables,
            derived_source_ids=selected_derived_ids,
        )

        # Build reading instructions for FULL_REGISTRY level or any request
        # This helps agents understand how to interpret the semantic context
        reading_instructions = self._build_reading_instructions(
            selected_source_tables=selected_source_tables,
            derived_records=derived_records,
            target_table=request.target_table,
            relationships=normalized_relationships,
            table_records=records,
        )

        status = SemanticBundleStatus.READY if not notes else SemanticBundleStatus.PARTIAL
        try:
            self.ensure_storage_exists()
            self._upsert_bundle(
                bundle_id=bundle_id,
                bundle_hash=bundle_hash,
                selection_key=selection_key,
                bundle_label=bundle_label,
                target_table=request.target_table,
                source_tables=selected_source_tables,
                derived_source_ids=selected_derived_ids,
                relationships=normalized_relationships,
                semantic_level=achieved_level,
                semantic_view_name=semantic_view_name,
                semantic_model_yaml=semantic_model_yaml,
                analyst_tool_name=None,
                status=status,
                stale_reason="; ".join(notes) or None,
                datahub_context=datahub_context,
                registry_version=registry_version,
                raw_assets=raw_assets,
                derived_semantics=derived_semantics,
                excluded_relationships=excluded_relationships,
                composition_diagnostics=composition_diagnostics,
            )
        except Exception as exc:
            logger.warning("Failed to persist registry semantic bundle %s: %s", bundle_id, exc)
            notes.append(f"semantic bundle cache persistence failed: {exc}")
            status = SemanticBundleStatus.PARTIAL
        summary = SemanticContextSummary(
            bundle_id=bundle_id,
            bundle_hash=bundle_hash,
            bundle_label=bundle_label,
            source_table_count=len(selected_source_tables),
            derived_source_count=len(derived_records),
            relationship_count=len(normalized_relationships),
            semantic_level=achieved_level,
            semantic_view_name=semantic_view_name,
            semantic_model_yaml=semantic_model_yaml,
            promoted=False,
            tables=[table.qualified_name for table in all_tables],
            derived_sources=[record.derived_source_id for record in derived_records],
            notes=notes,
            asset_versions={item["fqn"]: str(item["version"]) for item in asset_versions},
            composed_model_hash=(
                hashlib.sha256(semantic_model_yaml.encode("utf-8")).hexdigest()
                if semantic_model_yaml
                else None
            ),
        )
        stage_timings_ms["total"] = (time.perf_counter() - resolve_started) * 1000
        response = SemanticContextBundleResponse(
            bundle_id=bundle_id,
            bundle_hash=bundle_hash,
            bundle_label=bundle_label,
            requested_level=request.requested_level,
            achieved_level=achieved_level,
            semantic_view_name=semantic_view_name,
            semantic_model_yaml=semantic_model_yaml,
            status=status,
            promoted=False,
            cache_hit=False,
            cache_status="miss",
            registry_version=registry_version,
            raw_assets=raw_assets,
            composed_yaml=semantic_model_yaml,
            derived_semantics=derived_semantics,
            composition_diagnostics=composition_diagnostics,
            stage_timings_ms=stage_timings_ms,
            summary=summary,
            lineage=lineage,
            semantic_context=[item.model_dump(mode="json") for item in semantic_context],
            excluded_relationships=excluded_relationships,
            warnings=derived_semantic_warnings
            + [
                str(item.get("reason") or "Relationship omitted from Cortex Analyst YAML")
                for item in excluded_relationships
            ],
            datahub_context=datahub_context,
            reading_instructions=reading_instructions,
        )
        bundle_artifact = response.model_dump(mode="json")
        curation_overlay = self._active_curation_overlay(bundle_id)
        if curation_overlay:
            bundle_artifact.update(curation_overlay)
        try:
            self._persist_bundle_artifact(
                bundle_id=bundle_id,
                bundle_artifact=bundle_artifact,
            )
        except Exception as exc:
            logger.warning("Failed to persist semantic bundle artifact %s: %s", bundle_id, exc)
        cached_record = {
            "bundle_id": bundle_id,
            "bundle_hash": bundle_hash,
            "selection_key": selection_key,
            "bundle_label": bundle_label,
            "target_table": request.target_table.model_dump(mode="json") if request.target_table else None,
            "source_tables": [item.model_dump(mode="json") for item in selected_source_tables],
            "derived_source_ids": selected_derived_ids,
            "relationships": normalized_relationships,
            "semantic_level": SemanticLevel.FULL_REGISTRY,
            "semantic_view_name": semantic_view_name,
            "semantic_model_yaml": semantic_model_yaml,
            "registry_version": registry_version,
            "raw_assets": raw_assets,
            "derived_semantics": derived_semantics,
            "excluded_relationships": excluded_relationships,
            "composition_diagnostics": composition_diagnostics,
            "bundle_artifact": bundle_artifact,
            "updated_at": datetime.now(timezone.utc),
            "status": status.value,
            "stale_reason": "; ".join(notes) or None,
        }
        with _BUNDLE_CACHE_LOCK:
            _BUNDLE_RECORD_CACHE[f"{self._access_fingerprint}:{bundle_id}"] = (
                time.monotonic(),
                copy.deepcopy(cached_record),
            )
        return response

    def _persist_bundle_artifact(
        self,
        *,
        bundle_id: str,
        bundle_artifact: dict[str, Any],
    ) -> None:
        """Persist composed bundle JSON without interpolating JSON into SQL."""
        self._session.sql(
            f"""
            UPDATE {self._bundle_table}
            SET BUNDLE_ARTIFACT = PARSE_JSON(?),
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE SEMANTIC_BUNDLE_ID = ?
            """,
            params=[
                json.dumps(bundle_artifact, default=str),
                bundle_id,
            ],
        ).collect()

    def _legacy_refresh_bundle(
        self,
        request: SemanticContextRefreshRequest,
        *,
        agent_client: SnowflakeAgentClient | None = None,
        allow_agent_refresh: bool = True,
    ) -> SemanticContextBundleResponse:
        storage_available = True
        notes: list[str] = []
        try:
            self.ensure_storage_exists()
        except Exception:
            storage_available = False
            notes.append("semantic bundle storage unavailable; using in-memory bundle resolution only")
        try:
            self._derived_source_service.ensure_table_exists()
        except Exception:
            notes.append("derived-source storage unavailable; lineage enrichment may be partial")

        selected_source_tables = _dedupe_tables(request.selected_source_tables)
        selected_derived_ids = sorted({value for value in request.selected_derived_sources if value})
        normalized_relationships = _normalize_relationships(request.relationships)

        bundle_hash = self._bundle_hash(
            selected_source_tables=selected_source_tables,
            selected_derived_sources=selected_derived_ids,
            target_table=request.target_table,
            relationships=normalized_relationships,
        )
        selection_key = self._bundle_selection_key(
            selected_source_tables=selected_source_tables,
            selected_derived_sources=selected_derived_ids,
            target_table=request.target_table,
            relationships=normalized_relationships,
        )
        stable_bundle_id = f"sem_{hashlib.sha256(selection_key.encode('utf-8')).hexdigest()[:16]}"
        bundle_label = self._bundle_label(
            selected_source_tables=selected_source_tables,
            derived_records=[],
            target_table=request.target_table,
        )
        existing = (
            self.get_bundle(bundle_id=stable_bundle_id)
            or self._find_bundle_for_selection(
                selected_source_tables=selected_source_tables,
                derived_source_ids=selected_derived_ids,
                target_table=request.target_table,
            )
        ) if storage_available else None
        bundle_id = str(existing.get("bundle_id") or stable_bundle_id) if existing else stable_bundle_id

        derived_records = self._derived_source_service.get_sources_by_ids(selected_derived_ids)
        derived_semantic_warnings = self._derived_semantic_coverage_warnings(derived_records)
        notes.extend(derived_semantic_warnings)
        bundle_label = self._bundle_label(
            selected_source_tables=selected_source_tables,
            derived_records=derived_records,
            target_table=request.target_table,
        )
        lineage = [self._lineage_from_record(record) for record in derived_records]
        datahub_context = self._datahub.build_context(
            source_tables=selected_source_tables,
            derived_source_ids=selected_derived_ids,
        )
        tables_missing_semantic_records = self._tables_missing_semantic_records(selected_source_tables)

        cache_hit = (
            existing is not None
            and not request.force
            and _LEVEL_ORDER.get(existing["semantic_level"], -1) >= _LEVEL_ORDER[request.requested_level]
            and not tables_missing_semantic_records
        )

        promoted = False
        semantic_view_name = existing["semantic_view_name"] if existing else None
        analyst_tool_name = existing.get("analyst_tool_name") if existing else None
        achieved_level = request.requested_level
        bundle_has_required_level = (
            existing is not None
            and _LEVEL_ORDER.get(existing["semantic_level"], -1) >= _LEVEL_ORDER[request.requested_level]
        )
        existing_view_is_usable = bool(
            existing
            and existing.get("semantic_view_name")
            and not request.force
            and bundle_has_required_level
        )

        if (
            allow_agent_refresh
            and not cache_hit
            and request.requested_level in {
                SemanticLevel.L2_ANALYST_READY,
                SemanticLevel.L3_MAPPING_ENRICHED,
            }
        ):
            semantic_refresh_tables = self._analyst_source_tables(selected_source_tables, derived_records)
            if agent_client is not None and semantic_refresh_tables:
                try:
                    self._semantic_model_service.ensure_tables(
                        session=self._session,
                        agent_client=agent_client,
                        tables=semantic_refresh_tables,
                        force=request.force,
                        semantic_level=request.requested_level,
                    )
                except Exception as exc:  # pragma: no cover - graceful degradation
                    logger.warning("Semantic agent refresh failed; using lightweight context: %s", exc)
                    notes.append("semantic-model refresh fell back to lightweight context")
                    achieved_level = SemanticLevel.L1_CONTEXT
            else:
                achieved_level = SemanticLevel.L1_CONTEXT
                if not semantic_refresh_tables:
                    notes.append("semantic refresh requires at least one raw source table")
                else:
                    notes.append("semantic-model agent unavailable; kept lightweight context")
        elif (
            not cache_hit
            and request.requested_level == SemanticLevel.L1_CONTEXT
            and tables_missing_semantic_records
        ):
            notes.append(
                "using lightweight semantic context for newly selected tables; full semantic enrichment can happen later"
            )
        elif (
            not allow_agent_refresh
            and request.requested_level in {
                SemanticLevel.L2_ANALYST_READY,
                SemanticLevel.L3_MAPPING_ENRICHED,
            }
            and tables_missing_semantic_records
        ):
            notes.append(
                "semantic-model refresh deferred to AGT_STTM_BUILDER; using cached semantics only during bundle preparation"
            )

        if request.requested_level in {
            SemanticLevel.L2_ANALYST_READY,
            SemanticLevel.L3_MAPPING_ENRICHED,
        }:
            semantic_view_name = self._semantic_view_name(
                bundle_id=bundle_id,
                selected_source_tables=selected_source_tables,
                derived_records=derived_records,
                target_table=request.target_table,
            )
            if existing_view_is_usable:
                semantic_view_name = existing["semantic_view_name"]
            else:
                try:
                    analyst_source_tables = self._analyst_source_tables(selected_source_tables, derived_records)
                    if not analyst_source_tables:
                        raise ValueError("analyst-ready promotion requires at least one raw source table")
                    semantic_view_name, analyst_tool_name = self._promote_semantic_view(
                        bundle_id=bundle_id,
                        semantic_view_name=semantic_view_name,
                        selected_source_tables=analyst_source_tables,
                        derived_records=derived_records,
                        relationships=normalized_relationships,
                        target_table=request.target_table,
                        semantic_level=achieved_level,
                    )
                    promoted = True
                except Exception as exc:  # pragma: no cover - graceful degradation
                    logger.warning("Semantic view promotion failed for %s: %s", bundle_id, exc)
                    semantic_view_name = existing["semantic_view_name"] if existing else None
                    analyst_tool_name = existing.get("analyst_tool_name") if existing else None
                    notes.append(f"semantic view promotion failed: {exc}")
        should_sync_analyst_tool = bool(semantic_view_name)

        if should_sync_analyst_tool and semantic_view_name:
            try:
                synced_tool_name = self._sync_builder_agent_analyst_tool(
                    bundle_id=bundle_id,
                    semantic_view_name=semantic_view_name,
                    selected_source_tables=selected_source_tables,
                    derived_records=derived_records,
                    target_table=request.target_table,
                )
                analyst_tool_name = synced_tool_name or analyst_tool_name
                if storage_available and analyst_tool_name:
                    self._persist_analyst_tool_metadata(
                        bundle_id=bundle_id,
                        semantic_view_name=semantic_view_name,
                        analyst_tool_name=analyst_tool_name,
                        selected_source_tables=selected_source_tables,
                        derived_records=derived_records,
                        semantic_level=achieved_level,
                    )
            except Exception as exc:  # pragma: no cover - agent sync should not block the main path
                logger.warning("Failed to sync semantic view %s into STTM builder agent: %s", semantic_view_name, exc)
                notes.append(f"builder agent analyst sync failed: {exc}")

        semantic_context = self._build_semantic_context_items(
            selected_source_tables=selected_source_tables,
            derived_records=derived_records,
            relationships=normalized_relationships,
            requested_level=achieved_level,
        )
        summary = SemanticContextSummary(
            bundle_id=bundle_id,
            bundle_hash=bundle_hash,
            bundle_label=bundle_label,
            source_table_count=len(selected_source_tables),
            derived_source_count=len(derived_records),
            relationship_count=len(normalized_relationships),
            semantic_level=achieved_level,
            semantic_view_name=semantic_view_name,
            promoted=promoted,
            tables=[table.qualified_name for table in selected_source_tables],
            derived_sources=[record.derived_source_id for record in derived_records],
            notes=notes,
        )

        status = (
            SemanticBundleStatus.READY
            if cache_hit
            else SemanticBundleStatus.PARTIAL if notes else SemanticBundleStatus.REFRESHED
        )
        if promoted:
            status = SemanticBundleStatus.PROMOTED

        if storage_available:
            self._upsert_bundle(
                bundle_id=bundle_id,
                bundle_hash=bundle_hash,
                selection_key=selection_key,
                bundle_label=bundle_label,
                target_table=request.target_table,
                source_tables=selected_source_tables,
                derived_source_ids=selected_derived_ids,
                relationships=normalized_relationships,
                semantic_level=achieved_level,
                semantic_view_name=semantic_view_name,
                semantic_model_yaml=None,
                analyst_tool_name=analyst_tool_name,
                status=status,
                stale_reason="; ".join(notes) or None,
                datahub_context=datahub_context,
            )
            if selected_derived_ids:
                try:
                    self._derived_source_service.update_semantic_metadata(
                        source_ids=selected_derived_ids,
                        semantic_bundle_id=bundle_id,
                        semantic_view_name=semantic_view_name,
                        semantic_level=achieved_level.value,
                    )
                except Exception as exc:  # pragma: no cover - best effort
                    logger.warning("Failed to update derived-source semantic metadata for %s: %s", bundle_id, exc)
                    notes.append("derived-source semantic metadata update failed")
            try:
                self._delete_duplicate_bundles_for_selection(
                    bundle_id=bundle_id,
                    selected_source_tables=selected_source_tables,
                    derived_source_ids=selected_derived_ids,
                    target_table=request.target_table,
                )
            except Exception as exc:  # pragma: no cover - best effort
                logger.warning("Failed to clean duplicate semantic bundles for %s: %s", bundle_id, exc)

        return SemanticContextBundleResponse(
            bundle_id=bundle_id,
            bundle_hash=bundle_hash,
            bundle_label=bundle_label,
            requested_level=request.requested_level,
            achieved_level=achieved_level,
            semantic_view_name=semantic_view_name,
            status=status,
            promoted=promoted,
            cache_hit=cache_hit,
            summary=summary,
            lineage=lineage,
            semantic_context=[item.model_dump(mode="json") for item in semantic_context],
            warnings=derived_semantic_warnings,
            datahub_context=datahub_context,
        )

    @staticmethod
    def _derived_semantic_coverage_warnings(derived_records: list[Any]) -> list[str]:
        warnings: list[str] = []
        for record in derived_records:
            projection = getattr(record, "semantic_projection", None)
            quality = str(getattr(record, "semantic_quality", None) or "").lower()
            if not quality and isinstance(projection, dict):
                quality = str(projection.get("semantic_quality") or "").lower()
            if quality == "complete":
                continue
            issues = (
                projection.get("semantic_coverage_issues", [])
                if isinstance(projection, dict)
                else []
            )
            reason = "; ".join(str(item) for item in issues if item) or "semantic contract is incomplete"
            warnings.append(
                f"Derived source {record.derived_source_id} is not valid as authoritative L3 semantic evidence: {reason}"
            )
        return warnings

    def get_bundle(
        self,
        *,
        bundle_id: str | None = None,
        bundle_hash: str | None = None,
        selection_key: str | None = None,
    ) -> dict[str, Any] | None:
        if not bundle_id and not bundle_hash and not selection_key:
            return None
        now = time.monotonic()
        with _BUNDLE_CACHE_LOCK:
            for cache_key, (created_at, record) in _BUNDLE_RECORD_CACHE.items():
                if not cache_key.startswith(f"{self._access_fingerprint}:"):
                    continue
                if now - created_at > _BUNDLE_CACHE_IDLE_SECONDS:
                    continue
                matches = (
                    (bundle_id is not None and str(record.get("bundle_id") or "") == bundle_id)
                    or (bundle_hash is not None and str(record.get("bundle_hash") or "") == bundle_hash)
                    or (selection_key is not None and str(record.get("selection_key") or "") == selection_key)
                )
                if not matches:
                    continue
                return copy.deepcopy(record)
        predicates = []
        if bundle_id:
            predicates.append(f"SEMANTIC_BUNDLE_ID = {_quote_literal(bundle_id)}")
        if bundle_hash:
            predicates.append(f"BUNDLE_HASH = {_quote_literal(bundle_hash)}")
        if selection_key:
            predicates.append(f"SELECTION_KEY = {_quote_literal(selection_key)}")
        try:
            rows = self._session.sql(
                f"""
                SELECT *
                FROM {self._bundle_table}
                WHERE {" OR ".join(predicates)}
                ORDER BY LAST_GENERATED_AT DESC
                LIMIT 1
                """
            ).collect()
        except Exception:
            return None
        if not rows:
            return None
        record = self._bundle_row_to_dict(rows[0].as_dict())
        record_id = str(record.get("bundle_id") or "")
        if record_id:
            with _BUNDLE_CACHE_LOCK:
                _BUNDLE_RECORD_CACHE[f"{self._access_fingerprint}:{record_id}"] = (
                    time.monotonic(),
                    copy.deepcopy(record),
                )
        return record

    def get_projection(self, request: SemanticProjectionRequest) -> SemanticProjectionResponse:
        bundle = self.get_bundle(bundle_id=request.bundle_id, bundle_hash=request.bundle_hash)
        if not bundle:
            raise SemanticAssetNotFoundError(
                "Semantic bundle was not found for projection request.",
                details=[{"field": "semantic_bundle", "message": request.bundle_id or request.bundle_hash or ""}],
            )

        projection_key_payload = {
            "bundle_id": bundle.get("bundle_id"),
            "bundle_hash": bundle.get("bundle_hash"),
            "profile": request.profile.value,
            "target_columns": sorted({column.upper() for column in request.target_columns}),
            "source_columns_by_table": {
                str(table).upper(): sorted({str(column).upper() for column in columns})
                for table, columns in sorted(request.source_columns_by_table.items())
            },
            "mapping_row": request.mapping_row or {},
            "include_full_semantics": bool(request.include_full_semantics),
        }
        projection_key = hashlib.sha256(
            json.dumps(projection_key_payload, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

        if not request.force:
            cached = self._get_cached_projection(projection_key=projection_key)
            if cached:
                cached["cache_hit"] = True
                return SemanticProjectionResponse(**cached)

        source_tables = [
            table
            for item in bundle.get("source_tables", [])
            if (table := _table_ref_from_payload(item)) is not None
        ]
        target_table = _table_ref_from_payload(bundle.get("target_table"))
        all_tables = list(source_tables)
        if target_table and all(target_table.qualified_name.upper() != table.qualified_name.upper() for table in all_tables):
            all_tables.append(target_table)

        derived_records = self._derived_source_service.get_sources_by_ids(
            [str(value) for value in bundle.get("derived_source_ids", []) if value]
        )
        table_records = self._semantic_model_service.get_table_records(self._session, all_tables)
        records_by_fqn = {
            f"{record.get('database')}.{record.get('schema_name')}.{record.get('table_name')}".upper(): record
            for record in table_records
            if record.get("table_name")
        }
        relationships = list(bundle.get("relationships") or [])

        payload = self._build_projection_payload(
            profile=request.profile,
            bundle=bundle,
            source_tables=source_tables,
            target_table=target_table,
            derived_records=derived_records,
            table_records_by_fqn=records_by_fqn,
            relationships=relationships,
            target_columns=request.target_columns,
            source_columns_by_table=request.source_columns_by_table,
            mapping_row=request.mapping_row or {},
            include_full_semantics=request.include_full_semantics,
        )
        projection_hash = hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        projection = {
            "projection_id": f"proj_{projection_key[:16]}",
            "projection_key": projection_key,
            "projection_profile": request.profile.value,
            "semantic_bundle_id": bundle.get("bundle_id"),
            "bundle_hash": bundle.get("bundle_hash"),
            "projection_hash": projection_hash,
            "cache_hit": False,
            "payload": payload,
        }
        self._upsert_projection(projection)
        return SemanticProjectionResponse(**projection)

    def ensure_storage_exists(self) -> None:
        try:
            self._session.sql(
                f"""
                CREATE TABLE IF NOT EXISTS {self._bundle_table} (
                    SEMANTIC_BUNDLE_ID STRING,
                    BUNDLE_HASH STRING,
                    SELECTION_KEY STRING,
                    BUNDLE_LABEL STRING,
                    TARGET_TABLE VARIANT,
                    SOURCE_TABLES VARIANT,
                    DERIVED_SOURCE_IDS VARIANT,
                    RELATIONSHIPS VARIANT,
                    SEMANTIC_LEVEL STRING,
                    SEMANTIC_VIEW_NAME STRING,
                    ANALYST_TOOL_NAME STRING,
                    SEMANTIC_MODEL_YAML STRING,
                    REGISTRY_VERSION STRING,
                    RAW_ASSETS VARIANT,
                    DERIVED_SEMANTICS VARIANT,
                    EXCLUDED_RELATIONSHIPS VARIANT,
                    COMPOSITION_DIAGNOSTICS VARIANT,
                    BUNDLE_ARTIFACT VARIANT,
                    STATUS STRING,
                    STALE_REASON STRING,
                    DATAHUB_CONTEXT VARIANT,
                    LAST_GENERATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                    LAST_PROMOTED_AT TIMESTAMP_NTZ,
                    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
                )
                """
            ).collect()
            for column, data_type in (
                ("REGISTRY_VERSION", "STRING"),
                ("RAW_ASSETS", "VARIANT"),
                ("DERIVED_SEMANTICS", "VARIANT"),
                ("EXCLUDED_RELATIONSHIPS", "VARIANT"),
                ("COMPOSITION_DIAGNOSTICS", "VARIANT"),
                ("BUNDLE_ARTIFACT", "VARIANT"),
            ):
                self._session.sql(
                    f"ALTER TABLE {self._bundle_table} ADD COLUMN IF NOT EXISTS {column} {data_type}"
                ).collect()
            self._session.sql(
                f"""
                CREATE TABLE IF NOT EXISTS {self._projection_table} (
                    PROJECTION_ID STRING,
                    PROJECTION_KEY STRING,
                    PROJECTION_PROFILE STRING,
                    SOURCE_VIEW_ID STRING,
                    SOURCE_FQN STRING,
                    SEMANTIC_BUNDLE_ID STRING,
                    BUNDLE_HASH STRING,
                    ASSET_VERSION STRING,
                    PROJECTION_HASH STRING,
                    PROJECTION_PAYLOAD VARIANT,
                    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
                )
                """
            ).collect()
            self._session.sql(
                f"""
                CREATE TABLE IF NOT EXISTS {self._overrides_table} (
                    OVERRIDE_ID STRING,
                    SEMANTIC_BUNDLE_ID STRING,
                    OBJECT_SCOPE STRING,
                    OBJECT_KEY STRING,
                    OVERRIDE_TYPE STRING,
                    OVERRIDE_VALUE VARIANT,
                    CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
                )
                """
            ).collect()
        except Exception as exc:
            logger.warning("Semantic bundle storage setup skipped: %s", exc)
            raise

    def _get_cached_projection(self, *, projection_key: str) -> dict[str, Any] | None:
        try:
            self.ensure_storage_exists()
            rows = self._session.sql(
                f"""
                SELECT *
                FROM {self._projection_table}
                WHERE PROJECTION_KEY = {_quote_literal(projection_key)}
                ORDER BY UPDATED_AT DESC
                LIMIT 1
                """
            ).collect()
        except Exception:
            return None
        if not rows:
            return None
        data = rows[0].as_dict()
        return {
            "projection_id": data.get("PROJECTION_ID"),
            "projection_key": data.get("PROJECTION_KEY"),
            "projection_profile": data.get("PROJECTION_PROFILE"),
            "semantic_bundle_id": data.get("SEMANTIC_BUNDLE_ID") or None,
            "bundle_hash": data.get("BUNDLE_HASH") or None,
            "projection_hash": data.get("PROJECTION_HASH") or "",
            "cache_hit": True,
            "payload": _variant_to_python(data.get("PROJECTION_PAYLOAD")) or {},
        }

    def _upsert_projection(self, projection: dict[str, Any]) -> None:
        try:
            self.ensure_storage_exists()
            self._session.sql(
                f"""
                MERGE INTO {self._projection_table} AS target
                USING (
                    SELECT
                        {_quote_literal(str(projection["projection_id"]))} AS PROJECTION_ID,
                        {_quote_literal(str(projection["projection_key"]))} AS PROJECTION_KEY,
                        {_quote_literal(str(projection["projection_profile"]))} AS PROJECTION_PROFILE,
                        {_quote_literal(str(projection.get("semantic_bundle_id") or ""))} AS SEMANTIC_BUNDLE_ID,
                        {_quote_literal(str(projection.get("bundle_hash") or ""))} AS BUNDLE_HASH,
                        {_quote_literal(str(projection.get("projection_hash") or ""))} AS PROJECTION_HASH,
                        PARSE_JSON(?) AS PROJECTION_PAYLOAD
                ) AS source
                ON target.PROJECTION_KEY = source.PROJECTION_KEY
                WHEN MATCHED THEN UPDATE SET
                    PROJECTION_ID = source.PROJECTION_ID,
                    PROJECTION_PROFILE = source.PROJECTION_PROFILE,
                    SEMANTIC_BUNDLE_ID = source.SEMANTIC_BUNDLE_ID,
                    BUNDLE_HASH = source.BUNDLE_HASH,
                    PROJECTION_HASH = source.PROJECTION_HASH,
                    PROJECTION_PAYLOAD = source.PROJECTION_PAYLOAD,
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT (
                    PROJECTION_ID,
                    PROJECTION_KEY,
                    PROJECTION_PROFILE,
                    SEMANTIC_BUNDLE_ID,
                    BUNDLE_HASH,
                    PROJECTION_HASH,
                    PROJECTION_PAYLOAD,
                    CREATED_AT,
                    UPDATED_AT
                ) VALUES (
                    source.PROJECTION_ID,
                    source.PROJECTION_KEY,
                    source.PROJECTION_PROFILE,
                    source.SEMANTIC_BUNDLE_ID,
                    source.BUNDLE_HASH,
                    source.PROJECTION_HASH,
                    source.PROJECTION_PAYLOAD,
                    CURRENT_TIMESTAMP(),
                    CURRENT_TIMESTAMP()
                )
                """,
                params=[
                    json.dumps(projection.get("payload") or {}, default=str),
                ],
            ).collect()
        except Exception as exc:  # pragma: no cover - projection cache is best-effort
            logger.warning("Failed to cache semantic projection %s: %s", projection.get("projection_id"), exc)

    def _build_projection_payload(
        self,
        *,
        profile: SemanticProjectionProfile,
        bundle: dict[str, Any],
        source_tables: list[TableRef],
        target_table: TableRef | None,
        derived_records: list[Any],
        table_records_by_fqn: dict[str, dict[str, Any]],
        relationships: list[dict[str, Any]],
        target_columns: list[str],
        source_columns_by_table: dict[str, list[str]],
        mapping_row: dict[str, Any],
        include_full_semantics: bool,
    ) -> dict[str, Any]:
        role_map = self._projection_role_map(source_tables=source_tables, target_table=target_table)
        compact_tables = []
        for table in [*source_tables, *([target_table] if target_table else [])]:
            record = table_records_by_fqn.get(table.qualified_name.upper())
            if record:
                projected = self._compact_table_semantic_projection(
                    table=table,
                    table_record=record,
                    relationships=relationships,
                    requested_level=SemanticLevel.L3_MAPPING_ENRICHED,
                )
            else:
                projected = {"projection_profile": "missing_asset", "description": "Semantic asset is not available."}
            projected["table_role"] = role_map.get(table.qualified_name.upper(), "source")
            projected["fqn"] = table.qualified_name
            compact_tables.append(projected)

        derived_context = [
            self._derived_source_semantic_projection(record=record, requested_level=SemanticLevel.L3_MAPPING_ENRICHED)
            for record in derived_records
        ]
        base_payload: dict[str, Any] = {
            "semantic_bundle_id": bundle.get("bundle_id"),
            "bundle_hash": bundle.get("bundle_hash"),
            "bundle_label": bundle.get("bundle_label"),
            "profile": profile.value,
            "source_tables": [table.model_dump(mode="json") for table in source_tables],
            "target_table": target_table.model_dump(mode="json") if target_table else None,
            "roles": role_map,
            "relationships": relationships,
            "derived_sources": derived_context,
        }

        if profile == SemanticProjectionProfile.CHAT_SUMMARY:
            base_payload["tables"] = [
                {
                    "fqn": table.get("fqn"),
                    "role": table.get("table_role"),
                    "description": table.get("description"),
                    "domain_summary": table.get("domain_summary"),
                    "notable_columns": [
                        attribute
                        for attribute in table.get("attributes", [])[:12]
                        if isinstance(attribute, dict)
                    ],
                    "relationships": table.get("relationships"),
                }
                for table in compact_tables
            ]
            return base_payload

        if profile == SemanticProjectionProfile.ANALYST_MODEL:
            base_payload["semantic_model_yaml"] = bundle.get("semantic_model_yaml")
            base_payload["semantic_model_hash"] = hashlib.sha256(
                str(bundle.get("semantic_model_yaml") or "").encode("utf-8")
            ).hexdigest()
            return base_payload

        if profile == SemanticProjectionProfile.MAPPING_BATCH:
            target_set = {column.upper() for column in target_columns}
            base_payload["target_columns"] = list(target_columns)
            base_payload["tables"] = [
                self._filter_projection_columns(
                    table,
                    selected_columns=target_set if table.get("table_role") == "target" else set(),
                    fallback_limit=16 if table.get("table_role") == "target" else 40,
                )
                for table in compact_tables
            ]
            base_payload["source_column_scope"] = source_columns_by_table
            return base_payload

        if profile == SemanticProjectionProfile.TRANSFORMATION_ROW:
            source_scope = {
                key.upper(): {column.upper() for column in value}
                for key, value in source_columns_by_table.items()
            }
            base_payload["mapping_row"] = mapping_row
            base_payload["tables"] = [
                self._filter_projection_columns(
                    table,
                    selected_columns=source_scope.get(str(table.get("fqn") or "").upper(), set()),
                    fallback_limit=20,
                )
                for table in compact_tables
            ]
            return base_payload

        if profile == SemanticProjectionProfile.DERIVED_SOURCE:
            base_payload["tables"] = compact_tables
            base_payload["selected_columns_by_table"] = source_columns_by_table
            return base_payload

        if profile == SemanticProjectionProfile.ADMIN_FULL:
            base_payload["compact_tables"] = compact_tables
            if include_full_semantics:
                base_payload["full_semantics"] = {
                    fqn: record.get("semantic_model")
                    for fqn, record in table_records_by_fqn.items()
                }
            else:
                base_payload["full_semantics_available_by_reference"] = True
            return base_payload

        base_payload["tables"] = compact_tables
        return base_payload

    @staticmethod
    def _projection_role_map(
        *,
        source_tables: list[TableRef],
        target_table: TableRef | None,
    ) -> dict[str, str]:
        roles = {table.qualified_name.upper(): "source" for table in source_tables}
        if target_table:
            roles[target_table.qualified_name.upper()] = "target"
        if source_tables:
            roles.setdefault(source_tables[0].qualified_name.upper(), "driving_source")
        return roles

    @staticmethod
    def _filter_projection_columns(
        projection: dict[str, Any],
        *,
        selected_columns: set[str],
        fallback_limit: int,
    ) -> dict[str, Any]:
        cloned = dict(projection)
        attributes = [item for item in projection.get("attributes", []) if isinstance(item, dict)]
        if selected_columns:
            filtered = [
                attribute
                for attribute in attributes
                if str(attribute.get("name") or "").upper() in selected_columns
            ]
            cloned["attributes"] = filtered or attributes[:fallback_limit]
        else:
            cloned["attributes"] = attributes[:fallback_limit]
        cloned["attribute_count"] = len(attributes)
        return cloned

    def _build_semantic_context_items(
        self,
        *,
        selected_source_tables: list[TableRef],
        derived_records: list[Any],
        relationships: list[dict[str, Any]],
        requested_level: SemanticLevel,
    ) -> list[SemanticContextItem]:
        table_records = self._semantic_model_service.get_table_records(
            self._session,
            selected_source_tables,
        )
        table_records_by_name = {
            f"{record['database']}.{record['schema_name']}.{record['table_name']}".upper(): record
            for record in table_records
            if record.get("table_name")
        }

        context_items: list[SemanticContextItem] = []
        for table in selected_source_tables:
            qualified_name = table.qualified_name
            record = table_records_by_name.get(qualified_name)
            if record:
                context_items.append(
                    SemanticContextItem(
                        table=table,
                        semantic_model=self._compact_table_semantic_projection(
                            table=table,
                            table_record=record,
                            relationships=relationships,
                            requested_level=requested_level,
                        ),
                        scope=str(record["scope"]),
                    )
                )
                continue

            columns = self._table_selection_service.list_attributes_for_tables([qualified_name])[0].columns
            relationship_matches = [
                relation
                for relation in relationships
                if relation.get("left_table", {}).get("table") == table.table
                or relation.get("right_table", {}).get("table") == table.table
            ]
            heuristic_description, heuristic_domain_summary = self._heuristic_semantic_summary(
                table=table,
                columns=columns,
                relationships=relationship_matches,
            )
            context_items.append(
                SemanticContextItem(
                    table=table,
                    scope="TABLE",
                    semantic_model={
                        "description": heuristic_description,
                        "domain_summary": heuristic_domain_summary,
                        "semantic_level": requested_level.value,
                        "attributes": [
                            {
                                "name": column.column_name,
                                "data_type": column.data_type,
                                "is_primary_key": column.is_primary_key,
                                "is_foreign_key": column.is_foreign_key,
                            }
                            for column in columns
                        ],
                        "relationships": relationship_matches,
                    },
                )
            )

        for record in derived_records:
            table_ref = self._derived_table_ref(record)
            context_items.append(
                SemanticContextItem(
                    table=table_ref,
                    scope="DERIVED_SOURCE",
                    semantic_model=self._derived_source_semantic_projection(
                        record=record,
                        requested_level=requested_level,
                    ),
                )
            )
        return context_items

    def _compact_table_semantic_projection(
        self,
        *,
        table: TableRef,
        table_record: dict[str, Any],
        relationships: list[dict[str, Any]],
        requested_level: SemanticLevel,
    ) -> dict[str, Any]:
        """Project rich V2 semantics into a compact agent-ready context.

        SEM_TABLE_VIEWS may contain large samples, evidence blocks, profiling
        payloads, and full generated JSON. We keep enough for routing, mapping,
        transformation, and Analyst composition while passing durable registry
        references for any deep drill-down.
        """
        semantic_model = table_record.get("semantic_model")
        if not isinstance(semantic_model, dict):
            return {"semantic_level": requested_level.value}

        registry = (
            table_record.get("semantic_registry")
            if isinstance(table_record.get("semantic_registry"), dict)
            else semantic_model.get("semantic_registry")
        )
        attributes = self._attributes_for_table(
            table=table,
            table_record=table_record,
            derived_record=None,
        )
        relationship_model = semantic_model.get("relationship_candidates") or semantic_model.get("relationships")
        selected_relationships = [
            relation
            for relation in relationships
            if relation.get("left_table", {}).get("table") == table.table
            or relation.get("right_table", {}).get("table") == table.table
        ]

        def _trim_attribute(attribute: dict[str, Any]) -> dict[str, Any]:
            return {
                "name": attribute.get("name"),
                "data_type": attribute.get("data_type"),
                "summary": attribute.get("summary") or attribute.get("description"),
                "business_meaning": attribute.get("business_meaning"),
                "semantic_role": attribute.get("semantic_role"),
                "default_aggregation": attribute.get("default_aggregation"),
                "synonyms": attribute.get("synonyms") or [],
                "constraints": attribute.get("constraints") or [],
                "is_primary_key": attribute.get("is_primary_key"),
                "is_foreign_key": attribute.get("is_foreign_key"),
                "value_profile": _trim_value_profile(attribute.get("value_profile")),
            }

        projection: dict[str, Any] = {
            "projection_profile": "agent_compact",
            "projection_source": semantic_model.get("_projection_source") or table_record.get("semantic_source") or "semantic_registry",
            "semantic_level": "L3_MAPPING_ENRICHED",
            "table_role_hint": "source_or_target_resolved_by_bundle",
            "description": _first_non_empty(
                semantic_model.get("description"),
                semantic_model.get("domain_summary"),
                f"{table.table} semantic asset from the registry.",
            ),
            "domain_summary": semantic_model.get("domain_summary"),
            "business_context": semantic_model.get("business_context"),
            "grain": semantic_model.get("grain"),
            "pk_detection": semantic_model.get("pk_detection"),
            "semantic_registry": registry or {},
            "semantic_view": semantic_model.get("semantic_view") if isinstance(semantic_model.get("semantic_view"), dict) else {},
            "attributes": [_trim_attribute(attribute) for attribute in attributes],
            "relationships": _compact_relationship_model(relationship_model),
            "selected_ui_relationships": selected_relationships,
            "metrics": _compact_named_list(semantic_model.get("metrics")),
            "verified_queries": _compact_named_list(semantic_model.get("verified_queries")),
            "custom_instructions": semantic_model.get("custom_instructions") or semantic_model.get("module_custom_instructions"),
        }
        return {key: value for key, value in projection.items() if value not in (None, "", [], {})}

    @staticmethod
    def _derived_source_semantic_projection(
        *,
        record: Any,
        requested_level: SemanticLevel,
    ) -> dict[str, Any]:
        projection = getattr(record, "semantic_projection", None)
        if isinstance(projection, dict) and projection:
            return projection
        return {
            "projection_profile": "derived_source_virtual",
            "semantic_level": requested_level.value,
            "table_role_hint": "derived_source",
            "description": getattr(record, "business_description", None)
            or f"Derived source {record.derived_source_name}",
            "purpose": getattr(record, "purpose", None),
            "grain": getattr(record, "grain", None),
            "keys": getattr(record, "keys", None) or [],
            "sql_text": record.sql_text,
            "physical_view_name": getattr(record, "physical_view_name", None),
            "derived_source_id": getattr(record, "derived_source_id", None),
            "parent_derived_source_ids": record.parent_derived_source_ids,
            "base_source_tables": [table.model_dump(mode="json") for table in record.base_source_tables],
            "source_tables": [table.model_dump(mode="json") for table in record.source_tables],
            "relationships": [item.model_dump(mode="json") if hasattr(item, "model_dump") else item for item in record.relationships],
            "filters": record.filters,
            "selected_columns_by_table": record.selected_columns_by_table,
            "preview_columns": [column.model_dump(mode="json") for column in record.preview_columns],
            "output_columns": getattr(record, "output_columns", None) or [
                column.model_dump(mode="json") for column in record.preview_columns
            ],
            "column_semantics": getattr(record, "column_semantics", None) or [],
            "upstream_hash": record.upstream_hash,
            "source_dependency_hash": getattr(record, "source_dependency_hash", None),
            "semantic_quality": getattr(record, "semantic_quality", "incomplete"),
            "semantic_coverage_issues": [],
        }

    def _heuristic_semantic_summary(
        self,
        *,
        table: TableRef,
        columns: list[Any],
        relationships: list[dict[str, Any]],
    ) -> tuple[str, str]:
        table_name = table.table.upper()
        column_names = {str(column.column_name).upper() for column in columns}

        if "ROW_COUNT" in column_names and "CAPTURED_DATETIME" in column_names:
            return (
                "Stores profiling snapshots and structural metadata captured for source tables during STTM analysis.",
                "Operational metadata used for profiling freshness, row-count checks, DDL tracking, and schema-drift monitoring.",
            )

        if {"NOTE_TEXT", "NOTABLE_ID", "NOTABLE_TYPE"} & column_names:
            return (
                "Stores notes, comments, or activity records linked to business entities through a polymorphic association.",
                "Free-text operational context that can explain workflow activity, review notes, or audit commentary around domain records.",
            )

        if "STATUS" in column_names and any(name.endswith("_ID") for name in column_names):
            return (
                f"Represents a lifecycle-managed business entity in the {table.schema} domain, with identifiers, status, and audit-style fields.",
                "Useful for operational tracking, workflow state analysis, and connecting related records across the migration model.",
            )

        relationship_hint = ""
        if relationships:
            relationship_hint = " It participates in the current relationship graph and may provide join context for neighboring tables."

        readable_name = table.table.replace("_", " ").title()
        return (
            f"{readable_name} is part of the selected STTM working set.{relationship_hint}",
            "Use the column names and joins to interpret its role in the selected bundle; deeper semantics can be enriched over time.",
        )

    def _tables_missing_semantic_records(
        self,
        tables: list[TableRef],
    ) -> list[TableRef]:
        if not tables:
            return []
        existing_records = self._semantic_model_service.get_table_records(
            self._session,
            tables,
        )
        existing_names = {
            f"{record['database']}.{record['schema_name']}.{record['table_name']}"
            for record in existing_records
            if record.get("table_name")
        }
        return [table for table in tables if table.qualified_name not in existing_names]

    def _promote_semantic_view(
        self,
        *,
        bundle_id: str,
        semantic_view_name: str,
        selected_source_tables: list[TableRef],
        derived_records: list[Any],
        relationships: list[dict[str, Any]],
        target_table: TableRef | None,
        semantic_level: SemanticLevel,
    ) -> tuple[str, str | None]:
        yaml_spec = self._build_semantic_view_yaml(
            bundle_id=bundle_id,
            semantic_view_name=semantic_view_name,
            selected_source_tables=selected_source_tables,
            derived_records=derived_records,
            relationships=relationships,
            target_table=target_table,
            semantic_level=semantic_level,
        )
        schema_fqn = (
            f"{self._settings.resolved_metadata_database}."
            f"{self._settings.resolved_metadata_schema}"
        )
        yaml_sql = yaml_spec.replace("$$", "$ $")
        self._session.sql(
            f"""
            CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML(
              {_quote_literal(schema_fqn)},
              $${yaml_sql}$$,
              TRUE
            )
            """
        ).collect()
        self._session.sql(
            f"""
            CALL SYSTEM$CREATE_SEMANTIC_VIEW_FROM_YAML(
              {_quote_literal(schema_fqn)},
              $${yaml_sql}$$,
              FALSE
            )
            """
        ).collect()
        analyst_tool_name = self._sync_builder_agent_analyst_tool(
            bundle_id=bundle_id,
            semantic_view_name=semantic_view_name,
            selected_source_tables=selected_source_tables,
            derived_records=derived_records,
            target_table=target_table,
        )
        self._persist_semantic_view_metadata(
            bundle_id=bundle_id,
            semantic_view_name=semantic_view_name,
            yaml_spec=yaml_spec,
            selected_source_tables=selected_source_tables,
            derived_records=derived_records,
            semantic_level=semantic_level,
            analyst_tool_name=analyst_tool_name,
        )
        return semantic_view_name, analyst_tool_name

    def _build_semantic_view_yaml(
        self,
        *,
        bundle_id: str,
        semantic_view_name: str,
        selected_source_tables: list[TableRef],
        derived_records: list[Any],
        relationships: list[dict[str, Any]],
        target_table: TableRef | None,
        semantic_level: SemanticLevel,
        excluded_relationships: list[dict[str, Any]] | None = None,
        table_records: list[dict[str, Any]] | None = None,
        raw_assets: list[dict[str, Any]] | None = None,
        composition_diagnostics: list[dict[str, Any]] | None = None,
        derived_semantics: list[dict[str, Any]] | None = None,
    ) -> str:
        analyst_source_tables = self._analyst_source_tables(selected_source_tables, derived_records)
        if not analyst_source_tables:
            raise ValueError("semantic view promotion requires at least one raw or derived-backed source table")
        table_records = table_records or self._semantic_model_service.get_table_records(
            self._session, analyst_source_tables
        )
        return self._compose_authoritative_yaml(
            semantic_view_name=semantic_view_name,
            selected_tables=analyst_source_tables,
            table_records=table_records,
            derived_records=derived_records,
            explicit_relationships=relationships,
            target_table=target_table,
            excluded_relationships=excluded_relationships,
            raw_assets=raw_assets,
            composition_diagnostics=composition_diagnostics,
            derived_semantics=derived_semantics,
        )

    def _compose_authoritative_yaml(
        self,
        *,
        semantic_view_name: str,
        selected_tables: list[TableRef],
        table_records: list[dict[str, Any]],
        derived_records: list[Any],
        explicit_relationships: list[dict[str, Any]],
        target_table: TableRef | None,
        excluded_relationships: list[dict[str, Any]] | None,
        raw_assets: list[dict[str, Any]] | None,
        composition_diagnostics: list[dict[str, Any]] | None,
        derived_semantics: list[dict[str, Any]] | None,
    ) -> str:
        """Compose selected authoritative YAML without reconstructing semantic entities."""
        raw_assets = raw_assets if raw_assets is not None else []
        diagnostics = composition_diagnostics if composition_diagnostics is not None else []
        derived_semantics = derived_semantics if derived_semantics is not None else []
        for derived in derived_records:
            derived_semantics.append(
                {
                    "derived_source_id": getattr(derived, "derived_source_id", None),
                    "derived_source_name": getattr(derived, "derived_source_name", None),
                    "purpose": getattr(derived, "purpose", None),
                    "business_description": getattr(derived, "business_description", None),
                    "row_grain": getattr(derived, "grain", None),
                    "keys": copy.deepcopy(getattr(derived, "keys", None) or []),
                    "output_columns": copy.deepcopy(
                        getattr(derived, "output_columns", None) or []
                    ),
                    "column_semantics": copy.deepcopy(
                        getattr(derived, "column_semantics", None) or []
                    ),
                    "semantic_projection": copy.deepcopy(
                        getattr(derived, "semantic_projection", None) or {}
                    ),
                    "physical_view_name": getattr(derived, "physical_view_name", None),
                    "saved_sql": getattr(derived, "sql_text", None),
                    "source_tables": [
                        table.model_dump(mode="json")
                        if hasattr(table, "model_dump")
                        else copy.deepcopy(table)
                        for table in (getattr(derived, "source_tables", None) or [])
                    ],
                    "parent_derived_source_ids": copy.deepcopy(
                        getattr(derived, "parent_derived_source_ids", None) or []
                    ),
                    "upstream_hash": getattr(derived, "upstream_hash", None),
                    "source_dependency_hash": getattr(
                        derived, "source_dependency_hash", None
                    ),
                    "semantic_quality": getattr(derived, "semantic_quality", None),
                }
            )
        records_by_fqn = {
            f"{item.get('database')}.{item.get('schema_name')}.{item.get('table_name')}".upper(): item
            for item in table_records
        }
        selected_fqns = {table.qualified_name.upper() for table in selected_tables}
        logical_by_fqn: dict[str, str] = {}
        authored_logical_by_fqn: dict[str, str] = {}
        used_logical: dict[str, str] = {}
        composed_tables: list[dict[str, Any]] = []
        documents: list[tuple[str, dict[str, Any]]] = []

        for table in selected_tables:
            fqn = table.qualified_name.upper()
            record = records_by_fqn.get(fqn)
            semantic_model = record.get("semantic_model") if isinstance(record, dict) else None
            semantic_view = semantic_model.get("semantic_view") if isinstance(semantic_model, dict) else None
            native_view = semantic_model.get("native_semantic_view") if isinstance(semantic_model, dict) else None
            raw_yaml = (
                native_view.get("ca_yaml_model")
                if isinstance(native_view, dict) and native_view.get("ca_yaml_model")
                else (
                    semantic_view.get("yaml")
                    if isinstance(semantic_view, dict)
                    and str(semantic_view.get("source") or "").upper() == "SEM_NATIVE_VIEWS"
                    else None
                )
            )
            document: dict[str, Any] | None = None
            if isinstance(raw_yaml, str) and raw_yaml.strip():
                loaded = yaml.safe_load(raw_yaml)
                if not isinstance(loaded, dict):
                    raise ValueError(f"Authoritative semantic YAML is not an object for {table.qualified_name}")
                document = loaded
                raw_assets.append(
                    {
                        "fqn": table.qualified_name,
                        "yaml": raw_yaml,
                        "yaml_hash": semantic_view.get("yaml_hash")
                        or hashlib.sha256(raw_yaml.encode("utf-8")).hexdigest(),
                        "source": getattr(
                            getattr(self, "_settings", None),
                            "resolved_semantic_native_views_table",
                            "native_semantic_registry",
                        ),
                    }
                )
                documents.append((fqn, document))

            selected_block: dict[str, Any] | None = None
            if document:
                for candidate in document.get("tables") or []:
                    if not isinstance(candidate, dict):
                        continue
                    base = candidate.get("base_table") or {}
                    candidate_fqn = (
                        f"{base.get('database')}.{base.get('schema')}.{base.get('table')}".upper()
                    )
                    if candidate_fqn == fqn:
                        selected_block = copy.deepcopy(candidate)
                        break

            if selected_block is None:
                derived = next(
                    (
                        item for item in derived_records
                        if str(getattr(item, "physical_view_name", "") or "").upper() == fqn
                    ),
                    None,
                )
                if derived is None:
                    raise ValueError(
                        "Authoritative native semantic YAML is unavailable or has no table definition for "
                        f"{table.qualified_name}"
                    )
                selected_block = self._build_yaml_table(
                    logical_name=_logical_table_name(table),
                    table=table,
                    table_record=record,
                    derived_record=derived,
                )

            old_name = str(selected_block.get("name") or _logical_table_name(table))
            authored_logical_by_fqn[fqn] = old_name
            new_name = old_name
            if old_name.upper() in used_logical and used_logical[old_name.upper()] != fqn:
                new_name = f"{old_name}_{hashlib.sha256(fqn.encode()).hexdigest()[:8]}"
                diagnostics.append(
                    {
                        "type": "logical_name_conflict",
                        "name": old_name,
                        "fqn": table.qualified_name,
                        "resolved_name": new_name,
                    }
                )
            used_logical[new_name.upper()] = fqn
            logical_by_fqn[fqn] = new_name
            selected_block = self._rename_logical_reference(selected_block, old_name, new_name)
            selected_block["name"] = new_name
            composed_tables.append(selected_block)

        payload: dict[str, Any] = {
            "name": semantic_view_name.rsplit(".", 1)[-1],
            "description": self._bundle_label(
                selected_source_tables=selected_tables,
                derived_records=derived_records,
                target_table=target_table,
            ),
            "tables": composed_tables,
        }
        reserved = {"name", "description", "tables", "relationships", "custom_instructions", "module_custom_instructions"}
        for source_fqn, document in documents:
            for key, value in document.items():
                if key in reserved:
                    continue
                self._merge_top_level_definition(payload, key, value, source_fqn, diagnostics)

        authored_relationships: list[dict[str, Any]] = []
        for source_fqn, document in documents:
            for relationship in document.get("relationships") or []:
                if isinstance(relationship, dict):
                    rewritten = copy.deepcopy(relationship)
                    for fqn, old_name in authored_logical_by_fqn.items():
                        rewritten = self._rename_logical_reference(
                            rewritten,
                            old_name,
                            logical_by_fqn[fqn],
                        )
                        if rewritten.get("left_table") == old_name:
                            rewritten["left_table"] = logical_by_fqn[fqn]
                        if rewritten.get("right_table") == old_name:
                            rewritten["right_table"] = logical_by_fqn[fqn]
                    authored_relationships.append(rewritten)
        for item in explicit_relationships:
            if str(item.get("trust_state") or "").lower() in {
                "uniqueness_unproven",
                "unsafe",
                "flagged",
            }:
                if excluded_relationships is not None:
                    excluded_relationships.append(
                        {
                            "relationship": copy.deepcopy(item),
                            "reason": "relationship uniqueness is unproven",
                            "source": "structured_sttm_context",
                            "trust_state": item.get("trust_state"),
                            "analyst_compatible": False,
                        }
                    )
                continue
            authored_relationships.append(self._relationship_to_yaml(item, logical_by_fqn))
        yaml_relationships: list[dict[str, Any]] = []
        seen_relationships: set[str] = set()
        selected_logical = set(logical_by_fqn.values())
        for relationship in authored_relationships:
            if not relationship:
                continue
            left = str(relationship.get("left_table") or "")
            right = str(relationship.get("right_table") or "")
            if left not in selected_logical or right not in selected_logical:
                if excluded_relationships is not None:
                    excluded_relationships.append(
                        {
                            "relationship": relationship,
                            "reason": "relationship endpoint is not selected",
                            "source": "authoritative_yaml",
                            "analyst_compatible": False,
                        }
                    )
                continue
            signature = hashlib.sha256(
                json.dumps(relationship, sort_keys=True, default=str).encode("utf-8")
            ).hexdigest()
            if signature not in seen_relationships:
                seen_relationships.add(signature)
                yaml_relationships.append(relationship)
        if yaml_relationships:
            payload["relationships"] = yaml_relationships

        instruction_sections: dict[str, list[str]] = {}
        for _, document in documents:
            instructions = document.get("module_custom_instructions") or document.get("custom_instructions")
            if isinstance(instructions, dict):
                for section, value in instructions.items():
                    if str(value).strip():
                        instruction_sections.setdefault(str(section), []).append(str(value).strip())
            elif str(instructions or "").strip():
                instruction_sections.setdefault("sql_generation", []).append(str(instructions).strip())
        if instruction_sections:
            payload["module_custom_instructions"] = {
                key: "\n\n".join(dict.fromkeys(values))
                for key, values in instruction_sections.items()
            }

        for derived in derived_records:
            projection = getattr(derived, "semantic_projection", None) or {}
            for key in ("metrics", "verified_queries", "filters", "aggregates"):
                value = projection.get(key)
                if value:
                    self._merge_top_level_definition(
                        payload,
                        key,
                        value,
                        str(getattr(derived, "derived_source_id", "derived")),
                        diagnostics,
                    )

        rendered = yaml.safe_dump(payload, sort_keys=False, allow_unicode=False)
        if len(rendered.encode("utf-8")) > 8_000_000:
            raise ValueError(
                "The complete semantic bundle exceeds the safe agent payload size. "
                "Narrow the selected table set; no semantic sections were truncated."
            )
        validated = yaml.safe_load(rendered)
        if not isinstance(validated, dict) or len(validated.get("tables") or []) != len(selected_tables):
            raise ValueError("Composed semantic YAML failed lossless table coverage validation")
        return rendered

    @staticmethod
    def _relationship_to_yaml(
        relationship: dict[str, Any], logical_by_fqn: dict[str, str]
    ) -> dict[str, Any]:
        left = _table_ref_from_payload(relationship.get("left_table"))
        right = _table_ref_from_payload(relationship.get("right_table"))
        if left is None or right is None:
            return {}
        conditions = [
            {
                "left_column": str(item.get("left_column")),
                "right_column": str(item.get("right_column")),
            }
            for item in relationship.get("conditions") or []
            if item.get("left_column") and item.get("right_column")
        ]
        if not conditions:
            return {}
        return {
            "name": relationship.get("name") or f"rel_{left.table}_{right.table}",
            "left_table": logical_by_fqn.get(left.qualified_name.upper(), ""),
            "right_table": logical_by_fqn.get(right.qualified_name.upper(), ""),
            "relationship_columns": conditions,
        }

    @staticmethod
    def _merge_top_level_definition(
        payload: dict[str, Any],
        key: str,
        value: Any,
        source_fqn: str,
        diagnostics: list[dict[str, Any]],
    ) -> None:
        if key not in payload:
            payload[key] = copy.deepcopy(value)
            return
        existing = payload[key]
        if isinstance(existing, list) and isinstance(value, list):
            signatures = {
                hashlib.sha256(json.dumps(item, sort_keys=True, default=str).encode()).hexdigest()
                for item in existing
            }
            names = {
                str(item.get("name")): hashlib.sha256(
                    json.dumps(item, sort_keys=True, default=str).encode()
                ).hexdigest()
                for item in existing
                if isinstance(item, dict) and item.get("name")
            }
            for item in value:
                signature = hashlib.sha256(
                    json.dumps(item, sort_keys=True, default=str).encode()
                ).hexdigest()
                if signature not in signatures:
                    resolved = copy.deepcopy(item)
                    name = str(resolved.get("name") or "") if isinstance(resolved, dict) else ""
                    if name and name in names and names[name] != signature:
                        resolved_name = f"{name}_{hashlib.sha256(source_fqn.encode()).hexdigest()[:8]}"
                        resolved["name"] = resolved_name
                        diagnostics.append(
                            {
                                "type": "definition_name_conflict",
                                "collection": key,
                                "name": name,
                                "source_fqn": source_fqn,
                                "resolved_name": resolved_name,
                            }
                        )
                    existing.append(resolved)
                    signatures.add(signature)
                    if name:
                        names[str(resolved.get("name") or name)] = signature
            return
        if existing != value:
            namespaced = f"{key}__{hashlib.sha256(source_fqn.encode()).hexdigest()[:8]}"
            payload[namespaced] = copy.deepcopy(value)
            diagnostics.append(
                {
                    "type": "top_level_conflict",
                    "key": key,
                    "source_fqn": source_fqn,
                    "resolved_key": namespaced,
                }
            )
        return

        # Legacy composition below is intentionally unreachable. It remains for
        # one compatibility release while callers migrate to FULL_REGISTRY.
        table_records_by_name = {
            f"{record['database']}.{record['schema_name']}.{record['table_name']}".upper(): record
            for record in table_records
            if record.get("table_name")
        }

        logical_names: dict[str, str] = {}
        unique_columns_by_table: dict[str, set[str]] = {}
        yaml_tables: list[dict[str, Any]] = []
        saved_documents: list[dict[str, Any]] = []
        derived_by_physical_fqn = {
            str(getattr(record, "physical_view_name", "") or "").upper(): record
            for record in derived_records
            if getattr(record, "physical_view_name", None)
        }
        for table in analyst_source_tables:
            logical_name = _logical_table_name(table)
            logical_names[table.qualified_name] = logical_name
            record = table_records_by_name.get(table.qualified_name.upper())
            derived_record = derived_by_physical_fqn.get(table.qualified_name.upper())
            attributes = self._attributes_for_table(
                table=table,
                table_record=record,
                derived_record=derived_record,
            )
            unique_columns_by_table[table.qualified_name] = {
                str(item["name"]).upper()
                for item in attributes
                if item.get("is_primary_key")
            }
            saved_table, saved_document = (None, None)
            if derived_record is None:
                saved_table, saved_document = self._saved_yaml_table(
                    logical_name=logical_name,
                    table=table,
                    table_record=record,
                )
            generated_table = self._build_yaml_table(
                logical_name=logical_name,
                table=table,
                table_record=record,
                derived_record=derived_record,
            )
            yaml_tables.append(
                self._merge_saved_yaml_table(saved_table, generated_table)
                if saved_table
                else generated_table
            )
            if saved_document:
                saved_documents.append(saved_document)

        relationships = self._merge_registry_relationship_candidates(
            explicit_relationships=relationships,
            table_records=table_records,
            selected_tables=analyst_source_tables,
        )

        yaml_relationships: list[dict[str, Any]] = []
        for index, relationship in enumerate(relationships, start=1):
            left_ref = _table_ref_from_payload(relationship.get("left_table"))
            right_ref = _table_ref_from_payload(relationship.get("right_table"))
            if left_ref is None or right_ref is None:
                continue
            left_name = logical_names.get(left_ref.qualified_name)
            right_name = logical_names.get(right_ref.qualified_name)
            if not left_name or not right_name:
                continue

            relationship_columns = []
            for condition in relationship.get("conditions") or []:
                left_column = condition.get("left_column")
                right_column = condition.get("right_column")
                if not left_column or not right_column:
                    continue
                relationship_columns.append(
                    {
                        "left_column": str(left_column),
                        "right_column": str(right_column),
                    }
                )
            if not relationship_columns:
                continue
            left_unique = unique_columns_by_table.get(left_ref.qualified_name, set())
            right_unique = unique_columns_by_table.get(right_ref.qualified_name, set())
            left_cols = {str(item["left_column"]).upper() for item in relationship_columns}
            right_cols = {str(item["right_column"]).upper() for item in relationship_columns}
            if (
                right_cols and not right_cols.issubset(right_unique)
                and left_cols
                and left_cols.issubset(left_unique)
            ):
                left_ref, right_ref = right_ref, left_ref
                left_name, right_name = right_name, left_name
                relationship_columns = [
                    {
                        "left_column": item["right_column"],
                        "right_column": item["left_column"],
                    }
                    for item in relationship_columns
                ]
                left_unique, right_unique = right_unique, left_unique
                left_cols = {str(item["left_column"]).upper() for item in relationship_columns}
                right_cols = {str(item["right_column"]).upper() for item in relationship_columns}

            if right_cols and not right_cols.issubset(right_unique):
                reason = (
                    f"{left_ref.qualified_name} -> {right_ref.qualified_name} requires "
                    f"a proven unique key on {sorted(right_cols)}."
                )
                if excluded_relationships is not None:
                    excluded_relationships.append(
                        {
                            "relationship": copy.deepcopy(relationship),
                            "left_table": left_ref.qualified_name,
                            "right_table": right_ref.qualified_name,
                            "relationship_columns": relationship_columns,
                            "reason": reason,
                            "trust_state": relationship.get("trust_state") or "uniqueness_unproven",
                            "analyst_compatible": False,
                        }
                    )
                logger.info("Omitting Analyst-unsafe relationship: %s", reason)
                continue
            yaml_relationships.append(
                {
                    "name": f"rel_{index}_{left_name.lower()}_{right_name.lower()}",
                    "left_table": left_name,
                    "right_table": right_name,
                    "relationship_columns": relationship_columns,
                }
            )

        view_name = semantic_view_name.rsplit(".", 1)[-1]
        payload: dict[str, Any] = {
            "name": view_name,
            "description": (
                f"Semantic view for {self._bundle_label(selected_source_tables=analyst_source_tables, derived_records=[], target_table=target_table)}"
                + (f" targeting {target_table.table}" if target_table else "")
            ),
            "tables": yaml_tables,
        }
        if yaml_relationships:
            payload["relationships"] = yaml_relationships
        for key in ("metrics", "verified_queries"):
            merged_items: list[Any] = []
            seen_names: set[str] = set()
            for document in saved_documents:
                for item in document.get(key) or []:
                    if not isinstance(item, dict):
                        continue
                    name = str(item.get("name") or json.dumps(item, sort_keys=True))
                    if name in seen_names:
                        continue
                    seen_names.add(name)
                    merged_items.append(copy.deepcopy(item))
            for record in table_records:
                model = record.get("semantic_model")
                if not isinstance(model, dict):
                    continue
                for item in model.get(key) or []:
                    if not isinstance(item, dict):
                        continue
                    name = str(item.get("name") or json.dumps(item, sort_keys=True))
                    if name in seen_names:
                        continue
                    seen_names.add(name)
                    merged_items.append(copy.deepcopy(item))
            for derived in derived_records:
                projection = getattr(derived, "semantic_projection", None) or {}
                for item in projection.get(key) or []:
                    if not isinstance(item, dict):
                        continue
                    name = str(item.get("name") or json.dumps(item, sort_keys=True))
                    if name in seen_names:
                        continue
                    seen_names.add(name)
                    merged_items.append(copy.deepcopy(item))
            if merged_items:
                payload[key] = merged_items
        instruction_sections: dict[str, list[str]] = {}
        instruction_values: list[Any] = [
            document.get("module_custom_instructions") or document.get("custom_instructions")
            for document in saved_documents
        ]
        instruction_values.extend(
            record.get("semantic_model", {}).get("module_custom_instructions")
            or record.get("semantic_model", {}).get("custom_instructions")
            for record in table_records
            if isinstance(record.get("semantic_model"), dict)
        )
        for instruction in instruction_values:
            if isinstance(instruction, dict):
                for section, value in instruction.items():
                    if str(value).strip():
                        instruction_sections.setdefault(str(section), []).append(str(value).strip())
            elif str(instruction or "").strip():
                instruction_sections.setdefault("sql_generation", []).append(str(instruction).strip())
        if instruction_sections:
            payload["module_custom_instructions"] = {
                section: "\n\n".join(dict.fromkeys(values))
                for section, values in instruction_sections.items()
            }
        return yaml.safe_dump(payload, sort_keys=False, allow_unicode=False)

    @staticmethod
    def _merge_saved_yaml_table(
        saved_table: dict[str, Any],
        generated_table: dict[str, Any],
    ) -> dict[str, Any]:
        """Preserve valid authored YAML while applying latest registry semantics."""
        merged = copy.deepcopy(saved_table)
        merged.update(
            {
                "name": generated_table["name"],
                "description": generated_table.get("description"),
                "base_table": generated_table["base_table"],
            }
        )
        saved_entities: dict[str, dict[str, Any]] = {}
        for role in ("dimensions", "time_dimensions", "facts"):
            for item in saved_table.get(role) or []:
                if isinstance(item, dict) and item.get("name"):
                    saved_entities[str(item["name"]).upper()] = item
            merged.pop(role, None)
        for role in ("dimensions", "time_dimensions", "facts"):
            entities = []
            for generated in generated_table.get(role) or []:
                previous = saved_entities.get(str(generated.get("name") or "").upper(), {})
                entity = {**copy.deepcopy(previous), **copy.deepcopy(generated)}
                if previous.get("expr"):
                    entity["expr"] = previous["expr"]
                entities.append(entity)
            if entities or role == "dimensions":
                merged[role] = entities
        if generated_table.get("primary_key"):
            merged["primary_key"] = generated_table["primary_key"]
        generated_metrics = {
            str(item.get("name") or "").upper(): copy.deepcopy(item)
            for item in generated_table.get("metrics") or []
            if isinstance(item, dict) and item.get("name")
        }
        for item in saved_table.get("metrics") or []:
            if isinstance(item, dict) and item.get("name"):
                generated_metrics[str(item["name"]).upper()] = copy.deepcopy(item)
        if generated_metrics:
            merged["metrics"] = list(generated_metrics.values())
        generated_filters = {
            str(item.get("name") or "").upper(): copy.deepcopy(item)
            for item in generated_table.get("filters") or []
            if isinstance(item, dict) and item.get("name")
        }
        for item in saved_table.get("filters") or []:
            if isinstance(item, dict) and item.get("name"):
                generated_filters[str(item["name"]).upper()] = copy.deepcopy(item)
        if generated_filters:
            merged["filters"] = list(generated_filters.values())
        return merged

    @staticmethod
    def _rename_logical_reference(value: Any, old_name: str, new_name: str) -> Any:
        if isinstance(value, dict):
            return {
                key: SemanticContextService._rename_logical_reference(item, old_name, new_name)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [
                SemanticContextService._rename_logical_reference(item, old_name, new_name)
                for item in value
            ]
        if isinstance(value, str) and old_name != new_name:
            return re.sub(rf"\b{re.escape(old_name)}\.", f"{new_name}.", value)
        return value

    def _saved_yaml_table(
        self,
        *,
        logical_name: str,
        table: TableRef,
        table_record: dict[str, Any] | None,
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        if not table_record or not isinstance(table_record.get("semantic_model"), dict):
            return None, None
        semantic_model = table_record["semantic_model"]
        semantic_view = semantic_model.get("semantic_view")
        if not isinstance(semantic_view, dict):
            return None, None
        raw_yaml = semantic_view.get("yaml")
        if not isinstance(raw_yaml, str) or not raw_yaml.strip():
            return None, None
        try:
            document = yaml.safe_load(raw_yaml)
        except yaml.YAMLError:
            logger.warning("Ignoring invalid saved semantic YAML for %s", table.qualified_name)
            return None, None
        if not isinstance(document, dict):
            return None, None
        saved_tables = document.get("tables")
        if not isinstance(saved_tables, list):
            return None, None
        selected: dict[str, Any] | None = None
        for candidate in saved_tables:
            if not isinstance(candidate, dict):
                continue
            base = candidate.get("base_table")
            if not isinstance(base, dict):
                continue
            candidate_fqn = f"{base.get('database')}.{base.get('schema')}.{base.get('table')}".upper()
            if candidate_fqn == table.qualified_name.upper():
                selected = copy.deepcopy(candidate)
                break
        if selected is None:
            return None, None
        old_name = str(selected.get("name") or logical_name)
        selected = self._rename_logical_reference(selected, old_name, logical_name)
        selected["name"] = logical_name
        selected["base_table"] = {
            "database": table.database,
            "schema": table.schema,
            "table": table.table,
        }
        normalized_document = self._rename_logical_reference(
            copy.deepcopy(document), old_name, logical_name
        )
        normalized_document["tables"] = [selected]
        return selected, normalized_document

    def _merge_registry_relationship_candidates(
        self,
        *,
        explicit_relationships: list[dict[str, Any]],
        table_records: list[dict[str, Any]],
        selected_tables: list[TableRef],
    ) -> list[dict[str, Any]]:
        selected = {table.qualified_name.upper(): table for table in selected_tables}
        merged = [copy.deepcopy(item) for item in explicit_relationships]
        explicit_pairs = {
            frozenset((left.qualified_name.upper(), right.qualified_name.upper()))
            for item in explicit_relationships
            if (left := _table_ref_from_payload(item.get("left_table"))) is not None
            and (right := _table_ref_from_payload(item.get("right_table"))) is not None
        }
        for record in table_records:
            owner_fqn = f"{record.get('database')}.{record.get('schema_name')}.{record.get('table_name')}".upper()
            owner = selected.get(owner_fqn)
            model = record.get("semantic_model")
            if owner is None or not isinstance(model, dict):
                continue
            relationship_model = model.get("relationship_candidates") or model.get("relationships")
            if not isinstance(relationship_model, dict):
                continue
            for direction in ("outgoing", "incoming"):
                for candidate in relationship_model.get(direction) or []:
                    if not isinstance(candidate, dict):
                        continue
                    confidence = str(candidate.get("confidence") or "").upper()
                    if confidence and confidence not in {"HIGH", "MEDIUM"}:
                        continue
                    related = TableRef(
                        database=str(candidate.get("database") or owner.database),
                        schema=str(candidate.get("schema") or owner.schema),
                        table=str(candidate.get("table") or ""),
                    )
                    related_selected = selected.get(related.qualified_name.upper())
                    if related_selected is None:
                        continue
                    pair = frozenset((owner.qualified_name.upper(), related_selected.qualified_name.upper()))
                    if pair in explicit_pairs:
                        continue
                    mappings = candidate.get("column_mappings") or candidate.get("conditions") or []
                    conditions = []
                    for mapping in mappings:
                        if not isinstance(mapping, dict):
                            continue
                        fk_column = mapping.get("fk_column") or mapping.get("left_column")
                        pk_column = mapping.get("pk_column") or mapping.get("right_column")
                        if fk_column and pk_column:
                            conditions.append({
                                "left_column": str(fk_column),
                                "right_column": str(pk_column),
                                "operator": "=",
                            })
                    if not conditions:
                        continue
                    if direction == "outgoing":
                        left_table, right_table = owner, related_selected
                    else:
                        left_table, right_table = related_selected, owner
                    merged.append({
                        "left_table": left_table.model_dump(mode="json"),
                        "right_table": right_table.model_dump(mode="json"),
                        "join_type": "INNER",
                        "source": "SEMANTIC_REGISTRY",
                        "locked": True,
                        "conditions": conditions,
                    })
                    explicit_pairs.add(pair)
        return merged

    def _build_yaml_table(
        self,
        *,
        logical_name: str,
        table: TableRef,
        table_record: dict[str, Any] | None,
        derived_record: Any | None,
    ) -> dict[str, Any]:
        attributes = self._attributes_for_table(
            table=table,
            table_record=table_record,
            derived_record=derived_record,
        )
        description = self._table_description(table_record, derived_record, table)
        primary_keys = [item["name"] for item in attributes if item.get("is_primary_key")]

        dimensions: list[dict[str, Any]] = []
        time_dimensions: list[dict[str, Any]] = []
        facts: list[dict[str, Any]] = []
        generated_metrics: list[dict[str, Any]] = []
        for attribute in attributes:
            semantic_role = str(attribute.get("semantic_role") or "").strip().lower()
            entity_description = _semantic_view_entity_description(attribute)
            entity = {
                "name": attribute["name"],
                "description": entity_description,
                "expr": attribute["name"],
                "data_type": attribute["data_type"],
            }
            synonyms = [str(value) for value in (attribute.get("synonyms") or []) if value]
            value_profile = attribute.get("value_profile") or {}
            sample_values = attribute.get("sample_values") or value_profile.get("sample_values") or value_profile.get("unique_values") or []
            if synonyms:
                entity["synonyms"] = synonyms
            if sample_values:
                entity["sample_values"] = [
                    _semantic_sample_value(value)
                    for value in list(sample_values)[:10]
                    if value is not None
                ]
            if attribute.get("is_primary_key"):
                entity["unique"] = True
            if semantic_role == "time_dimension" or _is_time_type(attribute["data_type"]):
                time_dimensions.append(entity)
            elif semantic_role == "metric" or (
                _is_numeric_type(attribute["data_type"]) and not (
                    attribute.get("is_primary_key")
                    or attribute.get("is_foreign_key")
                    or _looks_like_identifier(attribute["name"])
                )
            ):
                default_aggregation = str(attribute.get("default_aggregation") or "").upper()
                aggregate_function = {
                    "SUM": "SUM",
                    "AVG": "AVG",
                    "AVERAGE": "AVG",
                    "MIN": "MIN",
                    "MAX": "MAX",
                    "COUNT": "COUNT",
                    "COUNT_DISTINCT": "COUNT_DISTINCT",
                    "COUNT DISTINCT": "COUNT_DISTINCT",
                }.get(default_aggregation)
                if aggregate_function:
                    metric_expr = (
                        f"COUNT(DISTINCT {attribute['name']})"
                        if aggregate_function == "COUNT_DISTINCT"
                        else f"{aggregate_function}({attribute['name']})"
                    )
                    generated_metrics.append({
                        "name": f"{aggregate_function.lower()}_{str(attribute['name']).lower()}",
                        "description": f"{aggregate_function.replace('_', ' ').title()} of {entity_description}",
                        "expr": metric_expr,
                        "synonyms": synonyms,
                    })
                facts.append(entity)
            else:
                dimensions.append(entity)

        yaml_table: dict[str, Any] = {
            "name": logical_name,
            "description": description,
            "base_table": {
                "database": table.database,
                "schema": table.schema,
                "table": table.table,
            },
            "dimensions": dimensions or [],
        }
        if primary_keys:
            yaml_table["primary_key"] = {"columns": primary_keys}
        if time_dimensions:
            yaml_table["time_dimensions"] = time_dimensions
        if facts:
            yaml_table["facts"] = facts
        if generated_metrics:
            yaml_table["metrics"] = generated_metrics
        model = table_record.get("semantic_model") if isinstance(table_record, dict) else {}
        projection = getattr(derived_record, "semantic_projection", None) if derived_record is not None else {}
        filters = (
            (projection or {}).get("filters")
            if isinstance(projection, dict)
            else None
        ) or (model.get("filters") if isinstance(model, dict) else None) or []
        normalized_filters = [
            copy.deepcopy(item)
            for item in filters
            if isinstance(item, dict) and item.get("name") and item.get("expr")
        ]
        if normalized_filters:
            yaml_table["filters"] = normalized_filters
        return yaml_table

    def _persist_semantic_view_metadata(
        self,
        *,
        bundle_id: str,
        semantic_view_name: str,
        yaml_spec: str,
        selected_source_tables: list[TableRef],
        derived_records: list[Any],
        semantic_level: SemanticLevel,
        analyst_tool_name: str | None = None,
    ) -> None:
        promoted_at = datetime.now(timezone.utc).isoformat()
        bundle_label = self._bundle_label(
            selected_source_tables=selected_source_tables,
            derived_records=derived_records,
            target_table=None,
        )
        table_records = self._semantic_model_service.get_table_records(
            self._session,
            selected_source_tables,
        )
        table_records_by_name = {
            f"{record['database']}.{record['schema_name']}.{record['table_name']}": record
            for record in table_records
            if record.get("table_name")
        }
        for table in selected_source_tables:
            existing = table_records_by_name.get(table.qualified_name)
            base_model = existing["semantic_model"] if existing else {
                "description": self._table_description(None, None, table),
                "attributes": self._attributes_for_table(
                    table=table,
                    table_record=None,
                    derived_record=None,
                ),
            }
            model_payload = dict(base_model) if isinstance(base_model, dict) else {"value": base_model}
            model_payload["semantic_view"] = {
                "name": semantic_view_name,
                "yaml": yaml_spec,
                "bundle_id": bundle_id,
                "bundle_label": bundle_label,
                "semantic_level": semantic_level.value,
                "promoted_at": promoted_at,
                "analyst_tool_name": analyst_tool_name,
            }
            ddl_hash = self._semantic_model_service.compute_ddl_hash(
                self._session,
                scope="TABLE",
                db_name=table.database,
                schema_name=table.schema,
                table_name=table.table,
            )
            self._semantic_model_service.upsert_table_record(
                self._session,
                table=table,
                semantic_model=model_payload,
                ddl_hash=ddl_hash,
            )

    def _persist_analyst_tool_metadata(
        self,
        *,
        bundle_id: str,
        semantic_view_name: str,
        analyst_tool_name: str,
        selected_source_tables: list[TableRef],
        derived_records: list[Any],
        semantic_level: SemanticLevel,
    ) -> None:
        view_name = semantic_view_name.rsplit(".", 1)[-1]
        bundle_label = self._bundle_label(
            selected_source_tables=selected_source_tables,
            derived_records=derived_records,
            target_table=None,
        )
        table_records = self._semantic_model_service.get_table_records(
            self._session,
            selected_source_tables,
        )
        for table in selected_source_tables:
            existing = next(
                (
                    record
                    for record in table_records
                    if (
                        record.get("database") == table.database
                        and record.get("schema_name") == table.schema
                        and record.get("table_name") == table.table
                    )
                ),
                None,
            )
            if not existing:
                continue
            base_model = existing["semantic_model"]
            model_payload = dict(base_model) if isinstance(base_model, dict) else {"value": base_model}
            semantic_view = model_payload.get("semantic_view")
            if not isinstance(semantic_view, dict):
                semantic_view = {
                    "name": semantic_view_name,
                    "yaml": yaml.safe_dump(
                        {
                            "name": view_name,
                            "description": f"Semantic view for {bundle_label}",
                        },
                        sort_keys=False,
                        allow_unicode=False,
                    ),
                    "bundle_id": bundle_id,
                    "bundle_label": bundle_label,
                    "semantic_level": semantic_level.value,
                    "promoted_at": datetime.now(timezone.utc).isoformat(),
                }
            semantic_view["analyst_tool_name"] = analyst_tool_name
            model_payload["semantic_view"] = semantic_view
            ddl_hash = self._semantic_model_service.compute_ddl_hash(
                self._session,
                scope="TABLE",
                db_name=table.database,
                schema_name=table.schema,
                table_name=table.table,
            )
            self._semantic_model_service.upsert_table_record(
                self._session,
                table=table,
                semantic_model=model_payload,
                ddl_hash=ddl_hash,
            )

    def _sync_builder_agent_analyst_tool(
        self,
        *,
        bundle_id: str,
        semantic_view_name: str,
        selected_source_tables: list[TableRef],
        derived_records: list[Any],
        target_table: TableRef | None,
    ) -> str:
        agent_name = self._settings.resolved_sttm_builder_agent
        rows = self._session.sql(f"DESCRIBE AGENT {agent_name}").collect()
        if not rows:
            raise ValueError(f"DESCRIBE AGENT returned no rows for {agent_name}")

        row = rows[0].as_dict(recursive=True)
        row_lower = {str(key).lower(): value for key, value in row.items()}
        raw_spec = row_lower.get("agent_spec") or row_lower.get("specification") or row_lower.get("spec")
        if not raw_spec:
            raise ValueError(f"Could not locate AGENT_SPEC in DESCRIBE AGENT output for {agent_name}")
        profile = row_lower.get("profile") or '{"display_name":"AGT_STTM_BUILDER"}'

        spec = yaml.safe_load(raw_spec) if isinstance(raw_spec, str) else raw_spec
        if not isinstance(spec, dict):
            raise ValueError(f"Agent spec for {agent_name} is not a YAML object")

        tools = spec.setdefault("tools", [])
        if not isinstance(tools, list):
            raise ValueError("Agent spec tools section is not a list")
        tool_resources = spec.setdefault("tool_resources", {})
        if not isinstance(tool_resources, dict):
            raise ValueError("Agent spec tool_resources section is not a mapping")

        desired_tool_name = _analyst_tool_name(
            selected_source_tables=selected_source_tables,
            derived_records=derived_records,
            target_table=target_table,
            bundle_id=bundle_id,
        )
        desired_tool_prefix = desired_tool_name.rsplit("__", 1)[0]

        removable_tool_names: set[str] = set()
        for tool_name, resource in list(tool_resources.items()):
            normalized_tool_name = str(tool_name)
            if not normalized_tool_name.startswith("ANALYST_STTM_"):
                continue
            if normalized_tool_name == desired_tool_name:
                continue
            if normalized_tool_name.startswith(desired_tool_prefix):
                removable_tool_names.add(normalized_tool_name)
                continue
            resource_view = ""
            if isinstance(resource, dict):
                resource_view = str(resource.get("semantic_view") or "").strip()
            if not resource_view or not self._semantic_view_exists(resource_view):
                removable_tool_names.add(normalized_tool_name)
                continue
            removable_tool_names.add(normalized_tool_name)

        if removable_tool_names:
            for tool_name in removable_tool_names:
                tool_resources.pop(tool_name, None)
            tools = [
                tool
                for tool in tools
                if not (
                    isinstance(tool, dict)
                    and isinstance(tool.get("tool_spec"), dict)
                    and str(tool["tool_spec"].get("name") or "") in removable_tool_names
                )
            ]
            spec["tools"] = tools

        existing_tool_name = None
        for tool_name, resource in tool_resources.items():
            if not isinstance(resource, dict):
                continue
            if str(resource.get("semantic_view") or "") == semantic_view_name:
                existing_tool_name = str(tool_name)
                break

        if existing_tool_name:
            if existing_tool_name != desired_tool_name:
                tool_resources.pop(existing_tool_name, None)
                tools = [
                    tool
                    for tool in tools
                    if not (
                        isinstance(tool, dict)
                        and isinstance(tool.get("tool_spec"), dict)
                        and str(tool["tool_spec"].get("name") or "") == existing_tool_name
                    )
                ]
                spec["tools"] = tools
                existing_tool_name = None

        if existing_tool_name:
            tool_present = any(
                isinstance(tool, dict)
                and isinstance(tool.get("tool_spec"), dict)
                and str(tool["tool_spec"].get("name") or "") == existing_tool_name
                for tool in tools
            )
            if tool_present:
                return existing_tool_name
            if not tool_present:
                tools.append(
                    {
                        "tool_spec": {
                            "type": "cortex_analyst_text_to_sql",
                            "name": existing_tool_name,
                            "description": (
                                f"Uses Cortex Analyst over semantic view {semantic_view_name} "
                                f"for analytical questions on {self._bundle_label_from_id(bundle_id)}."
                            ),
                        }
                    }
                )
            self._replace_agent_from_spec(agent_name=agent_name, profile=str(profile), spec=spec)
            return existing_tool_name

        tools.append(
            {
                "tool_spec": {
                    "type": "cortex_analyst_text_to_sql",
                    "name": desired_tool_name,
                    "description": (
                        f"Uses Cortex Analyst over semantic view {semantic_view_name} "
                        f"for analytical questions on {self._bundle_label_from_id(bundle_id)}."
                    ),
                }
            }
        )
        resource: dict[str, Any] = {"semantic_view": semantic_view_name}
        if self._settings.snowflake_warehouse:
            resource["execution_environment"] = {
                "type": "warehouse",
                "warehouse": self._settings.snowflake_warehouse,
            }
        tool_resources[desired_tool_name] = resource
        self._replace_agent_from_spec(agent_name=agent_name, profile=str(profile), spec=spec)
        return desired_tool_name

    def _semantic_view_exists(self, semantic_view_name: str) -> bool:
        normalized = str(semantic_view_name or "").strip()
        if not normalized:
            return False
        try:
            self._session.sql(f"DESCRIBE SEMANTIC VIEW {normalized}").collect()
        except Exception:
            return False
        return True

    def _replace_agent_from_spec(
        self,
        *,
        agent_name: str,
        profile: str,
        spec: dict[str, Any],
    ) -> None:
        spec_yaml = yaml.safe_dump(spec, sort_keys=False, allow_unicode=False)
        escaped_yaml = spec_yaml.replace("$$", "$ $")
        escaped_profile = profile.replace("'", "''")
        self._session.sql(
            f"""
            CREATE OR REPLACE AGENT {agent_name}
                PROFILE = '{escaped_profile}'
                FROM SPECIFICATION
                $$
{escaped_yaml.rstrip()}
                $$
            """
        ).collect()

    def _attributes_for_table(
        self,
        *,
        table: TableRef,
        table_record: dict[str, Any] | None,
        derived_record: Any | None,
    ) -> list[dict[str, Any]]:
        semantic_model = table_record["semantic_model"] if table_record else {}
        if isinstance(semantic_model, dict):
            attribute_rows = semantic_model.get("attributes")
            if isinstance(attribute_rows, list) and attribute_rows:
                return [
                    {
                        "name": str(item.get("name") or ""),
                        "data_type": str(item.get("data_type") or "VARCHAR"),
                        "description": item.get("description") or item.get("summary"),
                        "summary": item.get("summary"),
                        "business_meaning": item.get("business_meaning"),
                        "semantic_role": item.get("semantic_role") or item.get("role"),
                        "default_aggregation": item.get("default_aggregation"),
                        "constraints": item.get("constraints") or [],
                        "semantic_notes": item.get("semantic_notes") or [],
                        "synonyms": item.get("synonyms") or [],
                        "value_profile": item.get("value_profile") or {},
                        "sample_values": item.get("sample_values") or [],
                        "data_quality": item.get("data_quality") or {},
                        "range_stats": item.get("range_stats") or {},
                        "nullable": item.get("nullable"),
                        "is_primary_key": (
                            str(item.get("semantic_role") or "").lower() == "primary_key"
                            or _constraints_include(item.get("constraints"), "PRIMARY_KEY")
                        ),
                        "is_foreign_key": _has_foreign_key(item.get("constraints")),
                    }
                    for item in attribute_rows
                    if isinstance(item, dict) and item.get("name")
                ]

        if derived_record is not None:
            semantics = {
                str(item.get("name") or item.get("column_name") or "").upper(): item
                for item in (getattr(derived_record, "column_semantics", None) or [])
                if isinstance(item, dict)
            }
            outputs = {
                str(item.get("name") or item.get("column_name") or "").upper(): item
                for item in (getattr(derived_record, "output_columns", None) or [])
                if isinstance(item, dict)
            }
            return [
                {
                    "name": column.name,
                    "data_type": column.data_type,
                    "description": semantics.get(column.name.upper(), {}).get("description") or outputs.get(column.name.upper(), {}).get("description") or column.name,
                    "summary": semantics.get(column.name.upper(), {}).get("summary") or column.name,
                    "business_meaning": semantics.get(column.name.upper(), {}).get("business_meaning"),
                    "semantic_role": semantics.get(column.name.upper(), {}).get("semantic_role") or semantics.get(column.name.upper(), {}).get("role"),
                    "default_aggregation": semantics.get(column.name.upper(), {}).get("default_aggregation"),
                    "constraints": semantics.get(column.name.upper(), {}).get("constraints") or [],
                    "semantic_notes": semantics.get(column.name.upper(), {}).get("semantic_notes") or [],
                    "synonyms": semantics.get(column.name.upper(), {}).get("synonyms") or [],
                    "sample_values": semantics.get(column.name.upper(), {}).get("sample_values") or [],
                    "value_profile": semantics.get(column.name.upper(), {}).get("value_profile") or {},
                    "is_primary_key": column.is_primary_key,
                    "is_foreign_key": False,
                }
                for column in derived_record.preview_columns
            ]

        attributes = self._table_selection_service.list_attributes_for_tables([table.qualified_name])[0].columns
        return [
            {
                "name": column.column_name,
                "data_type": column.data_type,
                "description": column.column_name,
                "summary": column.column_name,
                "business_meaning": None,
                "semantic_role": None,
                "default_aggregation": None,
                "constraints": [],
                "semantic_notes": [],
                "is_primary_key": column.is_primary_key,
                "is_foreign_key": column.is_foreign_key,
            }
            for column in attributes
        ]

    @staticmethod
    def _table_description(
        table_record: dict[str, Any] | None,
        derived_record: Any | None,
        table: TableRef,
    ) -> str:
        if table_record and isinstance(table_record.get("semantic_model"), dict):
            for key in ("description", "domain_summary", "summary"):
                value = table_record["semantic_model"].get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        if derived_record is not None and getattr(derived_record, "derived_source_name", None):
            return f"Derived source {derived_record.derived_source_name}"
        return f"{table.table} selected for STTM semantic analysis."

    def _bundle_hash(
        self,
        *,
        selected_source_tables: Iterable[TableRef],
        selected_derived_sources: Iterable[str],
        target_table: TableRef | None,
        relationships: list[dict[str, Any]],
        selected_columns_by_table: dict[str, list[str]] | None = None,
    ) -> str:
        payload = {
            "source_tables": sorted(table.qualified_name for table in selected_source_tables),
            "selected_derived_sources": sorted(selected_derived_sources),
            "target_table": target_table.qualified_name if target_table else None,
            "relationships": _canonical_relationships_for_hash(relationships),
            "selected_columns_by_table": {
                key: sorted(set(values))
                for key, values in sorted((selected_columns_by_table or {}).items())
            },
        }
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _bundle_selection_key(
        self,
        *,
        selected_source_tables: Iterable[TableRef],
        selected_derived_sources: Iterable[str],
        target_table: TableRef | None,
        selected_columns_by_table: dict[str, list[str]] | None = None,
        relationships: list[dict[str, Any]] | None = None,
    ) -> str:
        payload = {
            "source_tables": sorted(table.qualified_name for table in selected_source_tables),
            "selected_derived_sources": sorted(selected_derived_sources),
            "target_table": target_table.qualified_name if target_table else None,
            "relationships": _canonical_relationships_for_hash(relationships or []),
            "selected_columns_by_table": {
                key: sorted(set(values))
                for key, values in sorted((selected_columns_by_table or {}).items())
            },
        }
        return json.dumps(payload, sort_keys=True, separators=(",", ":"))

    def _build_reading_instructions(
        self,
        *,
        selected_source_tables: list[TableRef],
        derived_records: list[Any],
        target_table: TableRef | None,
        relationships: list[dict[str, Any]],
        table_records: list[dict[str, Any]],
    ) -> SemanticReadingInstructions:
        """Build reading instructions for agents to interpret semantic context.

        Provides structured guidance on:
        - Table roles (source vs target vs driving)
        - Recommended reading order based on relationships
        - Key relationship paths for mapping
        - Confidence interpretation
        - Additional interpretation notes
        """
        # Build table roles map
        table_roles: dict[str, str] = {}
        driving_table: str | None = None

        for table in selected_source_tables:
            fqn = table.qualified_name.upper()
            table_roles[fqn] = "source"

        if target_table:
            target_fqn = target_table.qualified_name.upper()
            table_roles[target_fqn] = "target"

        # Identify driving table (table with most outgoing relationships)
        if relationships:
            outgoing_counts: dict[str, int] = {}
            for rel in relationships:
                left_table = rel.get("left_table", {})
                if isinstance(left_table, dict):
                    left_fqn = f"{left_table.get('database', '')}.{left_table.get('schema', '')}.{left_table.get('table', '')}".upper()
                    if left_fqn in table_roles and table_roles[left_fqn] == "source":
                        outgoing_counts[left_fqn] = outgoing_counts.get(left_fqn, 0) + 1

            if outgoing_counts:
                driving_table = max(outgoing_counts.keys(), key=lambda k: outgoing_counts[k])
                table_roles[driving_table] = "driving"

        # Add derived sources to roles
        for record in derived_records:
            ds_id = getattr(record, "derived_source_id", None) or record.get("derived_source_id")
            if ds_id:
                table_roles[f"DERIVED:{ds_id}"] = "derived_source"

        # Build reading order based on relationship topology
        reading_order: list[str] = []

        # Start with driving table or first source
        if driving_table:
            reading_order.append(driving_table)
        elif selected_source_tables:
            reading_order.append(selected_source_tables[0].qualified_name.upper())

        # Add tables connected by relationships in order
        visited = set(reading_order)
        for rel in relationships:
            left_table = rel.get("left_table", {})
            right_table = rel.get("right_table", {})

            for table_info in [left_table, right_table]:
                if isinstance(table_info, dict):
                    fqn = f"{table_info.get('database', '')}.{table_info.get('schema', '')}.{table_info.get('table', '')}".upper()
                    if fqn and fqn not in visited:
                        reading_order.append(fqn)
                        visited.add(fqn)

        # Add remaining source tables
        for table in selected_source_tables:
            fqn = table.qualified_name.upper()
            if fqn not in visited:
                reading_order.append(fqn)
                visited.add(fqn)

        # Add target table last
        if target_table and target_table.qualified_name.upper() not in visited:
            reading_order.append(target_table.qualified_name.upper())

        # Extract key relationships
        key_relationships: list[dict[str, Any]] = []
        for rel in relationships[:10]:  # Limit to top 10 relationships
            left_table = rel.get("left_table", {})
            right_table = rel.get("right_table", {})
            key_rel = {
                "left_table": f"{left_table.get('database', '')}.{left_table.get('schema', '')}.{left_table.get('table', '')}".upper() if isinstance(left_table, dict) else str(left_table),
                "right_table": f"{right_table.get('database', '')}.{right_table.get('schema', '')}.{right_table.get('table', '')}".upper() if isinstance(right_table, dict) else str(right_table),
                "join_type": rel.get("join_type", "INNER"),
                "confidence": rel.get("confidence", "MEDIUM"),
                "type": rel.get("type", "INFERRED"),
            }
            key_relationships.append(key_rel)

        # Build interpretation notes
        interpretation_notes: list[str] = []

        # Note about semantic view structure
        interpretation_notes.append(
            "Each table's semantic_model contains: description (business purpose), "
            "domain_summary (concise overview), attributes (columns with types and constraints), "
            "relationships (outgoing/incoming with confidence), and semantic_notes (quality observations)."
        )

        # Note about value_profile
        interpretation_notes.append(
            "value_profile in attributes contains either unique_values (if distinct_count <= 15) "
            "or sample_values (representative values). Use range_stats for numeric ranges."
        )

        # Note about relationship confidence
        if any(rel.get("type") == "FUZZY" for rel in relationships):
            interpretation_notes.append(
                "Some relationships are FUZZY (matched via semantic similarity). "
                "Verify these before using in critical joins."
            )

        # Note about derived sources
        if derived_records:
            interpretation_notes.append(
                f"Context includes {len(derived_records)} derived source(s). "
                "These are virtual sources with saved SQL - treat their output columns as available for mapping."
            )

        return SemanticReadingInstructions(
            table_roles=table_roles,
            reading_order=reading_order,
            key_relationships=key_relationships,
            confidence_guide=_CONFIDENCE_GUIDE.strip(),
            interpretation_notes=interpretation_notes,
        )

    def _find_bundle_for_selection(
        self,
        *,
        selected_source_tables: list[TableRef],
        derived_source_ids: list[str],
        target_table: TableRef | None,
    ) -> dict[str, Any] | None:
        expected_sources = sorted(table.qualified_name for table in selected_source_tables)
        expected_derived = sorted(derived_source_ids)
        expected_target = target_table.qualified_name if target_table else None
        try:
            rows = self._session.sql(
                f"""
                SELECT *
                FROM {self._bundle_table}
                ORDER BY LAST_GENERATED_AT DESC
                LIMIT 250
                """
            ).collect()
        except Exception:
            return None
        for row in rows:
            data = self._bundle_row_to_dict(row.as_dict())
            actual_sources = sorted(
                f"{item.get('database')}.{item.get('schema')}.{item.get('table')}"
                for item in (data.get("source_tables") or [])
                if isinstance(item, dict) and item.get("database") and item.get("schema") and item.get("table")
            )
            actual_target = None
            target_payload = data.get("target_table")
            if (
                isinstance(target_payload, dict)
                and target_payload.get("database")
                and target_payload.get("schema")
                and target_payload.get("table")
            ):
                actual_target = (
                    f"{target_payload.get('database')}.{target_payload.get('schema')}.{target_payload.get('table')}"
                )
            actual_derived = sorted(str(value) for value in (data.get("derived_source_ids") or []))
            if (
                actual_sources == expected_sources
                and actual_derived == expected_derived
                and actual_target == expected_target
            ):
                return data
        return None

    def _delete_duplicate_bundles_for_selection(
        self,
        *,
        bundle_id: str,
        selected_source_tables: list[TableRef],
        derived_source_ids: list[str],
        target_table: TableRef | None,
    ) -> None:
        expected_sources = sorted(table.qualified_name for table in selected_source_tables)
        expected_derived = sorted(derived_source_ids)
        expected_target = target_table.qualified_name if target_table else None
        rows = self._session.sql(
            f"""
            SELECT *
            FROM {self._bundle_table}
            ORDER BY LAST_GENERATED_AT DESC
            LIMIT 250
            """
        ).collect()
        duplicate_ids: list[str] = []
        for row in rows:
            data = self._bundle_row_to_dict(row.as_dict())
            row_bundle_id = str(data.get("bundle_id") or "")
            if not row_bundle_id or row_bundle_id == bundle_id:
                continue
            actual_sources = sorted(
                f"{item.get('database')}.{item.get('schema')}.{item.get('table')}"
                for item in (data.get("source_tables") or [])
                if isinstance(item, dict) and item.get("database") and item.get("schema") and item.get("table")
            )
            actual_target = None
            target_payload = data.get("target_table")
            if (
                isinstance(target_payload, dict)
                and target_payload.get("database")
                and target_payload.get("schema")
                and target_payload.get("table")
            ):
                actual_target = (
                    f"{target_payload.get('database')}.{target_payload.get('schema')}.{target_payload.get('table')}"
                )
            actual_derived = sorted(str(value) for value in (data.get("derived_source_ids") or []))
            if (
                actual_sources == expected_sources
                and actual_derived == expected_derived
                and actual_target == expected_target
            ):
                duplicate_ids.append(row_bundle_id)
        for duplicate_id in duplicate_ids:
            self._session.sql(
                f"DELETE FROM {self._bundle_table} WHERE SEMANTIC_BUNDLE_ID = {_quote_literal(duplicate_id)}"
            ).collect()

    def _upsert_bundle(
        self,
        *,
        bundle_id: str,
        bundle_hash: str,
        selection_key: str,
        bundle_label: str,
        target_table: TableRef | None,
        source_tables: list[TableRef],
        derived_source_ids: list[str],
        relationships: list[dict[str, Any]],
        semantic_level: SemanticLevel,
        semantic_view_name: str | None,
        semantic_model_yaml: str | None,
        analyst_tool_name: str | None,
        status: SemanticBundleStatus,
        stale_reason: str | None,
        datahub_context: dict[str, object] | None,
        registry_version: str | None = None,
        raw_assets: list[dict[str, Any]] | None = None,
        derived_semantics: list[dict[str, Any]] | None = None,
        excluded_relationships: list[dict[str, Any]] | None = None,
        composition_diagnostics: list[dict[str, Any]] | None = None,
    ) -> None:
        promoted_at = "CURRENT_TIMESTAMP()" if semantic_view_name else "NULL"
        # Bind large JSON values instead of interpolating them into SQL text.
        # Authoritative YAML assets can contain quotes, control characters and
        # large nested documents; binding keeps PARSE_JSON lossless and avoids
        # Snowflake reporting an "unterminated string" during bundle caching.
        json_params = [
            json.dumps(
                target_table.model_dump(mode="json") if target_table else None,
                default=str,
            ),
            json.dumps(
                [table.model_dump(mode="json") for table in source_tables],
                default=str,
            ),
            json.dumps(derived_source_ids, default=str),
            json.dumps(relationships, default=str),
            json.dumps(datahub_context, default=str),
            json.dumps(raw_assets or [], default=str),
            json.dumps(derived_semantics or [], default=str),
            json.dumps(excluded_relationships or [], default=str),
            json.dumps(composition_diagnostics or [], default=str),
        ]
        self._session.sql(
            f"""
            MERGE INTO {self._bundle_table} AS target
            USING (
              SELECT
                {_quote_literal(bundle_id)} AS SEMANTIC_BUNDLE_ID,
                {_quote_literal(bundle_hash)} AS BUNDLE_HASH,
                {_quote_literal(selection_key)} AS SELECTION_KEY,
                {_quote_literal(bundle_label)} AS BUNDLE_LABEL,
                PARSE_JSON(?) AS TARGET_TABLE,
                PARSE_JSON(?) AS SOURCE_TABLES,
                PARSE_JSON(?) AS DERIVED_SOURCE_IDS,
                PARSE_JSON(?) AS RELATIONSHIPS,
                {_quote_literal(semantic_level.value)} AS SEMANTIC_LEVEL,
                {_quote_literal(semantic_view_name or "")} AS SEMANTIC_VIEW_NAME,
                {_quote_literal(semantic_model_yaml or "")} AS SEMANTIC_MODEL_YAML,
                {_quote_literal(analyst_tool_name or "")} AS ANALYST_TOOL_NAME,
                {_quote_literal(status.value)} AS STATUS,
                {_quote_literal(stale_reason or "")} AS STALE_REASON,
                PARSE_JSON(?) AS DATAHUB_CONTEXT
                ,{_quote_literal(registry_version or "")} AS REGISTRY_VERSION
                ,PARSE_JSON(?) AS RAW_ASSETS
                ,PARSE_JSON(?) AS DERIVED_SEMANTICS
                ,PARSE_JSON(?) AS EXCLUDED_RELATIONSHIPS
                ,PARSE_JSON(?) AS COMPOSITION_DIAGNOSTICS
            ) AS source
            ON target.SEMANTIC_BUNDLE_ID = source.SEMANTIC_BUNDLE_ID
            WHEN MATCHED THEN UPDATE SET
              BUNDLE_HASH = source.BUNDLE_HASH,
              SELECTION_KEY = source.SELECTION_KEY,
              BUNDLE_LABEL = source.BUNDLE_LABEL,
              TARGET_TABLE = source.TARGET_TABLE,
              SOURCE_TABLES = source.SOURCE_TABLES,
              DERIVED_SOURCE_IDS = source.DERIVED_SOURCE_IDS,
              RELATIONSHIPS = source.RELATIONSHIPS,
              SEMANTIC_LEVEL = source.SEMANTIC_LEVEL,
              SEMANTIC_VIEW_NAME = source.SEMANTIC_VIEW_NAME,
              SEMANTIC_MODEL_YAML = source.SEMANTIC_MODEL_YAML,
              ANALYST_TOOL_NAME = source.ANALYST_TOOL_NAME,
              STATUS = source.STATUS,
              STALE_REASON = source.STALE_REASON,
              DATAHUB_CONTEXT = source.DATAHUB_CONTEXT,
              REGISTRY_VERSION = source.REGISTRY_VERSION,
              RAW_ASSETS = source.RAW_ASSETS,
              DERIVED_SEMANTICS = source.DERIVED_SEMANTICS,
              EXCLUDED_RELATIONSHIPS = source.EXCLUDED_RELATIONSHIPS,
              COMPOSITION_DIAGNOSTICS = source.COMPOSITION_DIAGNOSTICS,
              LAST_GENERATED_AT = CURRENT_TIMESTAMP(),
              LAST_PROMOTED_AT = {promoted_at},
              UPDATED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
              SEMANTIC_BUNDLE_ID,
              BUNDLE_HASH,
              SELECTION_KEY,
              BUNDLE_LABEL,
              TARGET_TABLE,
              SOURCE_TABLES,
              DERIVED_SOURCE_IDS,
              RELATIONSHIPS,
              SEMANTIC_LEVEL,
              SEMANTIC_VIEW_NAME,
              SEMANTIC_MODEL_YAML,
              ANALYST_TOOL_NAME,
              STATUS,
              STALE_REASON,
              DATAHUB_CONTEXT,
              REGISTRY_VERSION,
              RAW_ASSETS,
              DERIVED_SEMANTICS,
              EXCLUDED_RELATIONSHIPS,
              COMPOSITION_DIAGNOSTICS,
              LAST_GENERATED_AT,
              LAST_PROMOTED_AT,
              UPDATED_AT
            ) VALUES (
              source.SEMANTIC_BUNDLE_ID,
              source.BUNDLE_HASH,
              source.SELECTION_KEY,
              source.BUNDLE_LABEL,
              source.TARGET_TABLE,
              source.SOURCE_TABLES,
              source.DERIVED_SOURCE_IDS,
              source.RELATIONSHIPS,
              source.SEMANTIC_LEVEL,
              source.SEMANTIC_VIEW_NAME,
              source.SEMANTIC_MODEL_YAML,
              source.ANALYST_TOOL_NAME,
              source.STATUS,
              source.STALE_REASON,
              source.DATAHUB_CONTEXT,
              source.REGISTRY_VERSION,
              source.RAW_ASSETS,
              source.DERIVED_SEMANTICS,
              source.EXCLUDED_RELATIONSHIPS,
              source.COMPOSITION_DIAGNOSTICS,
              CURRENT_TIMESTAMP(),
              {promoted_at},
              CURRENT_TIMESTAMP()
            )
            """,
            params=json_params,
        ).collect()

    def _bundle_row_to_dict(self, row: dict[str, Any]) -> dict[str, Any]:
        source_tables = _variant_to_python(row.get("SOURCE_TABLES")) or []
        derived_source_ids = _variant_to_python(row.get("DERIVED_SOURCE_IDS")) or []
        target_table = _variant_to_python(row.get("TARGET_TABLE"))
        return {
            "bundle_id": row.get("SEMANTIC_BUNDLE_ID"),
            "bundle_hash": row.get("BUNDLE_HASH"),
            "selection_key": row.get("SELECTION_KEY") or None,
            "bundle_label": row.get("BUNDLE_LABEL")
            or _bundle_label_from_payload(source_tables, derived_source_ids, target_table),
            "target_table": target_table,
            "source_tables": source_tables,
            "derived_source_ids": derived_source_ids,
            "relationships": _variant_to_python(row.get("RELATIONSHIPS")) or [],
            "semantic_level": SemanticLevel.FULL_REGISTRY,
            "semantic_view_name": row.get("SEMANTIC_VIEW_NAME") or None,
            "semantic_model_yaml": row.get("SEMANTIC_MODEL_YAML") or None,
            "registry_version": row.get("REGISTRY_VERSION") or None,
            "raw_assets": _variant_to_python(row.get("RAW_ASSETS")) or [],
            "derived_semantics": _variant_to_python(row.get("DERIVED_SEMANTICS")) or [],
            "excluded_relationships": _variant_to_python(row.get("EXCLUDED_RELATIONSHIPS")) or [],
            "composition_diagnostics": _variant_to_python(row.get("COMPOSITION_DIAGNOSTICS")) or [],
            "bundle_artifact": _variant_to_python(row.get("BUNDLE_ARTIFACT")),
            "updated_at": row.get("UPDATED_AT"),
            "analyst_tool_name": row.get("ANALYST_TOOL_NAME") or None,
            "status": row.get("STATUS"),
            "stale_reason": row.get("STALE_REASON") or None,
        }

    def _lineage_from_record(self, record: Any) -> SemanticBundleLineage:
        return SemanticBundleLineage(
            derived_source_id=record.derived_source_id,
            derived_source_name=record.derived_source_name,
            parent_derived_source_ids=record.parent_derived_source_ids,
            base_source_tables=record.base_source_tables,
            lineage_depth=record.lineage_depth,
            upstream_hash=record.upstream_hash,
        )

    def _derived_source_tables(self, derived_records: list[Any]) -> list[TableRef]:
        tables: dict[str, TableRef] = {}
        for record in derived_records:
            for table in record.base_source_tables or []:
                if isinstance(table, TableRef):
                    tables[table.qualified_name.upper()] = table
        return [tables[key] for key in sorted(tables)]

    @staticmethod
    def _derived_table_ref(record: Any) -> TableRef:
        return TableRef(database="DERIVED", schema="DERIVED", table=record.derived_source_id)

    @staticmethod
    def _analyst_source_tables(
        selected_source_tables: list[TableRef],
        derived_records: list[Any],
    ) -> list[TableRef]:
        tables: dict[str, TableRef] = {
            table.qualified_name.upper(): table for table in selected_source_tables
        }
        for record in derived_records:
            physical_view_name = str(getattr(record, "physical_view_name", "") or "")
            parts = physical_view_name.split(".")
            if len(parts) == 3:
                table = TableRef(database=parts[0], schema=parts[1], table=parts[2])
                tables[table.qualified_name.upper()] = table
                continue
            for table in getattr(record, "base_source_tables", []) or []:
                if isinstance(table, TableRef):
                    tables[table.qualified_name.upper()] = table
        return [tables[key] for key in sorted(tables)]

    def _semantic_view_name(
        self,
        *,
        bundle_id: str,
        selected_source_tables: list[TableRef],
        derived_records: list[Any],
        target_table: TableRef | None,
    ) -> str:
        readable = _semantic_asset_suffix(
            selected_source_tables=selected_source_tables,
            derived_records=derived_records,
            target_table=target_table,
            bundle_id=bundle_id,
        )
        return (
            f"{self._settings.resolved_metadata_database}."
            f"{self._settings.resolved_metadata_schema}."
            f"SV_STTM_{readable}"
        )

    def _bundle_label(
        self,
        *,
        selected_source_tables: list[TableRef],
        derived_records: list[Any],
        target_table: TableRef | None,
    ) -> str:
        raw_names = [table.table for table in selected_source_tables]
        raw_names.extend(
            record.derived_source_name or record.derived_source_id
            for record in derived_records
        )
        names = [name for name in raw_names if name]
        if not names:
            return "Selected working set"
        visible = names[:3]
        label = " + ".join(visible)
        if len(names) > 3:
            label = f"{label} + {len(names) - 3} more"
        if target_table:
            label = f"{label} -> {target_table.table}"
        return label

    def _bundle_label_from_id(self, bundle_id: str) -> str:
        existing = self.get_bundle(bundle_id=bundle_id)
        if existing and existing.get("bundle_label"):
            return str(existing["bundle_label"])
        return f"bundle {bundle_id}"


def _normalize_relationships(relationships: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for relationship in relationships:
        left_ref = _table_ref_from_payload(relationship.get("left_table"))
        right_ref = _table_ref_from_payload(relationship.get("right_table"))
        left_table = left_ref.model_dump(mode="json") if left_ref else {}
        right_table = right_ref.model_dump(mode="json") if right_ref else {}
        normalized.append(
            {
                "left_table": left_table,
                "right_table": right_table,
                "constraint_name": relationship.get("constraint_name"),
                "join_type": _normalize_join_type(relationship.get("join_type")),
                "source": relationship.get("source"),
                "locked": relationship.get("locked", False),
                "conditions": sorted(
                    [
                        {
                            "left_column": str(item.get("left_column") or ""),
                            "right_column": str(item.get("right_column") or ""),
                            "operator": str(item.get("operator") or "="),
                        }
                        for item in (relationship.get("conditions") or [])
                        if item.get("left_column") and item.get("right_column")
                    ],
                    key=lambda item: (
                        item.get("left_column", ""),
                        item.get("right_column", ""),
                        item.get("operator", "="),
                    ),
                ),
            }
        )
    return sorted(
        normalized,
        key=lambda item: (
            json.dumps(item.get("left_table") or {}, sort_keys=True),
            json.dumps(item.get("right_table") or {}, sort_keys=True),
            item.get("join_type") or "",
        ),
    )


def _canonical_relationships_for_hash(relationships: list[dict[str, Any]]) -> list[dict[str, Any]]:
    canonical: list[dict[str, Any]] = []
    for relationship in relationships:
        left_ref = _table_ref_from_payload(relationship.get("left_table"))
        right_ref = _table_ref_from_payload(relationship.get("right_table"))
        if left_ref is None or right_ref is None:
            continue

        left_name = left_ref.qualified_name
        right_name = right_ref.qualified_name
        conditions = [
            {
                "left_column": str(item.get("left_column") or ""),
                "right_column": str(item.get("right_column") or ""),
                "operator": str(item.get("operator") or "="),
            }
            for item in (relationship.get("conditions") or [])
            if item.get("left_column") and item.get("right_column")
        ]
        if not conditions:
            continue

        if right_name < left_name:
            left_name, right_name = right_name, left_name
            conditions = [
                {
                    "left_column": item["right_column"],
                    "right_column": item["left_column"],
                    "operator": item["operator"],
                }
                for item in conditions
            ]

        canonical.append(
            {
                "left_table": left_name,
                "right_table": right_name,
                "join_type": _normalize_join_type(relationship.get("join_type")),
                "conditions": sorted(
                    conditions,
                    key=lambda item: (
                        item["left_column"],
                        item["right_column"],
                        item["operator"],
                    ),
                ),
            }
        )

    return sorted(
        canonical,
        key=lambda item: (
            item["left_table"],
            item["right_table"],
            item["join_type"],
            json.dumps(item["conditions"], sort_keys=True),
        ),
    )


def _normalize_join_type(value: Any) -> str:
    normalized = str(value or "INNER").strip().upper()
    if normalized.endswith(" JOIN"):
        normalized = normalized[:-5]
    if normalized in {"LEFT OUTER", "LEFT"}:
        return "LEFT"
    if normalized in {"RIGHT OUTER", "RIGHT"}:
        return "RIGHT"
    if normalized in {"FULL OUTER", "FULL"}:
        return "FULL"
    if normalized in {"INNER", "CROSS"}:
        return normalized
    return normalized or "INNER"


def _dedupe_tables(tables: Iterable[TableRef]) -> list[TableRef]:
    seen: dict[str, TableRef] = {}
    for table in tables:
        seen[table.qualified_name.upper()] = table
    return [seen[key] for key in sorted(seen)]


def _quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _variant_to_python(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _first_non_empty(*values: Any) -> Any:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if value not in (None, "", [], {}):
            return value
    return None


def _trim_value_profile(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    keep_keys = (
        "sample_values",
        "distinct_count",
        "null_count",
        "null_pct",
        "min",
        "max",
        "pattern",
        "business_terms",
    )
    trimmed = {key: value.get(key) for key in keep_keys if key in value}
    sample_values = trimmed.get("sample_values")
    if isinstance(sample_values, list) and len(sample_values) > 5:
        trimmed["sample_values"] = sample_values[:5]
    return {key: item for key, item in trimmed.items() if item not in (None, "", [], {})}


def _semantic_sample_value(value: Any) -> str:
    """Render Snowflake semantic YAML sample values as valid scalar strings."""
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _compact_named_list(value: Any, *, limit: int = 12) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    compact: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        compact.append(
            {
                key: item.get(key)
                for key in (
                    "name",
                    "description",
                    "summary",
                    "expr",
                    "sql",
                    "question",
                    "verified",
                    "confidence",
                )
                if item.get(key) not in (None, "", [], {})
            }
        )
        if len(compact) >= limit:
            break
    return compact


def _compact_relationship_model(value: Any, *, limit: int = 20) -> dict[str, Any] | list[Any]:
    def _compact_candidate(candidate: Any) -> dict[str, Any] | None:
        if not isinstance(candidate, dict):
            return None
        return {
            key: candidate.get(key)
            for key in (
                "type",
                "confidence",
                "database",
                "schema",
                "table",
                "relationship_type",
                "cardinality",
                "join_type",
                "column_mappings",
                "conditions",
                "semantic_review",
                "relationship_evidence",
                "inferred_method",
                "value_overlap_pct",
            )
            if candidate.get(key) not in (None, "", [], {})
        }

    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for direction in ("outgoing", "incoming", "relationships", "candidates"):
            candidates = value.get(direction)
            if not isinstance(candidates, list):
                continue
            compact = [
                compact_candidate
                for candidate in candidates[:limit]
                if (compact_candidate := _compact_candidate(candidate)) is not None
            ]
            if compact:
                result[direction] = compact
        return result
    if isinstance(value, list):
        return [
            compact_candidate
            for candidate in value[:limit]
            if (compact_candidate := _compact_candidate(candidate)) is not None
        ]
    return {}


def _logical_table_name(table: TableRef) -> str:
    raw = f"{table.database}_{table.schema}_{table.table}"
    return "".join(char if char.isalnum() else "_" for char in raw).strip("_").lower()


def _constraints_include(constraints: Any, expected: str) -> bool:
    if not isinstance(constraints, list):
        return False
    for item in constraints:
        if isinstance(item, str) and item.upper() == expected:
            return True
    return False


def _has_foreign_key(constraints: Any) -> bool:
    if not isinstance(constraints, list):
        return False
    for item in constraints:
        if isinstance(item, dict) and str(item.get("type") or "").upper() == "FOREIGN_KEY":
            return True
    return False


def _semantic_view_entity_description(attribute: dict[str, Any]) -> str:
    base = (
        str(attribute.get("business_meaning") or "").strip()
        or str(attribute.get("description") or "").strip()
        or str(attribute.get("summary") or "").strip()
        or str(attribute.get("name") or "").strip()
    )
    notes: list[str] = []
    semantic_role = str(attribute.get("semantic_role") or "").strip().lower()
    if attribute.get("is_primary_key"):
        notes.append("Primary key.")
    elif attribute.get("is_foreign_key"):
        notes.append("Foreign key.")
    elif semantic_role:
        notes.append(f"Semantic role: {semantic_role.replace('_', ' ')}.")

    constraints = attribute.get("constraints") or []
    for item in constraints:
        if isinstance(item, dict) and str(item.get("type") or "").upper() == "FOREIGN_KEY":
            refs = item.get("references") or {}
            ref_table = str(refs.get("table") or "").strip()
            ref_column = str(refs.get("column") or "").strip()
            if ref_table and ref_column:
                notes.append(f"References {ref_table}.{ref_column}.")
            elif ref_table:
                notes.append(f"References {ref_table}.")

    semantic_notes = [
        str(item).strip()
        for item in (attribute.get("semantic_notes") or [])
        if isinstance(item, str) and item.strip()
    ]
    pii_note = next(
        (
            note
            for note in semantic_notes
            if "sensitive" in note.lower() or "pii" in note.lower() or "mask" in note.lower()
        ),
        None,
    )
    if pii_note:
        notes.append(pii_note.rstrip(".") + ".")

    for note in semantic_notes:
        if note == pii_note:
            continue
        lowered = note.lower()
        if "candidate for derived" in lowered or "aggregation should" in lowered or "latest-record" in lowered:
            notes.append(note.rstrip(".") + ".")
            break

    if not notes:
        return base
    return f"{base} {' '.join(notes)}".strip()


def _is_numeric_type(data_type: str) -> bool:
    normalized = data_type.upper()
    return any(
        token in normalized
        for token in ("NUMBER", "DECIMAL", "NUMERIC", "INT", "FLOAT", "DOUBLE", "REAL")
    )


def _is_time_type(data_type: str) -> bool:
    normalized = data_type.upper()
    return any(token in normalized for token in ("DATE", "TIME", "TIMESTAMP"))


def _looks_like_identifier(column_name: str) -> bool:
    normalized = column_name.upper()
    return normalized.endswith("_ID") or normalized.endswith("ID") or normalized.endswith("_KEY")


def _table_ref_from_payload(payload: Any) -> TableRef | None:
    if isinstance(payload, str):
        parts = payload.split(".", 2)
        if len(parts) == 3 and all(parts):
            return TableRef(database=parts[0], schema=parts[1], table=parts[2])
        return None
    if not isinstance(payload, dict):
        return None
    database = payload.get("database")
    schema = payload.get("schema")
    table = payload.get("table")
    if not all(isinstance(value, str) and value for value in (database, schema, table)):
        return None
    return TableRef(database=database, schema=schema, table=table)


def _bundle_label_from_payload(
    source_tables: list[dict[str, Any]],
    derived_source_ids: list[str],
    target_table: dict[str, Any] | None,
) -> str | None:
    names = [str(item.get("table")) for item in source_tables if isinstance(item, dict) and item.get("table")]
    names.extend(item for item in derived_source_ids if item)
    if not names:
        return None
    visible = names[:3]
    label = " + ".join(visible)
    if len(names) > 3:
        label = f"{label} + {len(names) - 3} more"
    if isinstance(target_table, dict) and target_table.get("table"):
        label = f"{label} -> {target_table['table']}"
    return label


def _semantic_asset_suffix(
    *,
    selected_source_tables: list[TableRef],
    derived_records: list[Any],
    target_table: TableRef | None,
    bundle_id: str,
) -> str:
    raw_names = [table.table for table in selected_source_tables]
    raw_names.extend(
        str(record.derived_source_name or record.derived_source_id or "")
        for record in derived_records
    )
    source_slug = _slugify_identifier("_".join([name for name in raw_names[:2] if name]), limit=17) or "WORKSET"
    target_slug = _slugify_identifier(target_table.table if target_table else "", limit=17) or "CONTEXT"
    return f"{source_slug}__TO__{target_slug}__{bundle_id[-8:].upper()}"


def _analyst_tool_name(
    *,
    selected_source_tables: list[TableRef],
    derived_records: list[Any],
    target_table: TableRef | None,
    bundle_id: str,
) -> str:
    return f"ANALYST_STTM_{_semantic_asset_suffix(selected_source_tables=selected_source_tables, derived_records=derived_records, target_table=target_table, bundle_id=bundle_id)}"


def _slugify_identifier(value: str, *, limit: int = 48) -> str:
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", value.strip()).strip("_").upper()
    if not normalized:
        return ""
    return normalized[:limit].rstrip("_")
