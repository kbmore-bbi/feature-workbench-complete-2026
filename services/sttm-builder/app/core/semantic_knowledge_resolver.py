from __future__ import annotations

import json
from typing import Any

import yaml
from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.semantic_model import SemanticModelService
from app.schema.common import TableRef


class SemanticKnowledgeResolver:
    """Read-only resolver over native registry records and validated FIR overlays."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._service = SemanticModelService(settings)

    def resolve(self, session: Session, tables: list[TableRef]) -> list[dict[str, Any]]:
        records = self._service.get_table_records(session, tables)
        resolved: list[dict[str, Any]] = []
        for record in records:
            model = record.get("semantic_model")
            if not isinstance(model, dict):
                model = {}
            curated = model.get("curated_semantic_version")
            registry = record.get("registry") if isinstance(record.get("registry"), dict) else {}
            resolved.append(
                {
                    "fqn": self._record_fqn(record),
                    "semantic_model": model,
                    "relationships": self._relationship_list(model.get("relationships")),
                    "attributes": model.get("attributes") or [],
                    "verified_queries": model.get("verified_queries") or [],
                    "source": "validated_curated" if curated else registry.get("source") or model.get("semantic_source"),
                    "curated_version": curated,
                    "native_view": record.get("native_view") or model.get("native_semantic_view"),
                }
            )
        return resolved

    def relationship_payloads(
        self,
        session: Session,
        tables: list[TableRef],
    ) -> dict[str, dict[str, list[dict[str, Any]]]]:
        if not tables:
            return {}
        try:
            return self._batch_relationship_payloads(session, tables)
        except Exception:
            # Registry reconciliation can temporarily leave a client without
            # the curated table. Preserve the complete read path in that case.
            return self._relationship_payloads_from_records(session, tables)

    def _batch_relationship_payloads(
        self,
        session: Session,
        tables: list[TableRef],
    ) -> dict[str, dict[str, list[dict[str, Any]]]]:
        values_sql = ", ".join(
            "("
            f"{self._sql_literal(table.database.upper())}, "
            f"{self._sql_literal(table.schema.upper())}, "
            f"{self._sql_literal(table.table.upper())}"
            ")"
            for table in tables
        )
        registry = self._settings.resolved_semantic_views_table
        native_registry = self._settings.resolved_semantic_native_views_table
        curated = self._settings.qualify_metadata_object_name(
            "TBL_SEMANTIC_VIEW_VERSIONS"
        )
        rows = session.sql(
            f"""
            WITH requested(DATABASE_NAME, SCHEMA_NAME, TABLE_NAME, FQN) AS (
                SELECT column1, column2, column3,
                       column1 || '.' || column2 || '.' || column3
                FROM VALUES {values_sql}
            ), base AS (
                SELECT UPPER(t.FQN) AS FQN,
                       t.SEMANTIC_VIEW:semantic_model:relationships AS RELATIONSHIPS,
                       t.SEMANTIC_VIEW:semantic_model:attributes AS ATTRIBUTES
                FROM {registry} t
                INNER JOIN requested r ON UPPER(t.FQN) = r.FQN
                WHERE COALESCE(UPPER(t.STATUS), 'ACTIVE') IN ('ACTIVE', 'PENDING')
                QUALIFY ROW_NUMBER() OVER (
                    PARTITION BY UPPER(t.FQN) ORDER BY t.GENERATED_AT DESC
                ) = 1
            ), curated AS (
                SELECT UPPER(v.SEMANTIC_VIEW_FQN) AS FQN,
                       v.RELATIONSHIP_RULES AS RELATIONSHIPS
                FROM {curated} v
                INNER JOIN requested r ON UPPER(v.SEMANTIC_VIEW_FQN) = r.FQN
                WHERE COALESCE(LOWER(v.VALIDATION_STATUS), 'unvalidated') IN (
                    'validated', 'approved', 'active', 'confirmed'
                )
                QUALIFY ROW_NUMBER() OVER (
                    PARTITION BY UPPER(v.SEMANTIC_VIEW_FQN)
                    ORDER BY v.VERSION_NUMBER DESC, v.CREATED_AT DESC
                ) = 1
            ), native AS (
                SELECT UPPER(
                           n.DATABASE_NAME || '.' || n.SCHEMA_NAME || '.' || n.TABLE_NAME
                       ) AS FQN,
                       n.CA_YAML_MODEL,
                       COALESCE(n.HAS_LOW_CONFIDENCE_JOINS, FALSE) AS HAS_LOW_CONFIDENCE_JOINS,
                       COALESCE(n.HAS_FLAGGED_EXCLUDED, FALSE) AS HAS_FLAGGED_EXCLUDED
                FROM {native_registry} n
                INNER JOIN requested r
                    ON UPPER(n.DATABASE_NAME) = r.DATABASE_NAME
                   AND UPPER(n.SCHEMA_NAME) = r.SCHEMA_NAME
                   AND UPPER(n.TABLE_NAME) = r.TABLE_NAME
                WHERE COALESCE(UPPER(n.STATUS), 'ACTIVE') = 'ACTIVE'
                QUALIFY ROW_NUMBER() OVER (
                    PARTITION BY UPPER(n.DATABASE_NAME), UPPER(n.SCHEMA_NAME), UPPER(n.TABLE_NAME)
                    ORDER BY n.CREATED_AT DESC
                ) = 1
            )
            SELECT r.FQN,
                   COALESCE(c.RELATIONSHIPS, b.RELATIONSHIPS) AS RELATIONSHIPS,
                   IFF(c.FQN IS NOT NULL, 'VALIDATED_CURATED', 'REGISTRY') AS RELATIONSHIP_SOURCE,
                   b.ATTRIBUTES,
                   n.CA_YAML_MODEL,
                   n.HAS_LOW_CONFIDENCE_JOINS,
                   n.HAS_FLAGGED_EXCLUDED
            FROM requested r
            LEFT JOIN base b ON b.FQN = r.FQN
            LEFT JOIN curated c ON c.FQN = r.FQN
            LEFT JOIN native n ON n.FQN = r.FQN
            """
        ).collect()

        selected = {table.qualified_name.upper(): table for table in tables}
        payloads = {fqn: {"outgoing": [], "incoming": []} for fqn in selected}
        for row in rows:
            data = row.as_dict() if hasattr(row, "as_dict") else dict(row)
            fqn = str(data.get("FQN") or "").upper()
            owner = selected.get(fqn)
            if owner is None:
                continue
            relationships = self._json_value(data.get("RELATIONSHIPS"))
            relationship_source = str(data.get("RELATIONSHIP_SOURCE") or "REGISTRY").upper()
            if isinstance(relationships, dict) and (
                isinstance(relationships.get("outgoing"), list)
                or isinstance(relationships.get("incoming"), list)
            ):
                payloads[fqn]["outgoing"].extend(
                    item
                    for item in (relationships.get("outgoing") or [])
                    if isinstance(item, dict)
                    and self._relationship_is_confirmed(
                        item,
                        curated=relationship_source == "VALIDATED_CURATED",
                    )
                )
                payloads[fqn]["incoming"].extend(
                    item
                    for item in (relationships.get("incoming") or [])
                    if isinstance(item, dict)
                    and self._relationship_is_confirmed(
                        item,
                        curated=relationship_source == "VALIDATED_CURATED",
                    )
                )
            else:
                for relationship in self._relationship_list(relationships):
                    if not self._relationship_is_confirmed(
                        relationship,
                        curated=relationship_source == "VALIDATED_CURATED",
                    ):
                        continue
                    normalized = self._normalize_relationship(owner, relationship)
                    if normalized is None:
                        continue
                    left_fqn, right_fqn, outgoing, incoming = normalized
                    if left_fqn in payloads:
                        payloads[left_fqn]["outgoing"].append(outgoing)
                    if right_fqn in payloads:
                        payloads[right_fqn]["incoming"].append(incoming)

            if not payloads[fqn]["outgoing"] and not payloads[fqn]["incoming"]:
                attributes = self._json_value(data.get("ATTRIBUTES"))
                for attribute in attributes if isinstance(attributes, list) else []:
                    if not isinstance(attribute, dict):
                        continue
                    for constraint in attribute.get("constraints") or []:
                        if not isinstance(constraint, dict):
                            continue
                        if str(constraint.get("type") or "").upper() != "FOREIGN_KEY":
                            continue
                        confidence = str(constraint.get("confidence") or "LOW").upper()
                        references = constraint.get("references") or {}
                        if confidence != "HIGH" or not isinstance(references, dict):
                            continue
                        related_table = references.get("table")
                        related_column = references.get("column")
                        column_name = attribute.get("name")
                        if related_table and related_column and column_name:
                            payloads[fqn]["outgoing"].append(
                                {
                                    "schema": owner.schema,
                                    "table": str(related_table),
                                    "constraint_name": f"FK_{column_name}_{related_table}_{related_column}",
                                    "column_mappings": [
                                        {
                                            "fk_column": str(column_name),
                                            "pk_column": str(related_column),
                                        }
                                    ],
                                    "source": "semantic_knowledge_resolver",
                                }
                            )

            native_yaml = data.get("CA_YAML_MODEL")
            native_is_confirmed = not bool(data.get("HAS_LOW_CONFIDENCE_JOINS")) and not bool(
                data.get("HAS_FLAGGED_EXCLUDED")
            )
            if native_yaml and native_is_confirmed:
                for relationship in self._relationships_from_native_yaml(native_yaml, owner):
                    normalized = self._normalize_relationship(owner, relationship)
                    if normalized is None:
                        continue
                    left_fqn, right_fqn, outgoing, incoming = normalized
                    if left_fqn in payloads:
                        self._append_unique(payloads[left_fqn]["outgoing"], outgoing)
                    if right_fqn in payloads:
                        self._append_unique(payloads[right_fqn]["incoming"], incoming)
        return {
            fqn: payload
            for fqn, payload in payloads.items()
            if payload["outgoing"] or payload["incoming"]
        }

    def _relationship_payloads_from_records(
        self,
        session: Session,
        tables: list[TableRef],
    ) -> dict[str, dict[str, list[dict[str, Any]]]]:
        selected = {table.qualified_name.upper(): table for table in tables}
        payloads = {fqn: {"outgoing": [], "incoming": []} for fqn in selected}
        for record in self.resolve(session, tables):
            owner_fqn = str(record.get("fqn") or "").upper()
            owner = selected.get(owner_fqn)
            if owner is None:
                continue
            for relationship in record.get("relationships") or []:
                if not self._relationship_is_confirmed(
                    relationship,
                    curated=str(record.get("source") or "").lower() == "validated_curated",
                ):
                    continue
                normalized = self._normalize_relationship(owner, relationship)
                if normalized is None:
                    continue
                left_fqn, right_fqn, outgoing, incoming = normalized
                if left_fqn in payloads:
                    payloads[left_fqn]["outgoing"].append(outgoing)
                if right_fqn in payloads:
                    payloads[right_fqn]["incoming"].append(incoming)
            native_view = record.get("native_view")
            if not isinstance(native_view, dict):
                continue
            native_is_confirmed = not bool(native_view.get("has_low_confidence_joins")) and not bool(
                native_view.get("has_flagged_excluded")
            )
            if not native_is_confirmed:
                continue
            for relationship in self._relationships_from_native_yaml(
                native_view.get("ca_yaml_model"),
                owner,
            ):
                normalized = self._normalize_relationship(owner, relationship)
                if normalized is None:
                    continue
                left_fqn, right_fqn, outgoing, incoming = normalized
                if left_fqn in payloads:
                    self._append_unique(payloads[left_fqn]["outgoing"], outgoing)
                if right_fqn in payloads:
                    self._append_unique(payloads[right_fqn]["incoming"], incoming)
        return {
            fqn: payload
            for fqn, payload in payloads.items()
            if payload["outgoing"] or payload["incoming"]
        }

    @staticmethod
    def _sql_literal(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    @staticmethod
    def _json_value(value: Any) -> Any:
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return value

    @staticmethod
    def _record_fqn(record: dict[str, Any]) -> str:
        model = record.get("semantic_model") if isinstance(record.get("semantic_model"), dict) else {}
        return str(
            record.get("fqn")
            or model.get("fqn")
            or ".".join(
                str(record.get(key) or model.get(key) or "")
                for key in ("database", "schema_name", "table_name")
                if record.get(key) or model.get(key)
            )
        ).upper()

    @staticmethod
    def _relationship_list(value: Any) -> list[dict[str, Any]]:
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            result: list[dict[str, Any]] = []
            for direction in ("outgoing", "incoming", "relationships"):
                items = value.get(direction)
                if isinstance(items, list):
                    result.extend(
                        {**item, "direction": item.get("direction") or direction}
                        for item in items
                        if isinstance(item, dict)
                    )
            if result:
                return result
            return [value]
        return []

    @classmethod
    def _relationships_from_native_yaml(
        cls,
        raw_yaml: Any,
        owner: TableRef,
    ) -> list[dict[str, Any]]:
        """Translate Cortex Analyst YAML relationships to physical table references."""
        if not isinstance(raw_yaml, str) or not raw_yaml.strip():
            return []
        try:
            document = yaml.safe_load(raw_yaml)
        except yaml.YAMLError:
            return []
        if not isinstance(document, dict):
            return []

        logical_tables: dict[str, str] = {}
        for table in document.get("tables") or []:
            if not isinstance(table, dict):
                continue
            logical_name = str(table.get("name") or "").strip().upper()
            base = table.get("base_table")
            if not logical_name or not isinstance(base, dict):
                continue
            database = str(base.get("database") or owner.database)
            schema = str(base.get("schema") or owner.schema)
            physical_table = str(base.get("table") or "")
            if physical_table:
                logical_tables[logical_name] = f"{database}.{schema}.{physical_table}"

        result: list[dict[str, Any]] = []
        for relationship in document.get("relationships") or []:
            if not isinstance(relationship, dict):
                continue
            left_name = relationship.get("left_table") or relationship.get("from_table")
            right_name = relationship.get("right_table") or relationship.get("to_table")
            left_table = logical_tables.get(str(left_name or "").upper(), left_name)
            right_table = logical_tables.get(str(right_name or "").upper(), right_name)
            columns = (
                relationship.get("relationship_columns")
                or relationship.get("column_mappings")
                or relationship.get("conditions")
                or []
            )
            if not left_table or not right_table or not columns:
                continue
            result.append(
                {
                    **relationship,
                    "left_table": left_table,
                    "right_table": right_table,
                    "column_mappings": columns,
                    "validation_status": "CONFIRMED",
                    "source": "SEM_NATIVE_VIEWS.CA_YAML_MODEL",
                }
            )
        return result

    @staticmethod
    def _append_unique(items: list[dict[str, Any]], candidate: dict[str, Any]) -> None:
        signature = (
            str(candidate.get("schema") or "").upper(),
            str(candidate.get("table") or "").upper(),
            tuple(
                sorted(
                    (
                        str(mapping.get("fk_column") or "").upper(),
                        str(mapping.get("pk_column") or "").upper(),
                    )
                    for mapping in candidate.get("column_mappings") or []
                )
            ),
        )
        for item in items:
            item_signature = (
                str(item.get("schema") or "").upper(),
                str(item.get("table") or "").upper(),
                tuple(
                    sorted(
                        (
                            str(mapping.get("fk_column") or "").upper(),
                            str(mapping.get("pk_column") or "").upper(),
                        )
                        for mapping in item.get("column_mappings") or []
                    )
                ),
            )
            if item_signature == signature:
                return
        items.append(candidate)

    @staticmethod
    def _relationship_is_confirmed(
        relationship: dict[str, Any],
        *,
        curated: bool,
    ) -> bool:
        """Only surface joins that are safe to apply without user review.

        A validated/approved curated semantic version is itself confirmation.
        Registry relationships must otherwise carry explicit high-confidence,
        formal/DDL, or confirmed validation evidence. Medium/low/unspecified
        inferred joins remain available to FIR and the assistant, but are not
        auto-added to the selection-page relationship graph.
        """
        if curated:
            return True
        confidence = str(relationship.get("confidence") or "").strip().upper()
        validation = str(
            relationship.get("validation_status")
            or relationship.get("status")
            or ""
        ).strip().upper()
        relationship_type = str(
            relationship.get("relationship_type")
            or relationship.get("type")
            or ""
        ).strip().upper()
        source = str(relationship.get("source") or "").strip().upper()
        return (
            confidence == "HIGH"
            or validation in {"VALIDATED", "APPROVED", "CONFIRMED", "ACTIVE"}
            or relationship_type in {"FORMAL", "FOREIGN_KEY", "DDL"}
            or source in {"DDL", "FOREIGN_KEY", "DECLARED_CONSTRAINT"}
        )

    @staticmethod
    def _table_fqn(owner: TableRef, value: Any) -> str:
        if isinstance(value, dict):
            return ".".join(
                str(value.get(key) or "")
                for key in ("database", "schema", "table")
                if value.get(key)
            ).upper()
        text = str(value or "").strip()
        if text.count(".") == 0 and text:
            return f"{owner.database}.{owner.schema}.{text}".upper()
        if text.count(".") == 1 and text:
            return f"{owner.database}.{text}".upper()
        return text.upper()

    def _normalize_relationship(
        self,
        owner: TableRef,
        relationship: dict[str, Any],
    ) -> tuple[str, str, dict[str, Any], dict[str, Any]] | None:
        direction = str(relationship.get("direction") or "outgoing").lower()
        left_raw = relationship.get("left_table") or relationship.get("from_table")
        right_raw = relationship.get("right_table") or relationship.get("to_table")
        if not left_raw and not right_raw:
            related = relationship.get("table") or relationship.get("related_table")
            if direction == "incoming":
                left_raw, right_raw = related, owner.qualified_name
            else:
                left_raw, right_raw = owner.qualified_name, related
        left_fqn = self._table_fqn(owner, left_raw)
        right_fqn = self._table_fqn(owner, right_raw)
        if not left_fqn or not right_fqn:
            return None
        mappings = (
            relationship.get("column_mappings")
            or relationship.get("relationship_columns")
            or relationship.get("conditions")
            or []
        )
        if isinstance(mappings, dict):
            mappings = [mappings]
        normalized_mappings = []
        for mapping in mappings:
            if not isinstance(mapping, dict):
                continue
            left_column = mapping.get("left_column") or mapping.get("fk_column") or mapping.get("from_column")
            right_column = mapping.get("right_column") or mapping.get("pk_column") or mapping.get("to_column")
            if left_column and right_column:
                normalized_mappings.append(
                    {
                        "fk_column": str(left_column),
                        "pk_column": str(right_column),
                    }
                )
        if not normalized_mappings:
            return None
        left_parts = left_fqn.split(".")
        right_parts = right_fqn.split(".")
        common = {
            "constraint_name": relationship.get("constraint_name") or relationship.get("name"),
            "column_mappings": normalized_mappings,
            "business_meaning": relationship.get("business_meaning") or relationship.get("business_purpose"),
            "cardinality": relationship.get("cardinality"),
            "source": relationship.get("source") or "semantic_knowledge_resolver",
        }
        outgoing = {**common, "schema": right_parts[-2], "table": right_parts[-1]}
        incoming = {
            **common,
            "schema": left_parts[-2],
            "table": left_parts[-1],
            "column_mappings": [
                {"pk_column": item["fk_column"], "fk_column": item["pk_column"]}
                for item in normalized_mappings
            ],
        }
        return left_fqn, right_fqn, outgoing, incoming
