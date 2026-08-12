from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Literal

from snowflake.snowpark import Session
from sqlglot import exp, parse_one

from app.core.exceptions import SnowflakeAgentError
from app.core.config import Settings
from app.core.snowflake_analyst import SnowflakeAnalystClient
from app.schema.mapping_sql import (
    MappingSqlCompileRequest,
    MappingSqlCompileResponse,
    MappingSqlMappingItem,
    MappingSqlPreviewColumn,
    MappingSqlPreviewRequest,
    MappingSqlPreviewResponse,
    MappingSqlPreviewRow,
    MappingSqlReviewRequest,
    MappingSqlReviewResponse,
    MappingSqlParseRequest,
    MappingSqlParseResponse,
)
from app.schema.sttm_builder import (
    RelationEdge,
    RelationGraphContext,
    RelationNode,
    RelationNodeKind,
    RelationshipConditionItem,
)
from app.core.sql_parser import parse_sql_document
from app.core.cortex_completion import CortexCompletionUnavailable, complete_text

logger = logging.getLogger(__name__)


_PLACEHOLDER_MESSAGES = (
    "-- No columns mapped yet. Map columns to generate SQL.",
    "-- Select source tables and relationships in Step 1 to generate SQL.",
)


@dataclass
class _QueryExecutionResult:
    columns: list[MappingSqlPreviewColumn]
    rows: list[MappingSqlPreviewRow]


