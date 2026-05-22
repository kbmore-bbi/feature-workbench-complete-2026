import hashlib
import json
import logging
from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from snowflake.snowpark import Session
import yaml

from app.core.config import Settings
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
)
from app.schema.sttm_builder import RelationshipContextItem, SemanticContextItem

logger = logging.getLogger(__name__)

_LEVEL_ORDER = {
    SemanticLevel.L0_RELATIONSHIP: 0,
    SemanticLevel.L1_CONTEXT: 1,
    SemanticLevel.L2_ANALYST_READY: 2,
    SemanticLevel.L3_MAPPING_ENRICHED: 3,
}


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
    ) -> None:
        self._session = session
        self._settings = settings
        self._semantic_model_service = semantic_model_service
        self._table_selection_service = table_selection_service
        self._derived_source_service = derived_source_service
        self._datahub = datahub_adapter or DataHubAdapter(settings)
        self._bundle_table = settings.qualify_table_name(settings.snowflake_semantic_bundles_table)
        self._overrides_table = settings.qualify_table_name(settings.snowflake_semantic_overrides_table)

    def refresh_bundle(
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
        bundle_id = f"sem_{bundle_hash[:16]}"
        bundle_label = self._bundle_label(
            selected_source_tables=selected_source_tables,
            derived_records=[],
            target_table=request.target_table,
        )
        existing = self.get_bundle(bundle_id=bundle_id) if storage_available else None

        derived_records = self._derived_source_service.get_sources_by_ids(selected_derived_ids)
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
            semantic_refresh_tables = self._analyst_source_tables(selected_source_tables)
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
            semantic_view_name = self._semantic_view_name(bundle_id)
            if existing_view_is_usable:
                semantic_view_name = existing["semantic_view_name"]
            else:
                try:
                    analyst_source_tables = self._analyst_source_tables(selected_source_tables)
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
        should_sync_analyst_tool = bool(
            semantic_view_name
            and (
                not promoted
                and (
                    request.force
                    or not analyst_tool_name
                    or not existing
                    or str(existing.get("semantic_view_name") or "") != semantic_view_name
                )
            )
        )

        if should_sync_analyst_tool and semantic_view_name:
            try:
                synced_tool_name = self._sync_builder_agent_analyst_tool(
                    bundle_id=bundle_id,
                    semantic_view_name=semantic_view_name,
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
                bundle_label=bundle_label,
                target_table=request.target_table,
                source_tables=selected_source_tables,
                derived_source_ids=selected_derived_ids,
                relationships=normalized_relationships,
                semantic_level=achieved_level,
                semantic_view_name=semantic_view_name,
                analyst_tool_name=analyst_tool_name,
                status=status,
                stale_reason="; ".join(notes) or None,
                datahub_context=datahub_context,
            )

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
            datahub_context=datahub_context,
        )

    def get_bundle(
        self,
        *,
        bundle_id: str | None = None,
        bundle_hash: str | None = None,
    ) -> dict[str, Any] | None:
        if not bundle_id and not bundle_hash:
            return None
        try:
            self.ensure_storage_exists()
        except Exception:
            return None
        predicates = []
        if bundle_id:
            predicates.append(f"SEMANTIC_BUNDLE_ID = {_quote_literal(bundle_id)}")
        if bundle_hash:
            predicates.append(f"BUNDLE_HASH = {_quote_literal(bundle_hash)}")
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
        return self._bundle_row_to_dict(rows[0].as_dict())

    def ensure_storage_exists(self) -> None:
        try:
            self._session.sql(
                f"""
                CREATE TABLE IF NOT EXISTS {self._bundle_table} (
                    SEMANTIC_BUNDLE_ID STRING,
                    BUNDLE_HASH STRING,
                    BUNDLE_LABEL STRING,
                    TARGET_TABLE VARIANT,
                    SOURCE_TABLES VARIANT,
                    DERIVED_SOURCE_IDS VARIANT,
                    RELATIONSHIPS VARIANT,
                    SEMANTIC_LEVEL STRING,
                    SEMANTIC_VIEW_NAME STRING,
                    ANALYST_TOOL_NAME STRING,
                    STATUS STRING,
                    STALE_REASON STRING,
                    DATAHUB_CONTEXT VARIANT,
                    LAST_GENERATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                    LAST_PROMOTED_AT TIMESTAMP_NTZ,
                    UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
                )
                """
            ).collect()
            self._session.sql(
                f"ALTER TABLE {self._bundle_table} ADD COLUMN IF NOT EXISTS BUNDLE_LABEL STRING"
            ).collect()
            self._session.sql(
                f"ALTER TABLE {self._bundle_table} ADD COLUMN IF NOT EXISTS ANALYST_TOOL_NAME STRING"
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
            f"{record['database']}.{record['schema_name']}.{record['table_name']}": record
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
                        semantic_model=record["semantic_model"],
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
                    semantic_model={
                        "description": f"Derived source {record.derived_source_name}",
                        "semantic_level": requested_level.value,
                        "sql_text": record.sql_text,
                        "parent_derived_source_ids": record.parent_derived_source_ids,
                        "base_source_tables": [table.model_dump(mode="json") for table in record.base_source_tables],
                        "preview_columns": [column.model_dump(mode="json") for column in record.preview_columns],
                    },
                )
            )
        return context_items

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
              FALSE
            )
            """
        ).collect()
        analyst_tool_name = self._sync_builder_agent_analyst_tool(
            bundle_id=bundle_id,
            semantic_view_name=semantic_view_name,
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
    ) -> str:
        analyst_source_tables = self._analyst_source_tables(selected_source_tables)
        if not analyst_source_tables:
            raise ValueError("semantic view promotion requires at least one raw source table")
        table_records = self._semantic_model_service.get_table_records(self._session, analyst_source_tables)
        table_records_by_name = {
            f"{record['database']}.{record['schema_name']}.{record['table_name']}": record
            for record in table_records
            if record.get("table_name")
        }

        logical_names: dict[str, str] = {}
        unique_columns_by_table: dict[str, set[str]] = {}
        yaml_tables: list[dict[str, Any]] = []
        for table in analyst_source_tables:
            logical_name = _logical_table_name(table)
            logical_names[table.qualified_name] = logical_name
            record = table_records_by_name.get(table.qualified_name)
            attributes = self._attributes_for_table(
                table=table,
                table_record=record,
                derived_record=None,
            )
            unique_columns_by_table[table.qualified_name] = {
                str(item["name"])
                for item in attributes
                if item.get("is_primary_key")
            }
            yaml_tables.append(
                self._build_yaml_table(
                    logical_name=logical_name,
                    table=table,
                    table_record=record,
                    derived_record=None,
                )
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
            left_cols = {item["left_column"] for item in relationship_columns}
            right_cols = {item["right_column"] for item in relationship_columns}
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
        return yaml.safe_dump(payload, sort_keys=False, allow_unicode=False)

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
        for attribute in attributes:
            entity = {
                "name": attribute["name"],
                "description": attribute.get("description") or attribute.get("summary") or attribute["name"],
                "expr": attribute["name"],
                "data_type": attribute["data_type"],
            }
            if attribute.get("is_primary_key"):
                entity["unique"] = True
            if _is_time_type(attribute["data_type"]):
                time_dimensions.append(entity)
            elif _is_numeric_type(attribute["data_type"]) and not (
                attribute.get("is_primary_key")
                or attribute.get("is_foreign_key")
                or _looks_like_identifier(attribute["name"])
            ):
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

        existing_tool_name = None
        for tool_name, resource in tool_resources.items():
            if not isinstance(resource, dict):
                continue
            if str(resource.get("semantic_view") or "") == semantic_view_name:
                existing_tool_name = str(tool_name)
                break

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

        tool_name = f"ANALYST_{bundle_id.upper()}"
        tools.append(
            {
                "tool_spec": {
                    "type": "cortex_analyst_text_to_sql",
                    "name": tool_name,
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
        tool_resources[tool_name] = resource
        self._replace_agent_from_spec(agent_name=agent_name, profile=str(profile), spec=spec)
        return tool_name

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
                        "is_primary_key": _constraints_include(item.get("constraints"), "PRIMARY_KEY"),
                        "is_foreign_key": _has_foreign_key(item.get("constraints")),
                    }
                    for item in attribute_rows
                    if isinstance(item, dict) and item.get("name")
                ]

        if derived_record is not None:
            return [
                {
                    "name": column.name,
                    "data_type": column.data_type,
                    "description": column.name,
                    "summary": column.name,
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
    ) -> str:
        payload = {
            "source_tables": sorted(table.qualified_name for table in selected_source_tables),
            "selected_derived_sources": sorted(selected_derived_sources),
            "target_table": target_table.qualified_name if target_table else None,
            "relationships": _canonical_relationships_for_hash(relationships),
        }
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _upsert_bundle(
        self,
        *,
        bundle_id: str,
        bundle_hash: str,
        bundle_label: str,
        target_table: TableRef | None,
        source_tables: list[TableRef],
        derived_source_ids: list[str],
        relationships: list[dict[str, Any]],
        semantic_level: SemanticLevel,
        semantic_view_name: str | None,
        analyst_tool_name: str | None,
        status: SemanticBundleStatus,
        stale_reason: str | None,
        datahub_context: dict[str, object] | None,
    ) -> None:
        promoted_at = "CURRENT_TIMESTAMP()" if semantic_view_name else "NULL"
        self._session.sql(
            f"""
            MERGE INTO {self._bundle_table} AS target
            USING (
              SELECT
                {_quote_literal(bundle_id)} AS SEMANTIC_BUNDLE_ID,
                {_quote_literal(bundle_hash)} AS BUNDLE_HASH,
                {_quote_literal(bundle_label)} AS BUNDLE_LABEL,
                PARSE_JSON({_json_literal(target_table.model_dump(mode="json") if target_table else None)}) AS TARGET_TABLE,
                PARSE_JSON({_json_literal([table.model_dump(mode="json") for table in source_tables])}) AS SOURCE_TABLES,
                PARSE_JSON({_json_literal(derived_source_ids)}) AS DERIVED_SOURCE_IDS,
                PARSE_JSON({_json_literal(relationships)}) AS RELATIONSHIPS,
                {_quote_literal(semantic_level.value)} AS SEMANTIC_LEVEL,
                {_quote_literal(semantic_view_name or "")} AS SEMANTIC_VIEW_NAME,
                {_quote_literal(analyst_tool_name or "")} AS ANALYST_TOOL_NAME,
                {_quote_literal(status.value)} AS STATUS,
                {_quote_literal(stale_reason or "")} AS STALE_REASON,
                PARSE_JSON({_json_literal(datahub_context)}) AS DATAHUB_CONTEXT
            ) AS source
            ON target.SEMANTIC_BUNDLE_ID = source.SEMANTIC_BUNDLE_ID
            WHEN MATCHED THEN UPDATE SET
              BUNDLE_HASH = source.BUNDLE_HASH,
              BUNDLE_LABEL = source.BUNDLE_LABEL,
              TARGET_TABLE = source.TARGET_TABLE,
              SOURCE_TABLES = source.SOURCE_TABLES,
              DERIVED_SOURCE_IDS = source.DERIVED_SOURCE_IDS,
              RELATIONSHIPS = source.RELATIONSHIPS,
              SEMANTIC_LEVEL = source.SEMANTIC_LEVEL,
              SEMANTIC_VIEW_NAME = source.SEMANTIC_VIEW_NAME,
              ANALYST_TOOL_NAME = source.ANALYST_TOOL_NAME,
              STATUS = source.STATUS,
              STALE_REASON = source.STALE_REASON,
              DATAHUB_CONTEXT = source.DATAHUB_CONTEXT,
              LAST_GENERATED_AT = CURRENT_TIMESTAMP(),
              LAST_PROMOTED_AT = {promoted_at},
              UPDATED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
              SEMANTIC_BUNDLE_ID,
              BUNDLE_HASH,
              BUNDLE_LABEL,
              TARGET_TABLE,
              SOURCE_TABLES,
              DERIVED_SOURCE_IDS,
              RELATIONSHIPS,
              SEMANTIC_LEVEL,
              SEMANTIC_VIEW_NAME,
              ANALYST_TOOL_NAME,
              STATUS,
              STALE_REASON,
              DATAHUB_CONTEXT,
              LAST_GENERATED_AT,
              LAST_PROMOTED_AT,
              UPDATED_AT
            ) VALUES (
              source.SEMANTIC_BUNDLE_ID,
              source.BUNDLE_HASH,
              source.BUNDLE_LABEL,
              source.TARGET_TABLE,
              source.SOURCE_TABLES,
              source.DERIVED_SOURCE_IDS,
              source.RELATIONSHIPS,
              source.SEMANTIC_LEVEL,
              source.SEMANTIC_VIEW_NAME,
              source.ANALYST_TOOL_NAME,
              source.STATUS,
              source.STALE_REASON,
              source.DATAHUB_CONTEXT,
              CURRENT_TIMESTAMP(),
              {promoted_at},
              CURRENT_TIMESTAMP()
            )
            """
        ).collect()

    def _bundle_row_to_dict(self, row: dict[str, Any]) -> dict[str, Any]:
        source_tables = _variant_to_python(row.get("SOURCE_TABLES")) or []
        derived_source_ids = _variant_to_python(row.get("DERIVED_SOURCE_IDS")) or []
        target_table = _variant_to_python(row.get("TARGET_TABLE"))
        return {
            "bundle_id": row.get("SEMANTIC_BUNDLE_ID"),
            "bundle_hash": row.get("BUNDLE_HASH"),
            "bundle_label": row.get("BUNDLE_LABEL")
            or _bundle_label_from_payload(source_tables, derived_source_ids, target_table),
            "target_table": target_table,
            "source_tables": source_tables,
            "derived_source_ids": derived_source_ids,
            "relationships": _variant_to_python(row.get("RELATIONSHIPS")) or [],
            "semantic_level": SemanticLevel(str(row.get("SEMANTIC_LEVEL") or SemanticLevel.L1_CONTEXT.value)),
            "semantic_view_name": row.get("SEMANTIC_VIEW_NAME") or None,
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
        return []

    @staticmethod
    def _derived_table_ref(record: Any) -> TableRef:
        return TableRef(database="DERIVED", schema="DERIVED", table=record.derived_source_id)

    @staticmethod
    def _analyst_source_tables(selected_source_tables: list[TableRef]) -> list[TableRef]:
        return list(selected_source_tables)

    def _semantic_view_name(self, bundle_id: str) -> str:
        return (
            f"{self._settings.resolved_metadata_database}."
            f"{self._settings.resolved_metadata_schema}."
            f"SV_{bundle_id.upper()}"
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


def _json_literal(value: Any) -> str:
    return _quote_literal(json.dumps(value, default=str))


def _variant_to_python(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


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
