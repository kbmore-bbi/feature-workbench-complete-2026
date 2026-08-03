"""Server-side SQL parser using sqlglot.

Handles full DDL/DML/CTEs — not just SELECT like the client-side parser.
Extracts tables, column mappings, joins, transformations, and business rules.
"""
from __future__ import annotations

import logging
import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

try:
    import sqlglot
    from sqlglot import exp
    HAS_SQLGLOT = True
except ImportError:
    HAS_SQLGLOT = False
    logger.warning("sqlglot not installed — SQL parsing will use fallback regex")


@dataclass
class ColumnMapping:
    source_table: str | None
    source_column: str
    target_alias: str | None
    transformation: str | None = None
    source_columns: list[str] = field(default_factory=list)
    mapping_mode: str = "source"
    constant_value: str | None = None
    target_table: str | None = None
    physical_source_columns: list[str] = field(default_factory=list)
    lineage_path: list[dict[str, Any]] = field(default_factory=list)
    unresolved_references: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_table": self.source_table,
            "source_column": self.source_column,
            "target_alias": self.target_alias,
            "transformation": self.transformation,
            "source_columns": self.source_columns,
            "mapping_mode": self.mapping_mode,
            "constant_value": self.constant_value,
            "target_table": self.target_table,
            "physical_source_columns": self.physical_source_columns,
            "lineage_path": self.lineage_path,
            "unresolved_references": self.unresolved_references,
        }


@dataclass
class JoinPattern:
    join_type: str
    left_table: str
    right_table: str
    condition: str
    keys: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "join_type": self.join_type,
            "left_table": self.left_table,
            "right_table": self.right_table,
            "condition": self.condition,
            "keys": self.keys,
        }


@dataclass
class CTEDefinition:
    name: str
    purpose: str
    tables_referenced: list[str] = field(default_factory=list)
    sql_text: str | None = None
    dependencies: list[str] = field(default_factory=list)
    is_derived_source: bool = False
    output_columns: list[dict[str, Any]] = field(default_factory=list)
    grain_evidence: list[str] = field(default_factory=list)
    downstream_consumers: list[str] = field(default_factory=list)
    derived_source_candidate: bool = False
    derived_source_reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "purpose": self.purpose,
            "tables_referenced": self.tables_referenced,
            "sql_text": self.sql_text,
            "dependencies": self.dependencies,
            "is_derived_source": self.is_derived_source,
            "output_columns": self.output_columns,
            "grain_evidence": self.grain_evidence,
            "downstream_consumers": self.downstream_consumers,
            "derived_source_candidate": self.derived_source_candidate,
            "derived_source_reasons": self.derived_source_reasons,
        }


@dataclass
class BusinessRule:
    rule_type: str  # 'case_expression', 'where_filter', 'window_function'
    description: str
    sql_fragment: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule_type": self.rule_type,
            "description": self.description,
            "sql_fragment": self.sql_fragment,
        }


@dataclass
class SqlVariableBinding:
    """A typed, reviewable project-value candidate declared by Snowflake SET."""

    name: str
    raw_expression: str
    resolved_value: str | None
    inferred_type: str
    usage_roles: list[str] = field(default_factory=list)
    reference_count: int = 0
    classification: str = "mapping_value"
    project_value_candidate: bool = True
    approval_status: str = "draft"

    def to_dict(self) -> dict[str, Any]:
        return {
            "evidence_id": f"sql_variable:{self.name.lower()}",
            "name": self.name,
            "placeholder": f"${self.name}",
            "raw_expression": self.raw_expression,
            "resolved_value": self.resolved_value,
            "inferred_type": self.inferred_type,
            "usage_roles": self.usage_roles,
            "reference_count": self.reference_count,
            "classification": self.classification,
            "project_value_candidate": self.project_value_candidate,
            "approval_status": self.approval_status,
            "action_contract": {
                "action": (
                    "upsert_project_attribute"
                    if self.project_value_candidate
                    else "retain_as_sql_parameter"
                ),
                "scope": "project" if self.project_value_candidate else "document",
                "requires_review": True,
            },
            "provenance": "deterministic_sql_set_assignment",
        }


@dataclass
class ParsedSqlDocument:
    document_version: str = "3.0"
    source_tables: list[str] = field(default_factory=list)
    target_table: str | None = None
    column_mappings: list[ColumnMapping] = field(default_factory=list)
    join_patterns: list[JoinPattern] = field(default_factory=list)
    ctes: list[CTEDefinition] = field(default_factory=list)
    business_rules: list[BusinessRule] = field(default_factory=list)
    transformations: list[str] = field(default_factory=list)
    sql_dialect: str = "snowflake"
    parse_warnings: list[str] = field(default_factory=list)
    table_aliases: dict[str, str] = field(default_factory=dict)
    variables: dict[str, str] = field(default_factory=dict)
    variable_bindings: list[SqlVariableBinding] = field(default_factory=list)
    lineage_diagnostics: list[dict[str, Any]] = field(default_factory=list)
    knowledge_graph: dict[str, list[dict[str, Any]]] = field(
        default_factory=lambda: {"nodes": [], "edges": []}
    )
    target_binding: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "document_version": self.document_version,
            "source_tables": self.source_tables,
            "target_table": self.target_table,
            "column_mappings": [m.to_dict() for m in self.column_mappings],
            "join_patterns": [j.to_dict() for j in self.join_patterns],
            "ctes": [c.to_dict() for c in self.ctes],
            "business_rules": [r.to_dict() for r in self.business_rules],
            "transformations": self.transformations,
            "sql_dialect": self.sql_dialect,
            "parse_warnings": self.parse_warnings,
            "table_aliases": self.table_aliases,
            "variables": self.variables,
            "variable_bindings": [item.to_dict() for item in self.variable_bindings],
            "lineage_diagnostics": self.lineage_diagnostics,
            "knowledge_graph": self.knowledge_graph,
            "target_binding": self.target_binding,
            "stats": {
                "tables": len(self.source_tables),
                "columns": len(self.column_mappings),
                "joins": len(self.join_patterns),
                "ctes": len(self.ctes),
                "rules": len(self.business_rules),
                "variables": len(self.variable_bindings),
            },
        }


