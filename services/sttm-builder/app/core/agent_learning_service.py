"""Agent-specific learning retrieval service.

This service provides per-agent learning storage and retrieval using Cortex Search
for semantically relevant learnings.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import uuid4

from snowflake.snowpark import Session

from app.core.config import Settings

logger = logging.getLogger(__name__)


@dataclass
class AgentLearning:
    """A learning record for a specific agent."""

    learning_id: str
    agent_type: str
    learning_type: str
    summary: str
    confidence: float
    attributes: dict[str, Any]
    entity_type: str | None = None
    entity_ids: dict[str, Any] | None = None
    tags: list[str] | None = None
    usage_count: int = 0
    success_count: int = 0
    relevance_score: float = 0.0
    created_at: datetime | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "learning_id": self.learning_id,
            "agent_type": self.agent_type,
            "learning_type": self.learning_type,
            "summary": self.summary,
            "confidence": self.confidence,
            "attributes": self.attributes,
            "entity_type": self.entity_type,
            "entity_ids": self.entity_ids,
            "tags": self.tags,
            "usage_count": self.usage_count,
            "success_count": self.success_count,
            "relevance_score": self.relevance_score,
        }


class AgentLearningService:
    """Service for per-agent learning storage and retrieval."""

    AGENT_TYPES = {
        "SOURCE_MAPPING": "CSS_SOURCE_MAPPING_LEARNINGS",
        "TRANSFORMATION_RULE": "CSS_TRANSFORMATION_LEARNINGS",
        "STTM_BUILDER": "CSS_STTM_BUILDER_LEARNINGS",
    }

    def __init__(self, session: Session, settings: Settings):
        self._session = session
        self._settings = settings
        self._schema = f"{settings.snowflake_database}.{settings.snowflake_schema}"
        self._record_procedure_available: bool | None = None
        self._usage_procedure_available: bool | None = None

    def get_agent_learnings(
        self,
        agent_type: str,
        query_context: dict[str, Any],
        max_results: int = 10,
    ) -> list[AgentLearning]:
        """Retrieve relevant learnings for a specific agent using Cortex Search.

        Args:
            agent_type: The agent type (SOURCE_MAPPING, TRANSFORMATION_RULE, etc.)
            query_context: Context to search against (target columns, source tables, etc.)
            max_results: Maximum number of learnings to return

        Returns:
            List of relevant AgentLearning objects sorted by relevance
        """
        search_service = self.AGENT_TYPES.get(agent_type)
        if not search_service:
            logger.warning("Unknown agent type: %s, falling back to SQL query", agent_type)
            return self._get_learnings_sql(agent_type, query_context, max_results)

        search_query = self._build_search_query(query_context)
        if not search_query:
            logger.debug("Empty search query for agent %s", agent_type)
            return []

        try:
            full_service_name = f"{self._schema}.{search_service}"
            results = self._session.sql(f"""
                SELECT *
                FROM TABLE(
                    {full_service_name}!SEARCH(
                        query => '{self._escape_sql(search_query)}',
                        columns => ['SEARCH_TEXT'],
                        limit => {max_results}
                    )
                )
                ORDER BY RELEVANCE_SCORE DESC
            """).collect()

            return [self._parse_learning(row.as_dict()) for row in results]
        except Exception as exc:
            logger.warning(
                "Cortex Search failed for agent %s, falling back to SQL: %s",
                agent_type,
                exc,
            )
            return self._get_learnings_sql(agent_type, query_context, max_results)

    def get_correction_history(
        self,
        agent_type: str,
        target_columns: list[str],
        max_results: int = 10,
    ) -> list[AgentLearning]:
        """Get correction history for specific target columns.

        This is critical for avoiding repeated mistakes.
        """
        if not target_columns:
            return []

        target_cols_sql = ", ".join(f"'{self._escape_sql(c)}'" for c in target_columns)

        try:
            rows = self._session.sql(f"""
                SELECT *
                FROM {self._schema}.TBL_AGENT_LEARNINGS
                WHERE AGENT_TYPE = '{agent_type}'
                  AND LEARNING_TYPE IN ('mapping_correction', 'mapping_edit')
                  AND STATUS = 'active'
                  AND (
                      ATTRIBUTES:target_column::STRING IN ({target_cols_sql})
                      OR ARRAY_CONTAINS(ATTRIBUTES:target_columns::ARRAY, '{target_columns[0]}'::VARIANT)
                  )
                ORDER BY CONFIDENCE DESC, CREATED_AT DESC
                LIMIT {max_results}
            """).collect()

            return [self._parse_learning(row.as_dict()) for row in rows]
        except Exception as exc:
            logger.warning("Failed to get correction history: %s", exc)
            return []

    def get_similar_mappings(
        self,
        target_column: str,
        source_tables: list[str],
        project_id: str | None = None,
        max_results: int = 5,
    ) -> list[AgentLearning]:
        """Get similar accepted mappings for a target column."""
        search_terms = [target_column] + source_tables[:3]
        search_query = " ".join(search_terms)

        try:
            full_service_name = f"{self._schema}.CSS_SOURCE_MAPPING_LEARNINGS"
            rows = self._session.sql(f"""
                SELECT *
                FROM TABLE(
                    {full_service_name}!SEARCH(
                        query => '{self._escape_sql(search_query)}',
                        columns => ['SEARCH_TEXT'],
                        filter => {{'LEARNING_TYPE': 'mapping_acceptance'}},
                        limit => {max_results}
                    )
                )
                ORDER BY RELEVANCE_SCORE DESC
            """).collect()

            return [self._parse_learning(row.as_dict()) for row in rows]
        except Exception as exc:
            logger.warning("Failed to get similar mappings via Cortex Search: %s", exc)
            return self._get_similar_mappings_sql(target_column, source_tables, project_id, max_results)

    def record_learning(
        self,
        agent_type: str,
        learning_type: str,
        summary: str,
        attributes: dict[str, Any],
        entity_type: str | None = None,
        entity_ids: dict[str, Any] | None = None,
        tags: list[str] | None = None,
        confidence: float = 0.7,
        user_id: str | None = None,
    ) -> str:
        """Record a new learning for an agent.

        Returns:
            The learning_id of the created or updated learning
        """
        learning_id = f"lrn_{uuid4().hex[:16]}"
        learning_key = self._generate_learning_key(agent_type, learning_type, attributes)

        if self._record_procedure_available is not False:
            try:
                result = self._session.sql(f"""
                    CALL {self._schema}.SP_RECORD_AGENT_LEARNING(
                        '{agent_type}',
                        '{learning_type}',
                        '{self._escape_sql(summary)}',
                        PARSE_JSON('{self._escape_sql(json.dumps(attributes))}'),
                        {self._quote_or_null(entity_type)},
                        {self._json_or_null(entity_ids)},
                        {self._array_or_null(tags)},
                        {confidence},
                        {self._quote_or_null(user_id)}
                    )
                """).collect()
                self._record_procedure_available = True
                if result:
                    resolved_id = str(result[0][0])
                else:
                    resolved_id = learning_id
                self._invalidate_prepared_learning_contexts()
                return resolved_id
            except Exception as exc:
                if self._is_missing_procedure(exc, "SP_RECORD_AGENT_LEARNING"):
                    if self._record_procedure_available is not False:
                        logger.warning(
                            "SP_RECORD_AGENT_LEARNING is unavailable; using direct "
                            "TBL_AGENT_LEARNINGS MERGE for this process."
                        )
                    self._record_procedure_available = False
                else:
                    logger.warning(
                        "SP_RECORD_AGENT_LEARNING failed; using direct MERGE: %s",
                        exc,
                    )

        resolved_id = self._record_learning_direct(
            learning_id,
            agent_type,
            learning_type,
            learning_key,
            summary,
            attributes,
            entity_type,
            entity_ids,
            tags,
            confidence,
            user_id,
        )
        self._invalidate_prepared_learning_contexts()
        return resolved_id

    def _invalidate_prepared_learning_contexts(self) -> None:
        from app.core.learning_retrieval import invalidate_learning_context_cache

        invalidate_learning_context_cache()
        try:
            table_name = self._settings.qualify_metadata_object_name(
                "TBL_PREPARED_LEARNING_CONTEXTS"
            )
            self._session.sql(f"DELETE FROM {table_name}").collect()
        except Exception as exc:
            logger.debug("Durable prepared FIR context invalidation unavailable: %s", exc)

    def track_learning_usage(
        self,
        learning_id: str,
        was_successful: bool = True,
    ) -> None:
        """Track that a learning was used and whether it was successful."""
        if self._usage_procedure_available is not False:
            try:
                self._session.sql(f"""
                    CALL {self._schema}.SP_TRACK_LEARNING_USAGE(
                        '{learning_id}',
                        {str(bool(was_successful)).upper()}
                    )
                """).collect()
                self._usage_procedure_available = True
                return
            except Exception as exc:
                if self._is_missing_procedure(exc, "SP_TRACK_LEARNING_USAGE"):
                    self._usage_procedure_available = False
                else:
                    logger.warning(
                        "SP_TRACK_LEARNING_USAGE failed; using direct UPDATE: %s",
                        exc,
                    )
        try:
            self._session.sql(f"""
                UPDATE {self._schema}.TBL_AGENT_LEARNINGS
                SET USAGE_COUNT = COALESCE(USAGE_COUNT, 0) + 1,
                    SUCCESS_COUNT = COALESCE(SUCCESS_COUNT, 0)
                        + {1 if was_successful else 0},
                    LAST_USED_AT = CURRENT_TIMESTAMP()
                WHERE LEARNING_ID = '{self._escape_sql(learning_id)}'
            """).collect()
        except Exception as exc:
            logger.warning("Failed to track learning usage directly: %s", exc)

    def record_mapping_acceptance(
        self,
        target_column: str,
        source_columns: list[str],
        preprocessing_rule: str,
        preprocessing_rule_type: str,
        confidence_score: float,
        project_id: str,
        sttm_id: str,
        user_id: str | None = None,
        target_table: str | None = None,
        source_tables: list[str] | None = None,
        provenance: str | None = None,
    ) -> str:
        """Record a mapping acceptance as a SOURCE_MAPPING learning."""
        target_label = (
            f"{target_table}.{target_column}"
            if target_table
            else target_column
        )
        summary = (
            f"Accepted mapping: {', '.join(source_columns)} -> {target_label} "
            f"using {preprocessing_rule_type}"
        )

        attributes = {
            "target_column": target_column,
            "target_table": target_table,
            "source_columns": source_columns,
            "source_tables": source_tables or [],
            "preprocessing_rule": preprocessing_rule,
            "preprocessing_rule_type": preprocessing_rule_type,
            "confidence_score": confidence_score,
            "provenance": provenance,
        }

        tags = [f"rule:{preprocessing_rule_type}", f"target:{target_column}"]
        if target_table:
            tags.append(f"target_table:{target_table}")
        tags.extend(f"source_table:{table}" for table in (source_tables or []))
        return self.record_learning(
            agent_type="SOURCE_MAPPING",
            learning_type="mapping_acceptance",
            summary=summary,
            attributes=attributes,
            entity_type="mapping_row",
            entity_ids={"project_id": project_id, "sttm_id": sttm_id},
            tags=tags,
            confidence=min(1.0, confidence_score + 0.1),
            user_id=user_id,
        )

    def record_mapping_correction(
        self,
        target_column: str,
        incorrect_source: list[str],
        correct_source: list[str],
        error_category: str,
        prevention_hint: str,
        project_id: str,
        sttm_id: str,
        user_id: str | None = None,
    ) -> str:
        """Record a mapping correction to avoid repeating mistakes."""
        summary = f"Correction for {target_column}: avoid {incorrect_source}, use {correct_source}. {prevention_hint}"

        attributes = {
            "target_column": target_column,
            "incorrect_source": incorrect_source,
            "correct_source": correct_source,
            "error_category": error_category,
            "prevention_hint": prevention_hint,
        }

        return self.record_learning(
            agent_type="SOURCE_MAPPING",
            learning_type="mapping_correction",
            summary=summary,
            attributes=attributes,
            entity_type="mapping_row",
            entity_ids={"project_id": project_id, "sttm_id": sttm_id},
            tags=[f"error:{error_category}", f"target:{target_column}"],
            confidence=0.9,
            user_id=user_id,
        )

    def record_transformation_pattern(
        self,
        rule_type: str,
        rule_expression: str,
        description: str,
        source_columns: list[str],
        target_column: str,
        project_id: str,
        sttm_id: str,
        user_id: str | None = None,
    ) -> str:
        """Record a transformation rule pattern."""
        summary = f"Transformation pattern: {rule_type} for {target_column}. {description}"

        attributes = {
            "rule_type": rule_type,
            "rule_expression": rule_expression,
            "description": description,
            "source_columns": source_columns,
            "target_column": target_column,
        }

        return self.record_learning(
            agent_type="TRANSFORMATION_RULE",
            learning_type="transformation_pattern",
            summary=summary,
            attributes=attributes,
            entity_type="transformation",
            entity_ids={"project_id": project_id, "sttm_id": sttm_id},
            tags=[f"rule_type:{rule_type}", f"target:{target_column}"],
            confidence=0.8,
            user_id=user_id,
        )

    # ─── Private helpers ───────────────────────────────────────────────

    def _build_search_query(self, query_context: dict[str, Any]) -> str:
        """Build a search query from the context."""
        parts = []

        if "target_columns" in query_context:
            parts.extend(query_context["target_columns"][:5])

        if "source_tables" in query_context:
            for table in query_context["source_tables"][:3]:
                if isinstance(table, dict):
                    parts.append(table.get("table", ""))
                else:
                    parts.append(str(table).split(".")[-1])

        if "target_table" in query_context:
            target = query_context["target_table"]
            if isinstance(target, dict):
                parts.append(target.get("table", ""))
            else:
                parts.append(str(target).split(".")[-1])

        if "intent" in query_context:
            parts.append(str(query_context["intent"]))

        return " ".join(filter(None, parts))

    def _get_learnings_sql(
        self,
        agent_type: str,
        query_context: dict[str, Any],
        max_results: int,
    ) -> list[AgentLearning]:
        """Fallback SQL-based learning retrieval."""
        try:
            rows = self._session.sql(f"""
                SELECT *
                FROM {self._schema}.TBL_AGENT_LEARNINGS
                WHERE AGENT_TYPE = '{agent_type}'
                  AND STATUS = 'active'
                ORDER BY CONFIDENCE DESC, USAGE_COUNT DESC, CREATED_AT DESC
                LIMIT {max_results}
            """).collect()

            return [self._parse_learning(row.as_dict()) for row in rows]
        except Exception as exc:
            logger.error("SQL learning retrieval failed: %s", exc)
            return []

    def _get_similar_mappings_sql(
        self,
        target_column: str,
        source_tables: list[str],
        project_id: str | None,
        max_results: int,
    ) -> list[AgentLearning]:
        """Fallback SQL-based similar mappings retrieval."""
        try:
            project_filter = ""
            if project_id:
                project_filter = f"AND ENTITY_IDS:project_id::STRING != '{project_id}'"

            rows = self._session.sql(f"""
                SELECT *
                FROM {self._schema}.TBL_AGENT_LEARNINGS
                WHERE AGENT_TYPE = 'SOURCE_MAPPING'
                  AND LEARNING_TYPE = 'mapping_acceptance'
                  AND STATUS = 'active'
                  AND (
                      ATTRIBUTES:target_column::STRING ILIKE '%{self._escape_sql(target_column)}%'
                      OR SUMMARY ILIKE '%{self._escape_sql(target_column)}%'
                  )
                  {project_filter}
                ORDER BY CONFIDENCE DESC, USAGE_COUNT DESC
                LIMIT {max_results}
            """).collect()

            return [self._parse_learning(row.as_dict()) for row in rows]
        except Exception as exc:
            logger.error("SQL similar mappings retrieval failed: %s", exc)
            return []

    def _parse_learning(self, row: dict[str, Any]) -> AgentLearning:
        """Parse a database row into an AgentLearning object."""
        attributes = row.get("ATTRIBUTES") or {}
        if isinstance(attributes, str):
            try:
                attributes = json.loads(attributes)
            except json.JSONDecodeError:
                attributes = {}

        entity_ids = row.get("ENTITY_IDS") or {}
        if isinstance(entity_ids, str):
            try:
                entity_ids = json.loads(entity_ids)
            except json.JSONDecodeError:
                entity_ids = {}

        tags = row.get("TAGS") or []
        if isinstance(tags, str):
            try:
                tags = json.loads(tags)
            except json.JSONDecodeError:
                tags = []

        return AgentLearning(
            learning_id=str(row.get("LEARNING_ID", "")),
            agent_type=str(row.get("AGENT_TYPE", "")),
            learning_type=str(row.get("LEARNING_TYPE", "")),
            summary=str(row.get("SEARCH_TEXT") or row.get("SUMMARY", "")),
            confidence=float(row.get("CONFIDENCE", 0.5)),
            attributes=attributes,
            entity_type=row.get("ENTITY_TYPE"),
            entity_ids=entity_ids,
            tags=tags,
            usage_count=int(row.get("USAGE_COUNT", 0)),
            success_count=int(row.get("SUCCESS_COUNT", 0)),
            relevance_score=float(row.get("RELEVANCE_SCORE", 0.0)),
            created_at=row.get("CREATED_AT"),
        )

    def _generate_learning_key(
        self,
        agent_type: str,
        learning_type: str,
        attributes: dict[str, Any],
    ) -> str:
        """Generate a unique key for deduplication."""
        key_data = f"{agent_type}|{learning_type}|{json.dumps(attributes, sort_keys=True)}"
        return hashlib.md5(key_data.encode()).hexdigest()

    def _record_learning_direct(
        self,
        learning_id: str,
        agent_type: str,
        learning_type: str,
        learning_key: str,
        summary: str,
        attributes: dict[str, Any],
        entity_type: str | None,
        entity_ids: dict[str, Any] | None,
        tags: list[str] | None,
        confidence: float,
        user_id: str | None,
    ) -> str:
        """Direct deduplicating MERGE when the helper procedure is unavailable."""
        try:
            self._session.sql(f"""
                MERGE INTO {self._schema}.TBL_AGENT_LEARNINGS target
                USING (
                    SELECT
                        '{learning_id}' AS LEARNING_ID,
                        '{self._escape_sql(agent_type)}' AS AGENT_TYPE,
                        '{self._escape_sql(learning_type)}' AS LEARNING_TYPE,
                        '{learning_key}' AS LEARNING_KEY,
                        '{self._escape_sql(summary)}' AS SUMMARY,
                        {confidence}::FLOAT AS CONFIDENCE,
                        {self._quote_or_null(entity_type)} AS ENTITY_TYPE,
                        {self._json_or_null(entity_ids)} AS ENTITY_IDS,
                        PARSE_JSON('{self._escape_sql(json.dumps(attributes))}') AS ATTRIBUTES,
                        {self._array_or_null(tags)} AS TAGS,
                        {self._quote_or_null(user_id)} AS CREATED_BY
                ) source
                ON target.LEARNING_KEY = source.LEARNING_KEY
                   AND target.STATUS = 'active'
                WHEN MATCHED THEN UPDATE SET
                    SUMMARY = source.SUMMARY,
                    CONFIDENCE = GREATEST(
                        COALESCE(target.CONFIDENCE, 0),
                        source.CONFIDENCE
                    ),
                    ENTITY_TYPE = COALESCE(source.ENTITY_TYPE, target.ENTITY_TYPE),
                    ENTITY_IDS = COALESCE(source.ENTITY_IDS, target.ENTITY_IDS),
                    ATTRIBUTES = source.ATTRIBUTES,
                    TAGS = COALESCE(source.TAGS, target.TAGS),
                    USAGE_COUNT = COALESCE(target.USAGE_COUNT, 0) + 1,
                    LAST_USED_AT = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT (
                    LEARNING_ID, AGENT_TYPE, LEARNING_TYPE, LEARNING_KEY, SUMMARY,
                    CONFIDENCE, ENTITY_TYPE, ENTITY_IDS, ATTRIBUTES, TAGS,
                    CREATED_BY, STATUS
                ) VALUES (
                    source.LEARNING_ID, source.AGENT_TYPE, source.LEARNING_TYPE,
                    source.LEARNING_KEY, source.SUMMARY, source.CONFIDENCE,
                    source.ENTITY_TYPE, source.ENTITY_IDS, source.ATTRIBUTES,
                    source.TAGS, source.CREATED_BY, 'active'
                )
            """).collect()
            rows = self._session.sql(f"""
                SELECT LEARNING_ID
                FROM {self._schema}.TBL_AGENT_LEARNINGS
                WHERE LEARNING_KEY = '{learning_key}'
                  AND STATUS = 'active'
                ORDER BY CREATED_AT DESC
                LIMIT 1
            """).collect()
            return str(rows[0][0]) if rows else learning_id
        except Exception as exc:
            logger.error("Direct learning insert failed: %s", exc)
            return learning_id

    @staticmethod
    def _is_missing_procedure(exc: Exception, procedure_name: str) -> bool:
        message = str(exc).upper()
        return procedure_name.upper() in message and any(
            marker in message
            for marker in (
                "UNKNOWN USER-DEFINED FUNCTION",
                "UNKNOWN FUNCTION",
                "DOES NOT EXIST",
                "NOT EXIST",
            )
        )

    def _escape_sql(self, value: str) -> str:
        """Escape single quotes in SQL strings."""
        return value.replace("'", "''")

    def _quote_or_null(self, value: str | None) -> str:
        """Return quoted value or NULL."""
        if value is None:
            return "NULL"
        return f"'{self._escape_sql(value)}'"

    def _json_or_null(self, value: dict | None) -> str:
        """Return PARSE_JSON or NULL."""
        if value is None:
            return "NULL"
        return f"PARSE_JSON('{self._escape_sql(json.dumps(value))}')"

    def _array_or_null(self, value: list | None) -> str:
        """Return ARRAY_CONSTRUCT or NULL."""
        if value is None:
            return "NULL"
        items = ", ".join(f"'{self._escape_sql(str(v))}'" for v in value)
        return f"ARRAY_CONSTRUCT({items})"
