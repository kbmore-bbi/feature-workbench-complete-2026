from __future__ import annotations

import logging
from typing import Any

from app.core.agent_learning_service import AgentLearningService

logger = logging.getLogger(__name__)


class MappingKnowledgeProjector:
    """Project a canonical workspace snapshot into reusable structural learnings."""

    _TRUSTED_PROVENANCE = {
        "published_mapping",
        "historical_import",
        "client_asset_import",
        "validated_sql",
        "explicit_correction",
    }

    def __init__(self, learning_service: AgentLearningService) -> None:
        self._learning = learning_service

    @staticmethod
    def _table_fqn(value: Any) -> str:
        if not isinstance(value, dict):
            return str(value or "")
        return ".".join(
            str(value.get(key) or "")
            for key in ("database", "schema", "table")
            if value.get(key)
        )

    @staticmethod
    def _dict_list(snapshot: dict[str, Any], *keys: str) -> list[dict[str, Any]]:
        for key in keys:
            value = snapshot.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        return []

    @staticmethod
    def _string_list(value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(item) for item in value if item]
        if value:
            return [str(value)]
        return []

    def project(
        self,
        *,
        project_id: str,
        sttm_id: str,
        snapshot: dict[str, Any],
        outcome: str,
        user_id: str | None,
    ) -> int:
        provenance = str(
            snapshot.get("provenance")
            or snapshot.get("metadata", {}).get("provenance")
            or outcome
        ).lower()
        trusted = provenance in self._TRUSTED_PROVENANCE or outcome in {
            "published",
            "validated",
        }
        confidence = 1.0 if outcome == "published" else 0.9 if trusted else 0.75
        source_tables = [
            self._table_fqn(item)
            for item in self._dict_list(snapshot, "source_tables")
            if self._table_fqn(item)
        ]
        target_table = self._table_fqn(snapshot.get("target_table"))
        common = {
            "project_id": project_id,
            "sttm_id": sttm_id,
            "source_tables": source_tables,
            "target_table": target_table,
            "provenance": provenance,
            "outcome": outcome,
            "reusability": "structural",
        }
        count = 0

        def record(
            *,
            agent_type: str,
            learning_type: str,
            summary: str,
            attributes: dict[str, Any],
            entity_type: str,
            tags: list[str],
            item_confidence: float = confidence,
        ) -> None:
            nonlocal count
            try:
                self._learning.record_learning(
                    agent_type=agent_type,
                    learning_type=learning_type,
                    summary=summary,
                    attributes={**common, **attributes},
                    entity_type=entity_type,
                    entity_ids={"project_id": project_id, "sttm_id": sttm_id},
                    tags=tags,
                    confidence=item_confidence,
                    user_id=user_id,
                )
                count += 1
            except Exception as exc:  # learning must never block publication
                logger.warning("Unable to project %s learning: %s", learning_type, exc)

        for row in self._dict_list(snapshot, "mapping_rows", "mappings"):
            target_column = str(
                row.get("target_column")
                or row.get("target_attribute")
                or row.get("attribute_name")
                or ""
            )
            if not target_column:
                continue
            source_columns = self._string_list(
                row.get("source_columns")
                or row.get("source_column")
                or row.get("source_expression")
            )
            expression = str(
                row.get("preprocessing_rule")
                or row.get("transformation_logic")
                or row.get("expression")
                or ""
            )
            constant_value = row.get("constant_value")
            mapping_kind = "constant" if constant_value is not None else "column"
            reusability = "project_specific" if constant_value is not None else "structural"
            attributes = {
                "target_column": target_column,
                "source_columns": source_columns,
                "expression": expression,
                "mapping_kind": mapping_kind,
                "reusability": reusability,
                "constant_present": constant_value is not None,
            }
            if constant_value is not None:
                attributes["constant_value"] = constant_value
            record(
                agent_type="SOURCE_MAPPING",
                learning_type="column_mapping",
                summary=f"{target_column} is produced from {', '.join(source_columns) or mapping_kind}.",
                attributes=attributes,
                entity_type="target_column",
                tags=["mapping", mapping_kind, outcome],
            )
            if expression:
                record(
                    agent_type="TRANSFORMATION_RULE",
                    learning_type="transformation_pattern",
                    summary=f"{target_column} uses transformation: {expression}",
                    attributes=attributes,
                    entity_type="transformation",
                    tags=["transformation", outcome],
                )

        for relationship in self._dict_list(snapshot, "relationships", "joins"):
            left = str(relationship.get("left_table") or relationship.get("source_table") or "")
            right = str(relationship.get("right_table") or relationship.get("target_table") or "")
            join_type = str(relationship.get("join_type") or relationship.get("type") or "INNER")
            condition = relationship.get("condition") or relationship.get("conditions") or relationship.get("on")
            record(
                agent_type="STTM_BUILDER",
                learning_type="table_relationship",
                summary=f"{left} {join_type} joins {right} using {condition}.",
                attributes={
                    "left_table": left,
                    "right_table": right,
                    "join_type": join_type,
                    "condition": condition,
                    "business_purpose": relationship.get("business_purpose"),
                    "cardinality": relationship.get("cardinality"),
                    "fanout_risk": relationship.get("fanout_risk"),
                },
                entity_type="relationship",
                tags=["relationship", join_type.lower(), outcome],
            )

        query_structures = (
            ("filters", "query_filter"),
            ("filter_conditions", "query_filter"),
            ("grouping", "query_grouping"),
            ("group_by", "query_grouping"),
            ("sorting", "query_sorting"),
            ("order_by", "query_sorting"),
        )
        seen_query_items: set[str] = set()
        for key, learning_type in query_structures:
            value = snapshot.get(key)
            if value in (None, [], {}):
                continue
            identity = f"{learning_type}:{value}"
            if identity in seen_query_items:
                continue
            seen_query_items.add(identity)
            record(
                agent_type="STTM_BUILDER",
                learning_type=learning_type,
                summary=f"The mapping applies {learning_type.replace('_', ' ')}: {value}.",
                attributes={"query_shape": value},
                entity_type="query_shape",
                tags=[learning_type, outcome],
            )

        for cte in self._dict_list(snapshot, "ctes", "derived_sources"):
            name = str(cte.get("name") or cte.get("id") or cte.get("alias") or "derived_source")
            record(
                agent_type="STTM_BUILDER",
                learning_type="cte_lineage",
                summary=f"{name} is an intermediate source in the mapping lineage.",
                attributes={
                    "name": name,
                    "sql": cte.get("sql") or cte.get("query"),
                    "input_tables": cte.get("input_tables") or cte.get("source_tables") or [],
                    "output_columns": cte.get("output_columns") or cte.get("selected_columns") or [],
                    "grain": cte.get("grain"),
                    "purpose": cte.get("purpose") or cte.get("description"),
                },
                entity_type="derived_lineage",
                tags=["cte", "lineage", outcome],
            )

        validation = snapshot.get("validation") or snapshot.get("validation_history")
        if validation:
            record(
                agent_type="STTM_BUILDER",
                learning_type="validation_outcome",
                summary=f"Mapping validation outcome: {validation}",
                attributes={"validation": validation},
                entity_type="validation",
                tags=["validation", outcome],
            )
        return count