def parse_sql_document(sql_text: str) -> ParsedSqlDocument:
    """Parse a SQL document and extract all structural information."""
    normalized_sql, scripting_warnings, variables, variable_bindings = _normalize_snowflake_scripting(
        sql_text
    )
    if HAS_SQLGLOT:
        result = _parse_with_sqlglot(normalized_sql)
    else:
        result = _parse_with_regex(normalized_sql)
    result.parse_warnings.extend(scripting_warnings)
    result.variables = variables
    result.variable_bindings = variable_bindings
    _attach_variable_evidence(result)
    return result


def bind_sql_document_context(
    parsed: ParsedSqlDocument,
    *,
    workspace_target: str | None = None,
    target_hint: str | None = None,
) -> ParsedSqlDocument:
    """Bind a SELECT projection to the authoritative workspace target.

    Parsing remains independent of UI state. This post-parse binding preserves
    SQL-declared targets as evidence while allowing a selected target to own the
    mapping identity for reference SELECT statements.
    """
    selected = str(workspace_target or "").strip()
    hinted = str(target_hint or "").strip()
    declared = str(parsed.target_table or "").strip()
    resolved = selected or hinted or declared or ""
    source = (
        "workspace_selection"
        if selected
        else "explicit_upload_hint"
        if hinted
        else "sql_write_target"
        if declared
        else "unresolved"
    )
    conflicts: list[dict[str, str]] = []
    if selected and declared and selected.upper() != declared.upper():
        conflicts.append(
            {
                "kind": "target_conflict",
                "authoritative_target": selected,
                "sql_declared_target": declared,
            }
        )
    if selected and hinted and selected.upper() != hinted.upper():
        conflicts.append(
            {
                "kind": "target_hint_conflict",
                "authoritative_target": selected,
                "target_hint": hinted,
            }
        )
    parsed.target_binding = {
        "status": "resolved" if resolved else "unresolved",
        "target_table": resolved or None,
        "binding_source": source,
        "sql_declared_target": declared or None,
        "conflicts": conflicts,
    }
    if conflicts:
        parsed.parse_warnings.append(
            "The selected workspace target differs from target evidence in the SQL upload; "
            "the workspace selection was retained for review."
        )
    parsed.target_table = resolved or None
    for mapping in parsed.column_mappings:
        mapping.target_table = resolved or None

    if not resolved:
        return parsed
    graph = parsed.knowledge_graph
    nodes = graph.get("nodes") if isinstance(graph, dict) else None
    edges = graph.get("edges") if isinstance(graph, dict) else None
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return parsed
    replacements: dict[str, str] = {}
    for graph_node in nodes:
        if not isinstance(graph_node, dict):
            continue
        old_id = str(graph_node.get("id") or "")
        kind = str(graph_node.get("kind") or "")
        attributes = graph_node.get("attributes")
        attributes = attributes if isinstance(attributes, dict) else {}
        if kind == "target_table":
            new_id = f"target_table:{resolved.upper()}"
            graph_node["id"] = new_id
            attributes["fqn"] = resolved
            replacements[old_id] = new_id
        elif kind == "target_column":
            column = str(attributes.get("column") or old_id.rsplit(".", 1)[-1])
            new_id = f"target_column:{resolved}.{column}".upper()
            graph_node["id"] = new_id
            attributes["table"] = resolved
            replacements[old_id] = new_id
        graph_node["attributes"] = attributes
    for graph_edge in edges:
        if not isinstance(graph_edge, dict):
            continue
        graph_edge["source"] = replacements.get(
            str(graph_edge.get("source") or ""),
            graph_edge.get("source"),
        )
        graph_edge["target"] = replacements.get(
            str(graph_edge.get("target") or ""),
            graph_edge.get("target"),
        )
    return parsed


_SET_ASSIGNMENT = re.compile(
    r"(?ims)^\s*SET\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?);\s*(?=\r?\n|$)"
)
_IDENTIFIER_CALL = re.compile(r"(?is)IDENTIFIER\s*\(([^()]*)\)")


