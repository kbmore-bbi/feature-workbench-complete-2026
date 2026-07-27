"""Learning Retrieval Service for AGT_SOURCE_MAPPING integration.

This service retrieves and ranks FIR learnings, similar mappings, and
correction history to provide comprehensive learning context to agents.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from typing import Any

from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.agent_learning_service import AgentLearningService, AgentLearning
from app.core.exceptions import ContextPrecedentUnavailableError
from app.core.target_mapping_patterns import TargetMappingPatternService
from app.schema.sttm_builder import (
    LearningContext,
    FIRLearningItem,
    SimilarMappingItem,
    SemanticLearningItem,
    MappingIntentItem,
    ProjectContextItem,
    CrossProjectPatternItem,
    CorrectionHistoryItem,
    MappingPrecedentContext,
)

logger = logging.getLogger(__name__)

_LEARNING_CACHE_IDLE_SECONDS = 3600.0
_LEARNING_DURABLE_REVALIDATE_SECONDS = 86400
_LEARNING_CACHE_LOCK = threading.Lock()
_LEARNING_CACHE: dict[str, tuple[float, LearningContext]] = {}
_LEARNING_BUILD_LOCKS: dict[str, threading.Lock] = {}


def invalidate_learning_context_cache() -> None:
    with _LEARNING_CACHE_LOCK:
        _LEARNING_CACHE.clear()


class LearningRetrievalService:
    """Retrieves and ranks FIR learnings for agent context.

    Provides methods to fetch:
    - FIR learnings from inferences
    - Similar mappings from this and other projects
    - Semantic learnings for column disambiguation
    - Mapping intent (captured or inferred)
    - Project context
    - Cross-project patterns
    - Correction history to avoid repeating mistakes
    """

    def __init__(self, session: Session, settings: Settings, access_scope: str = "default") -> None:
        self._session = session
        self._settings = settings
        self._agent_learning_service = AgentLearningService(session, settings)
        self._target_pattern_service = (
            TargetMappingPatternService(session, settings)
            if settings.fir_target_mapping_patterns_v2
            else None
        )
        self._last_fir_retrieval_error: str | None = None
        effective_scope = access_scope if access_scope != "default" else f"session:{id(session)}"
        self._access_fingerprint = hashlib.sha256(effective_scope.encode("utf-8")).hexdigest()

    @staticmethod
    def _quote(value: Any) -> str:
        return "'" + str(value).replace("'", "''") + "'"

    def _load_durable_context(self, cache_key: str) -> LearningContext | None:
        """Hydrate a prepared learning context after a replica change or restart."""
        try:
            table_name = self._settings.qualify_metadata_object_name(
                "TBL_PREPARED_LEARNING_CONTEXTS"
            )
            rows = self._session.sql(
                f"""
                SELECT CONTEXT_PAYLOAD
                FROM {table_name}
                WHERE CONTEXT_KEY = {self._quote(cache_key)}
                  AND ACCESS_FINGERPRINT = {self._quote(self._access_fingerprint)}
                  AND UPDATED_AT >= DATEADD(
                      'second', -{int(_LEARNING_DURABLE_REVALIDATE_SECONDS)}, CURRENT_TIMESTAMP()
                  )
                ORDER BY UPDATED_AT DESC
                LIMIT 1
                """
            ).collect()
            if not rows:
                return None
            payload = rows[0].as_dict().get("CONTEXT_PAYLOAD")
            if isinstance(payload, str):
                payload = json.loads(payload)
            if not isinstance(payload, dict):
                return None
            result = LearningContext.model_validate(payload)
            result.cache_status = "l2"
            return result
        except Exception as exc:
            # Older installations may not have this table until the accompanying
            # idempotent DDL is bootstrapped. Retrieval remains functional.
            logger.debug("Prepared FIR context L2 cache unavailable: %s", exc)
            return None

    def get_prepared_learning_context(
        self,
        *,
        learning_context_id: str,
        learning_context_hash: str | None = None,
    ) -> LearningContext | None:
        """Hydrate an immutable prepared context by public handle.

        Warm assistant calls use this path instead of repeating FIR retrieval.
        Access isolation is enforced by the same internal fingerprint used by
        the durable cache.
        """
        if not learning_context_id:
            return None
        try:
            table_name = self._settings.qualify_metadata_object_name(
                "TBL_PREPARED_LEARNING_CONTEXTS"
            )
            hash_predicate = (
                f"AND LEARNING_CONTEXT_HASH = {self._quote(learning_context_hash)}"
                if learning_context_hash
                else ""
            )
            rows = self._session.sql(
                f"""
                SELECT CONTEXT_PAYLOAD
                FROM {table_name}
                WHERE LEARNING_CONTEXT_ID = {self._quote(learning_context_id)}
                  AND ACCESS_FINGERPRINT = {self._quote(self._access_fingerprint)}
                  {hash_predicate}
                ORDER BY UPDATED_AT DESC
                LIMIT 1
                """
            ).collect()
            if not rows:
                return None
            payload = rows[0].as_dict().get("CONTEXT_PAYLOAD")
            if isinstance(payload, str):
                payload = json.loads(payload)
            if not isinstance(payload, dict):
                return None
            context = LearningContext.model_validate(payload)
            context.cache_status = "l2-handle"
            return context
        except Exception as exc:
            logger.debug("Prepared FIR handle hydration unavailable: %s", exc)
            return None

    def _persist_durable_context(
        self,
        cache_key: str,
        context: LearningContext,
    ) -> None:
        """Persist the exact prepared object so agents do not repeat retrieval."""
        try:
            table_name = self._settings.qualify_metadata_object_name(
                "TBL_PREPARED_LEARNING_CONTEXTS"
            )
            payload = json.dumps(
                context.model_dump(mode="json"),
                sort_keys=True,
                default=str,
                separators=(",", ":"),
            )
            self._session.sql(
                f"""
                MERGE INTO {table_name} target
                USING (
                    SELECT
                        {self._quote(cache_key)} AS CONTEXT_KEY,
                        {self._quote(self._access_fingerprint)} AS ACCESS_FINGERPRINT,
                        {self._quote(context.learning_context_id or '')} AS LEARNING_CONTEXT_ID,
                        {self._quote(context.learning_context_hash or '')} AS LEARNING_CONTEXT_HASH,
                        PARSE_JSON({self._quote(payload)}) AS CONTEXT_PAYLOAD
                ) source
                ON target.CONTEXT_KEY = source.CONTEXT_KEY
                   AND target.ACCESS_FINGERPRINT = source.ACCESS_FINGERPRINT
                WHEN MATCHED THEN UPDATE SET
                    LEARNING_CONTEXT_ID = source.LEARNING_CONTEXT_ID,
                    LEARNING_CONTEXT_HASH = source.LEARNING_CONTEXT_HASH,
                    CONTEXT_PAYLOAD = source.CONTEXT_PAYLOAD,
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT (
                    CONTEXT_KEY, ACCESS_FINGERPRINT, LEARNING_CONTEXT_ID,
                    LEARNING_CONTEXT_HASH, CONTEXT_PAYLOAD, CREATED_AT, UPDATED_AT
                ) VALUES (
                    source.CONTEXT_KEY, source.ACCESS_FINGERPRINT,
                    source.LEARNING_CONTEXT_ID, source.LEARNING_CONTEXT_HASH,
                    source.CONTEXT_PAYLOAD, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
                )
                """
            ).collect()
        except Exception as exc:
            logger.debug("Unable to persist prepared FIR context in L2 cache: %s", exc)

    def _get_link_scope(self, *, project_id: str, sttm_id: str | None) -> dict[str, Any]:
        """Return only explicitly directed precedent scopes for this workspace."""
        project_ids: list[str] = []
        sttm_ids: list[str] = []
        explanations: list[dict[str, Any]] = []
        try:
            rows = self._session.sql(
                f"""
                SELECT PRECEDENT_PROJECT_ID, PRIORITY, KNOWLEDGE_CATEGORIES,
                       ALLOW_PROJECT_SPECIFIC_VALUES
                FROM {self._settings.qualify_metadata_object_name('TBL_FIR_PROJECT_LINKS')}
                WHERE PROJECT_ID = {self._quote(project_id)}
                  AND LOWER(COALESCE(STATUS, 'active')) = 'active'
                ORDER BY PRIORITY DESC
                """
            ).collect()
            for row in rows:
                data = row.as_dict()
                precedent_id = str(data.get("PRECEDENT_PROJECT_ID") or "")
                if not precedent_id:
                    continue
                project_ids.append(precedent_id)
                explanations.append(
                    {
                        "retrieval_mode": "linked_project",
                        "precedent_project_id": precedent_id,
                        "priority": int(data.get("PRIORITY") or 50),
                        "knowledge_categories": self._parse_string_list(
                            data.get("KNOWLEDGE_CATEGORIES")
                        ),
                        "allow_project_specific_values": bool(
                            data.get("ALLOW_PROJECT_SPECIFIC_VALUES")
                        ),
                    }
                )
        except Exception as exc:
            logger.debug("Project precedent links unavailable: %s", exc)
        if sttm_id:
            try:
                rows = self._session.sql(
                    f"""
                    SELECT PRECEDENT_STTM_ID, PRIORITY, KNOWLEDGE_CATEGORIES,
                           TARGET_COMPATIBILITY, CONFIDENCE,
                           ALLOW_PROJECT_SPECIFIC_VALUES
                    FROM {self._settings.qualify_metadata_object_name('TBL_FIR_MAPPING_LINKS')}
                    WHERE STTM_ID = {self._quote(sttm_id)}
                      AND LOWER(COALESCE(STATUS, 'active')) = 'active'
                    ORDER BY PRIORITY DESC
                    """
                ).collect()
                for row in rows:
                    data = row.as_dict()
                    precedent_id = str(data.get("PRECEDENT_STTM_ID") or "")
                    if not precedent_id:
                        continue
                    sttm_ids.append(precedent_id)
                    explanations.append(
                        {
                            "retrieval_mode": "linked_mapping",
                            "precedent_sttm_id": precedent_id,
                            "priority": int(data.get("PRIORITY") or 75),
                            "confidence": float(data.get("CONFIDENCE") or 1.0),
                            "target_compatibility": data.get("TARGET_COMPATIBILITY"),
                            "knowledge_categories": self._parse_string_list(
                                data.get("KNOWLEDGE_CATEGORIES")
                            ),
                            "allow_project_specific_values": bool(
                                data.get("ALLOW_PROJECT_SPECIFIC_VALUES")
                            ),
                        }
                    )
            except Exception as exc:
                logger.debug("Mapping precedent links unavailable: %s", exc)
        return {
            "project_ids": sorted(set(project_ids)),
            "sttm_ids": sorted(set(sttm_ids)),
            "explanations": explanations,
        }

    def get_comprehensive_learning_context(
        self,
        project_id: str,
        source_tables: list[str],
        target_table: str,
        target_columns: list[str],
        mapping_intent: dict[str, Any] | None = None,
        sttm_id: str | None = None,
        max_fir_learnings: int = 15,
        max_similar_mappings: int = 10,
        max_corrections: int = 5,
        context_key: str | None = None,
        source_set_hash: str | None = None,
        derived_set_hash: str | None = None,
        fir_epoch: str | None = None,
        milestone: str | None = None,
        target_agent: str = "AGT_SOURCE_MAPPING",
    ) -> LearningContext:
        """Retrieve all relevant learning context for a mapping operation.

        Returns prioritized and deduplicated learning items.

        Args:
            project_id: Current project ID
            source_tables: List of source table qualified names
            target_table: Target table qualified name
            target_columns: List of target column names
            mapping_intent: Optional provided mapping intent
            sttm_id: Optional STTM ID for context retrieval
            max_fir_learnings: Maximum FIR learnings to return
            max_similar_mappings: Maximum similar mappings to return
            max_corrections: Maximum correction history items

        Returns:
            LearningContext with all retrieved learning data
        """
        cache_payload = {
            "access": self._access_fingerprint,
            "project_id": project_id,
            "sttm_id": sttm_id,
            "source_tables": sorted(str(value).upper() for value in source_tables),
            "target_table": str(target_table).upper(),
            "target_columns": sorted(str(value).upper() for value in target_columns),
            "mapping_intent": mapping_intent or {},
            "context_key": context_key,
            "source_set_hash": source_set_hash,
            "derived_set_hash": derived_set_hash,
            "fir_epoch": fir_epoch,
            "milestone": milestone,
            "target_agent": target_agent,
            "max_fir_learnings": max_fir_learnings,
            "max_similar_mappings": max_similar_mappings,
            "max_corrections": max_corrections,
        }
        cache_key = hashlib.sha256(
            json.dumps(cache_payload, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        with _LEARNING_CACHE_LOCK:
            cached = _LEARNING_CACHE.get(cache_key)
            if cached and time.monotonic() - cached[0] <= _LEARNING_CACHE_IDLE_SECONDS:
                result = cached[1].model_copy(deep=True)
                result.cache_status = "l1"
                return result
            if cached:
                _LEARNING_CACHE.pop(cache_key, None)
            build_lock = _LEARNING_BUILD_LOCKS.setdefault(cache_key, threading.Lock())
        build_lock.acquire()
        with _LEARNING_CACHE_LOCK:
            cached = _LEARNING_CACHE.get(cache_key)
            if cached and time.monotonic() - cached[0] <= _LEARNING_CACHE_IDLE_SECONDS:
                result = cached[1].model_copy(deep=True)
                result.cache_status = "l1"
                build_lock.release()
                return result
        durable = self._load_durable_context(cache_key)
        if durable is not None:
            with _LEARNING_CACHE_LOCK:
                _LEARNING_CACHE[cache_key] = (
                    time.monotonic(),
                    durable.model_copy(deep=True),
                )
                _LEARNING_BUILD_LOCKS.pop(cache_key, None)
            build_lock.release()
            return durable
        link_scope = self._get_link_scope(project_id=project_id, sttm_id=sttm_id)
        try:
            fir_learnings = self._get_fir_learnings(
                source_tables,
                target_table,
                target_columns,
                max_fir_learnings,
                context_key=context_key,
                project_id=project_id,
                sttm_id=sttm_id,
                linked_project_ids=link_scope["project_ids"],
                linked_sttm_ids=link_scope["sttm_ids"],
            )
            similar_mappings = self._get_similar_mappings(
                project_id,
                source_tables,
                target_table,
                target_columns,
                max_similar_mappings,
                linked_project_ids=link_scope["project_ids"],
                linked_sttm_ids=link_scope["sttm_ids"],
            )
            semantic_learnings = self._get_semantic_learnings(target_columns)
            intent = self._get_or_infer_mapping_intent(
                project_id, target_table, source_tables, mapping_intent
            )
            project_context = self._get_project_context(project_id, source_tables, sttm_id)
            cross_project_patterns = self._get_cross_project_patterns(
                source_tables,
                target_table,
                target_columns,
                linked_project_ids=link_scope["project_ids"],
            )
            correction_history = self._get_correction_history(
                project_id, target_columns, max_corrections
            )
            all_tables = list(source_tables) + ([target_table] if target_table else [])
            semantic_version_learnings = self.get_semantic_version_learnings(all_tables)

            self._last_fir_retrieval_error = None
            fir_recommendations = self._get_fir_recommendations_for_context(
                project_id=project_id,
                source_tables=source_tables,
                target_table=target_table,
                target_columns=target_columns,
                context_key=context_key,
                source_set_hash=source_set_hash,
                derived_set_hash=derived_set_hash,
                milestone=milestone,
                target_agent=target_agent,
                linked_project_ids=link_scope["project_ids"],
                linked_sttm_ids=link_scope["sttm_ids"],
            )
            mapping_precedents = self._get_mapping_precedents(
                linked_sttm_ids=link_scope["sttm_ids"],
                link_explanations=link_scope["explanations"],
                target_columns=target_columns,
            )
            if link_scope["sttm_ids"] and not mapping_precedents:
                raise ContextPrecedentUnavailableError(
                    "The mapping is linked to completed precedent context, but that context could not be loaded."
                )
            target_mapping_patterns: list[dict[str, Any]] = []
            if self._target_pattern_service is not None and target_table:
                try:
                    target_mapping_patterns = [
                        candidate.model_dump(mode="json")
                        for candidate in self._target_pattern_service.retrieve_candidates(
                            target_table=target_table,
                            target_columns=target_columns,
                            source_tables=source_tables,
                            project_id=project_id,
                            limit=max(len(target_columns) * 5, 25),
                        )
                    ]
                except Exception as exc:
                    # Compatibility release: an installation may enable the
                    # service before the idempotent V2 DDL is bootstrapped.
                    logger.warning(
                        "Target-column FIR patterns are temporarily unavailable: %s",
                        exc,
                    )

            result = LearningContext(
                fir_learnings=fir_learnings,
                similar_mappings=similar_mappings,
                semantic_learnings=semantic_learnings,
                mapping_intent=intent,
                project_context=project_context,
                cross_project_patterns=cross_project_patterns,
                correction_history=correction_history,
                semantic_version_learnings=semantic_version_learnings,
                fir_recommendations=fir_recommendations,
                context_key=context_key,
                retrieval_mode=(
                    str(fir_recommendations[0].get("retrieval_mode"))
                    if fir_recommendations
                    else None
                ),
                linked_project_ids=link_scope["project_ids"],
                linked_mapping_ids=link_scope["sttm_ids"],
                linked_project_patterns=[
                    item.model_dump(mode="json") for item in cross_project_patterns
                ],
                linked_mapping_precedents=[
                    item.model_dump(mode="json")
                    for item in similar_mappings
                    if item.sttm_id in set(link_scope["sttm_ids"])
                ],
                mapping_precedents=mapping_precedents,
                target_mapping_patterns=target_mapping_patterns,
                curated_relationships=[
                    relationship
                    for item in semantic_version_learnings
                    for relationship in self._parse_relationships(item.get("relationship_rules"))
                ],
                retrieval_explanations=[
                    *link_scope["explanations"],
                    *(
                        [{
                            "retrieval_mode": "fir_degraded",
                            "visible_warning": self._last_fir_retrieval_error,
                        }]
                        if self._last_fir_retrieval_error
                        else []
                    ),
                ],
            )
            context_payload = result.model_dump(mode="json", exclude={"learning_context_id", "learning_context_hash", "cache_status"})
            context_hash = hashlib.sha256(
                json.dumps(context_payload, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
            ).hexdigest()
            result.learning_context_hash = context_hash
            result.learning_context_id = f"learn_{context_hash[:16]}"
            self._persist_durable_context(cache_key, result)
            with _LEARNING_CACHE_LOCK:
                _LEARNING_CACHE[cache_key] = (time.monotonic(), result.model_copy(deep=True))
                _LEARNING_BUILD_LOCKS.pop(cache_key, None)
            build_lock.release()
            return result
        except ContextPrecedentUnavailableError:
            with _LEARNING_CACHE_LOCK:
                _LEARNING_BUILD_LOCKS.pop(cache_key, None)
            build_lock.release()
            raise
        except Exception as exc:
            logger.warning("Failed to retrieve learning context: %s", exc)
            if link_scope["sttm_ids"]:
                with _LEARNING_CACHE_LOCK:
                    _LEARNING_BUILD_LOCKS.pop(cache_key, None)
                build_lock.release()
                raise ContextPrecedentUnavailableError(
                    "The linked mapping precedent failed during context preparation."
                ) from exc
            with _LEARNING_CACHE_LOCK:
                _LEARNING_BUILD_LOCKS.pop(cache_key, None)
            build_lock.release()
            return LearningContext()

    def _get_fir_learnings(
        self,
        source_tables: list[str],
        target_table: str,
        target_columns: list[str],
        limit: int = 15,
        *,
        context_key: str | None = None,
        project_id: str | None = None,
        sttm_id: str | None = None,
        linked_project_ids: list[str] | None = None,
        linked_sttm_ids: list[str] | None = None,
    ) -> list[FIRLearningItem]:
        """Retrieve exact FIR inferences, then reusable knowledge for the same subjects."""
        try:
            inference_table = self._settings.qualify_table_name(
                self._settings.snowflake_assistant_inferences_table
            )
            subjects = {
                str(value).strip().upper()
                for value in [*source_tables, target_table, *target_columns]
                if value and str(value).strip()
            }
            subjects.update(
                f"{target_table.strip().upper()}.{column.strip().upper()}"
                for column in target_columns
                if target_table and column and column.strip()
            )

            def quote(value: str) -> str:
                return "'" + value.replace("'", "''") + "'"

            select_sql = f"""
            SELECT
                INFERENCE_ID AS LEARNING_ID,
                COALESCE(INFERENCE_GOAL_ID, INFERENCE_TYPE) AS LEARNING_TYPE,
                COALESCE(SUBJECT_KEY, ATTRIBUTES:pattern_key::STRING, '') AS PATTERN_KEY,
                SUMMARY,
                COALESCE(CONFIDENCE, 0.5) AS CONFIDENCE,
                COALESCE(PROVENANCE:agent::STRING, SOURCE) AS SOURCE,
                COALESCE(
                    STRUCTURED_ANSWER:business_purpose::STRING,
                    STRUCTURED_ANSWER:business_definition::STRING,
                    STRUCTURED_ANSWER:business_meaning::STRING,
                    ATTRIBUTES:business_rationale::STRING
                ) AS BUSINESS_RATIONALE,
                COALESCE(STRUCTURED_ANSWER:domain::STRING, ATTRIBUTES:domain_pattern::STRING) AS DOMAIN_PATTERN,
                COALESCE(
                    ATTRIBUTES:reusability::STRING,
                    IFF(INFERENCE_GOAL_ID = 'Q2', 'column_specific',
                        IFF(INFERENCE_GOAL_ID IN ('Q6', 'Q7'), 'table_specific', 'highly_reusable'))
                ) AS REUSABILITY,
                TO_CHAR(CREATED_AT, 'YYYY-MM-DD HH24:MI:SS') AS CREATED_AT
            FROM {inference_table}
            WHERE STATUS = 'active'
              AND COALESCE(VALIDATION_STATUS, 'unvalidated') NOT IN ('rejected', 'superseded')
              AND COALESCE(CONFIDENCE, 0.5) >= 0.3
              {{predicate}}
            ORDER BY COALESCE(CONFIDENCE, 0.5) DESC, CREATED_AT DESC
            LIMIT {limit}
            """

            rows = []
            if context_key:
                rows = self._session.sql(
                    select_sql.format(predicate=f"AND CONTEXT_KEY = {quote(context_key)}")
                ).collect()
            if not rows and subjects:
                subject_literals = ", ".join(quote(subject) for subject in sorted(subjects))
                allowed_scope: list[str] = []
                allowed_projects = [str(project_id)] if project_id else []
                allowed_projects.extend(linked_project_ids or [])
                allowed_sttms = [str(sttm_id)] if sttm_id else []
                allowed_sttms.extend(linked_sttm_ids or [])
                if allowed_projects:
                    values = ", ".join(quote(value) for value in sorted(set(allowed_projects)))
                    allowed_scope.append(f"TO_VARCHAR(PROJECT_ID) IN ({values})")
                if allowed_sttms:
                    values = ", ".join(quote(value) for value in sorted(set(allowed_sttms)))
                    allowed_scope.append(f"TO_VARCHAR(STTM_ID) IN ({values})")
                scope_predicate = (
                    " AND (" + " OR ".join(allowed_scope) + ")"
                    if allowed_scope
                    else ""
                )
                rows = self._session.sql(
                    select_sql.format(
                        predicate=(
                            f"AND UPPER(COALESCE(SUBJECT_KEY, '')) IN ({subject_literals})"
                            f"{scope_predicate}"
                        )
                    )
                ).collect()
            return [
                FIRLearningItem(
                    learning_id=str(row["LEARNING_ID"] or ""),
                    learning_type=str(row["LEARNING_TYPE"] or ""),
                    pattern_key=str(row["PATTERN_KEY"] or ""),
                    summary=str(row["SUMMARY"] or ""),
                    confidence=float(row["CONFIDENCE"]) if row["CONFIDENCE"] else 0.5,
                    source=str(row["SOURCE"] or ""),
                    business_rationale=row["BUSINESS_RATIONALE"],
                    domain_pattern=row["DOMAIN_PATTERN"],
                    reusability=row["REUSABILITY"],
                    created_at=row["CREATED_AT"],
                )
                for row in rows
            ]
        except Exception as exc:
            logger.debug("Failed to get FIR learnings: %s", exc)
            return []

    def _get_similar_mappings(
        self,
        project_id: str,
        source_tables: list[str],
        target_table: str,
        target_columns: list[str],
        limit: int = 10,
        *,
        linked_project_ids: list[str] | None = None,
        linked_sttm_ids: list[str] | None = None,
    ) -> list[SimilarMappingItem]:
        """Find similar mappings from this or other projects.

        Prioritizes:
        1. Same project mappings (highest)
        2. Published STTMs in other projects
        3. Exact target column name match
        """
        try:
            target_cols_list = ", ".join(f"'{col}'" for col in target_columns) if target_columns else "''"

            allowed_projects = sorted(set([project_id, *(linked_project_ids or [])]))
            allowed_sttms = sorted(set(linked_sttm_ids or []))
            project_scope = ", ".join(self._quote(value) for value in allowed_projects)
            sttm_scope = ", ".join(self._quote(value) for value in allowed_sttms) or "NULL"
            query = f"""
            SELECT
                a.ATTRIBUTE_ID as mapping_id,
                s.PROJECT_ID as project_id,
                COALESCE(p.PROJECT_NAME, s.PROJECT_ID) as project_name,
                s.STTM_ID as sttm_id,
                COALESCE(s.STTM_NAME, s.STTM_ID) as sttm_name,
                a.ATTRIBUTE_NAME as target_column,
                COALESCE(a.CONDITION:source_columns, TRY_PARSE_JSON(a.SOURCE_COLUMN), ARRAY_CONSTRUCT(a.SOURCE_COLUMN)) as source_columns,
                COALESCE(
                    LOWER(a.CONDITION:mapping_mode::STRING),
                    IFF(a.CONDITION:constant_value IS NOT NULL OR UPPER(a.CONDITION:preprocessing_rule_type::STRING) = 'VALUE', 'constant', 'source')
                ) as mapping_mode,
                a.CONDITION:constant_value::STRING as constant_value,
                a.TRANSFORMATION_LOGIC as preprocessing_rule,
                COALESCE(a.CONDITION:preprocessing_rule_type::STRING, 'Direct') as preprocessing_rule_type,
                COALESCE(a.CONDITION:confidence::NUMBER, 0.7) as confidence_score,
                UPPER(COALESCE(s.STATUS, '')) IN ('PUBLISHED', 'COMPLETE') as was_published,
                CASE
                    WHEN s.PROJECT_ID = '{project_id}' THEN 1.0
                    WHEN TO_VARCHAR(s.STTM_ID) IN ({sttm_scope}) THEN 0.95
                    WHEN TO_VARCHAR(s.PROJECT_ID) IN ({project_scope}) AND UPPER(s.STATUS) = 'COMPLETE' THEN 0.85
                    ELSE 0.0
                END as similarity_score
            FROM {self._settings.qualify_table_name('TBL_STTM_ATTRIBUTES')} a
            JOIN {self._settings.qualify_table_name('TBL_STTM')} s ON a.STTM_ID = s.STTM_ID
            LEFT JOIN {self._settings.qualify_table_name('TBL_PROJECTS')} p ON s.PROJECT_ID = p.PROJECT_ID
            WHERE a.ATTRIBUTE_NAME IN ({target_cols_list})
              AND (
                  TO_VARCHAR(s.PROJECT_ID) = {self._quote(project_id)}
                  OR TO_VARCHAR(s.STTM_ID) IN ({sttm_scope})
                  OR (
                      TO_VARCHAR(s.PROJECT_ID) IN ({project_scope})
                      AND UPPER(COALESCE(s.STATUS, '')) IN ('COMPLETE', 'PUBLISHED')
                  )
              )
            ORDER BY similarity_score DESC, confidence_score DESC
            LIMIT {limit}
            """

            rows = self._session.sql(query).collect()
            return [
                SimilarMappingItem(
                    mapping_id=str(row["MAPPING_ID"] or ""),
                    project_id=str(row["PROJECT_ID"] or ""),
                    project_name=str(row["PROJECT_NAME"] or ""),
                    sttm_id=str(row["STTM_ID"] or ""),
                    sttm_name=str(row["STTM_NAME"] or ""),
                    target_column=str(row["TARGET_COLUMN"] or ""),
                    source_columns=self._parse_source_columns(row["SOURCE_COLUMNS"]),
                    mapping_mode=(
                        "constant" if str(row["MAPPING_MODE"] or "source").lower() == "constant" else "source"
                    ),
                    constant_value=(str(row["CONSTANT_VALUE"]) if row["CONSTANT_VALUE"] is not None else None),
                    preprocessing_rule=row["PREPROCESSING_RULE"],
                    preprocessing_rule_type=str(row["PREPROCESSING_RULE_TYPE"] or "Direct"),
                    confidence_score=float(row["CONFIDENCE_SCORE"]) if row["CONFIDENCE_SCORE"] else 0.7,
                    was_published=bool(row["WAS_PUBLISHED"]),
                    similarity_score=float(row["SIMILARITY_SCORE"]) if row["SIMILARITY_SCORE"] else 0.5,
                )
                for row in rows
            ]
        except Exception as exc:
            logger.debug("Failed to get similar mappings: %s", exc)
            return []

    def _get_mapping_precedents(
        self,
        *,
        linked_sttm_ids: list[str],
        link_explanations: list[dict[str, Any]],
        target_columns: list[str],
    ) -> list[MappingPrecedentContext]:
        if not linked_sttm_ids:
            return []
        sttm_literals = ", ".join(self._quote(value) for value in linked_sttm_ids)
        target_filter = ""
        if target_columns:
            target_literals = ", ".join(self._quote(value.upper()) for value in target_columns)
            target_filter = f"AND UPPER(a.ATTRIBUTE_NAME) IN ({target_literals})"
        metadata_rows = self._session.sql(
            f"""
            SELECT s.STTM_ID, s.PROJECT_ID, s.STATUS, s.CURRENT_VERSION,
                   s.LAST_SNAPSHOT_ID, s.PARSED_MAPPING_MODEL, s.RAW_MAPPING_SQL
            FROM {self._settings.qualify_table_name('TBL_STTM')} s
            JOIN {self._settings.qualify_table_name('TBL_PROJECTS')} p
              ON p.PROJECT_ID = s.PROJECT_ID
            WHERE TO_VARCHAR(s.STTM_ID) IN ({sttm_literals})
              AND UPPER(COALESCE(s.STATUS, '')) IN ('COMPLETE', 'PUBLISHED')
              AND COALESCE(s.RUNTIME_SUPPRESSED, FALSE) = FALSE
              AND UPPER(COALESCE(p.STATUS, 'ACTIVE')) <> 'ARCHIVED'
              AND COALESCE(p.RUNTIME_SUPPRESSED, FALSE) = FALSE
            """
        ).collect()
        attribute_rows = self._session.sql(
            f"""
            SELECT a.STTM_ID, a.ATTRIBUTE_ID, a.ATTRIBUTE_NAME, a.SOURCE_COLUMN,
                   a.DATA_TYPE, a.TRANSFORMATION_LOGIC, a.DESCRIPTION, a.CONDITION,
                   a.EFFECTIVE_FROM_VERSION, a.EFFECTIVE_THROUGH_VERSION
            FROM {self._settings.qualify_table_name('TBL_STTM_ATTRIBUTES')} a
            JOIN {self._settings.qualify_table_name('TBL_STTM')} s
              ON s.STTM_ID = a.STTM_ID
            WHERE TO_VARCHAR(a.STTM_ID) IN ({sttm_literals})
              {target_filter}
              AND (
                  COALESCE(a.IS_DRAFT, FALSE) = FALSE
                  OR UPPER(COALESCE(s.STATUS, '')) IN ('COMPLETE', 'PUBLISHED')
              )
              AND (a.EFFECTIVE_FROM_VERSION IS NULL OR a.EFFECTIVE_FROM_VERSION <= s.CURRENT_VERSION)
              AND (a.EFFECTIVE_THROUGH_VERSION IS NULL OR a.EFFECTIVE_THROUGH_VERSION >= s.CURRENT_VERSION)
            QUALIFY ROW_NUMBER() OVER (
                PARTITION BY a.STTM_ID, UPPER(a.ATTRIBUTE_NAME)
                ORDER BY COALESCE(a.EFFECTIVE_FROM_VERSION, 0) DESC, a.ATTRIBUTE_ID DESC
            ) = 1
            ORDER BY a.STTM_ID, a.ATTRIBUTE_ID
            """
        ).collect()
        mappings_by_sttm: dict[str, list[dict[str, Any]]] = {}
        for row in attribute_rows:
            data = row.as_dict()
            condition = self._parse_json(data.get("CONDITION")) or {}
            source_columns = self._parse_string_list(condition.get("source_columns"))
            if not source_columns:
                source_columns = self._parse_source_columns(data.get("SOURCE_COLUMN"))
            constant_value = condition.get("constant_value")
            mapping_mode = str(condition.get("mapping_mode") or "").lower()
            if not mapping_mode:
                mapping_mode = "constant" if constant_value is not None else "source"
            imported_rule_label = str(condition.get("preprocessing_rule") or "").strip()
            imported_rule_type = str(
                condition.get("preprocessing_rule_type")
                or imported_rule_label
                or ("Value" if mapping_mode == "constant" else "Direct")
            ).strip()
            transformation_logic = data.get("TRANSFORMATION_LOGIC")
            preprocessing_rule = transformation_logic or imported_rule_label or None
            mappings_by_sttm.setdefault(str(data.get("STTM_ID")), []).append(
                {
                    "mapping_id": str(data.get("ATTRIBUTE_ID") or ""),
                    "target_column": str(data.get("ATTRIBUTE_NAME") or ""),
                    "target_type": data.get("DATA_TYPE"),
                    "mapping_mode": "constant" if mapping_mode == "constant" else "source",
                    "source_columns": source_columns,
                    "constant_value": constant_value,
                    "preprocessing_rule": preprocessing_rule,
                    "preprocessing_rule_type": imported_rule_type,
                    "description": data.get("DESCRIPTION"),
                    "condition": condition,
                }
            )

        explanation_by_sttm = {
            str(item.get("precedent_sttm_id")): item
            for item in link_explanations
            if item.get("precedent_sttm_id")
        }
        precedents: list[MappingPrecedentContext] = []
        for row in metadata_rows:
            data = row.as_dict()
            precedent_id = str(data.get("STTM_ID") or "")
            parsed = self._parse_json(data.get("PARSED_MAPPING_MODEL")) or {}
            explanation = explanation_by_sttm.get(precedent_id, {})
            raw_sql = str(data.get("RAW_MAPPING_SQL") or "")
            precedents.append(
                MappingPrecedentContext(
                    precedent_sttm_id=precedent_id,
                    precedent_project_id=str(data.get("PROJECT_ID") or "") or None,
                    compatibility=explanation.get("target_compatibility"),
                    confidence=float(explanation.get("confidence") or 1.0),
                    priority=int(explanation.get("priority") or 0),
                    knowledge_categories=explanation.get("knowledge_categories") or [],
                    allow_project_specific_values=bool(
                        explanation.get("allow_project_specific_values")
                    ),
                    mappings=mappings_by_sttm.get(precedent_id, []),
                    relationships=parsed.get("join_patterns") or parsed.get("relationships") or [],
                    filters=parsed.get("filters") or [],
                    ctes=parsed.get("ctes") or [],
                    derived_sources=parsed.get("derived_source_candidates")
                    or parsed.get("derived_sources")
                    or [],
                    business_rules=parsed.get("business_rules") or [],
                    alias_contract=parsed.get("table_aliases") or {},
                    raw_sql_hash=(
                        hashlib.sha256(raw_sql.encode("utf-8")).hexdigest()
                        if raw_sql
                        else None
                    ),
                    snapshot_id=str(data.get("LAST_SNAPSHOT_ID") or "") or None,
                )
            )
        return sorted(precedents, key=lambda item: (-item.priority, item.precedent_sttm_id))

    def _get_semantic_learnings(
        self,
        target_columns: list[str],
        limit: int = 10,
    ) -> list[SemanticLearningItem]:
        """Retrieve semantic learnings for column disambiguation."""
        try:
            target_cols_pattern = "%|%".join(target_columns) if target_columns else ""

            query = f"""
            SELECT
                LEARNING_ID as learning_id,
                LEARNING_TYPE as learning_type,
                SUMMARY as summary,
                COALESCE(CONFIDENCE, 0.7) as confidence,
                COALESCE(ATTRIBUTES:applies_to, ARRAY_CONSTRUCT()) as applies_to,
                ATTRIBUTES:correct_interpretation::STRING as correct_interpretation,
                ATTRIBUTES:incorrect_interpretation::STRING as incorrect_interpretation
            FROM {self._settings.qualify_table_name(self._settings.snowflake_semantic_learnings_table)}
            WHERE STATUS = 'active'
              AND LEARNING_TYPE IN ('column_disambiguation', 'transformation_pattern', 'domain_vocabulary')
            ORDER BY CONFIDENCE DESC, UPDATED_AT DESC
            LIMIT {limit}
            """

            rows = self._session.sql(query).collect()
            return [
                SemanticLearningItem(
                    learning_id=str(row["LEARNING_ID"] or ""),
                    learning_type=str(row["LEARNING_TYPE"] or ""),
                    summary=str(row["SUMMARY"] or ""),
                    confidence=float(row["CONFIDENCE"]) if row["CONFIDENCE"] else 0.7,
                    applies_to=self._parse_string_list(row["APPLIES_TO"]),
                    correct_interpretation=row["CORRECT_INTERPRETATION"],
                    incorrect_interpretation=row["INCORRECT_INTERPRETATION"],
                )
                for row in rows
            ]
        except Exception as exc:
            logger.debug("Failed to get semantic learnings: %s", exc)
            return []

    def _get_or_infer_mapping_intent(
        self,
        project_id: str,
        target_table: str,
        source_tables: list[str],
        provided_intent: dict[str, Any] | None,
    ) -> MappingIntentItem | None:
        """Get existing mapping intent or infer from context."""
        if provided_intent:
            return MappingIntentItem(
                intent_id=str(provided_intent.get("intent_id") or ""),
                business_goal=str(provided_intent.get("business_goal") or ""),
                target_outcome=str(provided_intent.get("target_outcome") or ""),
                lifecycle=str(provided_intent.get("lifecycle") or "initial"),
                domain_hints=self._parse_string_list(provided_intent.get("domain_hints")),
                captured_from=str(provided_intent.get("captured_from") or "user_response"),
                # Browser/workspace payloads preserve an explicitly unknown
                # confidence as JSON null.  Treat that the same as an omitted
                # confidence instead of letting float(None) discard the whole
                # linked-precedent context.
                confidence=float(provided_intent.get("confidence") or 0.8),
            )

        try:
            query = f"""
            SELECT
                INTENT_ID as intent_id,
                BUSINESS_GOAL as business_goal,
                TARGET_OUTCOME as target_outcome,
                COALESCE(ATTRIBUTES:lifecycle::STRING, 'initial') as lifecycle,
                COALESCE(ATTRIBUTES:domain_hints, ARRAY_CONSTRUCT()) as domain_hints,
                COALESCE(SOURCE, 'inferred') as captured_from,
                COALESCE(CONFIDENCE, 0.7) as confidence
            FROM {self._settings.qualify_table_name(self._settings.snowflake_mapping_intents_table)}
            WHERE PROJECT_ID = '{project_id}'
              AND TARGET_TABLE = '{target_table}'
            ORDER BY UPDATED_AT DESC
            LIMIT 1
            """

            rows = self._session.sql(query).collect()
            if rows:
                row = rows[0]
                return MappingIntentItem(
                    intent_id=str(row["INTENT_ID"] or ""),
                    business_goal=str(row["BUSINESS_GOAL"] or ""),
                    target_outcome=str(row["TARGET_OUTCOME"] or ""),
                    lifecycle=str(row["LIFECYCLE"] or "initial"),
                    domain_hints=self._parse_string_list(row["DOMAIN_HINTS"]),
                    captured_from=str(row["CAPTURED_FROM"] or "inferred"),
                    confidence=float(row["CONFIDENCE"]) if row["CONFIDENCE"] else 0.7,
                )
        except Exception as exc:
            logger.debug("Failed to get mapping intent: %s", exc)

        return None

    def _get_project_context(
        self,
        project_id: str,
        source_tables: list[str],
        sttm_id: str | None = None,
    ) -> ProjectContextItem | None:
        """Build project context including stats, common patterns, and STTM details."""
        try:
            query = f"""
            SELECT
                p.PROJECT_ID as project_id,
                p.PROJECT_NAME as project_name,
                p.DESCRIPTION as project_description,
                COUNT(DISTINCT s.STTM_ID) as sttm_count,
                COUNT(DISTINCT CASE WHEN s.STATUS = 'published' THEN s.STTM_ID END) as published_count
            FROM {self._settings.qualify_table_name('TBL_PROJECTS')} p
            LEFT JOIN {self._settings.qualify_table_name('TBL_STTM')} s ON p.PROJECT_ID = s.PROJECT_ID
            WHERE p.PROJECT_ID = '{project_id}'
            GROUP BY p.PROJECT_ID, p.PROJECT_NAME, p.DESCRIPTION
            """

            rows = self._session.sql(query).collect()
            if not rows:
                return None

            row = rows[0]
            context = ProjectContextItem(
                project_id=str(row["PROJECT_ID"] or ""),
                project_name=str(row["PROJECT_NAME"] or ""),
                project_description=str(row["PROJECT_DESCRIPTION"] or "") if row["PROJECT_DESCRIPTION"] else None,
                domain=str(row["PROJECT_DESCRIPTION"] or "") if row["PROJECT_DESCRIPTION"] else None,
                sttm_count=int(row["STTM_COUNT"]) if row["STTM_COUNT"] else 0,
                published_count=int(row["PUBLISHED_COUNT"]) if row["PUBLISHED_COUNT"] else 0,
                common_patterns=[],
                common_source_tables=source_tables[:5],
                related_sttms=[],
            )

            # Fetch STTM details if sttm_id is provided
            if sttm_id:
                sttm_query = f"""
                SELECT
                    STTM_ID,
                    STTM_NAME,
                    DESCRIPTION,
                    STATUS
                FROM {self._settings.qualify_table_name('TBL_STTM')}
                WHERE STTM_ID = '{sttm_id}'
                LIMIT 1
                """
                sttm_rows = self._session.sql(sttm_query).collect()
                if sttm_rows:
                    sttm_row = sttm_rows[0]
                    context.sttm_id = str(sttm_row["STTM_ID"] or "")
                    context.sttm_name = str(sttm_row["STTM_NAME"] or "") if sttm_row["STTM_NAME"] else None
                    context.sttm_description = str(sttm_row["DESCRIPTION"] or "") if sttm_row["DESCRIPTION"] else None
                    context.sttm_status = str(sttm_row["STATUS"] or "") if sttm_row["STATUS"] else None

            return context
        except Exception as exc:
            logger.debug("Failed to get project context: %s", exc)

        return None

    def _get_cross_project_patterns(
        self,
        source_tables: list[str],
        target_table: str,
        target_columns: list[str],
        limit: int = 5,
        *,
        linked_project_ids: list[str] | None = None,
    ) -> list[CrossProjectPatternItem]:
        """Find reusable patterns from other projects."""
        if not linked_project_ids:
            return []
        try:
            target_cols_list = ", ".join(f"'{col}'" for col in target_columns) if target_columns else "''"
            project_scope = ", ".join(self._quote(value) for value in linked_project_ids)

            query = f"""
            SELECT
                INFERENCE_ID as pattern_id,
                INFERENCE_TYPE as pattern_type,
                SUMMARY as description,
                ATTRIBUTES as example_mapping,
                ARRAY_CONSTRUCT(ATTRIBUTES:project_id::STRING) as source_projects,
                1 as usage_count,
                COALESCE(CONFIDENCE, 0.8) as avg_confidence,
                ATTRIBUTES:reusability::STRING = 'highly_reusable' as is_recommended
            FROM {self._settings.qualify_table_name(self._settings.snowflake_assistant_inferences_table)}
            WHERE STATUS = 'active'
              AND INFERENCE_TYPE IN ('mapping_acceptance_learning', 'sttm_publish_learning')
              AND ATTRIBUTES:reusability::STRING IN ('highly_reusable', 'table_specific')
              AND ATTRIBUTES:target_column::STRING IN ({target_cols_list})
              AND ATTRIBUTES:project_id::STRING IN ({project_scope})
            ORDER BY avg_confidence DESC
            LIMIT {limit}
            """

            rows = self._session.sql(query).collect()
            return [
                CrossProjectPatternItem(
                    pattern_id=str(row["PATTERN_ID"] or ""),
                    pattern_type=str(row["PATTERN_TYPE"] or "mapping_pattern"),
                    description=str(row["DESCRIPTION"] or ""),
                    example_mapping=self._parse_json(row["EXAMPLE_MAPPING"]) or {},
                    source_projects=self._parse_string_list(row["SOURCE_PROJECTS"]),
                    usage_count=int(row["USAGE_COUNT"]) if row["USAGE_COUNT"] else 1,
                    avg_confidence=float(row["AVG_CONFIDENCE"]) if row["AVG_CONFIDENCE"] else 0.8,
                    is_recommended=bool(row["IS_RECOMMENDED"]),
                )
                for row in rows
            ]
        except Exception as exc:
            logger.debug("Failed to get cross-project patterns: %s", exc)
            return []

    def _get_correction_history(
        self,
        project_id: str,
        target_columns: list[str],
        limit: int = 10,
    ) -> list[CorrectionHistoryItem]:
        """Get history of corrections to avoid repeating mistakes."""
        try:
            target_cols_list = ", ".join(f"'{col}'" for col in target_columns) if target_columns else "''"

            query = f"""
            SELECT
                INFERENCE_ID as correction_id,
                ATTRIBUTES:target_column::STRING as target_column,
                COALESCE(ATTRIBUTES:before_source_columns, ARRAY_CONSTRUCT()) as incorrect_source,
                COALESCE(ATTRIBUTES:after_source_columns, ARRAY_CONSTRUCT()) as correct_source,
                COALESCE(ATTRIBUTES:error_category::STRING, 'unknown') as error_category,
                COALESCE(ATTRIBUTES:prevention_hint::STRING, '') as prevention_hint,
                1 as correction_count
            FROM {self._settings.qualify_table_name(self._settings.snowflake_assistant_inferences_table)}
            WHERE INFERENCE_TYPE = 'mapping_edit_learning'
              AND ATTRIBUTES:was_correction::BOOLEAN = TRUE
              AND (
                  ATTRIBUTES:project_id::STRING = '{project_id}'
                  OR ATTRIBUTES:target_column::STRING IN ({target_cols_list})
              )
            ORDER BY CREATED_AT DESC
            LIMIT {limit}
            """

            rows = self._session.sql(query).collect()
            return [
                CorrectionHistoryItem(
                    correction_id=str(row["CORRECTION_ID"] or ""),
                    target_column=str(row["TARGET_COLUMN"] or ""),
                    incorrect_source=self._parse_string_list(row["INCORRECT_SOURCE"]),
                    correct_source=self._parse_string_list(row["CORRECT_SOURCE"]),
                    error_category=str(row["ERROR_CATEGORY"] or "unknown"),
                    prevention_hint=str(row["PREVENTION_HINT"] or ""),
                    correction_count=int(row["CORRECTION_COUNT"]) if row["CORRECTION_COUNT"] else 1,
                )
                for row in rows
            ]
        except Exception as exc:
            logger.debug("Failed to get correction history: %s", exc)
            return []

    def _parse_source_columns(self, value: Any) -> list[str]:
        """Parse source columns from various formats."""
        if value is None:
            return []
        if isinstance(value, list):
            return [str(v) for v in value if v]
        if isinstance(value, str):
            try:
                import json
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return [str(v) for v in parsed if v]
            except Exception:
                pass
            return [value] if value else []
        return []

    def _parse_string_list(self, value: Any) -> list[str]:
        """Parse a string list from various formats."""
        if value is None:
            return []
        if isinstance(value, list):
            return [str(v) for v in value if v]
        if isinstance(value, str):
            try:
                import json
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return [str(v) for v in parsed if v]
            except Exception:
                pass
            return [value] if value else []
        return []

    def _parse_json(self, value: Any) -> dict[str, Any] | None:
        """Parse JSON from various formats."""
        if value is None:
            return None
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                import json
                return json.loads(value)
            except Exception:
                pass
        return None

    def _parse_relationships(self, value: Any) -> list[dict[str, Any]]:
        if value is None:
            return []
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            nested = value.get("relationships")
            if isinstance(nested, list):
                return [item for item in nested if isinstance(item, dict)]
            return [value]
        if isinstance(value, str):
            try:
                import json

                return self._parse_relationships(json.loads(value))
            except Exception:
                return []
        return []

    # ─── Agent-Specific Learning Integration ───────────────────────────

    def get_agent_learnings(
        self,
        agent_type: str,
        query_context: dict[str, Any],
        max_results: int = 10,
    ) -> list[AgentLearning]:
        """Retrieve relevant learnings for a specific agent using Cortex Search.

        This is a convenience wrapper around AgentLearningService.

        Args:
            agent_type: The agent type (SOURCE_MAPPING, TRANSFORMATION_RULE, etc.)
            query_context: Context containing target_columns, source_tables, etc.
            max_results: Maximum number of learnings to return

        Returns:
            List of AgentLearning objects sorted by relevance
        """
        return self._agent_learning_service.get_agent_learnings(
            agent_type, query_context, max_results
        )

    def get_source_mapping_learnings(
        self,
        target_columns: list[str],
        source_tables: list[str],
        project_id: str | None = None,
        max_results: int = 10,
    ) -> list[AgentLearning]:
        """Get learnings specific to source mapping operations.

        Combines:
        - Similar mappings from past acceptances
        - Corrections to avoid
        - Transformation patterns
        """
        query_context = {
            "target_columns": target_columns,
            "source_tables": source_tables,
        }
        if project_id:
            query_context["project_id"] = project_id

        learnings = self._agent_learning_service.get_agent_learnings(
            "SOURCE_MAPPING", query_context, max_results
        )

        correction_learnings = self._agent_learning_service.get_correction_history(
            "SOURCE_MAPPING", target_columns, max_results=5
        )

        all_learnings = learnings + correction_learnings
        seen_ids = set()
        deduped = []
        for learning in all_learnings:
            if learning.learning_id not in seen_ids:
                seen_ids.add(learning.learning_id)
                deduped.append(learning)

        return sorted(deduped, key=lambda x: -x.confidence)[:max_results]

    def get_transformation_learnings(
        self,
        target_columns: list[str],
        rule_types: list[str] | None = None,
        max_results: int = 10,
    ) -> list[AgentLearning]:
        """Get learnings specific to transformation rules.

        Useful for AGT_TRANSFORMATION_RULE to suggest preprocessing patterns.
        """
        query_context = {
            "target_columns": target_columns,
        }
        if rule_types:
            query_context["rule_types"] = rule_types

        return self._agent_learning_service.get_agent_learnings(
            "TRANSFORMATION_RULE", query_context, max_results
        )

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
    ) -> str:
        """Record a mapping acceptance for future learning."""
        return self._agent_learning_service.record_mapping_acceptance(
            target_column=target_column,
            source_columns=source_columns,
            preprocessing_rule=preprocessing_rule,
            preprocessing_rule_type=preprocessing_rule_type,
            confidence_score=confidence_score,
            project_id=project_id,
            sttm_id=sttm_id,
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
        return self._agent_learning_service.record_mapping_correction(
            target_column=target_column,
            incorrect_source=incorrect_source,
            correct_source=correct_source,
            error_category=error_category,
            prevention_hint=prevention_hint,
            project_id=project_id,
            sttm_id=sttm_id,
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
        """Record a transformation pattern for future suggestions."""
        return self._agent_learning_service.record_transformation_pattern(
            rule_type=rule_type,
            rule_expression=rule_expression,
            description=description,
            source_columns=source_columns,
            target_column=target_column,
            project_id=project_id,
            sttm_id=sttm_id,
            user_id=user_id,
        )

    def track_learning_usage(
        self,
        learning_id: str,
        was_successful: bool = True,
    ) -> None:
        """Track that a learning was used and whether it was successful."""
        self._agent_learning_service.track_learning_usage(learning_id, was_successful)

    def _get_fir_recommendations_for_context(
        self,
        project_id: str,
        source_tables: list[str],
        target_table: str,
        target_columns: list[str],
        context_key: str | None = None,
        source_set_hash: str | None = None,
        derived_set_hash: str | None = None,
        milestone: str | None = None,
        target_agent: str = "AGT_SOURCE_MAPPING",
        linked_project_ids: list[str] | None = None,
        linked_sttm_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch pre-computed FIR recommendations relevant to the current mapping context.

        Queries for multiple agent types/triggers to give agents a full picture
        of available pre-computed recommendations for the selected tables.
        """
        all_tables = list(source_tables)
        if target_table:
            all_tables.append(target_table)
        if not all_tables:
            return []

        trigger_type = (
            milestone
            or ("before_auto_map" if target_table else "selection_changed")
        )
        context = {
            "project_id": project_id,
            "table_names": all_tables,
            "column_names": target_columns,
            "context_key": context_key,
            "source_set_hash": source_set_hash,
            "target_fqn": target_table,
            "derived_set_hash": derived_set_hash,
            "milestone": milestone,
            "linked_project_ids": linked_project_ids or [],
            "linked_sttm_ids": linked_sttm_ids or [],
        }

        results = self.get_fir_recommendations(
            agent_type=target_agent,
            trigger_type=trigger_type,
            context=context,
            max_results=15,
        )
        if not results:
            from app.core.conversation_memory import ConversationMemoryService

            memory = ConversationMemoryService(self._session, self._settings)
            fallback = memory.find_fir_recommendations_for_context(
                selected_tables=source_tables,
                target_table=target_table or None,
                project_id=project_id or None,
                context_key=context_key,
                source_set_hash=source_set_hash,
                derived_set_hash=derived_set_hash,
                milestone=trigger_type,
                target_agent=target_agent,
                allow_search_fallback=True,
                limit=15,
            )
            results = [
                {
                    "source": "fir_system",
                    "recommendation_id": item.get("recommendation_id"),
                    "type": item.get("recommendation_type"),
                    "category": item.get("recommendation_category"),
                    "priority": item.get("recommendation_priority"),
                    "score": item.get("recommendation_priority"),
                    "confidence": item.get("confidence"),
                    "context_key": item.get("context_key"),
                    "question_id": item.get("question_id"),
                    "evidence_ids": item.get("evidence_ids") or [],
                    "evidence_summary": item.get("evidence_summary"),
                    "payload": item.get("agent_payload") or {},
                    "retrieval_mode": item.get("retrieval_mode"),
                    "usage_stats": {"used": 0, "successful": 0},
                }
                for item in fallback
            ]

        results.sort(key=lambda r: r.get("score", r.get("priority", 0)), reverse=True)
        return results[:15]

    # ─── FIR System Integration ────────────────────────────────────────

    def get_fir_recommendations(
        self,
        agent_type: str,
        trigger_type: str,
        context: dict[str, Any],
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        """Retrieve FIR System recommendations for an agent.

        Calls SP_FIR_GET_AGENT_RECOMMENDATIONS to fetch pre-formatted
        recommendations from the FIR batch processing system.

        Args:
            agent_type: Target agent (SOURCE_MAPPING, TRANSFORMATION_RULE, STTM_BUILDER)
            trigger_type: Trigger event (on_mapping_start, on_source_selection, etc.)
            context: Context with project_id, table_names, column_names, sttm_id, etc.
            max_results: Maximum recommendations to return

        Returns:
            List of recommendation payloads formatted for learning_context injection.
            Each recommendation has:
            - source: 'fir_system'
            - recommendation_id: Unique ID for tracking
            - type: Recommendation type (pattern_reuse, correction_warning, etc.)
            - priority: 1-100 priority score
            - confidence: Confidence score
            - payload: Agent-specific formatted data
            - usage_stats: {used: int, successful: int}
        """
        try:
            agent_name = f"AGT_{agent_type}" if not agent_type.startswith("AGT_") else agent_type
            context_with_max = {**context, "max_results": max_results}

            proc_name = self._settings.qualify_metadata_object_name(
                "SP_FIR_GET_AGENT_RECOMMENDATIONS"
            )
            result = self._session.call(
                proc_name,
                agent_name,
                trigger_type,
                context_with_max,
            )

            if isinstance(result, str):
                import json
                result = json.loads(result)

            if result.get("status") == "success":
                recommendations = result.get("recommendations", [])
                retrieval_mode = result.get("retrieval_mode")
                for recommendation in recommendations:
                    recommendation["retrieval_mode"] = retrieval_mode
                return recommendations[:max_results]
            else:
                self._last_fir_retrieval_error = "; ".join(
                    str(value) for value in result.get("errors", [])
                ) or "FIR recommendation procedure returned a non-success status."
                logger.warning(
                    "FIR recommendations retrieval failed: %s",
                    result.get("errors", []),
                )
                return []

        except Exception as exc:
            self._last_fir_retrieval_error = str(exc)
            logger.warning("Failed to get FIR recommendations: %s", exc)
            return []

    def get_semantic_version_learnings(
        self,
        table_fqns: list[str],
        limit: int = 3,
    ) -> list[dict[str, Any]]:
        """Retrieve curated semantic version learnings for the given tables.

        Queries TBL_SEMANTIC_VIEW_VERSIONS for the latest curated version of each
        relevant table's semantic view. Returns BUSINESS_GLOSSARY, RELATIONSHIP_RULES,
        TRANSFORMATION_PATTERNS, COLUMN_SEMANTICS, and QA_PAIRS.
        """
        if not table_fqns:
            return []
        try:
            fqn_list = ", ".join(self._quote(fqn.upper()) for fqn in table_fqns)
            rows = self._session.sql(f"""
                SELECT
                    SEMANTIC_VIEW_FQN,
                    VERSION_LABEL,
                    VERSION_NUMBER,
                    BUSINESS_GLOSSARY,
                    RELATIONSHIP_RULES,
                    TRANSFORMATION_PATTERNS,
                    COLUMN_SEMANTICS,
                    QA_PAIRS,
                    CONFIDENCE
                FROM {self._settings.qualify_metadata_object_name('TBL_SEMANTIC_VIEW_VERSIONS')}
                WHERE UPPER(SEMANTIC_VIEW_FQN) IN ({fqn_list})
                  AND COALESCE(LOWER(VALIDATION_STATUS), 'unvalidated') IN (
                      'validated', 'approved', 'active', 'confirmed'
                  )
                QUALIFY ROW_NUMBER() OVER (
                    PARTITION BY SEMANTIC_VIEW_FQN
                    ORDER BY VERSION_NUMBER DESC
                ) = 1
                LIMIT {limit}
            """).collect()

            results = []
            for row in rows:
                row_dict = row.as_dict() if hasattr(row, "as_dict") else row
                results.append({
                    "fqn": row_dict.get("SEMANTIC_VIEW_FQN"),
                    "version_label": row_dict.get("VERSION_LABEL"),
                    "version_number": row_dict.get("VERSION_NUMBER"),
                    "business_glossary": row_dict.get("BUSINESS_GLOSSARY"),
                    "relationship_rules": row_dict.get("RELATIONSHIP_RULES"),
                    "transformation_patterns": row_dict.get("TRANSFORMATION_PATTERNS"),
                    "column_semantics": row_dict.get("COLUMN_SEMANTICS"),
                    "qa_pairs": row_dict.get("QA_PAIRS"),
                    "confidence": row_dict.get("CONFIDENCE"),
                })
            return results
        except Exception as exc:
            logger.debug("Failed to get semantic version learnings: %s", exc)
            return []

    def record_fir_recommendation_success(
        self,
        recommendation_id: str,
    ) -> bool:
        """Record that a FIR recommendation was successfully used.

        Called when a user accepts a suggestion that was based on a FIR recommendation.
        This updates the success_count for the recommendation, which influences
        confidence scoring and future recommendation priority.

        Args:
            recommendation_id: The AGENT_RECOMMENDATION_ID from the FIR system

        Returns:
            True if recording succeeded, False otherwise
        """
        try:
            proc_name = self._settings.qualify_metadata_object_name(
                "SP_FIR_RECORD_RECOMMENDATION_SUCCESS"
            )
            self._session.call(proc_name, recommendation_id)
            return True
        except Exception as exc:
            logger.warning("Failed to record FIR recommendation success: %s", exc)
            return False
