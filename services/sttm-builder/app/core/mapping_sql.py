from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from snowflake.snowpark import Session

from app.core.exceptions import SnowflakeAgentError
from app.core.snowflake_analyst import SnowflakeAnalystClient
from app.schema.mapping_sql import (
    MappingSqlMappingItem,
    MappingSqlPreviewColumn,
    MappingSqlPreviewRequest,
    MappingSqlPreviewResponse,
    MappingSqlPreviewRow,
    MappingSqlReviewRequest,
    MappingSqlReviewResponse,
)

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
    ) -> None:
        self._session = session
        self._analyst = analyst_client

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

        if body.semantic_view_name:
            try:
                analyst_response = self._analyst.ask(
                    question=self._build_review_prompt(body, preview_sql, validation_error=validation_error),
                    semantic_view=body.semantic_view_name,
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
                syntax_valid = True
                execution_ready = True
                review_agent = "SNOWFLAKE_EXECUTOR"
                review_summary = repair_summary
                warnings.append(
                    "Cortex Analyst could not complete the SQL review request, so Snowflake validation generated a suggested repair for your approval."
                )

        if validation_error and not optimized_preview_sql:
            warnings.append(
                "Snowflake validation could not prepare a safe repaired SQL automatically. Review the validation issue and adjust the mapping SQL before running preview."
            )
            review_summary = f"Snowflake validation found an issue that still needs attention: {validation_error}"
            syntax_valid = False
            execution_ready = False

        return MappingSqlReviewResponse(
            valid=syntax_valid,
            review_agent=review_agent,
            syntax_valid=syntax_valid,
            execution_ready=execution_ready,
            review_summary=review_summary,
            optimized=optimized,
            requires_approval=optimized and optimized_preview_sql is not None,
            original_preview_sql=preview_sql,
            original_generated_sql=generated_sql,
            optimized_preview_sql=optimized_preview_sql,
            optimized_generated_sql=optimized_generated_sql,
            semantic_view_name=body.semantic_view_name,
            warnings=warnings,
        )

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
        else:
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
        mapping_lines = []
        for mapping in body.mappings:
            if (mapping.status or "").upper() != "MAPPED":
                continue
            source_columns = mapping.source_columns or []
            if not source_columns and mapping.source_column:
                source_columns = [part.strip() for part in mapping.source_column.split(",") if part.strip()]
            mapping_lines.append(
                f"- {mapping.target_column}: sources={source_columns or ['<none>']}, "
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
            "6. Do not return INSERT statements, explanations inside the SQL, markdown fences, or DDL.",
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