def _split_snowflake_concat(expression: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    quote: str | None = None
    index = 0
    while index < len(expression):
        char = expression[index]
        if char in {"'", '"'}:
            if quote == char and index + 1 < len(expression) and expression[index + 1] == char:
                current.extend((char, char))
                index += 2
                continue
            quote = None if quote == char else (char if quote is None else quote)
        if quote is None and expression[index:index + 2] == "||":
            parts.append("".join(current).strip())
            current = []
            index += 2
            continue
        current.append(char)
        index += 1
    parts.append("".join(current).strip())
    return parts


def _split_function_args(expression: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    quote: str | None = None
    depth = 0
    index = 0
    while index < len(expression):
        char = expression[index]
        if char in {"'", '"'}:
            if quote == char and index + 1 < len(expression) and expression[index + 1] == char:
                current.extend((char, char))
                index += 2
                continue
            quote = None if quote == char else (char if quote is None else quote)
        elif quote is None:
            if char == "(":
                depth += 1
            elif char == ")":
                depth = max(0, depth - 1)
            elif char == "," and depth == 0:
                parts.append("".join(current).strip())
                current = []
                index += 1
                continue
        current.append(char)
        index += 1
    parts.append("".join(current).strip())
    return [part for part in parts if part]


def _evaluate_snowflake_identifier_expression(
    expression: str,
    variables: dict[str, str],
) -> str | None:
    expression = expression.strip()
    concat_call = re.fullmatch(r"(?is)CONCAT\s*\((.*)\)", expression)
    if concat_call:
        values = [
            _evaluate_snowflake_identifier_expression(part, variables)
            for part in _split_function_args(concat_call.group(1))
        ]
        if any(value is None for value in values):
            return None
        return "".join(value or "" for value in values).strip() or None

    values: list[str] = []
    for raw_part in _split_snowflake_concat(expression):
        part = raw_part.strip()
        if not part:
            continue
        if part.startswith("$"):
            value = variables.get(part[1:].upper())
            if value is None:
                return None
            values.append(value)
            continue
        if len(part) >= 2 and part[0] == part[-1] and part[0] in {"'", '"'}:
            quote = part[0]
            values.append(part[1:-1].replace(quote * 2, quote))
            continue
        nested = re.fullmatch(r"(?is)IDENTIFIER\s*\((.*)\)", part)
        if nested:
            value = _evaluate_snowflake_identifier_expression(nested.group(1), variables)
            if value is None:
                return None
            values.append(value)
            continue
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)*", part):
            values.append(part)
            continue
        return None
    value = "".join(values).strip()
    return value or None


def _evaluate_snowflake_variable_expression(
    expression: str,
    variables: dict[str, str],
) -> str | None:
    """Resolve static SET values while retaining identifier-expression support."""
    value = expression.strip()
    quoted = re.fullmatch(r"(?s)'((?:''|[^'])*)'", value)
    if quoted:
        return quoted.group(1).replace("''", "'")
    if re.fullmatch(r"[-+]?\d+(?:\.\d+)?", value):
        return value
    if value.upper() in {"TRUE", "FALSE", "NULL"}:
        return value.upper()
    typed_literal = re.fullmatch(
        r"(?is)(?:DATE|TIME|TIMESTAMP(?:_(?:NTZ|LTZ|TZ))?)\s*'((?:''|[^'])*)'",
        value,
    )
    if typed_literal:
        return typed_literal.group(1).replace("''", "'")
    return _evaluate_snowflake_identifier_expression(value, variables)


def _infer_snowflake_variable_type(raw_expression: str, resolved_value: str | None) -> str:
    raw = raw_expression.strip()
    upper = raw.upper()
    if upper == "NULL":
        return "VARIANT"
    if upper in {"TRUE", "FALSE"}:
        return "BOOLEAN"
    if re.fullmatch(r"[-+]?\d+", raw):
        return "INT"
    if re.fullmatch(r"[-+]?\d+\.\d+", raw):
        return "DECIMAL"
    typed = re.match(r"(?is)^(DATE|TIME|TIMESTAMP(?:_(?:NTZ|LTZ|TZ))?)\s*'", raw)
    if typed:
        return typed.group(1).upper()
    candidate = str(resolved_value or "")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", candidate):
        return "DATE"
    return "VARCHAR"


def _variable_usage_roles(sql_without_set: str, name: str) -> tuple[list[str], int]:
    placeholder = re.compile(rf"\${re.escape(name)}\b", re.IGNORECASE)
    reference_count = len(placeholder.findall(sql_without_set))
    roles: set[str] = set()
    for identifier in _IDENTIFIER_CALL.finditer(sql_without_set):
        if placeholder.search(identifier.group(1)):
            roles.add("physical_identifier")
    for line in sql_without_set.splitlines():
        reference = placeholder.search(line)
        if not reference:
            continue
        upper = line.upper()
        if " WHERE " in f" {upper} " or upper.lstrip().startswith(("AND ", "OR ")):
            roles.add("filter")
        if " JOIN " in f" {upper} " or upper.lstrip().startswith("ON "):
            roles.add("relationship")
        select_index = upper.find("SELECT")
        from_index = upper.find("FROM")
        placeholder_in_projection = (
            select_index >= 0
            and reference.start() > select_index
            and (from_index < 0 or reference.start() < from_index)
        )
        if placeholder_in_projection or " AS " in upper[reference.start():]:
            roles.add("projection_or_transformation")
    if reference_count and not roles:
        roles.add("expression")
    if not reference_count:
        roles.add("declared_unused")
    return sorted(roles), reference_count


def _attach_variable_evidence(result: ParsedSqlDocument) -> None:
    """Connect SET declarations to deterministic graph value bindings."""
    graph = result.knowledge_graph
    nodes = graph.setdefault("nodes", [])
    edges = graph.setdefault("edges", [])
    value_nodes = {
        str((node.get("attributes") or {}).get("value") or "").upper(): str(node.get("id") or "")
        for node in nodes
        if isinstance(node, dict) and str(node.get("kind") or "") == "value_binding"
    }
    existing_ids = {str(node.get("id") or "") for node in nodes if isinstance(node, dict)}
    edge_ids = {str(edge.get("id") or "") for edge in edges if isinstance(edge, dict)}
    for binding in result.variable_bindings:
        node_id = f"sql_variable:{binding.name.upper()}"
        if node_id not in existing_ids:
            nodes.append(
                {
                    "id": node_id,
                    "kind": "project_value_candidate" if binding.project_value_candidate else "sql_variable",
                    "attributes": {
                        "name": binding.name,
                        "placeholder": f"${binding.name}",
                        "inferred_type": binding.inferred_type,
                        "usage_roles": binding.usage_roles,
                        "classification": binding.classification,
                        "approval_status": binding.approval_status,
                        "provenance": "deterministic_sql_set_assignment",
                    },
                }
            )
            existing_ids.add(node_id)
        value_node = value_nodes.get(f"${binding.name}".upper())
        if value_node:
            edge_id = _stable_node_id("edge", [node_id, "binds", value_node])
            if edge_id not in edge_ids:
                edges.append(
                    {
                        "id": edge_id,
                        "source": node_id,
                        "relation": "binds",
                        "target": value_node,
                        "attributes": {"requires_review": True},
                    }
                )
                edge_ids.add(edge_id)


def _normalize_snowflake_scripting(
    sql_text: str,
) -> tuple[str, list[str], dict[str, str], list[SqlVariableBinding]]:
    """Resolve static SET variables used by IDENTIFIER for structural parsing only."""
    variables: dict[str, str] = {}
    assignments: list[tuple[str, str, str | None]] = []
    for match in _SET_ASSIGNMENT.finditer(sql_text):
        name = match.group(1)
        raw_expression = match.group(2).strip()
        value = _evaluate_snowflake_variable_expression(raw_expression, variables)
        if value is not None:
            variables[name.upper()] = value
        assignments.append((name, raw_expression, value))

    sql_without_set = _SET_ASSIGNMENT.sub("", sql_text)
    variable_bindings: list[SqlVariableBinding] = []
    for name, raw_expression, value in assignments:
        usage_roles, reference_count = _variable_usage_roles(sql_without_set, name)
        identifier_only = bool(usage_roles) and set(usage_roles) <= {
            "physical_identifier",
            "declared_unused",
        }
        classification = (
            "environment_identifier"
            if identifier_only and "physical_identifier" in usage_roles
            else "declared_unused"
            if reference_count == 0
            else "mapping_value"
        )
        variable_bindings.append(
            SqlVariableBinding(
                name=name,
                raw_expression=raw_expression,
                resolved_value=value,
                inferred_type=_infer_snowflake_variable_type(raw_expression, value),
                usage_roles=usage_roles,
                reference_count=reference_count,
                classification=classification,
                project_value_candidate=(
                    value is not None and classification == "mapping_value"
                ),
            )
        )

    normalized = sql_text
    partially_resolved: set[str] = set()
    for _ in range(5):
        changed = False

        def replace_identifier(match: re.Match[str]) -> str:
            nonlocal changed
            value = _evaluate_snowflake_identifier_expression(match.group(1), variables)
            if value is None:
                # Deployment scripts often supply database/schema variables at
                # runtime while assigning the physical table name locally. The
                # table suffix is still enough for MappingSqlService to resolve
                # against the selected/known FQNs without guessing a schema.
                for part in reversed(_split_snowflake_concat(match.group(1))):
                    token = part.strip()
                    candidate = (
                        variables.get(token[1:].upper())
                        if token.startswith("$")
                        else None
                    )
                    if candidate and re.fullmatch(
                        r"[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)*",
                        candidate,
                    ):
                        partially_resolved.add(match.group(1).strip())
                        changed = True
                        return candidate
                return match.group(0)
            changed = True
            return value

        normalized = _IDENTIFIER_CALL.sub(replace_identifier, normalized)
        if not changed:
            break

    unresolved = sorted(
        {
            match.group(1).strip()
            for match in _IDENTIFIER_CALL.finditer(normalized)
            if "$" in match.group(1)
        }
    )
    warnings = []
    if partially_resolved:
        warnings.append(
            "Runtime database/schema variables were unavailable; table suffixes were resolved "
            "against the selected workspace: " + ", ".join(sorted(partially_resolved)[:8])
        )
    if unresolved:
        warnings.append(
            "Some dynamic IDENTIFIER expressions could not be resolved for visual synchronization: "
            + ", ".join(unresolved[:8])
        )
    return normalized, warnings, dict(sorted(variables.items())), variable_bindings


def _parse_with_sqlglot(sql_text: str) -> ParsedSqlDocument:
    """Full parse using sqlglot AST."""
    result = ParsedSqlDocument()

    try:
        statements = sqlglot.parse(
            sql_text,
            read="snowflake",
            error_level=sqlglot.ErrorLevel.IGNORE,
        )
    except Exception as exc:
        result.parse_warnings.append(f"sqlglot parse error: {exc}")
        return _parse_with_regex(sql_text)

    for stmt in statements:
        if stmt is None:
            continue
        if isinstance(stmt, exp.Use):
            # USE DATABASE/SCHEMA establishes parser context. It is not a data
            # source and must never become a selectable workspace table.
            continue

        cte_names = {
            str(cte.alias or "").upper()
            for cte in stmt.find_all(exp.CTE)
            if cte.alias
        }
        target_names: set[str] = set()
        target_expr = None
        if isinstance(stmt, (exp.Insert, exp.Update, exp.Delete, exp.Merge, exp.Create)):
            target_expr = stmt.this
        if target_expr is not None and not isinstance(target_expr, exp.Table):
            target_expr = target_expr.find(exp.Table)
        if isinstance(target_expr, exp.Table):
            target_name = _qualified_table_name(target_expr)
            if target_name:
                target_names.add(target_name.upper())
                if result.target_table is None:
                    result.target_table = target_name

        # Extract physical source tables, excluding write targets and CTE aliases.
        for table in stmt.find_all(exp.Table):
            table_name = _qualified_table_name(table)
            if (
                table_name
                and table_name.upper() not in target_names
                and table_name.upper() not in cte_names
                and table_name not in result.source_tables
            ):
                result.source_tables.append(table_name)

        # Keep all CTEs in lineage. Only transformation-bearing CTEs become
        # selectable derived-source candidates in the workspace projection.
        ctes = list(stmt.find_all(exp.CTE))
        for cte_index, cte in enumerate(ctes):
            cte_name = str(cte.alias or "")
            cte_tables: list[str] = []
            dependencies: list[str] = []
            for t in cte.find_all(exp.Table):
                name = _qualified_table_name(t)
                if name.upper() in cte_names:
                    dependencies.append(name)
                elif name.upper() not in target_names:
                    cte_tables.append(name)
            preceding_ctes = ctes[:cte_index + 1]
            cte_sql = "WITH " + ", ".join(
                _render_sql(item) for item in preceding_ctes
            )
            cte_sql += f" SELECT * FROM {cte_name}"
            cte_query = cte.this
            has_transform = any(
                True
                for node_type in (
                    exp.Join,
                    exp.Where,
                    exp.Qualify,
                    exp.Group,
                    exp.Order,
                    exp.Window,
                    exp.Case,
                )
                if next(cte_query.find_all(node_type), None) is not None
            )
            cte_select = cte_query.find(exp.Select)
            if cte_select:
                has_transform = has_transform or any(
                    not isinstance(item.this if isinstance(item, exp.Alias) else item, (exp.Column, exp.Star))
                    for item in cte_select.expressions
                )
            result.ctes.append(CTEDefinition(
                name=cte_name,
                purpose=f"CTE referencing {', '.join(cte_tables[:3])}",
                tables_referenced=list(dict.fromkeys(cte_tables)),
                sql_text=cte_sql,
                dependencies=list(dict.fromkeys(dependencies)),
                is_derived_source=has_transform,
            ))

        # Extract joins
        table_aliases: dict[str, str] = {}
        for table in stmt.find_all(exp.Table):
            qualified = _qualified_table_name(table)
            if not qualified:
                continue
            table_aliases[table.name.upper()] = qualified
            alias = str(table.alias or "").strip()
            if alias:
                table_aliases[alias.upper()] = qualified
        result.table_aliases.update(table_aliases)
        for join in stmt.find_all(exp.Join):
            join_type = "LEFT JOIN"
            if join.side:
                join_type = f"{join.side} JOIN"
            elif join.kind:
                join_type = f"{join.kind} JOIN"

            right_table = ""
            table_expr = join.find(exp.Table)
            if table_expr:
                right_table = _qualified_table_name(table_expr)

            condition = ""
            on_clause = join.args.get("on")
            if on_clause:
                condition = _render_sql(on_clause)

            keys = []
            referenced_tables: list[str] = []
            if on_clause:
                for col in on_clause.find_all(exp.Column):
                    keys.append(_render_sql(col))
                    qualifier = str(col.table or "").strip().upper()
                    resolved = table_aliases.get(qualifier)
                    if resolved and resolved not in referenced_tables:
                        referenced_tables.append(resolved)

            left_table = next(
                (
                    value
                    for value in referenced_tables
                    if value.upper() != right_table.upper()
                ),
                "",
            )

            result.join_patterns.append(JoinPattern(
                join_type=join_type,
                left_table=left_table,
                right_table=right_table,
                condition=condition[:200],
                keys=keys[:4],
            ))

        # The outer SELECT is the mapping projection. stmt.find(Select) returns
        # the first nested CTE SELECT and silently creates the wrong mappings.
        outer_selects = [
            candidate
            for candidate in stmt.find_all(exp.Select)
            if not _has_ancestor(candidate, exp.CTE)
        ]
        select = outer_selects[-1] if outer_selects else None
        if select:
            statement_mappings: list[ColumnMapping] = []
            for col_expr in select.expressions:
                mapping = _extract_column_mapping(col_expr)
                if mapping:
                    mapping.target_table = result.target_table
                    result.column_mappings.append(mapping)
                    statement_mappings.append(mapping)
            _enrich_lineage_v3(
                stmt=stmt,
                outer_select=select,
                mappings=statement_mappings,
                cte_definitions=result.ctes[-len(ctes):] if ctes else [],
                result=result,
            )

        # Extract CASE expressions as business rules
        for case_expr in stmt.find_all(exp.Case):
            sql_frag = _render_sql(case_expr)[:300]
            result.business_rules.append(BusinessRule(
                rule_type="case_expression",
                description=f"CASE expression with {len(list(case_expr.find_all(exp.If)))} conditions",
                sql_fragment=sql_frag,
            ))

        # Preserve query-shaping clauses across nested queries and CTEs.
        for where in stmt.find_all(exp.Where):
            result.business_rules.append(BusinessRule(
                rule_type="where_filter",
                description="WHERE clause filter",
                sql_fragment=_render_sql(where)[:1000],
            ))

        for qualify in stmt.find_all(exp.Qualify):
            result.business_rules.append(BusinessRule(
                rule_type="qualify_filter",
                description="QUALIFY deduplication/filter",
                sql_fragment=_render_sql(qualify)[:1000],
            ))

        for group in stmt.find_all(exp.Group):
            result.business_rules.append(BusinessRule(
                rule_type="grouping",
                description="GROUP BY clause",
                sql_fragment=_render_sql(group)[:1000],
            ))

        for order in stmt.find_all(exp.Order):
            result.business_rules.append(BusinessRule(
                rule_type="sorting",
                description="ORDER BY clause",
                sql_fragment=_render_sql(order)[:1000],
            ))

        # Extract window functions
        for window in stmt.find_all(exp.Window):
            result.business_rules.append(BusinessRule(
                rule_type="window_function",
                description=f"Window: {_render_sql(window.this)[:50]}",
                sql_fragment=_render_sql(window)[:300],
            ))

        # Detect transformations
        _detect_transformations(stmt, result)

    return result


def _render_sql(expression: Any) -> str:
    return expression.sql(
        dialect="snowflake",
        unsupported_level=sqlglot.ErrorLevel.IGNORE,
    )


def _qualified_table_name(table: Any) -> str:
    name = str(getattr(table, "name", "") or "")
    database = str(getattr(table, "db", "") or "")
    catalog = str(getattr(table, "catalog", "") or "")
    return ".".join(part for part in (catalog, database, name) if part)


def _has_ancestor(node: Any, ancestor_type: type[Any]) -> bool:
    parent = getattr(node, "parent", None)
    while parent is not None:
        if isinstance(parent, ancestor_type):
            return True
        parent = getattr(parent, "parent", None)
    return False


def _extract_column_mapping(col_expr) -> ColumnMapping | None:
    """Extract a column mapping from a SELECT expression."""
    try:
        if isinstance(col_expr, exp.Star):
            return None
        alias = str(getattr(col_expr, "alias", "") or "") or None
        inner = col_expr.this if isinstance(col_expr, exp.Alias) else col_expr
        if isinstance(inner, exp.Star):
            return None

        columns = list(inner.find_all(exp.Column))
        if isinstance(inner, exp.Column) and not columns:
            columns = [inner]
        rendered = _render_sql(inner)
        source_columns = list(dict.fromkeys(_render_sql(column) for column in columns))

        if not columns:
            return ColumnMapping(
                source_table=None,
                source_column="",
                target_alias=alias,
                transformation=None,
                source_columns=[],
                mapping_mode="constant",
                constant_value=rendered,
            )

        first = columns[0]
        direct = isinstance(inner, exp.Column)
        return ColumnMapping(
            source_table=str(first.table or "") or None,
            source_column=first.name,
            target_alias=alias or first.name,
            transformation=None if direct else rendered,
            source_columns=source_columns,
            mapping_mode="source",
        )
    except Exception:
        return None


def _stable_node_id(kind: str, value: Any) -> str:
    raw = json.dumps(
        value, sort_keys=True, separators=(",", ":"), default=str
    ).encode("utf-8")
    return f"{kind}:{hashlib.sha256(raw).hexdigest()[:24]}"


def _nearest_select(node: Any) -> Any | None:
    parent = getattr(node, "parent", None)
    while parent is not None:
        if isinstance(parent, exp.Select):
            return parent
        parent = getattr(parent, "parent", None)
    return None


def _scope_relations(select: Any) -> tuple[dict[str, str], list[str]]:
    aliases: dict[str, str] = {}
    ordered: list[str] = []
    for table in select.find_all(exp.Table):
        if _nearest_select(table) is not select:
            continue
        relation = _qualified_table_name(table)
        if not relation:
            continue
        ordered.append(relation)
        aliases[table.name.upper()] = relation
        alias = str(table.alias or "").strip()
        if alias:
            aliases[alias.upper()] = relation
    return aliases, list(dict.fromkeys(ordered))


def _grain_evidence(select: Any) -> list[str]:
    evidence: list[str] = []
    if bool(select.args.get("distinct")):
        evidence.append("DISTINCT changes or constrains output grain")
    if next(select.find_all(exp.Group), None) is not None:
        evidence.append("GROUP BY defines an aggregated output grain")
    if next(select.find_all(exp.AggFunc), None) is not None:
        evidence.append("Aggregate functions may change output grain")
    if next(select.find_all(exp.Qualify), None) is not None:
        evidence.append("QUALIFY filters windowed rows")
    if next(select.find_all(exp.Window), None) is not None:
        evidence.append("Window functions partition or rank rows")
    return evidence


def _derived_candidate_reasons(select: Any) -> list[str]:
    reasons: list[str] = []
    aliases, relations = _scope_relations(select)
    del aliases
    if len(relations) > 1 or next(select.find_all(exp.Join), None) is not None:
        reasons.append("combines multiple relations")
    if next(select.find_all(exp.Group), None) is not None or next(
        select.find_all(exp.AggFunc), None
    ) is not None:
        reasons.append("changes grain through aggregation")
    if next(select.find_all(exp.Qualify), None) is not None or next(
        select.find_all(exp.Window), None
    ) is not None:
        reasons.append("implements deduplication or windowed row selection")
    if bool(select.args.get("distinct")):
        reasons.append("enforces distinct output rows")
    if next(select.find_all(exp.Where), None) is not None:
        reasons.append("encodes correctness-critical reusable filtering")
    complex_outputs = sum(
        not isinstance(
            item.this if isinstance(item, exp.Alias) else item,
            (exp.Column, exp.Star),
        )
        for item in select.expressions
    )
    if complex_outputs >= 2:
        reasons.append("contains multiple reusable output transformations")
    return reasons


def _projection_outputs(select: Any) -> list[dict[str, Any]]:
    aliases, relations = _scope_relations(select)
    outputs: list[dict[str, Any]] = []
    for index, expression in enumerate(select.expressions):
        inner = expression.this if isinstance(expression, exp.Alias) else expression
        output_name = str(getattr(expression, "alias", "") or "")
        if not output_name and isinstance(inner, exp.Column):
            output_name = str(inner.name or "")
        if isinstance(inner, exp.Star):
            outputs.append(
                {
                    "name": "*",
                    "expression": "*",
                    "source_references": [],
                    "unresolved_references": ["wildcard:*"],
                    "ordinal": index,
                }
            )
            continue
        references: list[dict[str, str]] = []
        unresolved: list[str] = []
        for column in inner.find_all(exp.Column):
            qualifier = str(column.table or "").strip().upper()
            relation = aliases.get(qualifier) if qualifier else None
            if not relation and not qualifier and len(relations) == 1:
                relation = relations[0]
            if not relation:
                unresolved.append(_render_sql(column))
            references.append(
                {
                    "relation": relation or qualifier,
                    "column": str(column.name or ""),
                    "reference": _render_sql(column),
                }
            )
        outputs.append(
            {
                "name": output_name or f"_EXPR_{index + 1}",
                "expression": _render_sql(inner),
                "source_references": references,
                "unresolved_references": unresolved,
                "ordinal": index,
            }
        )
    return outputs


def _enrich_lineage_v3(
    *,
    stmt: Any,
    outer_select: Any,
    mappings: list[ColumnMapping],
    cte_definitions: list[CTEDefinition],
    result: ParsedSqlDocument,
) -> None:
    cte_nodes = list(stmt.find_all(exp.CTE))
    cte_by_name = {
        str(cte.alias or "").strip().upper(): cte for cte in cte_nodes if cte.alias
    }
    definitions_by_name = {
        definition.name.upper(): definition for definition in cte_definitions
    }
    outputs_by_cte: dict[str, dict[str, dict[str, Any]]] = {}

    for name, cte in cte_by_name.items():
        cte_select = cte.this.find(exp.Select)
        if cte_select is None:
            continue
        outputs = _projection_outputs(cte_select)
        outputs_by_cte[name] = {
            str(item.get("name") or "").upper(): item for item in outputs
        }
        definition = definitions_by_name.get(name)
        if definition is not None:
            definition.output_columns = outputs
            definition.grain_evidence = _grain_evidence(cte_select)
            definition.derived_source_reasons = _derived_candidate_reasons(
                cte_select
            )
            definition.derived_source_candidate = bool(
                definition.derived_source_reasons
            )

    for consumer_name, definition in definitions_by_name.items():
        for dependency in definition.dependencies:
            dependency_definition = definitions_by_name.get(dependency.upper())
            if (
                dependency_definition is not None
                and consumer_name not in dependency_definition.downstream_consumers
            ):
                dependency_definition.downstream_consumers.append(consumer_name)
    outer_aliases, _ = _scope_relations(outer_select)
    for relation in set(outer_aliases.values()):
        dependency_definition = definitions_by_name.get(relation.upper())
        if (
            dependency_definition is not None
            and "FINAL_PROJECTION" not in dependency_definition.downstream_consumers
        ):
            dependency_definition.downstream_consumers.append("FINAL_PROJECTION")

    def resolve_reference(
        relation: str,
        column: str,
        *,
        stack: tuple[str, ...] = (),
    ) -> tuple[list[str], list[dict[str, Any]], list[str]]:
        relation_key = str(relation or "").upper()
        column_key = str(column or "").upper()
        identity = f"{relation_key}.{column_key}"
        if relation_key in outputs_by_cte:
            if identity in stack:
                return [], [], [f"cyclic_lineage:{identity}"]
            output = outputs_by_cte[relation_key].get(column_key)
            if output is None:
                return [], [], [f"unresolved_cte_output:{identity}"]
            leaves: list[str] = []
            path = [
                {
                    "kind": "cte_output",
                    "relation": relation,
                    "column": column,
                    "expression": output.get("expression"),
                }
            ]
            unresolved = list(output.get("unresolved_references") or [])
            for source in output.get("source_references") or []:
                child_leaves, child_path, child_unresolved = resolve_reference(
                    str(source.get("relation") or ""),
                    str(source.get("column") or ""),
                    stack=(*stack, identity),
                )
                leaves.extend(child_leaves)
                path.extend(child_path)
                unresolved.extend(child_unresolved)
            return (
                list(dict.fromkeys(leaves)),
                path,
                list(dict.fromkeys(unresolved)),
            )
        if relation_key:
            leaf = f"{relation}.{column}"
            return (
                [leaf],
                [{"kind": "physical_column", "column": leaf}],
                [],
            )
        return [], [], [f"unresolved_column:{column}"]

    outer_outputs = _projection_outputs(outer_select)
    for mapping, output in zip(mappings, outer_outputs):
        leaves: list[str] = []
        lineage_path: list[dict[str, Any]] = [
            {
                "kind": "target_expression",
                "target_column": mapping.target_alias,
                "expression": output.get("expression"),
            }
        ]
        unresolved = list(output.get("unresolved_references") or [])
        for source in output.get("source_references") or []:
            child_leaves, child_path, child_unresolved = resolve_reference(
                str(source.get("relation") or ""),
                str(source.get("column") or ""),
            )
            leaves.extend(child_leaves)
            lineage_path.extend(child_path)
            unresolved.extend(child_unresolved)
        mapping.physical_source_columns = list(dict.fromkeys(leaves))
        mapping.lineage_path = lineage_path
        mapping.unresolved_references = list(dict.fromkeys(unresolved))
        if mapping.unresolved_references:
            result.lineage_diagnostics.append(
                {
                    "target_column": mapping.target_alias,
                    "status": "partial",
                    "unresolved_references": mapping.unresolved_references,
                }
            )

    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[str, dict[str, Any]] = {}

    def node(kind: str, key: str, attributes: dict[str, Any]) -> str:
        node_id = f"{kind}:{key}"
        nodes.setdefault(
            node_id,
            {"id": node_id, "kind": kind, "attributes": attributes},
        )
        return node_id

    def edge(source: str, relation: str, target: str, attributes=None) -> None:
        edge_id = _stable_node_id(
            "edge", [source, relation, target, attributes or {}]
        )
        edges.setdefault(
            edge_id,
            {
                "id": edge_id,
                "source": source,
                "relation": relation,
                "target": target,
                "attributes": attributes or {},
            },
        )

    target_table = result.target_table or "UNRESOLVED_TARGET"
    target_table_node = node(
        "target_table", target_table.upper(), {"fqn": result.target_table}
    )
    for mapping in mappings:
        target_column = str(mapping.target_alias or "")
        target_node = node(
            "target_column",
            f"{target_table}.{target_column}".upper(),
            {"table": result.target_table, "column": target_column},
        )
        edge(target_table_node, "contains", target_node)
        mapping_node = node(
            "mapping",
            _stable_node_id(
                "mapping",
                [target_table, target_column, mapping.transformation, mapping.constant_value],
            ),
            {
                "target_column": target_column,
                "expression": mapping.transformation,
                "constant_value": mapping.constant_value,
            },
        )
        edge(mapping_node, "maps_to", target_node)
        if mapping.transformation:
            transformation_node = node(
                "transformation",
                _stable_node_id(
                    "transformation",
                    [target_table, target_column, mapping.transformation],
                ),
                {
                    "expression": mapping.transformation,
                    "provenance": "deterministic_sql_ast",
                },
            )
            edge(transformation_node, "implements", mapping_node)
        for path_item in mapping.lineage_path:
            if path_item.get("kind") != "cte_output":
                continue
            cte_output_node = node(
                "cte_output",
                (
                    f"{path_item.get('relation')}.{path_item.get('column')}"
                ).upper(),
                {
                    "cte": path_item.get("relation"),
                    "column": path_item.get("column"),
                    "expression": path_item.get("expression"),
                },
            )
            edge(cte_output_node, "feeds", mapping_node)
        for leaf in mapping.physical_source_columns:
            table_name, _, column_name = leaf.rpartition(".")
            table_node = node("physical_table", table_name.upper(), {"fqn": table_name})
            column_node = node(
                "physical_column", leaf.upper(), {"fqn": leaf}
            )
            edge(table_node, "contains", column_node)
            edge(column_node, "feeds", mapping_node)
        if mapping.constant_value is not None:
            binding_node = node(
                "value_binding",
                _stable_node_id("binding", mapping.constant_value),
                {"value": mapping.constant_value, "is_placeholder": str(mapping.constant_value).startswith("$")},
            )
            edge(binding_node, "feeds", mapping_node)

    for definition in cte_definitions:
        cte_node = node(
            "cte",
            definition.name.upper(),
            {
                "name": definition.name,
                "purpose": definition.purpose,
                "grain_evidence": definition.grain_evidence,
                "derived_source_candidate": definition.derived_source_candidate,
                "derived_source_reasons": definition.derived_source_reasons,
            },
        )
        for table_name in definition.tables_referenced:
            table_node = node(
                "physical_table", table_name.upper(), {"fqn": table_name}
            )
            edge(table_node, "feeds", cte_node)
        for dependency in definition.dependencies:
            dependency_node = node(
                "cte", dependency.upper(), {"name": dependency}
            )
            edge(dependency_node, "feeds", cte_node)
        for output in definition.output_columns:
            output_name = str(output.get("name") or "")
            output_node = node(
                "cte_output",
                f"{definition.name}.{output_name}".upper(),
                {
                    "cte": definition.name,
                    "column": output_name,
                    "expression": output.get("expression"),
                },
            )
            edge(cte_node, "produces", output_node)

    for join in result.join_patterns:
        join_node = node(
            "relationship",
            _stable_node_id("relationship", join.to_dict()),
            join.to_dict(),
        )
        for table_name in (join.left_table, join.right_table):
            if table_name:
                table_node = node(
                    "relation", table_name.upper(), {"name": table_name}
                )
                edge(table_node, "participates_in", join_node)

    for rule in result.business_rules:
        rule_node = node(
            "query_shaping_rule",
            _stable_node_id("rule", rule.to_dict()),
            {
                **rule.to_dict(),
                "provenance": "deterministic_sql_ast",
            },
        )
        edge(rule_node, "shapes", target_table_node)

    result.knowledge_graph = {
        "nodes": list(nodes.values()),
        "edges": list(edges.values()),
    }


def _detect_transformations(stmt, result: ParsedSqlDocument) -> None:
    """Detect common transformation patterns."""
    sql_str = _render_sql(stmt).upper()
    patterns = [
        ("CAST", "Type casting"),
        ("COALESCE", "Null handling"),
        ("TRIM", "Whitespace trimming"),
        ("UPPER", "Uppercase normalization"),
        ("LOWER", "Lowercase normalization"),
        ("CONCAT", "String concatenation"),
        ("LPAD", "Left padding"),
        ("RPAD", "Right padding"),
        ("DATEADD", "Date arithmetic"),
        ("DATEDIFF", "Date difference"),
        ("SPLIT_PART", "String splitting"),
        ("ROW_NUMBER", "Row numbering"),
        ("LAG", "Previous row access"),
        ("LEAD", "Next row access"),
        ("NVL", "Null value replacement"),
    ]
    for pattern, desc in patterns:
        if pattern in sql_str:
            result.transformations.append(f"{pattern}: {desc}")


def _parse_with_regex(sql_text: str) -> ParsedSqlDocument:
    """Fallback regex-based parser when sqlglot is unavailable."""
    result = ParsedSqlDocument()
    result.parse_warnings.append("Parsed with regex fallback (sqlglot unavailable)")

    upper = sql_text.upper()

    # Extract tables from FROM/JOIN clauses
    table_pattern = re.compile(
        r'\b(?:FROM|JOIN)\s+(\w+(?:\.\w+)*)\s*', re.IGNORECASE
    )
    for match in table_pattern.finditer(sql_text):
        table = match.group(1)
        if table.upper() not in ("SELECT", "WHERE", "ON", "AND", "OR"):
            if table not in result.source_tables:
                result.source_tables.append(table)

    # Extract aliases from SELECT
    alias_pattern = re.compile(
        r'\bas\s+(\w+)', re.IGNORECASE
    )
    for match in alias_pattern.finditer(sql_text):
        alias = match.group(1)
        if alias.upper() not in ("VARCHAR", "INTEGER", "DATE", "TIMESTAMP"):
            result.column_mappings.append(ColumnMapping(
                source_table=None,
                source_column="(regex match)",
                target_alias=alias,
            ))

    # Detect joins
    join_pattern = re.compile(
        r'(LEFT|RIGHT|INNER|FULL|CROSS)?\s*JOIN\s+(\w+)', re.IGNORECASE
    )
    for match in join_pattern.finditer(sql_text):
        result.join_patterns.append(JoinPattern(
            join_type=f"{match.group(1) or 'INNER'} JOIN",
            left_table="",
            right_table=match.group(2),
            condition="(regex parse)",
        ))

    _detect_transformations_regex(upper, result)
    return result


def _detect_transformations_regex(upper_sql: str, result: ParsedSqlDocument) -> None:
    patterns = [
        ("CAST(", "Type casting"),
        ("COALESCE(", "Null handling"),
        ("CASE WHEN", "Conditional logic"),
        ("TRIM(", "Whitespace trimming"),
        ("OVER(", "Window function"),
    ]
    for pattern, desc in patterns:
        if pattern in upper_sql:
            result.transformations.append(f"{pattern.rstrip('(')}: {desc}")
