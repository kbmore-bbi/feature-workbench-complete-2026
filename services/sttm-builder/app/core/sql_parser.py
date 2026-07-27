"""Server-side SQL parser using sqlglot.

Handles full DDL/DML/CTEs — not just SELECT like the client-side parser.
Extracts tables, column mappings, joins, transformations, and business rules.
"""
from __future__ import annotations

import logging
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

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_table": self.source_table,
            "source_column": self.source_column,
            "target_alias": self.target_alias,
            "transformation": self.transformation,
            "source_columns": self.source_columns,
            "mapping_mode": self.mapping_mode,
            "constant_value": self.constant_value,
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

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "purpose": self.purpose,
            "tables_referenced": self.tables_referenced,
            "sql_text": self.sql_text,
            "dependencies": self.dependencies,
            "is_derived_source": self.is_derived_source,
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
class ParsedSqlDocument:
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

    def to_dict(self) -> dict[str, Any]:
        return {
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
            "stats": {
                "tables": len(self.source_tables),
                "columns": len(self.column_mappings),
                "joins": len(self.join_patterns),
                "ctes": len(self.ctes),
                "rules": len(self.business_rules),
            },
        }


def parse_sql_document(sql_text: str) -> ParsedSqlDocument:
    """Parse a SQL document and extract all structural information."""
    normalized_sql, scripting_warnings = _normalize_snowflake_scripting(sql_text)
    if HAS_SQLGLOT:
        result = _parse_with_sqlglot(normalized_sql)
    else:
        result = _parse_with_regex(normalized_sql)
    result.parse_warnings.extend(scripting_warnings)
    return result


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


def _normalize_snowflake_scripting(sql_text: str) -> tuple[str, list[str]]:
    """Resolve static SET variables used by IDENTIFIER for structural parsing only."""
    variables: dict[str, str] = {}
    for match in _SET_ASSIGNMENT.finditer(sql_text):
        value = _evaluate_snowflake_identifier_expression(match.group(2), variables)
        if value is not None:
            variables[match.group(1).upper()] = value

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
    return normalized, warnings


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
            for col_expr in select.expressions:
                mapping = _extract_column_mapping(col_expr)
                if mapping:
                    result.column_mappings.append(mapping)

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