class MappingSqlService:
    def __init__(
        self,
        *,
        session: Session,
        analyst_client: SnowflakeAnalystClient,
        settings: Settings | None = None,
    ) -> None:
        self._session = session
        self._analyst = analyst_client
        self._settings = settings

    def review(self, body: MappingSqlReviewRequest) -> MappingSqlReviewResponse:
        preview_sql = self._normalize_sql(body.preview_sql)
        generated_sql = self._normalize_sql(body.generated_sql)
        if not preview_sql:
            raise ValueError("Preview SQL is empty.")
        if self._is_placeholder_sql(preview_sql) or self._is_placeholder_sql(generated_sql):
            raise ValueError("Map at least one target attribute before validating SQL.")

        warnings: list[str] = []
        syntax_valid = False
        execution_ready = False
        validation_error: str | None = None
        try:
            syntax_valid = self._validate_preview_sql(preview_sql)
            execution_ready = syntax_valid
        except Exception as exc:
            validation_error = self._summarize_sql_error(exc)
            warnings.append(
                "The original SQL did not pass Snowflake validation. A suggested repair will be attempted if an analyst review is available."
            )

        optimized_preview_sql: str | None = None
        optimized_generated_sql: str | None = None
        review_summary = (
            "The generated SQL is ready to preview."
            if not validation_error
            else "The generated SQL needs a fix before it can be previewed."
        )
        review_agent = "CORTEX_ANALYST"
        optimized = False
        review_kind: Literal["none", "optimization", "repair"] = "none"

        if body.semantic_view_name or body.semantic_model_yaml:
            try:
                analyst_response = self._analyst.ask(
                    question=self._build_review_prompt(body, preview_sql, validation_error=validation_error),
                    semantic_view=body.semantic_view_name,
                    semantic_model_yaml=body.semantic_model_yaml,
                )
                if analyst_response.text and not self._is_unhelpful_review_summary(analyst_response.text):
                    review_summary = analyst_response.text.strip()
                candidate_sql = self._normalize_sql(analyst_response.sql)
                if candidate_sql and candidate_sql != preview_sql:
                    if not self._covers_target_aliases(candidate_sql, body.mappings):
                        warnings.append(
                            "Cortex Analyst suggested SQL that did not preserve every target alias, so the original SQL was kept."
                        )
                    elif self._candidate_sql_is_valid(candidate_sql):
                        optimized_preview_sql = candidate_sql
                        optimized_generated_sql = self._rebuild_insert_sql(
                            generated_sql,
                            candidate_sql,
                        )
                        optimized = self._normalize_sql(candidate_sql) != preview_sql or not syntax_valid
                        review_kind = "repair" if validation_error else "optimization"
                        syntax_valid = True
                        execution_ready = True
                        if validation_error:
                            review_summary = (
                                "The original SQL had a validation issue. Cortex Analyst suggested a repaired SQL version for your approval."
                            )
                        elif not analyst_response.text or self._is_unhelpful_review_summary(analyst_response.text):
                            review_summary = (
                                "Cortex Analyst found an optimized SQL version. Review the suggested changes before previewing results."
                            )
                    else:
                        warnings.append(
                            "Cortex Analyst suggested an alternative SQL shape, but it did not pass validation, so the original SQL was kept."
                        )
            except SnowflakeAgentError as exc:
                review_agent = "SNOWFLAKE_EXECUTOR"
                warnings.append(f"Cortex Analyst review was skipped: {exc}")
            except Exception as exc:  # pragma: no cover - defensive
                review_agent = "SNOWFLAKE_EXECUTOR"
                warnings.append(f"Cortex Analyst review failed: {exc}")
        else:
            review_agent = "SNOWFLAKE_EXECUTOR"
            warnings.append(
                "No semantic view was available, so SQL review used Snowflake execution checks only."
            )

        if validation_error and not optimized_preview_sql:
            repaired_preview_sql, repair_summary = self._attempt_sql_repair(
                preview_sql,
                validation_error=validation_error,
            )
            if repaired_preview_sql and self._candidate_sql_is_valid(repaired_preview_sql):
                optimized_preview_sql = repaired_preview_sql
                optimized_generated_sql = self._rebuild_insert_sql(
                    generated_sql,
                    repaired_preview_sql,
                )
                optimized = True
                review_kind = "repair"
                syntax_valid = True
                execution_ready = True
                review_agent = "SNOWFLAKE_EXECUTOR"
                review_summary = repair_summary
                warnings.append(
                    "Cortex Analyst could not complete the SQL review request, so Snowflake validation generated a suggested repair for your approval."
                )

        if validation_error and not optimized_preview_sql and body.attempt_ai_repair:
            repaired_preview_sql, repair_summary = self._attempt_cortex_sql_repair(
                body,
                preview_sql,
                validation_error=validation_error,
            )
            if repaired_preview_sql and self._candidate_sql_is_valid(repaired_preview_sql):
                optimized_preview_sql = repaired_preview_sql
                optimized_generated_sql = self._rebuild_insert_sql(generated_sql, repaired_preview_sql)
                optimized = True
                review_kind = "repair"
                syntax_valid = True
                execution_ready = True
                review_agent = "CORTEX_SQL_REPAIR"
                review_summary = repair_summary
                warnings.append(
                    "The AI repair was validated by Snowflake and is available for explicit review and approval."
                )

        if validation_error and not optimized_preview_sql:
            warnings.append(
                "Snowflake validation could not prepare a safe repaired SQL automatically. Review the validation issue and adjust the mapping SQL before running preview."
            )
            review_summary = f"Snowflake validation found an issue that still needs attention: {validation_error}"
            syntax_valid = False
            execution_ready = False

        repair_options = self._build_repair_options(
            validation_error=validation_error,
            has_suggested_sql=optimized_preview_sql is not None,
        )

        return MappingSqlReviewResponse(
            valid=syntax_valid,
            review_agent=review_agent,
            syntax_valid=syntax_valid,
            execution_ready=execution_ready,
            review_summary=review_summary,
            validation_error=validation_error,
            review_kind=review_kind,
            optimized=optimized,
            requires_approval=optimized and optimized_preview_sql is not None,
            original_preview_sql=preview_sql,
            original_generated_sql=generated_sql,
            optimized_preview_sql=optimized_preview_sql,
            optimized_generated_sql=optimized_generated_sql,
            semantic_view_name=body.semantic_view_name,
            warnings=warnings,
            repair_options=repair_options,
        )

    def compile(self, body: MappingSqlCompileRequest) -> MappingSqlCompileResponse:
        """Compile the UI/agent relation graph into a single query namespace."""
        # Linked precedent is evidence for agent mapping decisions only. Never
        # replace the current relation graph with a prior mapping's stored SQL;
        # the compiler must prove the current mapping by compiling its current
        # nodes, joins, bindings, derived SQL, and attribute expressions.
        graph = body.relation_graph
        nodes = {node.relation_id: node for node in graph.nodes}
        if not nodes:
            raise ValueError("The relation graph has no source nodes.")
        if len(nodes) != len(graph.nodes):
            raise ValueError("Relation IDs must be unique.")

        aliases: dict[str, str] = {}
        alias_to_id: dict[str, str] = {}
        for node in graph.nodes:
            alias = self._safe_sql_identifier(node.alias, label="relation alias")
            alias_key = alias.upper()
            if alias_key in alias_to_id:
                raise ValueError(f"Duplicate relation alias: {alias}")
            aliases[node.relation_id] = alias
            alias_to_id[alias_key] = node.relation_id

        bindings = {item.binding_id: item for item in graph.value_bindings}
        # Agents naturally refer to a placeholder by its contract value
        # (for example "$TransactionFirmID"), while the UI persists a stable
        # binding_id (for example "canonical-TransactionFirmID"). Both identify
        # the same binding. Accept the value as an alias only when it is unique;
        # ambiguous values still fail closed below.
        bindings_by_value: dict[str, Any] = {}
        ambiguous_binding_values: set[str] = set()
        for binding in graph.value_bindings:
            value = str(binding.value or "").strip()
            if not value:
                continue
            if value in bindings_by_value and bindings_by_value[value].binding_id != binding.binding_id:
                ambiguous_binding_values.add(value)
            else:
                bindings_by_value[value] = binding
        for value in ambiguous_binding_values:
            bindings_by_value.pop(value, None)
        for value, binding in bindings_by_value.items():
            bindings.setdefault(value, binding)
        resolved_placeholders = self._resolved_placeholder_sql(graph)
        unresolved_placeholders: set[str] = set()
        required_relation_ids: set[str] = set()
        select_items: list[str] = []
        target_columns: list[str] = []

        for mapping in body.mappings:
            if str(mapping.status or "MAPPED").upper() not in {"MAPPED", "COMPLETE", "ACCEPTED"}:
                raise ValueError(f"Target {mapping.target_column} is not mapped.")
            target = self._safe_sql_identifier(mapping.target_column, label="target column")
            dependencies = mapping.source_dependencies or mapping.source_columns
            for dependency in dependencies:
                relation_id = self._resolve_dependency_relation(dependency, nodes, alias_to_id)
                if relation_id is None:
                    raise ValueError(f"Undefined relation or alias in dependency: {dependency}")
                required_relation_ids.add(relation_id)

            for binding_id in mapping.value_binding_ids:
                binding = bindings.get(binding_id)
                if binding is None:
                    raise ValueError(f"Undefined Value binding: {binding_id}")
                if (
                    binding.is_placeholder
                    and binding.resolution_status.lower() not in {"resolved", "project_attribute"}
                ):
                    unresolved_placeholders.add(binding.value)

            if mapping.mapping_mode in {"constant", "attribute"}:
                placeholder = str(mapping.constant_value or "").strip()
                if self._is_placeholder(placeholder) and placeholder in resolved_placeholders:
                    expression = resolved_placeholders[placeholder]
                else:
                    expression = self._compile_constant(mapping.constant_value, mapping.target_type)
                    if self._is_placeholder(mapping.constant_value):
                        unresolved_placeholders.add(placeholder)
            else:
                expression = (mapping.expression or "").strip()
                if expression:
                    self._reject_query_level_expression(expression, target=mapping.target_column)
                elif dependencies:
                    expression = dependencies[0]
                else:
                    raise ValueError(f"Target {mapping.target_column} has no source or Value dependency.")
            expression = self._substitute_placeholders(expression, resolved_placeholders)
            expression = self._normalize_expression_namespace(expression, nodes, aliases)
            self._validate_expression_aliases(expression, alias_to_id, nodes)
            # Expressions can reference a relation that was omitted from the
            # explicit dependency list. Once the qualifier is validated, make
            # that relation part of the join plan as well.
            required_relation_ids.update(
                self._expression_relation_ids(expression, alias_to_id)
            )
            select_items.append(f"  {expression} AS {target}")
            target_columns.append(target)

        driving_id = body.driving_relation_id
        if driving_id and driving_id not in nodes:
            raise ValueError(f"Driving relation does not exist: {driving_id}")
        if not driving_id:
            driving_id = next(iter(required_relation_ids), graph.nodes[0].relation_id)
        required_relation_ids.add(driving_id)

        edges = [
            edge for edge in graph.edges
            if edge.left_relation_id in required_relation_ids or edge.right_relation_id in required_relation_ids
        ]
        connected_ids, ordered_edges = self._connected_join_plan(driving_id, required_relation_ids, edges)
        disconnected = required_relation_ids - connected_ids
        if disconnected:
            inherited_ids = {edge.edge_id for edge in edges}
            # A newly inherited edge may connect an ancestor used by another
            # derived source, so retry within a strict graph-sized bound.
            for _ in range(len(nodes)):
                inherited = self._lineage_inherited_edges(
                    disconnected_ids=disconnected,
                    nodes=nodes,
                    edges=graph.edges,
                    connected_ids=connected_ids,
                    existing_edge_ids=inherited_ids,
                )
                if not inherited:
                    break
                inherited_ids.update(edge.edge_id for edge in inherited)
                edges = edges + inherited
                connected_ids, ordered_edges = self._connected_join_plan(
                    driving_id, required_relation_ids, edges
                )
                disconnected = required_relation_ids - connected_ids
                if not disconnected:
                    break
        if disconnected:
            disconnected_labels = []
            for relation_id in sorted(disconnected):
                node = nodes[relation_id]
                label = (
                    node.table.qualified_name
                    if node.table is not None
                    else node.physical_view_name
                    or node.relation_id
                )
                disconnected_labels.append(label)
            raise ValueError(
                "Required relations are disconnected from the driving relation: "
                + ", ".join(disconnected_labels)
                + ". Add validated relation edges from the driving graph to these relations, "
                "or remap the affected targets to outputs already produced by a connected derived source."
            )

        cte_nodes = self._ordered_cte_nodes(graph.nodes, required_relation_ids)
        cte_lines: list[str] = []
        for node in cte_nodes:
            if not body.self_contained_derived and node.physical_view_name:
                continue
            if not node.sql_text:
                if node.physical_view_name:
                    continue
                raise ValueError(f"Derived relation {node.relation_id} has no saved SQL or physical view.")
            inner_sql = self._normalize_sql(node.sql_text).rstrip(";")
            if not inner_sql:
                raise ValueError(f"Derived relation {node.relation_id} has empty saved SQL.")
            cte_lines.append(f"{aliases[node.relation_id]} AS (\n{inner_sql}\n)")

        from_lines = [f"FROM {self._relation_sql(nodes[driving_id], aliases, body.self_contained_derived)}"]
        joined = {driving_id}
        for edge in ordered_edges:
            left_joined = edge.left_relation_id in joined
            attach_id = edge.right_relation_id if left_joined else edge.left_relation_id
            join_type = self._normalize_join_type(edge.join_type)
            predicates: list[str] = []
            for condition in edge.conditions:
                left_alias = aliases[edge.left_relation_id]
                right_alias = aliases[edge.right_relation_id]
                left_column = self._safe_sql_identifier(condition.left_column, label="join column")
                right_column = self._safe_sql_identifier(condition.right_column, label="join column")
                operator = condition.operator.strip().upper()
                if operator not in {"=", "!=", "<>", "<", "<=", ">", ">="}:
                    raise ValueError(f"Unsupported join operator: {condition.operator}")
                predicates.append(f"{left_alias}.{left_column} {operator} {right_alias}.{right_column}")
            if edge.additional_predicate:
                self._reject_query_level_expression(edge.additional_predicate, target="join predicate")
                predicates.append(f"({edge.additional_predicate.strip()})")
            if not predicates:
                raise ValueError(f"Join edge {edge.edge_id} has no conditions.")
            from_lines.append(
                f"{join_type} JOIN {self._relation_sql(nodes[attach_id], aliases, body.self_contained_derived)}\n"
                f"  ON " + "\n  AND ".join(predicates)
            )
            joined.add(attach_id)

        for expression in (
            body.where_predicates
            + body.group_by_expressions
            + body.qualify_predicates
            + body.order_by_expressions
        ):
            self._reject_query_level_expression(expression, target="query-shaping expression")

        query_lines: list[str] = []
        if cte_lines:
            query_lines.extend(["WITH", ",\n".join(cte_lines)])
        query_lines.extend(["SELECT", ",\n".join(select_items), *from_lines])
        if body.where_predicates:
            query_lines.extend(["WHERE", "  " + "\n  AND ".join(body.where_predicates)])
        if body.group_by_expressions:
            query_lines.extend(["GROUP BY", "  " + ",\n  ".join(body.group_by_expressions)])
        if body.qualify_predicates:
            query_lines.extend(["QUALIFY", "  " + "\n  AND ".join(body.qualify_predicates)])
        if body.order_by_expressions:
            query_lines.extend(["ORDER BY", "  " + ",\n  ".join(body.order_by_expressions)])
        preview_sql = "\n".join(query_lines)
        generated_sql = preview_sql
        if body.target_table:
            target_name = body.target_table.qualified_name
            generated_sql = (
                f"INSERT INTO {target_name} (\n  "
                + ",\n  ".join(target_columns)
                + f"\n)\n{preview_sql};"
            )

        ready = not unresolved_placeholders
        warnings: list[str] = []
        if unresolved_placeholders:
            warnings.append("Resolve project-specific Value placeholders before execution.")
            if not body.allow_unresolved_placeholders:
                ready = False
        if body.validate_with_explain and ready:
            self._compile_preview_sql(preview_sql)

        return MappingSqlCompileResponse(
            valid=True,
            ready=ready,
            preview_sql=preview_sql,
            generated_sql=generated_sql,
            relation_aliases=aliases,
            required_relation_ids=sorted(required_relation_ids),
            unresolved_placeholders=sorted(unresolved_placeholders),
            warnings=warnings,
        )

    def _compile_accepted_precedent(
        self,
        body: MappingSqlCompileRequest,
    ) -> MappingSqlCompileResponse:
        """Restore validated query shaping when every target accepted one exact precedent."""
        precedent_id = str(body.accepted_precedent_sttm_id or "").strip()
        if not precedent_id:
            raise ValueError("Accepted precedent mapping ID is empty.")
        if not body.mappings or any(
            str(mapping.precedent_decision or "").lower() != "accept_precedent"
            or str(mapping.precedent_mapping_id or "") != precedent_id
            for mapping in body.mappings
        ):
            raise ValueError(
                "Precedent query shaping requires every compiled target to accept the same precedent."
            )
        if self._settings is None:
            raise ValueError("Precedent query shaping is unavailable without metadata settings.")
        table = self._settings.qualify_table_name("TBL_STTM")
        rows = self._session.sql(
            f"""
            SELECT RAW_MAPPING_SQL, STATUS
            FROM {table}
            WHERE TO_VARCHAR(STTM_ID) = ?
              AND UPPER(COALESCE(STATUS, '')) IN ('COMPLETE', 'PUBLISHED')
              AND COALESCE(RUNTIME_SUPPRESSED, FALSE) = FALSE
            LIMIT 1
            """,
            params=[precedent_id],
        ).collect()
        if not rows:
            raise ValueError(f"Accepted precedent {precedent_id} is not available or complete.")
        row = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
        raw_sql = str(row.get("RAW_MAPPING_SQL") or "")
        if not raw_sql.strip():
            raise ValueError(f"Accepted precedent {precedent_id} has no stored SQL.")
        parsed = parse_sql_document(raw_sql)
        expected_targets = {mapping.target_column.upper() for mapping in body.mappings}
        precedent_targets = {item.target_alias.upper() for item in parsed.column_mappings}
        if expected_targets != precedent_targets:
            missing = sorted(expected_targets - precedent_targets)
            extra = sorted(precedent_targets - expected_targets)
            raise ValueError(
                "Accepted precedent target contract differs from the current mapping: "
                f"missing={missing}, extra={extra}"
            )
        query_match = re.search(
            r"(?im)^WITH\s+[A-Za-z_][\w$]*\s+AS\s*\(",
            raw_sql,
        )
        if query_match is None:
            raise ValueError(f"Accepted precedent {precedent_id} has no query body.")
        preview_sql = raw_sql[query_match.start():].strip()
        resolved_placeholders = self._resolved_placeholder_sql(body.relation_graph)
        preview_sql = self._substitute_placeholders(preview_sql, resolved_placeholders)
        preview_sql = self._qualify_precedent_physical_tables(
            preview_sql,
            body.relation_graph,
        )
        unresolved = sorted(set(re.findall(r"\$[A-Za-z_][\w$]*", preview_sql)))
        target_columns = [
            self._safe_sql_identifier(mapping.target_column, label="target column")
            for mapping in body.mappings
        ]
        generated_sql = preview_sql
        if body.target_table:
            generated_sql = (
                f"INSERT INTO {body.target_table.qualified_name} (\n  "
                + ",\n  ".join(target_columns)
                + f"\n)\n{preview_sql.rstrip(';')};"
            )
        ready = not unresolved
        warnings = [
            f"Restored complete query shaping from accepted precedent {precedent_id}."
        ]
        if unresolved:
            warnings.append("Resolve project-specific Value placeholders before execution.")
        if body.validate_with_explain and ready:
            self._compile_preview_sql(preview_sql)
        return MappingSqlCompileResponse(
            valid=True,
            ready=ready,
            preview_sql=preview_sql,
            generated_sql=generated_sql,
            relation_aliases=dict(parsed.table_aliases),
            required_relation_ids=list(parsed.source_tables),
            unresolved_placeholders=unresolved,
            warnings=warnings,
        )

    @staticmethod
    def _safe_sql_identifier(value: str, *, label: str) -> str:
        token = str(value or "").strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", token):
            raise ValueError(f"Invalid {label}: {value}")
        return token

    @staticmethod
    def _is_placeholder(value: str | None) -> bool:
        return bool(re.fullmatch(r"\$[A-Za-z_][A-Za-z0-9_]*", str(value or "").strip()))

    @classmethod
    def _resolved_placeholder_sql(cls, graph: RelationGraphContext) -> dict[str, str]:
        """Return explicitly resolved Value contracts as safe SQL expressions."""
        resolved: dict[str, str] = {}
        for binding in graph.value_bindings:
            placeholder = str(binding.value or "").strip()
            if not binding.is_placeholder or not cls._is_placeholder(placeholder):
                continue
            if str(binding.resolution_status or "").lower() not in {"resolved", "project_attribute"}:
                continue
            if binding.resolved_value is None:
                continue
            resolved[placeholder] = cls._compile_constant(
                binding.resolved_value,
                binding.data_type,
            )
        return resolved

    @staticmethod
    def _substitute_placeholders(sql: str, resolved: dict[str, str]) -> str:
        result = sql
        for placeholder in sorted(resolved, key=len, reverse=True):
            result = re.sub(
                rf"(?<![A-Za-z0-9_$]){re.escape(placeholder)}(?![A-Za-z0-9_$])",
                lambda _match, replacement=resolved[placeholder]: replacement,
                result,
            )
        return result

    @staticmethod
    def _qualify_precedent_physical_tables(
        sql: str,
        graph: RelationGraphContext,
    ) -> str:
        """Make imported query bodies independent of the compiler session schema."""
        result = sql
        physical_nodes = [
            node
            for node in graph.nodes
            if node.kind == RelationNodeKind.PHYSICAL_TABLE and node.table is not None
        ]
        for node in sorted(
            physical_nodes,
            key=lambda item: len(str(item.table.table if item.table else "")),
            reverse=True,
        ):
            assert node.table is not None
            table_name = node.table.table
            qualified = node.table.qualified_name
            result = re.sub(
                rf"(?i)(\b(?:FROM|JOIN)\s+)(?![A-Za-z0-9_$]+\.){re.escape(table_name)}(?=\s|$)",
                lambda match, replacement=qualified: match.group(1) + replacement,
                result,
            )
        return result

    @classmethod
    def _compile_constant(cls, value: str | None, target_type: str | None) -> str:
        token = str(value or "").strip()
        if not token or token.upper() == "NULL":
            return "NULL"
        if cls._is_placeholder(token):
            return token
        data_type = str(target_type or "").upper()
        if re.match(r"^(NUMBER|DECIMAL|NUMERIC|INT|INTEGER|BIGINT|FLOAT|DOUBLE)", data_type) and re.fullmatch(r"[-+]?(?:\d+\.?\d*|\.\d+)", token):
            return token
        if re.match(r"^(BOOLEAN|BOOL)", data_type) and token.upper() in {"TRUE", "FALSE"}:
            return token.upper()
        return "'" + token.replace("'", "''") + "'"

    @staticmethod
    def _reject_query_level_expression(expression: str, *, target: str) -> None:
        scrubbed = re.sub(r"'(?:''|[^'])*'", "''", expression)
        if re.search(r"(?is)(?:^|[;\s])(SELECT|WITH|FROM|JOIN|WHERE|QUALIFY|GROUP\s+BY|HAVING|ORDER\s+BY)(?:\s|$)", scrubbed):
            raise ValueError(f"Query-level SQL is not allowed inside {target}.")
        if ";" in scrubbed:
            raise ValueError(f"Statement separators are not allowed inside {target}.")

    @staticmethod
    def _resolve_dependency_relation(
        dependency: str,
        nodes: dict[str, RelationNode],
        alias_to_id: dict[str, str],
    ) -> str | None:
        qualifier, separator, _ = str(dependency).strip().rpartition(".")
        if not separator:
            return None
        if qualifier.upper() in alias_to_id:
            return alias_to_id[qualifier.upper()]
        if qualifier in nodes:
            return qualifier
        qualifier_upper = qualifier.upper()
        for relation_id, node in nodes.items():
            if node.table and node.table.qualified_name.upper() == qualifier_upper:
                return relation_id
            if node.physical_view_name and node.physical_view_name.upper() == qualifier_upper:
                return relation_id
        return None

    @staticmethod
    def _normalize_expression_namespace(
        expression: str,
        nodes: dict[str, RelationNode],
        aliases: dict[str, str],
    ) -> str:
        normalized = expression
        replacements: list[tuple[str, str]] = []
        short_form_owners: dict[str, set[str]] = {}

        def collect_short_forms(name: str | None, relation_id: str) -> None:
            parts = [part for part in str(name or "").split(".") if part]
            if len(parts) < 2:
                return
            for candidate in (parts[-1], ".".join(parts[-2:])):
                short_form_owners.setdefault(candidate.upper(), set()).add(relation_id)

        for relation_id, node in nodes.items():
            alias = aliases[relation_id]
            replacements.append((relation_id, alias))
            if node.table:
                replacements.append((node.table.qualified_name, alias))
                collect_short_forms(node.table.qualified_name, relation_id)
            if node.physical_view_name:
                replacements.append((node.physical_view_name, alias))
                collect_short_forms(node.physical_view_name, relation_id)

        # Only unique short forms are safe. Ambiguous table names deliberately
        # remain unresolved and are rejected by alias validation.
        reserved = {alias.upper() for alias in aliases.values()}
        reserved.update(source.upper() for source, _ in replacements)
        for candidate, owners in short_form_owners.items():
            if len(owners) != 1 or candidate in reserved:
                continue
            replacements.append((candidate, aliases[next(iter(owners))]))

        for source, alias in sorted(replacements, key=lambda item: len(item[0]), reverse=True):
            normalized = re.sub(
                rf"(?i)(?<![A-Za-z0-9_$]){re.escape(source)}\.",
                f"{alias}.",
                normalized,
            )
        return normalized

    @staticmethod
    def _validate_expression_aliases(
        expression: str,
        alias_to_id: dict[str, str],
        nodes: dict[str, RelationNode],
    ) -> None:
        scrubbed = re.sub(r"'(?:''|[^'])*'", "''", expression)
        known = set(alias_to_id)
        known.update(node.relation_id.upper() for node in nodes.values())
        qualified_columns = re.findall(
            r"(?<![$\w])([A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_$]*)",
            scrubbed,
        )
        for qualifier, _column in qualified_columns:
            if qualifier.upper() not in known:
                raise ValueError(f"Undefined SQL alias in mapping expression: {qualifier}")
        for qualifier, column in qualified_columns:
            relation_id = alias_to_id.get(qualifier.upper())
            if relation_id is None:
                continue
            node = nodes[relation_id]
            available = MappingSqlService._relation_output_columns(node)
            if not available:
                if node.kind in {RelationNodeKind.DERIVED_SOURCE, RelationNodeKind.CTE}:
                    raise ValueError(
                        f"Derived relation {node.relation_id} has no validated output-column contract."
                    )
                continue
            if column.upper() not in available:
                raise ValueError(
                    f"Column {column} is not produced by relation {node.relation_id}. "
                    f"Available columns: {', '.join(sorted(available))}"
                )

    @staticmethod
    def _relation_output_columns(node: RelationNode) -> set[str]:
        declared = {
            str(item.get("name") or item.get("column_name") or "").strip().upper()
            for item in node.output_columns
            if isinstance(item, dict)
            and str(item.get("name") or item.get("column_name") or "").strip()
        }
        if declared:
            return declared
        if not node.sql_text:
            return set()
        try:
            statement = parse_one(node.sql_text, read="snowflake")
        except Exception:
            return set()
        select = statement if isinstance(statement, exp.Select) else statement.find(exp.Select)
        if select is None:
            return set()
        return {
            str(item.alias_or_name or "").strip().upper()
            for item in select.expressions
            if not isinstance(item, exp.Star) and str(item.alias_or_name or "").strip()
        }

    @staticmethod
    def _normalize_join_type(value: str) -> str:
        token = " ".join(str(value or "INNER").upper().split())
        allowed = {"INNER", "LEFT", "LEFT OUTER", "RIGHT", "RIGHT OUTER", "FULL", "FULL OUTER"}
        if token not in allowed:
            raise ValueError(f"Unsupported join type: {value}")
        return token

    @staticmethod
    def _connected_join_plan(driving_id: str, required_ids: set[str], edges: list[Any]) -> tuple[set[str], list[Any]]:
        connected = {driving_id}
        ordered: list[Any] = []
        pending = list(edges)
        progressed = True
        while progressed and required_ids - connected:
            progressed = False
            for edge in list(pending):
                left_in = edge.left_relation_id in connected
                right_in = edge.right_relation_id in connected
                if left_in == right_in:
                    continue
                ordered.append(edge)
                connected.add(edge.right_relation_id if left_in else edge.left_relation_id)
                pending.remove(edge)
                progressed = True
        return connected, ordered

    @staticmethod
    def _expression_relation_ids(expression: str, alias_to_id: dict[str, str]) -> set[str]:
        """Return relations referenced by qualified columns in an expression."""
        scrubbed = re.sub(r"'(?:''|[^'])*'", "''", expression)
        found: set[str] = set()
        for qualifier, _column in re.findall(
            r"(?<![$\w])([A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_$]*)",
            scrubbed,
        ):
            relation_id = alias_to_id.get(qualifier.upper())
            if relation_id is not None:
                found.add(relation_id)
        return found

    @staticmethod
    def _derived_source_aliases(node: RelationNode) -> dict[str, str]:
        """Resolve aliases in derived SQL back to qualified physical tables."""
        if not node.sql_text:
            return {}
        try:
            statement = parse_one(node.sql_text, read="snowflake")
        except Exception:
            return {}
        aliases: dict[str, str] = {}
        for table in statement.find_all(exp.Table):
            qualified = ".".join(
                part for part in (table.catalog, table.db, table.name) if part
            ).upper()
            alias = str(table.alias_or_name or "").strip().upper()
            if alias and qualified:
                aliases[alias] = qualified
        return aliases

    @classmethod
    def _derived_output_column_for_parent(
        cls,
        node: RelationNode,
        base_id: str,
        parent_column: str,
    ) -> str | None:
        """Find the derived output carrying one physical parent's join column."""
        target = str(parent_column or "").strip().upper()
        if not target:
            return None
        available = cls._relation_output_columns(node)
        base_upper = base_id.upper()
        base_short = base_upper.rsplit(".", 1)[-1]
        lineage = [
            item
            for item in node.column_semantics
            if isinstance(item, dict) and item.get("source_columns")
        ]
        if lineage:
            alias_map = cls._derived_source_aliases(node)

            def qualifier_is_base(qualifier: str) -> bool:
                resolved = alias_map.get(qualifier)
                if resolved is not None:
                    return (
                        resolved == base_upper
                        or resolved.rsplit(".", 1)[-1] == base_short
                    )
                return qualifier in {base_upper, base_short}

            matches: set[str] = set()
            for item in lineage:
                name = str(item.get("name") or "").strip().upper()
                if not name or name not in available:
                    continue
                for source in item.get("source_columns") or []:
                    text = str(source or "").strip().upper()
                    qualifier, separator, column = text.rpartition(".")
                    if separator:
                        if column == target and qualifier_is_base(qualifier):
                            matches.add(name)
                    elif text == target and len(node.base_relation_ids) == 1:
                        matches.add(name)
            return next(iter(matches)) if len(matches) == 1 else None
        if len(node.base_relation_ids) == 1 and target in available:
            return target
        return None

    @classmethod
    def _lineage_inherited_edges(
        cls,
        *,
        disconnected_ids: set[str],
        nodes: dict[str, RelationNode],
        edges: list[Any],
        connected_ids: set[str],
        existing_edge_ids: set[str],
    ) -> list[RelationEdge]:
        """Re-project a validated parent join onto a disconnected derived source."""
        inherited: list[RelationEdge] = []
        for relation_id in sorted(disconnected_ids):
            node = nodes.get(relation_id)
            if node is None or node.kind != RelationNodeKind.DERIVED_SOURCE:
                continue
            if not cls._relation_output_columns(node):
                continue
            for base_id in node.base_relation_ids:
                if base_id == relation_id or base_id not in nodes:
                    continue
                for edge in edges:
                    if edge.left_relation_id == base_id:
                        other_id, base_on_left = edge.right_relation_id, True
                    elif edge.right_relation_id == base_id:
                        other_id, base_on_left = edge.left_relation_id, False
                    else:
                        continue
                    if other_id == relation_id or other_id not in connected_ids:
                        continue
                    if not edge.conditions:
                        continue
                    rewritten: list[RelationshipConditionItem] = []
                    for condition in edge.conditions:
                        parent_column = (
                            condition.left_column
                            if base_on_left
                            else condition.right_column
                        )
                        derived_column = cls._derived_output_column_for_parent(
                            node, base_id, parent_column
                        )
                        if derived_column is None:
                            rewritten = []
                            break
                        rewritten.append(
                            RelationshipConditionItem(
                                left_column=(
                                    derived_column
                                    if base_on_left
                                    else condition.left_column
                                ),
                                operator=condition.operator,
                                right_column=(
                                    condition.right_column
                                    if base_on_left
                                    else derived_column
                                ),
                            )
                        )
                    if not rewritten:
                        continue
                    edge_id = f"lineage:{relation_id}:{edge.edge_id}"
                    if edge_id in existing_edge_ids:
                        continue
                    existing_edge_ids.add(edge_id)
                    inherited.append(
                        RelationEdge(
                            edge_id=edge_id,
                            left_relation_id=(relation_id if base_on_left else other_id),
                            right_relation_id=(other_id if base_on_left else relation_id),
                            join_type=edge.join_type,
                            conditions=rewritten,
                            additional_predicate=edge.additional_predicate,
                            provenance="DERIVED_LINEAGE",
                            validation_status=edge.validation_status,
                        )
                    )
        return inherited

    @staticmethod
    def _ordered_cte_nodes(nodes: list[RelationNode], required_ids: set[str]) -> list[RelationNode]:
        derived_nodes = {
            node.relation_id: node for node in nodes
            if node.kind in {RelationNodeKind.DERIVED_SOURCE, RelationNodeKind.CTE}
        }
        needed_ids = {node_id for node_id in required_ids if node_id in derived_nodes}

        def include_parents(node_id: str) -> None:
            node = derived_nodes.get(node_id)
            if node is None:
                return
            for parent_id in node.parent_relation_ids:
                if parent_id in derived_nodes and parent_id not in needed_ids:
                    needed_ids.add(parent_id)
                    include_parents(parent_id)

        for node_id in list(needed_ids):
            include_parents(node_id)
        needed = {node_id: derived_nodes[node_id] for node_id in needed_ids}
        ordered: list[RelationNode] = []
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(node_id: str) -> None:
            if node_id in visited:
                return
            if node_id in visiting:
                raise ValueError(f"Circular derived-source dependency involving {node_id}.")
            visiting.add(node_id)
            node = needed[node_id]
            for parent_id in node.parent_relation_ids:
                if parent_id in needed:
                    visit(parent_id)
            visiting.remove(node_id)
            visited.add(node_id)
            ordered.append(node)

        for node_id in needed:
            visit(node_id)
        return ordered

    @staticmethod
    def _relation_sql(node: RelationNode, aliases: dict[str, str], self_contained: bool) -> str:
        alias = aliases[node.relation_id]
        if node.kind == RelationNodeKind.PHYSICAL_TABLE:
            if not node.table:
                raise ValueError(f"Physical relation {node.relation_id} has no table reference.")
            return f"{node.table.qualified_name} AS {alias}"
        if not self_contained and node.physical_view_name:
            return f"{node.physical_view_name} AS {alias}"
        return alias

    def parse(self, body: MappingSqlParseRequest) -> MappingSqlParseResponse:
        parsed = parse_sql_document(body.sql)
        known = {table.qualified_name.upper(): table for table in body.known_tables}
        cte_names = {item.name.upper() for item in parsed.ctes}
        unresolved: list[str] = []
        ambiguous: dict[str, list[str]] = {}

        def resolve(name: str | None) -> str | None:
            if not name:
                return None
            upper = name.upper()
            if upper in cte_names:
                return name
            if upper in known:
                return known[upper].qualified_name
            candidates = [fqn for fqn in known if fqn == upper or fqn.endswith(f".{upper}")]
            if len(candidates) == 1:
                return known[candidates[0]].qualified_name
            if len(candidates) > 1:
                ambiguous[name] = sorted(candidates)
            elif name.count(".") < 2:
                unresolved.append(name)
            return name

        source_tables = [resolve(name) or name for name in parsed.source_tables]
        target_table = resolve(parsed.target_table)
        if target_table is None:
            current_target = body.current_workspace.get("target_table")
            if isinstance(current_target, str) and current_target.strip():
                target_table = current_target
        joins = []
        for item in parsed.join_patterns:
            join = item.to_dict()
            join["left_table"] = resolve(item.left_table) or item.left_table
            join["right_table"] = resolve(item.right_table) or item.right_table
            joins.append(join)
        mapping_rows = []
        for mapping in parsed.column_mappings:
            item = mapping.to_dict()
            source_table = None
            if mapping.source_table:
                source_table = parsed.table_aliases.get(mapping.source_table.upper())
                source_table = source_table or resolve(mapping.source_table)
            item["source_table"] = source_table
            item["target_column"] = mapping.target_alias or mapping.source_column
            resolved_columns: list[str] = []
            for source_column in mapping.source_columns:
                qualifier, separator, column_name = source_column.rpartition(".")
                if separator:
                    resolved_table = parsed.table_aliases.get(qualifier.upper())
                    resolved_table = resolved_table or resolve(qualifier)
                    resolved_columns.append(
                        ".".join(part for part in (resolved_table, column_name) if part)
                    )
                else:
                    resolved_columns.append(source_column)
            if not resolved_columns and mapping.mapping_mode == "source" and mapping.source_column:
                resolved_columns = [
                    ".".join(
                        part
                        for part in (item.get("source_table"), mapping.source_column)
                        if part
                    )
                ]
            item["source_columns"] = resolved_columns
            mapping_mode = mapping.mapping_mode
            constant_value = mapping.constant_value
            attribute_name = None
            if isinstance(constant_value, str):
                variable_match = re.fullmatch(
                    r"\$([A-Za-z_][A-Za-z0-9_]*)",
                    constant_value.strip(),
                )
                if variable_match:
                    candidate_name = variable_match.group(1)
                    resolved_value = parsed.variables.get(candidate_name.upper())
                    if resolved_value is not None:
                        mapping_mode = "attribute"
                        attribute_name = candidate_name
                        constant_value = resolved_value
            item["mapping_mode"] = mapping_mode
            item["constant_value"] = constant_value
            item["attribute_name"] = attribute_name
            item["expression"] = mapping.transformation
            item["rule"] = (
                "Value"
                if mapping_mode in {"constant", "attribute"}
                else ("Custom" if mapping.transformation else "Direct")
            )
            item["status"] = "MAPPED"
            mapping_rows.append(item)
        filters = [
            rule.to_dict()
            for rule in parsed.business_rules
            if rule.rule_type in {"where_filter", "qualify_filter", "grouping", "sorting"}
        ]
        workspace = {
            "source_tables": source_tables,
            "target_table": target_table,
            "mapping_rows": mapping_rows,
            "relationships": joins,
            "filters": filters,
            "ctes": [item.to_dict() for item in parsed.ctes],
            "derived_sources": [
                item.to_dict() for item in parsed.ctes if item.is_derived_source
            ],
            "business_rules": [item.to_dict() for item in parsed.business_rules],
            "transformations": parsed.transformations,
            "sql": body.sql,
        }
        diff = self._workspace_diff(body.current_workspace, workspace)
        warnings = list(parsed.parse_warnings)
        if ambiguous:
            warnings.append("Resolve ambiguous table references before applying SQL changes.")
        if unresolved:
            warnings.append("Resolve unqualified table references before applying SQL changes.")
        return MappingSqlParseResponse(
            valid=not ambiguous and not unresolved and bool(source_tables or target_table),
            parsed_workspace=workspace,
            diff=diff,
            warnings=warnings,
            unresolved_references=sorted(set(unresolved)),
            ambiguous_references=ambiguous,
        )

    @staticmethod
    def _workspace_diff(
        current: dict[str, Any],
        parsed: dict[str, Any],
    ) -> dict[str, list[Any]]:
        diff: dict[str, list[Any]] = {}
        for key in ("source_tables", "mapping_rows", "relationships", "filters", "ctes"):
            before = current.get(key) if isinstance(current.get(key), list) else []
            after = parsed.get(key) if isinstance(parsed.get(key), list) else []
            before_tokens = {json.dumps(item, sort_keys=True, default=str) for item in before}
            after_tokens = {json.dumps(item, sort_keys=True, default=str) for item in after}
            diff[f"{key}_added"] = [json.loads(item) for item in sorted(after_tokens - before_tokens)]
            diff[f"{key}_removed"] = [json.loads(item) for item in sorted(before_tokens - after_tokens)]
        if current.get("target_table") != parsed.get("target_table"):
            diff["target_table_changed"] = [
                {"before": current.get("target_table"), "after": parsed.get("target_table")}
            ]
        return diff

    def preview(self, body: MappingSqlPreviewRequest) -> MappingSqlPreviewResponse:
        preview_sql = self._normalize_sql(body.approved_preview_sql or body.preview_sql)
        generated_sql = self._normalize_sql(body.approved_generated_sql or body.generated_sql)
        if not preview_sql:
            raise ValueError("Preview SQL is empty.")
        if self._is_placeholder_sql(preview_sql) or self._is_placeholder_sql(generated_sql):
            raise ValueError("Map at least one target attribute before previewing results.")

        transformed = self._execute_preview_sql(preview_sql, limit=body.preview_limit)
        source_aliases = self._build_source_alias_map(body.mappings)
        warnings: list[str] = []
        if source_aliases:
            try:
                source_rows = self._execute_source_value_preview(
                    body.source_query_sql,
                    source_aliases,
                    limit=body.preview_limit,
                )
            except Exception as exc:
                warnings.append(
                    "Preview rows were generated, but the source-value comparison query could not be prepared. "
                    f"Reason: {self._summarize_sql_error(exc)}"
                )
                source_rows = _QueryExecutionResult(columns=[], rows=[])
        elif re.search(
            r"(?:SQL\s+COMPILATION\s+ERROR.*(?:SYNTAX|UNEXPECTED)|SYNTAX\s+ERROR|UNEXPECTED\s+['\"])",
            validation_error,
            flags=re.IGNORECASE,
        ):
            source_rows = _QueryExecutionResult(columns=[], rows=[])

        return MappingSqlPreviewResponse(
            valid=True,
            variant_used=body.chosen_variant,
            executed_preview_sql=preview_sql,
            executed_generated_sql=generated_sql,
            preview_columns=transformed.columns,
            preview_rows=transformed.rows,
            source_sample_aliases=source_aliases,
            source_sample_rows=source_rows.rows,
            semantic_view_name=body.semantic_view_name,
            warnings=warnings,
        )

    def _validate_preview_sql(self, sql_text: str) -> bool:
        self._compile_preview_sql(sql_text)
        return True

    def _compile_preview_sql(self, sql_text: str) -> None:
        normalized = self._normalize_sql(sql_text)
        if not normalized:
            raise ValueError("Preview SQL is empty.")
        self._session.sql(f"EXPLAIN USING TEXT {normalized}").collect()

    def _candidate_sql_is_valid(self, sql_text: str) -> bool:
        try:
            self._validate_preview_sql(sql_text)
        except Exception:
            return False
        return True

    def _execute_preview_sql(self, sql_text: str, *, limit: int) -> _QueryExecutionResult:
        normalized_sql = self._normalize_sql(sql_text)
        preview_query = (
            "SELECT * FROM (\n"
            f"{normalized_sql}\n"
            f") AS MAPPING_PREVIEW LIMIT {limit}"
        )
        dataframe = self._session.sql(preview_query)
        rows = dataframe.collect()
        columns = [
            MappingSqlPreviewColumn(name=field.name, data_type=str(field.datatype))
            for field in dataframe.schema.fields
        ]
        serialized_rows = [
            MappingSqlPreviewRow(
                values=json.loads(json.dumps(row.as_dict(recursive=True), default=str))
            )
            for row in rows
        ]
        return _QueryExecutionResult(columns=columns, rows=serialized_rows)

    def _execute_source_value_preview(
        self,
        source_query_sql: str,
        alias_map: dict[str, str],
        *,
        limit: int,
    ) -> _QueryExecutionResult:
        if not alias_map:
            return _QueryExecutionResult(columns=[], rows=[])
        foundation_sql = self._normalize_source_foundation_sql(source_query_sql)
        if not foundation_sql:
            return _QueryExecutionResult(columns=[], rows=[])
        select_items = ",\n  ".join(
            f"{source_expr} AS {alias}"
            for source_expr, alias in alias_map.items()
        )
        preview_query = (
            "SELECT\n"
            f"  {select_items}\n"
            f"{foundation_sql}\n"
            f"LIMIT {limit}"
        )
        dataframe = self._session.sql(preview_query)
        rows = dataframe.collect()
        columns = [
            MappingSqlPreviewColumn(name=field.name, data_type=str(field.datatype))
            for field in dataframe.schema.fields
        ]
        serialized_rows = [
            MappingSqlPreviewRow(
                values=json.loads(json.dumps(row.as_dict(recursive=True), default=str))
            )
            for row in rows
        ]
        return _QueryExecutionResult(columns=columns, rows=serialized_rows)

    @staticmethod
    def _build_source_alias_map(mappings: list[MappingSqlMappingItem]) -> dict[str, str]:
        aliases: dict[str, str] = {}
        counter = 1
        for mapping in mappings:
            source_columns = mapping.source_columns or []
            if not source_columns and mapping.source_column:
                source_columns = [
                    part.strip()
                    for part in mapping.source_column.split(",")
                    if part.strip()
                ]
            for source_expr in source_columns:
                if source_expr in aliases:
                    continue
                aliases[source_expr] = f"SRC_{counter}"
                counter += 1
        return aliases

    @staticmethod
    def _covers_target_aliases(sql_text: str, mappings: list[MappingSqlMappingItem]) -> bool:
        upper_sql = sql_text.upper()
        expected_aliases = [
            mapping.target_column.upper()
            for mapping in mappings
            if (mapping.status or "").upper() == "MAPPED"
        ]
        return all(
            f" AS {alias}" in upper_sql or re.search(rf"\b{re.escape(alias)}\b", upper_sql)
            for alias in expected_aliases
        )

    @staticmethod
    def _rebuild_insert_sql(generated_sql: str, preview_sql: str) -> str:
        normalized_generated = generated_sql.rstrip().rstrip(";")
        normalized_preview = preview_sql.rstrip().rstrip(";")
        marker = "\nSELECT"
        marker_index = normalized_generated.upper().find(marker)
        if marker_index == -1:
            return normalized_generated
        return f"{normalized_generated[:marker_index]}\n{normalized_preview};"

    @staticmethod
    def _normalize_sql(sql_text: str | None) -> str:
        return (sql_text or "").strip().rstrip(";")

    @staticmethod
    def _is_placeholder_sql(sql_text: str) -> bool:
        normalized = sql_text.strip()
        return any(normalized.startswith(message) for message in _PLACEHOLDER_MESSAGES)

    @staticmethod
    def _normalize_source_foundation_sql(sql_text: str) -> str:
        normalized = MappingSqlService._normalize_sql(sql_text)
        stripped = re.sub(r"^\s*SELECT\s+\*\s+", "", normalized, count=1, flags=re.IGNORECASE)
        if stripped != normalized:
            return stripped.lstrip()
        return f"FROM (\n{normalized}\n) AS SOURCE_FOUNDATION"

    @staticmethod
    def _summarize_sql_error(exc: Exception) -> str:
        text = str(exc).strip()
        if not text:
            return "Snowflake returned an unknown validation error."
        collapsed = re.sub(r"\s+", " ", text)
        return collapsed[:600]

    @staticmethod
    def _build_repair_options(
        *,
        validation_error: str | None,
        has_suggested_sql: bool,
    ) -> list[dict[str, str]]:
        """Turn validation failures into safe UI actions without inventing SQL."""
        if not validation_error:
            return []

        options: list[dict[str, str]] = []
        if has_suggested_sql:
            options.append(
                {
                    "code": "apply_suggested_sql",
                    "title": "Review the suggested SQL repair",
                    "description": (
                        "Compare the validated repair with the current SQL, then explicitly apply it."
                    ),
                    "action": "review_suggested_sql",
                }
            )
        elif (
            "syntax error" in validation_error.lower()
            or "unexpected" in validation_error.lower()
        ):
            options.append(
                {
                    "code": "fix_with_ai",
                    "title": "Fix syntax with AI",
                    "description": (
                        "Ask the SQL analyst to repair only the failing syntax, then validate the "
                        "candidate in Snowflake before showing it for approval."
                    ),
                    "action": "request_ai_repair",
                }
            )

        variable_match = re.search(
            r"SESSION\s+VARIABLE\s+['\"]?(\$?[A-Z0-9_]+)",
            validation_error,
            flags=re.IGNORECASE,
        )
        if variable_match:
            identifier = variable_match.group(1)
            if not identifier.startswith("$"):
                identifier = f"${identifier}"
            options.append(
                {
                    "code": "resolve_value_binding",
                    "title": f"Resolve the Value binding {identifier}",
                    "description": (
                        "Snowflake is treating this placeholder as a session variable. Open the "
                        "mapping row and bind the project-specific Value (or configure the session "
                        "variable used for validation), then validate again."
                    ),
                    "action": "open_mapping",
                    "identifier": identifier,
                }
            )

        identifier_match = re.search(
            r"(?:INVALID\s+IDENTIFIER|IDENTIFIER)\s+['\"]([^'\"]+)['\"]",
            validation_error,
            flags=re.IGNORECASE,
        )
        if identifier_match:
            identifier = identifier_match.group(1)
            options.append(
                {
                    "code": "verify_source_contract",
                    "title": f"Verify source output {identifier}",
                    "description": (
                        "Confirm that the selected physical or derived source exposes this column "
                        "and that its relation alias is joined into the current graph. Update the "
                        "source contract or mapping dependency, then validate again."
                    ),
                    "action": "open_mapping",
                    "identifier": identifier,
                }
            )

        options.append(
            {
                "code": "edit_sql",
                "title": "Edit and re-parse the generated SQL",
                "description": (
                    "Use Edit SQL to make a reviewed correction. The workspace parser will show "
                    "the mapping, relationship, filter, and derived-source changes before applying them."
                ),
                "action": "edit_sql",
            }
        )
        return options

    def _attempt_cortex_sql_repair(
        self,
        body: MappingSqlReviewRequest,
        preview_sql: str,
        *,
        validation_error: str,
    ) -> tuple[str | None, str]:
        """Request a syntax-only repair and fail closed unless Snowflake validates it."""
        model = (
            self._settings.fir_upload_explanation_model
            if self._settings is not None
            else "claude-haiku-4-5"
        )
        target_aliases = [
            mapping.target_column
            for mapping in body.mappings
            if (mapping.status or "").upper() == "MAPPED"
        ]
        prompt = (
            "Repair the Snowflake SQL syntax below. Preserve every SELECT alias, table, join, "
            "filter, and business expression. Do not invent columns or change business logic. "
            "Return JSON only as {\"sql\":\"...\",\"summary\":\"...\"}.\n"
            f"Required target aliases: {json.dumps(target_aliases)}\n"
            f"Snowflake error: {validation_error}\nSQL:\n{preview_sql}"
        )
        try:
            raw = complete_text(
                self._session,
                model=model,
                prompt=prompt,
            )
            parsed = self._parse_json_object(raw)
            candidate = self._normalize_sql(str(parsed.get("sql") or ""))
            if not candidate or not self._covers_target_aliases(candidate, body.mappings):
                return None, "AI did not return a contract-preserving SQL repair."
            summary = str(parsed.get("summary") or "AI prepared a syntax repair for review.")
            return candidate, summary
        except CortexCompletionUnavailable as exc:
            logger.warning("Cortex SQL repair unavailable: %s", exc)
            return None, "AI could not prepare a safe SQL repair."
        except Exception as exc:
            logger.warning("Cortex SQL repair failed: %s", exc)
            return None, "AI could not prepare a safe SQL repair."

    @staticmethod
    def _parse_json_object(value: object) -> dict[str, object]:
        if isinstance(value, dict):
            for key in ("response", "content", "message"):
                nested = value.get(key)
                if nested is not None:
                    parsed = MappingSqlService._parse_json_object(nested)
                    if parsed:
                        return parsed
            return value
        if isinstance(value, list):
            for item in value:
                parsed = MappingSqlService._parse_json_object(item)
                if parsed:
                    return parsed
            return {}
        text = str(value or "").strip()
        fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
        if fenced:
            text = fenced.group(1)
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
        try:
            parsed = json.loads(text)
        except (TypeError, json.JSONDecodeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}

    @staticmethod
    def _is_unhelpful_review_summary(text: str) -> bool:
        normalized = text.strip().lower()
        return normalized.startswith("i'm sorry") or "this question is asking for" in normalized

    def _build_review_prompt(
        self,
        body: MappingSqlReviewRequest,
        preview_sql: str,
        *,
        validation_error: str | None = None,
    ) -> str:
        source_tables = ", ".join(table.qualified_name for table in body.source_tables) or "None"
        target_table = body.target_table.qualified_name if body.target_table else "None"
        relationship_lines = [
            (
                f"- {item.left_table.qualified_name} {item.join_type} {item.right_table.qualified_name}"
                f" on {', '.join(f'{condition.left_column} {condition.operator} {condition.right_column}' for condition in item.conditions)}"
            )
            for item in body.relationships
            if item.conditions
        ]
        relation_lines: list[str] = []
        derived_sql_sections: list[str] = []
        if body.relation_graph is not None:
            for node in body.relation_graph.nodes:
                output_names = [
                    str(item.get("name") or item.get("column_name") or "").strip()
                    for item in node.output_columns
                    if isinstance(item, dict)
                    and str(item.get("name") or item.get("column_name") or "").strip()
                ]
                relation_lines.append(
                    f"- id={node.relation_id}; alias={node.alias}; kind={node.kind.value}; "
                    f"outputs={output_names or ['<contract missing>']}"
                )
                if node.kind in {RelationNodeKind.DERIVED_SOURCE, RelationNodeKind.CTE} and node.sql_text:
                    derived_sql_sections.extend(
                        [
                            f"Saved SQL for derived relation {node.relation_id} (read-only evidence):",
                            self._normalize_sql(node.sql_text)[:12000],
                        ]
                    )
        mapping_lines = []
        for mapping in body.mappings:
            if (mapping.status or "").upper() != "MAPPED":
                continue
            source_columns = mapping.source_columns or []
            if not source_columns and mapping.source_column:
                source_columns = [part.strip() for part in mapping.source_column.split(",") if part.strip()]
            mapping_lines.append(
                f"- {mapping.target_column}: sources={source_columns or ['<none>']}, "
                f"mode={mapping.mapping_mode}, "
                f"constant={mapping.constant_value if mapping.mapping_mode == 'constant' else '<none>'}, "
                f"rule={mapping.rule or 'Direct'}, expression={mapping.expression or '<none>'}"
            )

        prompt_lines = [
            "Generate the best Snowflake SELECT statement for this STTM mapping request using the semantic view.",
            f"Target table: {target_table}",
            f"Source tables: {source_tables}",
            "Required target aliases and mapping intent:",
            *(mapping_lines or ["- None"]),
            "Current relationships:",
            *(relationship_lines or ["- None"]),
            "Unified relation graph and validated output contracts:",
            *(relation_lines or ["- None"]),
            *derived_sql_sections,
            "Baseline SELECT SQL to improve or repair if needed:",
            preview_sql,
            "",
            *(
                [
                    "Snowflake validation issue that must be fixed:",
                    validation_error,
                    "",
                ]
                if validation_error
                else []
            ),
            "Instructions:",
            "1. Return a Snowflake SELECT statement only.",
            "2. Use the baseline SQL as guidance, but regenerate it in the best valid form for Snowflake if it is invalid or suboptimal.",
            "3. Preserve the target aliases exactly as written in the baseline SQL.",
            "4. Respect the listed relationships and source tables; do not introduce unrelated tables.",
            "5. Fix aggregation, grouping, casting, join, or expression issues if required.",
            "6. Never reference a derived column that is absent from that relation's output contract.",
            "7. If a required business field cannot be produced from the current graph, do not invent a column; explain that no safe repair is possible.",
            "8. Do not return INSERT statements, explanations inside the SQL, markdown fences, or DDL.",
        ]
        return "\n".join(prompt_lines)

    def _attempt_sql_repair(
        self,
        preview_sql: str,
        *,
        validation_error: str,
    ) -> tuple[str | None, str]:
        if self._needs_group_by_repair(preview_sql, validation_error):
            repaired = self._repair_missing_group_by(preview_sql)
            if repaired and self._normalize_sql(repaired) != self._normalize_sql(preview_sql):
                return (
                    repaired,
                    "Snowflake validation found aggregate expressions mixed with non-aggregated selected columns. A repaired SQL version was prepared by grouping the non-aggregated columns so you can review and apply it.",
                )
        return None, "Snowflake validation found an issue, but no safe automatic repair could be prepared."

    @staticmethod
    def _needs_group_by_repair(sql_text: str, validation_error: str) -> bool:
        upper_error = validation_error.upper()
        upper_sql = sql_text.upper()
        return (
            "GROUP BY" not in upper_sql
            and ("IS NOT A VALID GROUP BY EXPRESSION" in upper_error or "NOT AN AGGREGATE" in upper_error)
            and any(func in upper_sql for func in ("MAX(", "MIN(", "SUM(", "AVG(", "COUNT(", "LISTAGG(", "ARRAY_AGG(", "OBJECT_AGG("))
        )

    def _repair_missing_group_by(self, sql_text: str) -> str | None:
        normalized = self._normalize_sql(sql_text)
        parsed = self._parse_select_from_query(normalized)
        if not parsed:
            return None
        select_clause, remainder = parsed
        select_items = self._split_top_level(select_clause)
        if not select_items:
            return None

        non_aggregate_expressions: list[str] = []
        for item in select_items:
            expr = self._strip_alias(item)
            if self._contains_aggregate(expr):
                continue
            non_aggregate_expressions.append(expr)

        if not non_aggregate_expressions:
            return None

        upper_remainder = remainder.upper()
        insert_at = len(remainder)
        for keyword in (" QUALIFY ", " ORDER BY ", " LIMIT "):
            index = upper_remainder.find(keyword)
            if index != -1:
                insert_at = min(insert_at, index)
        before_tail = remainder[:insert_at].rstrip()
        tail = remainder[insert_at:].lstrip()
        group_by_clause = "GROUP BY\n  " + ",\n  ".join(non_aggregate_expressions)
        select_list = ",\n  ".join(select_items)
        rebuilt = f"SELECT\n  {select_list}\n{before_tail}\n{group_by_clause}"
        if tail:
            rebuilt = f"{rebuilt}\n{tail}"
        return rebuilt

    @staticmethod
    def _parse_select_from_query(sql_text: str) -> tuple[str, str] | None:
        upper_sql = sql_text.upper()
        if not upper_sql.startswith("SELECT"):
            return None
        depth = 0
        in_single = False
        in_double = False
        from_index = -1
        for index, char in enumerate(sql_text):
            previous = sql_text[index - 1] if index > 0 else ""
            if char == "'" and not in_double and previous != "\\":
                in_single = not in_single
                continue
            if char == '"' and not in_single and previous != "\\":
                in_double = not in_double
                continue
            if in_single or in_double:
                continue
            if char == "(":
                depth += 1
                continue
            if char == ")" and depth > 0:
                depth -= 1
                continue
            if depth == 0 and upper_sql[index : index + 6] == "FROM  ":
                # no-op safeguard, retained for symmetry with boundary check below
                continue
            if depth == 0 and upper_sql[index : index + 4] == "FROM":
                before = upper_sql[index - 1] if index > 0 else " "
                after = upper_sql[index + 4] if index + 4 < len(upper_sql) else " "
                if before.isspace() and after.isspace():
                    from_index = index
                    break
        if from_index == -1:
            return None
        select_clause = sql_text[6:from_index].strip()
        remainder = sql_text[from_index:].strip()
        return select_clause, remainder

    def _split_top_level(self, value: str) -> list[str]:
        parts: list[str] = []
        current: list[str] = []
        depth = 0
        in_single = False
        in_double = False
        for index, char in enumerate(value):
            previous = value[index - 1] if index > 0 else ""
            if char == "'" and not in_double and previous != "\\":
                in_single = not in_single
                current.append(char)
                continue
            if char == '"' and not in_single and previous != "\\":
                in_double = not in_double
                current.append(char)
                continue
            if not in_single and not in_double:
                if char == "(":
                    depth += 1
                elif char == ")" and depth > 0:
                    depth -= 1
                elif char == "," and depth == 0:
                    token = "".join(current).strip()
                    if token:
                        parts.append(token)
                    current = []
                    continue
            current.append(char)
        token = "".join(current).strip()
        if token:
            parts.append(token)
        return parts

    @staticmethod
    def _strip_alias(item: str) -> str:
        match = re.match(r"^(.*?)(?:\s+AS\s+|\s+)([A-Za-z_][A-Za-z0-9_$]*)\s*$", item, flags=re.IGNORECASE)
        if not match:
            return item.strip()
        expression = match.group(1).strip()
        if not expression:
            return item.strip()
        return expression

    @staticmethod
    def _contains_aggregate(expression: str) -> bool:
        upper_expression = expression.upper()
        return any(func in upper_expression for func in ("MAX(", "MIN(", "SUM(", "AVG(", "COUNT(", "LISTAGG(", "ARRAY_AGG(", "OBJECT_AGG("))
