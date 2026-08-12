from __future__ import annotations

import json
import logging
import math
import gzip
import hashlib
import os
import tempfile
import uuid
from functools import wraps
from threading import RLock
from typing import Any

from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.exceptions import SnowflakeQueryError
from app.core.performance import increment, observe
from app.schema.conversation import (
    AssistantInferenceRecord,
    AssistantPreferenceState,
    AssistantSignal,
    AssistantSignalStatus,
    AssistantSignalType,
    ConversationSearchHit,
    EvidenceCitation,
    FeedbackInput,
    MappingIntent,
)

logger = logging.getLogger(__name__)

_artifact_write_lock = RLock()


def _serialize_artifact_writes(function):
    """Coalesce same-process artifact writes around the durable hash lookup.

    Snowflake's primary-key declarations are informational, so the durable
    content-hash lookup remains the source of truth. Serializing the short
    lookup/stage/insert section prevents concurrent requests in one replica
    from racing between the lookup and insert.
    """

    @wraps(function)
    def wrapped(*args, **kwargs):
        with _artifact_write_lock:
            return function(*args, **kwargs)

    return wrapped


class ConversationMemoryService:
    _ensured_storage_keys: set[str] = set()
    _search_preview_unavailable_services: set[str] = set()
    _artifact_stage_warning_keys: set[str] = set()

    def __init__(self, session: Session, settings: Settings) -> None:
        self._session = session
        self._settings = settings

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    @staticmethod
    def _quote_literal(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    @staticmethod
    def _json_literal(value: Any) -> str:
        normalized = ConversationMemoryService._normalize_json_value(value)
        payload = json.dumps(normalized, default=str, allow_nan=False).replace("$$", "$ $")
        return f"$${payload}$$"

    @staticmethod
    def _normalize_json_value(value: Any) -> Any:
        if isinstance(value, float):
            if math.isnan(value) or math.isinf(value):
                return None
            return value
        if isinstance(value, str):
            return "".join(ch for ch in value if ch >= " " or ch in "\t\n\r")
        if isinstance(value, dict):
            return {
                str(key): ConversationMemoryService._normalize_json_value(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [ConversationMemoryService._normalize_json_value(item) for item in value]
        if isinstance(value, tuple):
            return [ConversationMemoryService._normalize_json_value(item) for item in value]
        return value

    def _qualified_name(self, name: str) -> str:
        qualified_name = self._settings.qualify_metadata_object_name(name)
        parts = [part.strip() for part in qualified_name.split(".")]
        if len(parts) != 3 or not all(parts):
            raise SnowflakeQueryError(
                f"Expected fully qualified DATABASE.SCHEMA.OBJECT name, got '{qualified_name}'."
            )
        return ".".join(self._quote_identifier(part) for part in parts)

    @property
    def _turns_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_conversation_turns_table)

    @property
    def _feedback_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_conversation_feedback_table)

    @property
    def _recommendations_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_conversation_recommendations_table)

    @property
    def _assistant_inferences_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_assistant_inferences_table)

    @property
    def _assistant_signals_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_assistant_signals_table)

    @property
    def _assistant_settings_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_assistant_settings_table)

    @property
    def _relationship_facts_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_relationship_facts_table)

    @property
    def _rag_documents_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_rag_documents_table)

    @property
    def _client_notes_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_client_notes_table)

    @property
    def _client_sql_assets_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_client_sql_assets_table)

    @property
    def _fir_events_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_fir_events_table)

    @property
    def _fir_feature_snapshots_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_fir_feature_snapshots_table)

    @property
    def _mapping_intents_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_mapping_intents_table)

    @property
    def _semantic_learnings_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_semantic_learnings_table)

    @property
    def _fir_model_scores_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_fir_model_scores_table)

    @property
    def _fir_templates_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_fir_templates_table)

    @property
    def _workspace_snapshots_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_workspace_snapshots_table)

    @property
    def _agent_artifacts_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_agent_artifacts_table)

    @property
    def _conversation_segments_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_conversation_segments_table)

    @property
    def _agent_artifact_stage(self) -> str:
        name = self._settings.qualify_metadata_object_name(
            self._settings.snowflake_agent_artifact_stage
        )
        return "@" + ".".join(
            self._quote_identifier(part.strip()) for part in name.split(".")
        )

    @property
    def _search_service_name(self) -> str:
        return self._settings.qualify_metadata_object_name(self._settings.snowflake_rag_search_service)

    @property
    def _semantic_models_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_semantic_model_table)

    @property
    def _semantic_bundles_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_semantic_bundles_table)

    @property
    def _derived_sources_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_derived_sources_table)

    def ensure_storage_exists(self) -> None:
        storage_key = "|".join(
            self._settings.qualify_metadata_object_name(name)
            for name in (
                self._settings.snowflake_conversation_turns_table,
                self._settings.snowflake_conversation_feedback_table,
                self._settings.snowflake_conversation_recommendations_table,
                self._settings.snowflake_assistant_inferences_table,
                self._settings.snowflake_assistant_signals_table,
                self._settings.snowflake_assistant_settings_table,
                self._settings.snowflake_relationship_facts_table,
                self._settings.snowflake_rag_documents_table,
                self._settings.snowflake_client_notes_table,
                self._settings.snowflake_client_sql_assets_table,
                self._settings.snowflake_fir_events_table,
                self._settings.snowflake_fir_feature_snapshots_table,
                self._settings.snowflake_mapping_intents_table,
                self._settings.snowflake_semantic_learnings_table,
                self._settings.snowflake_fir_model_scores_table,
                self._settings.snowflake_fir_templates_table,
                self._settings.snowflake_workspace_snapshots_table,
                self._settings.snowflake_agent_artifacts_table,
                self._settings.snowflake_conversation_segments_table,
            )
        )
        if storage_key in self._ensured_storage_keys:
            return
        if self._settings.uses_custom_oauth and self._settings.spcs_execute_as_caller_enabled:
            logger.info(
                "Skipping conversation-memory DDL bootstrap at request time for "
                "custom OAuth + restricted caller-rights runtime."
            )
            self._ensured_storage_keys.add(storage_key)
            return
        statements = [
            f"""
            CREATE TABLE IF NOT EXISTS {self._turns_table} (
                TURN_ID STRING,
                CONVERSATION_ID STRING,
                REQUEST_ID STRING,
                TRACE_ID STRING,
                ROLE STRING,
                ROUTE STRING,
                INTENT_CLASS STRING,
                MESSAGE STRING,
                CITATIONS VARIANT,
                GUARDRAILS_META VARIANT,
                USER_ID STRING,
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._feedback_table} (
                FEEDBACK_ID STRING,
                REQUEST_ID STRING,
                TARGET_REQUEST_ID STRING,
                CONVERSATION_ID STRING,
                SIGNAL_ID STRING,
                FEEDBACK_TYPE STRING,
                CATEGORY STRING,
                OPTION_SELECTED STRING,
                RATING NUMBER,
                COMMENT STRING,
                ENTITY_TYPE STRING,
                ENTITY_ID STRING,
                SELECTION_CONTEXT VARIANT,
                CONTEXT_KEY STRING,
                QUESTION_ID STRING,
                INFERENCE_ID STRING,
                AGENT_RECOMMENDATION_ID STRING,
                SNAPSHOT_ID STRING,
                CORRECTION_PAYLOAD VARIANT,
                USER_ID STRING,
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._recommendations_table} (
                RECOMMENDATION_ID STRING,
                REQUEST_ID STRING,
                CONVERSATION_ID STRING,
                SIGNAL_ID STRING,
                RECOMMENDATION_TYPE STRING,
                MESSAGE STRING,
                CITATIONS VARIANT,
                ENTITY_TYPE STRING,
                ENTITY_IDS VARIANT,
                CONFIDENCE FLOAT,
                ATTRIBUTES VARIANT,
                APPROVAL_REQUIRED BOOLEAN,
                STATUS STRING,
                REVIEW_RATING NUMBER,
                REVIEW_COMMENT STRING,
                REVIEW_STATUS STRING,
                USER_ID STRING,
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._assistant_inferences_table} (
                INFERENCE_ID STRING,
                INFERENCE_KEY STRING,
                REQUEST_ID STRING,
                CONVERSATION_ID STRING,
                SOURCE STRING,
                INFERENCE_TYPE STRING,
                SUMMARY STRING,
                CONFIDENCE FLOAT,
                ENTITY_TYPE STRING,
                ENTITY_IDS VARIANT,
                ATTRIBUTES VARIANT,
                STATUS STRING,
                USER_ID STRING,
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._assistant_signals_table} (
                SIGNAL_ID STRING,
                SIGNAL_KEY STRING,
                REQUEST_ID STRING,
                CONVERSATION_ID STRING,
                INFERENCE_ID STRING,
                SIGNAL_TYPE STRING,
                LAYER STRING,
                SOURCE STRING,
                STATUS STRING,
                TITLE STRING,
                MESSAGE STRING,
                OPTIONS VARIANT,
                ALLOW_FREE_TEXT BOOLEAN,
                REQUIRES_RESPONSE BOOLEAN,
                ENTITY_TYPE STRING,
                ENTITY_IDS VARIANT,
                CONFIDENCE FLOAT,
                ATTRIBUTES VARIANT,
                USER_ID STRING,
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                RESPONDED_AT TIMESTAMP_NTZ,
                DISMISSED_AT TIMESTAMP_NTZ
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._assistant_settings_table} (
                USER_ID STRING,
                FEEDBACK_ENABLED BOOLEAN DEFAULT TRUE,
                RECOMMENDATIONS_ENABLED BOOLEAN DEFAULT TRUE,
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._relationship_facts_table} (
                RELATIONSHIP_DOC_ID STRING,
                SEMANTIC_BUNDLE_ID STRING,
                SOURCE_KIND STRING,
                SOURCE_ENTITY_ID STRING,
                SEMANTIC_VIEW_NAME STRING,
                LEFT_TABLE STRING,
                RIGHT_TABLE STRING,
                JOIN_TYPE STRING,
                CONSTRAINT_NAME STRING,
                SOURCE_HASH STRING,
                RELATIONSHIP_TEXT STRING,
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._rag_documents_table} (
                DOC_ID STRING,
                DOC_FOLDER STRING,
                DOC_TYPE STRING,
                ENTITY_ID STRING,
                TITLE STRING,
                SEARCH_TEXT STRING,
                SEMANTIC_BUNDLE_ID STRING,
                SEMANTIC_VIEW_NAME STRING,
                REQUEST_ID STRING,
                CONVERSATION_ID STRING,
                SOURCE_HASH STRING,
                ATTRIBUTES VARIANT,
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._client_notes_table} (
                NOTE_ID STRING,
                PROJECT_ID STRING,
                ENTITY_TYPE STRING,
                ENTITY_IDS VARIANT,
                TITLE STRING,
                NOTE_TEXT STRING,
                SOURCE_LABEL STRING,
                AUTHOR_NAME STRING,
                TAGS VARIANT,
                ATTRIBUTES VARIANT,
                STATUS STRING DEFAULT 'active',
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._client_sql_assets_table} (
                SQL_ASSET_ID STRING,
                PROJECT_ID STRING,
                ENTITY_TYPE STRING,
                ENTITY_IDS VARIANT,
                TITLE STRING,
                SQL_TEXT STRING,
                SQL_KIND STRING DEFAULT 'historical_mapping',
                DIALECT STRING DEFAULT 'snowflake',
                DESCRIPTION STRING,
                SOURCE_LABEL STRING,
                AUTHOR_NAME STRING,
                TAGS VARIANT,
                ATTRIBUTES VARIANT,
                STATUS STRING DEFAULT 'active',
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._fir_events_table} (
                EVENT_ID STRING,
                EVENT_TYPE STRING,
                USER_ID STRING,
                SESSION_ID STRING,
                REQUEST_ID STRING,
                PAGE STRING,
                SURFACE STRING,
                ENTITY_TYPE STRING,
                ENTITY_IDS VARIANT,
                EVENT_PAYLOAD VARIANT,
                CONTEXT_KEY STRING,
                SNAPSHOT_ID STRING,
                MILESTONE STRING,
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._fir_feature_snapshots_table} (
                FEATURE_KEY STRING,
                USER_ID STRING,
                SESSION_ID STRING,
                PAGE STRING,
                SURFACE STRING,
                ENTITY_TYPE STRING,
                ENTITY_IDS VARIANT,
                FEATURES VARIANT,
                MODEL_TARGETS VARIANT,
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._mapping_intents_table} (
                INTENT_ID STRING,
                CONTEXT_KEY STRING,
                USER_ID STRING,
                SESSION_ID STRING,
                TARGET_TABLE STRING,
                SOURCE_TABLES VARIANT,
                BUSINESS_GOAL STRING,
                LIFECYCLE STRING,
                TARGET_OUTCOME STRING,
                DOMAIN_HINTS VARIANT,
                SOURCE STRING,
                CONFIDENCE FLOAT,
                ATTRIBUTES VARIANT,
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._semantic_learnings_table} (
                LEARNING_ID STRING,
                LEARNING_KEY STRING,
                USER_ID STRING,
                ENTITY_TYPE STRING,
                ENTITY_IDS VARIANT,
                LEARNING_TYPE STRING,
                SUMMARY STRING,
                CONFIDENCE FLOAT,
                SOURCE STRING,
                ATTRIBUTES VARIANT,
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._fir_model_scores_table} (
                SCORE_ID STRING,
                MODEL_NAME STRING,
                MODEL_VERSION STRING,
                CONTEXT_KEY STRING,
                ENTITY_TYPE STRING,
                ENTITY_ID STRING,
                PAGE STRING,
                SURFACE STRING,
                FEEDBACK_NEEDED_PROBABILITY FLOAT,
                RECOMMENDATION_HELPFULNESS_PROBABILITY FLOAT,
                RECOMMENDATION_TYPE STRING,
                RECOMMENDATION_PRIORITY FLOAT,
                SCORE_PAYLOAD VARIANT,
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._fir_templates_table} (
                TEMPLATE_ID STRING,
                TEMPLATE_TYPE STRING,
                SOURCE_EVENT_TYPE STRING,
                ENTITY_TYPE STRING,
                NAME STRING,
                DESCRIPTION STRING,
                EXTRACTION_SCHEMA VARIANT,
                PROMPT_GUIDANCE STRING,
                RECOMMENDATION_RULES VARIANT,
                STATUS STRING DEFAULT 'active',
                VERSION STRING DEFAULT '1.0',
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._workspace_snapshots_table} (
                SNAPSHOT_ID STRING,
                SESSION_ID STRING,
                THREAD_ID STRING,
                CONTEXT_VERSION STRING DEFAULT '2.0',
                CONTEXT_HASH STRING,
                CONTEXT_KEY STRING,
                ACTION STRING,
                MILESTONE STRING,
                PAGE STRING,
                SURFACE STRING,
                PROJECT_ID STRING,
                STTM_ID STRING,
                SEMANTIC_BUNDLE_ID STRING,
                SEMANTIC_BUNDLE_HASH STRING,
                MAPPING_VERSION STRING,
                SNAPSHOT_PAYLOAD VARIANT,
                RAW_MAPPING_SQL TEXT,
                PARSED_MAPPING_MODEL VARIANT,
                RUNTIME_SUPPRESSED BOOLEAN DEFAULT FALSE,
                USER_ID STRING,
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._agent_artifacts_table} (
                ARTIFACT_ID STRING,
                REQUEST_ID STRING,
                SESSION_ID STRING,
                THREAD_ID STRING,
                AGENT_NAME STRING,
                ARTIFACT_TYPE STRING,
                ARTIFACT_STATUS STRING DEFAULT 'draft',
                ENTITY_TYPE STRING,
                ENTITY_IDS VARIANT,
                CONTEXT_KEY STRING,
                SNAPSHOT_ID STRING,
                SEMANTIC_BUNDLE_ID STRING,
                SEMANTIC_BUNDLE_HASH STRING,
                RETRIEVED_INFERENCE_IDS VARIANT,
                RETRIEVED_RECOMMENDATION_IDS VARIANT,
                USED_INFERENCE_IDS VARIANT,
                USED_RECOMMENDATION_IDS VARIANT,
                PAYLOAD VARIANT,
                SUMMARY STRING,
                CREATED_BY STRING,
                LOGICAL_CONVERSATION_ID STRING,
                THREAD_SEGMENT NUMBER,
                PROJECT_ID STRING,
                MAPPING_ID STRING,
                MIME_TYPE STRING,
                CONTENT_HASH STRING,
                STAGE_PATH STRING,
                ORIGINAL_SIZE_BYTES NUMBER,
                COMPRESSED_SIZE_BYTES NUMBER,
                SOURCE_ARTIFACT_IDS VARIANT,
                ACCESS_FINGERPRINT STRING,
                SEARCH_KEYWORDS VARIANT,
                RETENTION_UNTIL TIMESTAMP_NTZ,
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._conversation_segments_table} (
                SEGMENT_ID STRING,
                LOGICAL_CONVERSATION_ID STRING,
                PHYSICAL_THREAD_ID STRING,
                SEGMENT_NUMBER NUMBER,
                PREVIOUS_SEGMENT_ID STRING,
                NEXT_SEGMENT_ID STRING,
                ROLLOVER_REASON STRING,
                ESTIMATED_CONTEXT_TOKENS NUMBER DEFAULT 0,
                TURN_COUNT NUMBER DEFAULT 0,
                CHECKPOINT_ARTIFACT_ID STRING,
                SEMANTIC_BUNDLE_HASH STRING,
                LEARNING_CONTEXT_HASH STRING,
                STATUS STRING DEFAULT 'ACTIVE',
                USER_ID STRING,
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
                CLOSED_AT TIMESTAMP_NTZ
            )
            """,
        ]
        for statement in statements:
            self._session.sql(statement).collect()
        # CREATE TABLE IF NOT EXISTS does not evolve tables created by an
        # earlier release. Keep local/non-caller-rights runtimes compatible
        # with the additive artifact and logical-conversation contracts.
        artifact_columns = (
            ("LOGICAL_CONVERSATION_ID", "STRING"),
            ("THREAD_SEGMENT", "NUMBER"),
            ("PROJECT_ID", "STRING"),
            ("MAPPING_ID", "STRING"),
            ("MIME_TYPE", "STRING"),
            ("CONTENT_HASH", "STRING"),
            ("STAGE_PATH", "STRING"),
            ("ORIGINAL_SIZE_BYTES", "NUMBER"),
            ("COMPRESSED_SIZE_BYTES", "NUMBER"),
            ("SOURCE_ARTIFACT_IDS", "VARIANT"),
            ("ACCESS_FINGERPRINT", "STRING"),
            ("SEARCH_KEYWORDS", "VARIANT"),
            ("RETENTION_UNTIL", "TIMESTAMP_NTZ"),
            ("UPDATED_AT", "TIMESTAMP_NTZ"),
        )
        for column_name, column_type in artifact_columns:
            self._session.sql(
                f"ALTER TABLE {self._agent_artifacts_table} "
                f"ADD COLUMN IF NOT EXISTS {column_name} {column_type}"
            ).collect()
        self._ensured_storage_keys.add(storage_key)

    def record_turn(
        self,
        *,
        conversation_id: str,
        request_id: str | None,
        trace_id: str | None,
        role: str,
        route: str,
        intent_class: str,
        message: str | None,
        citations: list[EvidenceCitation],
        guardrails_meta: dict[str, Any],
        user_id: str | None,
    ) -> str:
        self.ensure_storage_exists()
        if (
            not self._settings.conversation_memory_v2
            or (not request_id and not trace_id)
        ):
            turn_id = f"turn_{uuid.uuid4().hex[:16]}"
        else:
            identity = "\x1f".join(
                (conversation_id, request_id or "", role, trace_id or "", route)
            )
            turn_id = f"turn_{hashlib.sha256(identity.encode('utf-8')).hexdigest()[:24]}"
        increment("conversation.turn.attempted", role=role, route=route)
        citations_json = json.dumps(
            [item.model_dump(mode="json") for item in citations],
            default=str,
        )
        guardrails_json = json.dumps(guardrails_meta, default=str)
        statement = (
            f"""
            MERGE INTO {self._turns_table} target
            USING (
                SELECT ? AS TURN_ID, ? AS CONVERSATION_ID, ? AS REQUEST_ID,
                       ? AS TRACE_ID, ? AS ROLE, ? AS ROUTE, ? AS INTENT_CLASS,
                       ? AS MESSAGE, PARSE_JSON(?) AS CITATIONS,
                       PARSE_JSON(?) AS GUARDRAILS_META, ? AS USER_ID
            ) source
            ON target.TURN_ID = source.TURN_ID
            WHEN NOT MATCHED THEN INSERT (
                TURN_ID, CONVERSATION_ID, REQUEST_ID, TRACE_ID, ROLE, ROUTE,
                INTENT_CLASS, MESSAGE, CITATIONS, GUARDRAILS_META, USER_ID
            ) VALUES (
                source.TURN_ID, source.CONVERSATION_ID, source.REQUEST_ID,
                source.TRACE_ID, source.ROLE, source.ROUTE, source.INTENT_CLASS,
                source.MESSAGE, source.CITATIONS, source.GUARDRAILS_META, source.USER_ID
            )
            """
        )
        params = [
            turn_id,
            conversation_id,
            request_id or "",
            trace_id or "",
            role,
            route,
            intent_class,
            message or "",
            citations_json,
            guardrails_json,
            user_id or "",
        ]
        try:
            self._session.sql(statement, params=params).collect()
            increment("conversation.turn.persisted", role=role, route=route)
        except Exception:
            increment("conversation.turn.failed", role=role, route=route)
            logger.exception(
                "Conversation turn persistence failed conversation=%s request=%s role=%s caller_rights=%s",
                conversation_id,
                request_id,
                role,
                self._settings.spcs_execute_as_caller_enabled,
            )
            raise
        return turn_id

    def load_recent_turns(
        self,
        logical_conversation_id: str,
        *,
        limit: int,
        user_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return durable recent turns in chronological order."""

        self.ensure_storage_exists()
        user_predicate = (
            f"AND COALESCE(USER_ID, '') = {self._quote_literal(user_id)}"
            if user_id
            else ""
        )
        rows = self._session.sql(
            f"""
            SELECT ROLE, MESSAGE, REQUEST_ID, TRACE_ID, CREATED_AT
            FROM {self._turns_table}
            WHERE CONVERSATION_ID = {self._quote_literal(logical_conversation_id)}
              {user_predicate}
            ORDER BY CREATED_AT DESC
            LIMIT {max(1, int(limit))}
            """
        ).collect()
        normalized: list[dict[str, Any]] = []
        for row in reversed(rows):
            data = row.as_dict() if hasattr(row, "as_dict") else dict(row)
            normalized.append(
                {
                    "role": str(data.get("ROLE") or data.get("role") or "user").lower(),
                    "content": str(data.get("MESSAGE") or data.get("message") or ""),
                    "request_id": data.get("REQUEST_ID") or data.get("request_id"),
                    "trace_id": data.get("TRACE_ID") or data.get("trace_id"),
                }
            )
        return normalized

    def load_active_conversation_segment(
        self,
        logical_conversation_id: str,
        *,
        user_id: str | None = None,
    ) -> dict[str, Any] | None:
        self.ensure_storage_exists()
        user_predicate = (
            f"AND COALESCE(USER_ID, '') = {self._quote_literal(user_id)}"
            if user_id
            else ""
        )
        rows = self._session.sql(
            f"""
            SELECT *
            FROM {self._conversation_segments_table}
            WHERE LOGICAL_CONVERSATION_ID =
                {self._quote_literal(logical_conversation_id)}
              AND STATUS = 'ACTIVE'
              {user_predicate}
            ORDER BY SEGMENT_NUMBER DESC
            LIMIT 1
            """
        ).collect()
        if not rows:
            return None
        row = rows[0]
        return row.as_dict() if hasattr(row, "as_dict") else dict(row)

    def load_conversation_segment_by_thread(
        self,
        physical_thread_id: str,
        *,
        user_id: str | None = None,
    ) -> dict[str, Any] | None:
        """Resolve a legacy physical thread handle to its logical conversation."""

        self.ensure_storage_exists()
        user_predicate = (
            f"AND COALESCE(USER_ID, '') = {self._quote_literal(user_id)}"
            if user_id
            else ""
        )
        rows = self._session.sql(
            f"""
            SELECT *
            FROM {self._conversation_segments_table}
            WHERE PHYSICAL_THREAD_ID = {self._quote_literal(physical_thread_id)}
              {user_predicate}
            ORDER BY SEGMENT_NUMBER DESC
            LIMIT 1
            """
        ).collect()
        if not rows:
            return None
        row = rows[0]
        return row.as_dict() if hasattr(row, "as_dict") else dict(row)

    def create_conversation_segment(
        self,
        *,
        logical_conversation_id: str,
        physical_thread_id: str | None,
        segment_number: int,
        previous_segment_id: str | None,
        rollover_reason: str | None,
        checkpoint_artifact_id: str | None,
        semantic_bundle_hash: str | None,
        learning_context_hash: str | None,
        user_id: str | None,
    ) -> str:
        self.ensure_storage_exists()
        segment_id = f"segment_{uuid.uuid4().hex[:20]}"
        self._session.sql(
            f"""
            INSERT INTO {self._conversation_segments_table} (
                SEGMENT_ID, LOGICAL_CONVERSATION_ID, PHYSICAL_THREAD_ID,
                SEGMENT_NUMBER, PREVIOUS_SEGMENT_ID, ROLLOVER_REASON,
                CHECKPOINT_ARTIFACT_ID, ESTIMATED_CONTEXT_TOKENS, TURN_COUNT,
                SEMANTIC_BUNDLE_HASH, LEARNING_CONTEXT_HASH, STATUS, USER_ID
            )
            SELECT
                {self._quote_literal(segment_id)},
                {self._quote_literal(logical_conversation_id)},
                {self._quote_literal(physical_thread_id or "")},
                {max(1, int(segment_number))},
                {self._quote_literal(previous_segment_id or "")},
                {self._quote_literal(rollover_reason or "")},
                {self._quote_literal(checkpoint_artifact_id or "")},
                0,
                0,
                {self._quote_literal(semantic_bundle_hash or "")},
                {self._quote_literal(learning_context_hash or "")},
                'ACTIVE',
                {self._quote_literal(user_id or "")}
            """
        ).collect()
        return segment_id

    def close_conversation_segment(
        self,
        segment_id: str,
        *,
        rollover_reason: str,
        next_segment_id: str | None = None,
    ) -> None:
        self.ensure_storage_exists()
        self._session.sql(
            f"""
            UPDATE {self._conversation_segments_table}
            SET STATUS = 'CLOSED',
                ROLLOVER_REASON = {self._quote_literal(rollover_reason)},
                NEXT_SEGMENT_ID = {self._quote_literal(next_segment_id or "")},
                CLOSED_AT = CURRENT_TIMESTAMP()
            WHERE SEGMENT_ID = {self._quote_literal(segment_id)}
            """
        ).collect()

    def bind_conversation_thread(
        self,
        segment_id: str,
        physical_thread_id: str,
    ) -> None:
        self.ensure_storage_exists()
        self._session.sql(
            f"""
            UPDATE {self._conversation_segments_table}
            SET PHYSICAL_THREAD_ID = {self._quote_literal(physical_thread_id)},
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE SEGMENT_ID = {self._quote_literal(segment_id)}
            """
        ).collect()

    def note_conversation_segment_usage(
        self,
        segment_id: str,
        *,
        added_tokens: int,
        added_turns: int = 1,
    ) -> None:
        self.ensure_storage_exists()
        self._session.sql(
            f"""
            UPDATE {self._conversation_segments_table}
            SET ESTIMATED_CONTEXT_TOKENS =
                    COALESCE(ESTIMATED_CONTEXT_TOKENS, 0) + {max(0, int(added_tokens))},
                TURN_COUNT = COALESCE(TURN_COUNT, 0) + {max(0, int(added_turns))},
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE SEGMENT_ID = {self._quote_literal(segment_id)}
            """
        ).collect()

    def record_feedback(
        self,
        *,
        request_id: str | None,
        conversation_id: str,
        feedback: FeedbackInput,
        user_id: str | None,
    ) -> str:
        self.ensure_storage_exists()
        feedback_id = f"feedback_{uuid.uuid4().hex[:16]}"
        self._session.sql(
            f"""
            INSERT INTO {self._feedback_table} (
                FEEDBACK_ID, REQUEST_ID, TARGET_REQUEST_ID, CONVERSATION_ID, SIGNAL_ID,
                FEEDBACK_TYPE, CATEGORY, OPTION_SELECTED, RATING, COMMENT, ENTITY_TYPE,
                ENTITY_ID, SELECTION_CONTEXT, USER_ID
                , CONTEXT_KEY, QUESTION_ID, INFERENCE_ID, AGENT_RECOMMENDATION_ID,
                  SNAPSHOT_ID, CORRECTION_PAYLOAD
            )
            SELECT
                {self._quote_literal(feedback_id)},
                {self._quote_literal(request_id or "")},
                {self._quote_literal(feedback.target_request_id or "")},
                {self._quote_literal(conversation_id)},
                {self._quote_literal(feedback.signal_id or "")},
                {self._quote_literal(feedback.feedback_type)},
                {self._quote_literal(feedback.category)},
                {self._quote_literal(feedback.option_selected or "")},
                {str(feedback.rating) if feedback.rating is not None else 'NULL'},
                {self._quote_literal(feedback.comment or "")},
                {self._quote_literal(feedback.entity_type or "")},
                {self._quote_literal(feedback.entity_id or "")},
                PARSE_JSON({self._json_literal(feedback.selection_context or {})}),
                {self._quote_literal(user_id or "")},
                {self._quote_literal(feedback.context_key or "")},
                {self._quote_literal(feedback.question_id or "")},
                {self._quote_literal(feedback.inference_id or "")},
                {self._quote_literal(feedback.agent_recommendation_id or "")},
                {self._quote_literal(feedback.snapshot_id or "")},
                PARSE_JSON({self._json_literal(feedback.correction_payload or {})})
            """
        ).collect()
        return feedback_id

    def record_fir_recommendation_outcome(
        self,
        *,
        recommendation_id: str,
        outcome_type: str,
        context_key: str | None = None,
        snapshot_id: str | None = None,
        request_id: str | None = None,
        artifact_id: str | None = None,
        user_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> str:
        idempotency_key = str(request_id or "").strip()
        outcome_id = (
            "outcome_"
            + hashlib.sha256(
                f"{recommendation_id}:{outcome_type}:{idempotency_key}".encode(
                    "utf-8"
                )
            ).hexdigest()[:20]
            if idempotency_key
            else f"outcome_{uuid.uuid4().hex[:20]}"
        )
        table = self._qualified_name("TBL_FIR_RECOMMENDATION_OUTCOMES")
        source = f"""
            SELECT
                {self._quote_literal(outcome_id)} AS OUTCOME_ID,
                {self._quote_literal(recommendation_id)} AS AGENT_RECOMMENDATION_ID,
                {self._quote_literal(context_key or "")} AS CONTEXT_KEY,
                {self._quote_literal(snapshot_id or "")} AS SNAPSHOT_ID,
                {self._quote_literal(idempotency_key)} AS REQUEST_ID,
                {self._quote_literal(artifact_id or "")} AS ARTIFACT_ID,
                {self._quote_literal(user_id or "")} AS USER_ID,
                {self._quote_literal(outcome_type)} AS OUTCOME_TYPE,
                PARSE_JSON({self._json_literal(payload or {})}) AS OUTCOME_PAYLOAD
        """
        if idempotency_key:
            statement = f"""
                MERGE INTO {table} target
                USING ({source}) source
                ON target.AGENT_RECOMMENDATION_ID = source.AGENT_RECOMMENDATION_ID
                   AND target.OUTCOME_TYPE = source.OUTCOME_TYPE
                   AND target.REQUEST_ID = source.REQUEST_ID
                WHEN NOT MATCHED THEN INSERT (
                    OUTCOME_ID, AGENT_RECOMMENDATION_ID, CONTEXT_KEY, SNAPSHOT_ID,
                    REQUEST_ID, ARTIFACT_ID, USER_ID, OUTCOME_TYPE, OUTCOME_PAYLOAD
                ) VALUES (
                    source.OUTCOME_ID, source.AGENT_RECOMMENDATION_ID,
                    source.CONTEXT_KEY, source.SNAPSHOT_ID, source.REQUEST_ID,
                    source.ARTIFACT_ID, source.USER_ID, source.OUTCOME_TYPE,
                    source.OUTCOME_PAYLOAD
                )
            """
        else:
            statement = f"""
                INSERT INTO {table} (
                    OUTCOME_ID, AGENT_RECOMMENDATION_ID, CONTEXT_KEY, SNAPSHOT_ID,
                    REQUEST_ID, ARTIFACT_ID, USER_ID, OUTCOME_TYPE, OUTCOME_PAYLOAD
                )
                {source}
            """
        self._session.sql(statement).collect()
        if outcome_type in {"used", "accepted", "corrected", "rejected", "validated", "published"}:
            recommendation_table = self._qualified_name("TBL_FIR_AGENT_RECOMMENDATIONS")
            self._session.sql(f"""
                UPDATE {recommendation_table}
                SET USAGE_COUNT = (
                        SELECT COUNT(*)
                        FROM {table} o
                        WHERE o.AGENT_RECOMMENDATION_ID =
                              {self._quote_literal(recommendation_id)}
                          AND o.OUTCOME_TYPE IN (
                              'used', 'accepted', 'corrected', 'rejected',
                              'validated', 'published'
                          )
                    ),
                    SUCCESS_COUNT = (
                        SELECT COUNT(*)
                        FROM {table} o
                        WHERE o.AGENT_RECOMMENDATION_ID =
                              {self._quote_literal(recommendation_id)}
                          AND o.OUTCOME_TYPE IN (
                              'accepted', 'validated', 'published'
                          )
                    ),
                    LAST_USED_AT = CURRENT_TIMESTAMP(),
                    UPDATED_AT = CURRENT_TIMESTAMP(),
                    STATUS = IFF(
                        {self._quote_literal(outcome_type)}
                            IN ('rejected', 'corrected'),
                        'inactive',
                        STATUS
                    )
                WHERE AGENT_RECOMMENDATION_ID = {self._quote_literal(recommendation_id)}
            """).collect()
        return outcome_id

    def record_fir_recommendation_outcomes_batch(
        self,
        outcomes: list[dict[str, Any]],
    ) -> list[str]:
        """Record background recommendation impressions in one Snowflake statement."""
        if not outcomes:
            return []
        table = self._qualified_name("TBL_FIR_RECOMMENDATION_OUTCOMES")
        outcome_ids: list[str] = []
        rows: list[str] = []
        for outcome in outcomes:
            outcome_id = f"outcome_{uuid.uuid4().hex[:20]}"
            outcome_ids.append(outcome_id)
            rows.append(
                "SELECT "
                f"{self._quote_literal(outcome_id)}, "
                f"{self._quote_literal(str(outcome.get('recommendation_id') or ''))}, "
                f"{self._quote_literal(str(outcome.get('context_key') or ''))}, "
                f"{self._quote_literal(str(outcome.get('snapshot_id') or ''))}, "
                f"{self._quote_literal(str(outcome.get('request_id') or ''))}, "
                f"{self._quote_literal(str(outcome.get('artifact_id') or ''))}, "
                f"{self._quote_literal(str(outcome.get('user_id') or ''))}, "
                "'shown', "
                f"PARSE_JSON({self._json_literal(outcome.get('payload') or {})})"
            )
        self._session.sql(
            f"""
            INSERT INTO {table} (
                OUTCOME_ID, AGENT_RECOMMENDATION_ID, CONTEXT_KEY, SNAPSHOT_ID,
                REQUEST_ID, ARTIFACT_ID, USER_ID, OUTCOME_TYPE, OUTCOME_PAYLOAD
            )
            {" UNION ALL ".join(rows)}
            """
        ).collect()
        return outcome_ids

    def record_recommendation(
        self,
        *,
        request_id: str | None,
        conversation_id: str,
        signal_id: str | None,
        recommendation_type: str,
        message: str | None,
        citations: list[EvidenceCitation],
        entity_type: str | None,
        entity_ids: list[str] | None,
        confidence: float | None,
        attributes: dict[str, Any] | None,
        approval_required: bool,
        status: str,
        user_id: str | None,
    ) -> str:
        self.ensure_storage_exists()
        recommendation_key = "|".join(
            [
                signal_id or "",
                recommendation_type,
                message or "",
                entity_type or "",
                ",".join(entity_ids or []),
            ]
        )
        recommendation_id = f"recommendation_{uuid.uuid5(uuid.NAMESPACE_DNS, recommendation_key).hex[:16]}"
        self._session.sql(
            f"""
            MERGE INTO {self._recommendations_table} AS target
            USING (
                SELECT
                    {self._quote_literal(recommendation_id)} AS RECOMMENDATION_ID,
                    {self._quote_literal(request_id or "")} AS REQUEST_ID,
                    {self._quote_literal(conversation_id)} AS CONVERSATION_ID,
                    {self._quote_literal(signal_id or "")} AS SIGNAL_ID,
                    {self._quote_literal(recommendation_type)} AS RECOMMENDATION_TYPE,
                    {self._quote_literal(message or "")} AS MESSAGE,
                    PARSE_JSON({self._json_literal([item.model_dump(mode="json") for item in citations])}) AS CITATIONS,
                    {self._quote_literal(entity_type or "")} AS ENTITY_TYPE,
                    PARSE_JSON({self._json_literal(entity_ids or [])}) AS ENTITY_IDS,
                    {str(confidence) if confidence is not None else 'NULL'} AS CONFIDENCE,
                    PARSE_JSON({self._json_literal(attributes or {})}) AS ATTRIBUTES,
                    {str(bool(approval_required)).upper()} AS APPROVAL_REQUIRED,
                    {self._quote_literal(status)} AS STATUS,
                    {self._quote_literal(user_id or "")} AS USER_ID
            ) AS source
            ON target.RECOMMENDATION_ID = source.RECOMMENDATION_ID
            WHEN MATCHED THEN UPDATE SET
                REQUEST_ID = source.REQUEST_ID,
                CONVERSATION_ID = source.CONVERSATION_ID,
                SIGNAL_ID = source.SIGNAL_ID,
                RECOMMENDATION_TYPE = source.RECOMMENDATION_TYPE,
                MESSAGE = source.MESSAGE,
                CITATIONS = source.CITATIONS,
                ENTITY_TYPE = source.ENTITY_TYPE,
                ENTITY_IDS = source.ENTITY_IDS,
                CONFIDENCE = source.CONFIDENCE,
                ATTRIBUTES = source.ATTRIBUTES,
                APPROVAL_REQUIRED = source.APPROVAL_REQUIRED,
                STATUS = source.STATUS,
                USER_ID = source.USER_ID,
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
                RECOMMENDATION_ID, REQUEST_ID, CONVERSATION_ID, SIGNAL_ID, RECOMMENDATION_TYPE,
                MESSAGE, CITATIONS, ENTITY_TYPE, ENTITY_IDS, CONFIDENCE, ATTRIBUTES,
                APPROVAL_REQUIRED, STATUS, USER_ID
            ) VALUES (
                source.RECOMMENDATION_ID, source.REQUEST_ID, source.CONVERSATION_ID, source.SIGNAL_ID, source.RECOMMENDATION_TYPE,
                source.MESSAGE, source.CITATIONS, source.ENTITY_TYPE, source.ENTITY_IDS, source.CONFIDENCE, source.ATTRIBUTES,
                source.APPROVAL_REQUIRED, source.STATUS, source.USER_ID
            )
            """
        ).collect()
        return recommendation_id

    def get_assistant_settings(self, *, user_id: str | None) -> AssistantPreferenceState:
        self.ensure_storage_exists()
        if not user_id:
            return AssistantPreferenceState()
        rows = self._session.sql(
            f"""
            SELECT FEEDBACK_ENABLED, RECOMMENDATIONS_ENABLED
            FROM {self._assistant_settings_table}
            WHERE USER_ID = {self._quote_literal(user_id)}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY USER_ID ORDER BY UPDATED_AT DESC) = 1
            """
        ).collect()
        if not rows:
            return AssistantPreferenceState()
        data = rows[0].as_dict()
        return AssistantPreferenceState(
            feedback_enabled=bool(data.get("FEEDBACK_ENABLED", True)),
            recommendations_enabled=bool(data.get("RECOMMENDATIONS_ENABLED", True)),
        )

    def save_assistant_settings(
        self,
        *,
        user_id: str | None,
        settings: AssistantPreferenceState,
    ) -> AssistantPreferenceState:
        self.ensure_storage_exists()
        if not user_id:
            return settings
        self._session.sql(
            f"""
            MERGE INTO {self._assistant_settings_table} AS target
            USING (
                SELECT
                    {self._quote_literal(user_id)} AS USER_ID,
                    {str(settings.feedback_enabled).upper()} AS FEEDBACK_ENABLED,
                    {str(settings.recommendations_enabled).upper()} AS RECOMMENDATIONS_ENABLED
            ) AS source
            ON target.USER_ID = source.USER_ID
            WHEN MATCHED THEN UPDATE SET
                FEEDBACK_ENABLED = source.FEEDBACK_ENABLED,
                RECOMMENDATIONS_ENABLED = source.RECOMMENDATIONS_ENABLED,
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
                USER_ID, FEEDBACK_ENABLED, RECOMMENDATIONS_ENABLED
            ) VALUES (
                source.USER_ID, source.FEEDBACK_ENABLED, source.RECOMMENDATIONS_ENABLED
            )
            """
        ).collect()
        return settings

    @staticmethod
    def build_context_key(
        *,
        source_tables: list[str] | None,
        target_table: str | None,
        page: str | None,
        surface: str | None,
        selected_derived_sources: list[str] | None = None,
    ) -> str:
        normalized_sources = sorted(str(item).strip().upper() for item in (source_tables or []) if str(item).strip())
        normalized_derived = sorted(str(item).strip() for item in (selected_derived_sources or []) if str(item).strip())
        return "|".join(
            [
                (page or "builder").strip().lower(),
                (surface or "SOURCE_SELECTION").strip().upper(),
                ",".join(normalized_sources),
                (target_table or "").strip().upper(),
                ",".join(normalized_derived),
            ]
        )

    def record_fir_event(
        self,
        *,
        event_type: str,
        user_id: str | None,
        session_id: str | None,
        request_id: str | None,
        page: str | None,
        surface: str | None,
        entity_type: str | None,
        entity_ids: list[str] | None,
        event_payload: dict[str, Any] | None,
        context_key: str | None = None,
        snapshot_id: str | None = None,
        milestone: str | None = None,
    ) -> str:
        self.ensure_storage_exists()
        idempotency_key = str(request_id or "").strip()
        event_id = (
            "event_"
            + hashlib.sha256(
                f"{event_type}:{idempotency_key}".encode("utf-8")
            ).hexdigest()[:20]
            if idempotency_key
            else f"event_{uuid.uuid4().hex[:20]}"
        )
        source_select = f"""
            SELECT
                {self._quote_literal(event_id)} AS EVENT_ID,
                {self._quote_literal(event_type)} AS EVENT_TYPE,
                {self._quote_literal(user_id or "")} AS USER_ID,
                {self._quote_literal(session_id or "")} AS SESSION_ID,
                {self._quote_literal(idempotency_key)} AS REQUEST_ID,
                {self._quote_literal(page or "")} AS PAGE,
                {self._quote_literal(surface or "")} AS SURFACE,
                {self._quote_literal(entity_type or "")} AS ENTITY_TYPE,
                PARSE_JSON({self._json_literal(entity_ids or [])}) AS ENTITY_IDS,
                PARSE_JSON({self._json_literal(event_payload or {})}) AS EVENT_PAYLOAD,
                {self._quote_literal(context_key or "")} AS CONTEXT_KEY,
                {self._quote_literal(snapshot_id or "")} AS SNAPSHOT_ID,
                {self._quote_literal(milestone or "")} AS MILESTONE
        """
        if idempotency_key:
            statement = f"""
                MERGE INTO {self._fir_events_table} target
                USING ({source_select}) source
                ON target.EVENT_TYPE = source.EVENT_TYPE
                   AND target.REQUEST_ID = source.REQUEST_ID
                WHEN NOT MATCHED THEN INSERT (
                    EVENT_ID, EVENT_TYPE, USER_ID, SESSION_ID, REQUEST_ID, PAGE,
                    SURFACE, ENTITY_TYPE, ENTITY_IDS, EVENT_PAYLOAD, CONTEXT_KEY,
                    SNAPSHOT_ID, MILESTONE
                ) VALUES (
                    source.EVENT_ID, source.EVENT_TYPE, source.USER_ID,
                    source.SESSION_ID, source.REQUEST_ID, source.PAGE,
                    source.SURFACE, source.ENTITY_TYPE, source.ENTITY_IDS,
                    source.EVENT_PAYLOAD, source.CONTEXT_KEY,
                    source.SNAPSHOT_ID, source.MILESTONE
                )
            """
        else:
            statement = f"""
                INSERT INTO {self._fir_events_table} (
                    EVENT_ID, EVENT_TYPE, USER_ID, SESSION_ID, REQUEST_ID, PAGE,
                    SURFACE, ENTITY_TYPE, ENTITY_IDS, EVENT_PAYLOAD, CONTEXT_KEY,
                    SNAPSHOT_ID, MILESTONE
                )
                {source_select}
            """
        self._session.sql(statement).collect()
        return event_id

    def process_fir_event_with_templates(
        self,
        *,
        event_type: str,
        event_payload: dict[str, Any],
        context: dict[str, Any],
        user_id: str | None = None,
        request_id: str | None = None,
        conversation_id: str | None = None,
        llm_client: Any = None,
    ) -> list[dict[str, Any]]:
        """Process a FIR event using template-driven extraction.

        This method:
        1. Loads active templates matching the event type
        2. For each template:
           - Extracts required and derived fields
           - Optionally runs LLM extraction for semantic fields
           - Generates an inference record
           - Applies recommendation rules
        3. Stores the generated inferences
        4. Returns the list of processed results

        Args:
            event_type: The type of event (e.g., 'mapping.accept', 'conversation.feedback')
            event_payload: The event data
            context: Context data (project_id, sttm_id, etc.)
            user_id: Optional user identifier
            request_id: Optional request identifier
            conversation_id: Optional conversation identifier
            llm_client: Optional LLM client for semantic extraction

        Returns:
            List of processing results with inference_id and any errors
        """
        from app.core.fir_template_engine import FIRTemplateEngine

        engine = FIRTemplateEngine(self._session, llm_client)
        templates = engine.load_templates(event_type)

        if not templates:
            logger.debug("No active templates found for event type: %s", event_type)
            return []

        results = []
        for template in templates:
            try:
                extraction = engine.extract_inference(event_payload, context, template)
                inference = engine.generate_inference_record(extraction, template)

                inference_id = self.record_inference(
                    inference_key=inference.inference_key,
                    request_id=request_id,
                    conversation_id=conversation_id,
                    source=f"template:{template.template_id}",
                    inference_type=inference.inference_type,
                    summary=inference.summary,
                    confidence=inference.confidence,
                    entity_type=inference.entity_type,
                    entity_ids=list(inference.entity_ids.values()) if inference.entity_ids else None,
                    attributes={
                        **inference.attributes,
                        "template_id": template.template_id,
                        "template_version": template.version,
                        "tags": inference.tags,
                    },
                    status="active",
                    user_id=user_id,
                )

                actions = engine.apply_recommendation_rules(extraction, inference, template)
                for action in actions:
                    self._execute_recommendation_action(action, context, user_id)

                engine.build_rag_document(extraction, inference, template)

                results.append({
                    "template_id": template.template_id,
                    "inference_id": inference_id,
                    "inference_type": inference.inference_type,
                    "confidence": inference.confidence,
                    "errors": extraction.errors,
                    "actions_applied": len(actions),
                })

            except Exception as e:
                logger.exception("Failed to process template %s for event %s", template.template_id, event_type)
                results.append({
                    "template_id": template.template_id,
                    "inference_id": None,
                    "error": str(e),
                })

        return results

    def _execute_recommendation_action(
        self,
        action: dict[str, Any],
        context: dict[str, Any],
        user_id: str | None,
    ) -> None:
        """Execute a recommendation action generated by a template rule.

        Actions are queued for async processing or executed inline based on type.
        """
        action_type = action.get("action_type")
        params = action.get("params", {})

        if action_type == "create_semantic_learning":
            self.upsert_semantic_learning(
                learning_key=f"learning_{uuid.uuid4().hex[:16]}",
                learning_type=params.get("learning_type", "template_generated"),
                summary=params.get("detail", "Auto-generated from template"),
                confidence=params.get("confidence", 0.7),
                entity_type=params.get("entity_type"),
                entity_ids=params.get("entity_ids"),
                attributes=params,
                status="active",
                user_id=user_id,
            )
        elif action_type == "create_global_semantic_learning":
            self.upsert_semantic_learning(
                learning_key=f"global_learning_{uuid.uuid4().hex[:16]}",
                learning_type=params.get("learning_type", "global_pattern"),
                summary=params.get("detail", "Global pattern from template"),
                confidence=params.get("confidence", 0.8),
                entity_type="global",
                entity_ids=None,
                attributes={**params, "scope": "global"},
                status="active",
                user_id=user_id,
            )
        elif action_type == "boost_similar_patterns":
            logger.info(
                "Boosting pattern %s by %s",
                params.get("pattern_key"),
                params.get("boost_amount", 0.1),
            )
        elif action_type == "penalize_pattern":
            logger.info(
                "Penalizing pattern %s by %s",
                params.get("pattern_key"),
                params.get("penalty_amount", 0.1),
            )
        elif action_type == "reinforce_pattern":
            logger.info("Reinforcing pattern with boost %s", params.get("boost_confidence", 0.05))
        elif action_type == "update_routing_hints":
            logger.info("Updating routing hints: %s", params)
        else:
            logger.debug("Unhandled recommendation action type: %s", action_type)

    def upsert_feature_snapshot(
        self,
        *,
        feature_key: str,
        user_id: str | None,
        session_id: str | None,
        page: str | None,
        surface: str | None,
        entity_type: str | None,
        entity_ids: list[str] | None,
        features: dict[str, Any],
        model_targets: dict[str, Any] | None = None,
    ) -> None:
        self.ensure_storage_exists()
        self._session.sql(
            f"""
            MERGE INTO {self._fir_feature_snapshots_table} AS target
            USING (
                SELECT
                    {self._quote_literal(feature_key)} AS FEATURE_KEY,
                    {self._quote_literal(user_id or "")} AS USER_ID,
                    {self._quote_literal(session_id or "")} AS SESSION_ID,
                    {self._quote_literal(page or "")} AS PAGE,
                    {self._quote_literal(surface or "")} AS SURFACE,
                    {self._quote_literal(entity_type or "")} AS ENTITY_TYPE,
                    PARSE_JSON({self._json_literal(entity_ids or [])}) AS ENTITY_IDS,
                    PARSE_JSON({self._json_literal(features)}) AS FEATURES,
                    PARSE_JSON({self._json_literal(model_targets or {})}) AS MODEL_TARGETS
            ) AS source
            ON target.FEATURE_KEY = source.FEATURE_KEY
            WHEN MATCHED THEN UPDATE SET
                USER_ID = source.USER_ID,
                SESSION_ID = source.SESSION_ID,
                PAGE = source.PAGE,
                SURFACE = source.SURFACE,
                ENTITY_TYPE = source.ENTITY_TYPE,
                ENTITY_IDS = source.ENTITY_IDS,
                FEATURES = source.FEATURES,
                MODEL_TARGETS = source.MODEL_TARGETS,
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
                FEATURE_KEY, USER_ID, SESSION_ID, PAGE, SURFACE, ENTITY_TYPE, ENTITY_IDS, FEATURES, MODEL_TARGETS
            ) VALUES (
                source.FEATURE_KEY, source.USER_ID, source.SESSION_ID, source.PAGE, source.SURFACE, source.ENTITY_TYPE, source.ENTITY_IDS, source.FEATURES, source.MODEL_TARGETS
            )
            """
        ).collect()

    def get_feature_snapshot(self, *, feature_key: str) -> dict[str, Any]:
        self.ensure_storage_exists()
        rows = self._session.sql(
            f"""
            SELECT FEATURES, MODEL_TARGETS
            FROM {self._fir_feature_snapshots_table}
            WHERE FEATURE_KEY = {self._quote_literal(feature_key)}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY FEATURE_KEY ORDER BY UPDATED_AT DESC) = 1
            """
        ).collect()
        if not rows:
            return {}
        row = rows[0].as_dict()
        return {
            "features": self._coerce_json_object(row.get("FEATURES")),
            "model_targets": self._coerce_json_object(row.get("MODEL_TARGETS")),
        }

    def upsert_fir_template(
        self,
        *,
        template_type: str,
        source_event_type: str,
        entity_type: str | None,
        name: str,
        extraction_schema: dict[str, Any],
        prompt_guidance: str | None = None,
        recommendation_rules: dict[str, Any] | None = None,
        description: str | None = None,
        version: str = "1.0",
        status: str = "active",
    ) -> str:
        self.ensure_storage_exists()
        template_key = "|".join([template_type, source_event_type, entity_type or "", name, version])
        template_id = f"template_{uuid.uuid5(uuid.NAMESPACE_DNS, template_key).hex[:20]}"
        self._session.sql(
            f"""
            MERGE INTO {self._fir_templates_table} AS target
            USING (
                SELECT
                    {self._quote_literal(template_id)} AS TEMPLATE_ID,
                    {self._quote_literal(template_type)} AS TEMPLATE_TYPE,
                    {self._quote_literal(source_event_type)} AS SOURCE_EVENT_TYPE,
                    {self._quote_literal(entity_type or "")} AS ENTITY_TYPE,
                    {self._quote_literal(name)} AS NAME,
                    {self._quote_literal(description or "")} AS DESCRIPTION,
                    PARSE_JSON({self._json_literal(extraction_schema)}) AS EXTRACTION_SCHEMA,
                    {self._quote_literal(prompt_guidance or "")} AS PROMPT_GUIDANCE,
                    PARSE_JSON({self._json_literal(recommendation_rules or {})}) AS RECOMMENDATION_RULES,
                    {self._quote_literal(status)} AS STATUS,
                    {self._quote_literal(version)} AS VERSION
            ) AS source
            ON target.TEMPLATE_ID = source.TEMPLATE_ID
            WHEN MATCHED THEN UPDATE SET
                TEMPLATE_TYPE = source.TEMPLATE_TYPE,
                SOURCE_EVENT_TYPE = source.SOURCE_EVENT_TYPE,
                ENTITY_TYPE = source.ENTITY_TYPE,
                NAME = source.NAME,
                DESCRIPTION = source.DESCRIPTION,
                EXTRACTION_SCHEMA = source.EXTRACTION_SCHEMA,
                PROMPT_GUIDANCE = source.PROMPT_GUIDANCE,
                RECOMMENDATION_RULES = source.RECOMMENDATION_RULES,
                STATUS = source.STATUS,
                VERSION = source.VERSION,
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
                TEMPLATE_ID, TEMPLATE_TYPE, SOURCE_EVENT_TYPE, ENTITY_TYPE, NAME, DESCRIPTION,
                EXTRACTION_SCHEMA, PROMPT_GUIDANCE, RECOMMENDATION_RULES, STATUS, VERSION
            ) VALUES (
                source.TEMPLATE_ID, source.TEMPLATE_TYPE, source.SOURCE_EVENT_TYPE, source.ENTITY_TYPE, source.NAME, source.DESCRIPTION,
                source.EXTRACTION_SCHEMA, source.PROMPT_GUIDANCE, source.RECOMMENDATION_RULES, source.STATUS, source.VERSION
            )
            """
        ).collect()
        return template_id

    def save_workspace_snapshot(
        self,
        *,
        session_id: str | None,
        thread_id: str | None,
        context_hash: str,
        snapshot_payload: dict[str, Any],
        context_version: str = "2.0",
        context_key: str | None = None,
        action: str | None = None,
        milestone: str | None = None,
        page: str | None = None,
        surface: str | None = None,
        project_id: str | None = None,
        sttm_id: str | None = None,
        semantic_bundle_id: str | None = None,
        semantic_bundle_hash: str | None = None,
        mapping_version: str | None = None,
        user_id: str | None = None,
    ) -> str:
        self.ensure_storage_exists()
        snapshot_id = f"snapshot_{uuid.uuid4().hex[:20]}"
        snapshot_json = json.dumps(snapshot_payload, default=str, allow_nan=False)
        parsed_mapping_json = json.dumps(
            snapshot_payload.get("parsed_mapping_model") or {},
            default=str,
            allow_nan=False,
        )
        self._session.sql(
            f"""
            INSERT INTO {self._workspace_snapshots_table} (
                SNAPSHOT_ID, SESSION_ID, THREAD_ID, CONTEXT_VERSION, CONTEXT_HASH,
                CONTEXT_KEY, ACTION, MILESTONE, PAGE, SURFACE,
                PROJECT_ID, STTM_ID, SEMANTIC_BUNDLE_ID, SEMANTIC_BUNDLE_HASH, MAPPING_VERSION,
                SNAPSHOT_PAYLOAD, RAW_MAPPING_SQL, PARSED_MAPPING_MODEL,
                RUNTIME_SUPPRESSED, USER_ID
            )
            SELECT
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                PARSE_JSON(?), ?, PARSE_JSON(?),
                FALSE,
                ?
            """,
            params=[
                snapshot_id,
                session_id or "",
                thread_id or "",
                context_version or "2.0",
                context_hash,
                context_key or "",
                action or "",
                milestone or "",
                page or "",
                surface or "",
                project_id or "",
                sttm_id or "",
                semantic_bundle_id or "",
                semantic_bundle_hash or "",
                mapping_version or "",
                snapshot_json,
                str(
                    snapshot_payload.get("raw_mapping_sql")
                    or snapshot_payload.get("mapping_sql")
                    or ""
                ),
                parsed_mapping_json,
                user_id or "",
            ],
        ).collect()
        observe("workspace_snapshot.persisted_bytes", len(snapshot_json.encode("utf-8")))
        increment("workspace_snapshot.persisted")
        return snapshot_id

    @_serialize_artifact_writes
    def record_agent_artifact(
        self,
        *,
        request_id: str | None,
        session_id: str | None,
        thread_id: str | None,
        agent_name: str,
        artifact_type: str,
        payload: dict[str, Any],
        artifact_status: str = "draft",
        entity_type: str | None = None,
        entity_ids: list[str] | None = None,
        semantic_bundle_id: str | None = None,
        semantic_bundle_hash: str | None = None,
        summary: str | None = None,
        created_by: str | None = None,
        context_key: str | None = None,
        snapshot_id: str | None = None,
        retrieved_inference_ids: list[str] | None = None,
        retrieved_recommendation_ids: list[str] | None = None,
        used_inference_ids: list[str] | None = None,
        used_recommendation_ids: list[str] | None = None,
        logical_conversation_id: str | None = None,
        thread_segment: int | None = None,
        project_id: str | None = None,
        mapping_id: str | None = None,
        mime_type: str = "application/json",
        source_artifact_ids: list[str] | None = None,
        access_fingerprint: str | None = None,
        keywords: list[str] | None = None,
    ) -> str:
        self.ensure_storage_exists()
        normalized_payload = self._normalize_json_value(payload)
        serialized = json.dumps(
            normalized_payload,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
            allow_nan=False,
        ).encode("utf-8")
        content_hash = hashlib.sha256(serialized).hexdigest()
        owner_scope = access_fingerprint or created_by or ""
        existing = self._session.sql(
            f"""
            SELECT ARTIFACT_ID
            FROM {self._agent_artifacts_table}
            WHERE CONTENT_HASH = {self._quote_literal(content_hash)}
              AND COALESCE(ACCESS_FINGERPRINT, '') =
                  {self._quote_literal(owner_scope)}
            ORDER BY CREATED_AT DESC
            LIMIT 1
            """
        ).collect()
        if existing:
            row = existing[0]
            data = row.as_dict() if hasattr(row, "as_dict") else dict(row)
            return str(data.get("ARTIFACT_ID") or data.get("artifact_id"))

        artifact_id = f"artifact_{uuid.uuid4().hex[:20]}"
        stage_path = ""
        compressed_size = len(serialized)
        stored_payload: dict[str, Any] = normalized_payload
        inline_limit = max(0, int(self._settings.agent_inline_artifact_limit_bytes))
        if len(serialized) > inline_limit:
            caller_runtime = (
                self._settings.uses_custom_oauth
                and self._settings.spcs_execute_as_caller_enabled
            )
            if caller_runtime:
                stored_payload = self._bounded_inline_artifact_fallback(
                    artifact_id=artifact_id,
                    normalized_payload=normalized_payload,
                    serialized_size=len(serialized),
                    content_hash=content_hash,
                    mime_type=mime_type,
                    reason="stage_upload_disabled_for_caller_rights_runtime",
                )
                self._warn_artifact_stage_once(
                    "caller-rights",
                    "Agent artifact stage upload is disabled in caller-rights OAuth "
                    "sessions; using bounded inline persistence.",
                )
            else:
                local_path = ""
                try:
                    with tempfile.NamedTemporaryFile(
                        mode="wb",
                        suffix=".json.gz",
                        delete=False,
                    ) as handle:
                        local_path = handle.name
                        with gzip.GzipFile(fileobj=handle, mode="wb") as compressed:
                            compressed.write(serialized)
                    compressed_size = os.path.getsize(local_path)
                    destination = (
                        f"{self._agent_artifact_stage}/sha256/{content_hash[:2]}"
                    )
                    self._session.file.put(
                        f"file://{local_path}",
                        destination,
                        auto_compress=False,
                        overwrite=False,
                    )
                    stage_path = f"{destination}/{content_hash}.json.gz"
                    stored_payload = {
                        "artifact_ref": artifact_id,
                        "content_hash": content_hash,
                        "stage_path": stage_path,
                        "mime_type": mime_type,
                        "original_size": len(serialized),
                        "compressed_size": compressed_size,
                    }
                except Exception as exc:
                    stored_payload = self._bounded_inline_artifact_fallback(
                        artifact_id=artifact_id,
                        normalized_payload=normalized_payload,
                        serialized_size=len(serialized),
                        content_hash=content_hash,
                        mime_type=mime_type,
                        reason="stage_upload_failed",
                    )
                    self._warn_artifact_stage_once(
                        self._agent_artifact_stage,
                        f"Agent artifact stage upload failed; using bounded inline "
                        f"persistence: {exc}",
                    )
                finally:
                    if local_path:
                        try:
                            os.unlink(local_path)
                        except OSError:
                            logger.debug("Failed to remove temporary artifact file %s", local_path)

        self._session.sql(
            f"""
            INSERT INTO {self._agent_artifacts_table} (
                ARTIFACT_ID, REQUEST_ID, SESSION_ID, THREAD_ID, AGENT_NAME, ARTIFACT_TYPE,
                ARTIFACT_STATUS, ENTITY_TYPE, ENTITY_IDS, CONTEXT_KEY, SNAPSHOT_ID,
                SEMANTIC_BUNDLE_ID, SEMANTIC_BUNDLE_HASH, RETRIEVED_INFERENCE_IDS,
                RETRIEVED_RECOMMENDATION_IDS, USED_INFERENCE_IDS, USED_RECOMMENDATION_IDS,
                PAYLOAD, SUMMARY, CREATED_BY, LOGICAL_CONVERSATION_ID, THREAD_SEGMENT,
                PROJECT_ID, MAPPING_ID, MIME_TYPE, CONTENT_HASH, STAGE_PATH,
                ORIGINAL_SIZE_BYTES, COMPRESSED_SIZE_BYTES, SOURCE_ARTIFACT_IDS,
                ACCESS_FINGERPRINT, SEARCH_KEYWORDS, RETENTION_UNTIL
            )
            SELECT
                {self._quote_literal(artifact_id)},
                {self._quote_literal(request_id or "")},
                {self._quote_literal(session_id or "")},
                {self._quote_literal(thread_id or "")},
                {self._quote_literal(agent_name)},
                {self._quote_literal(artifact_type)},
                {self._quote_literal(artifact_status)},
                {self._quote_literal(entity_type or "")},
                PARSE_JSON({self._json_literal(entity_ids or [])}),
                {self._quote_literal(context_key or "")},
                {self._quote_literal(snapshot_id or "")},
                {self._quote_literal(semantic_bundle_id or "")},
                {self._quote_literal(semantic_bundle_hash or "")},
                PARSE_JSON({self._json_literal(retrieved_inference_ids or [])}),
                PARSE_JSON({self._json_literal(retrieved_recommendation_ids or [])}),
                PARSE_JSON({self._json_literal(used_inference_ids or [])}),
                PARSE_JSON({self._json_literal(used_recommendation_ids or [])}),
                PARSE_JSON({self._json_literal(stored_payload)}),
                {self._quote_literal(summary or "")},
                {self._quote_literal(created_by or "")},
                {self._quote_literal(logical_conversation_id or "")},
                {int(thread_segment or 0)},
                {self._quote_literal(project_id or "")},
                {self._quote_literal(mapping_id or "")},
                {self._quote_literal(mime_type)},
                {self._quote_literal(content_hash)},
                {self._quote_literal(stage_path)},
                {len(serialized)},
                {compressed_size},
                PARSE_JSON({self._json_literal(source_artifact_ids or [])}),
                {self._quote_literal(owner_scope)},
                PARSE_JSON({self._json_literal(keywords or [])}),
                DATEADD(
                    day,
                    {max(1, int(self._settings.agent_artifact_draft_retention_days))},
                    CURRENT_TIMESTAMP()
                )
            """
        ).collect()
        return artifact_id

    def _bounded_inline_artifact_fallback(
        self,
        *,
        artifact_id: str,
        normalized_payload: dict[str, Any],
        serialized_size: int,
        content_hash: str,
        mime_type: str,
        reason: str,
    ) -> dict[str, Any]:
        fallback_limit = max(
            int(self._settings.agent_inline_artifact_limit_bytes),
            int(self._settings.agent_caller_inline_fallback_limit_bytes),
        )
        if serialized_size <= fallback_limit:
            return normalized_payload
        return {
            "artifact_ref": artifact_id,
            "content_hash": content_hash,
            "mime_type": mime_type,
            "original_size": serialized_size,
            "persistence": "metadata_only",
            "payload_truncated": True,
            "reason": reason,
        }

    @classmethod
    def _warn_artifact_stage_once(cls, key: str, message: str) -> None:
        if key in cls._artifact_stage_warning_keys:
            return
        cls._artifact_stage_warning_keys.add(key)
        logger.warning(message)

    def get_agent_artifact(
        self,
        artifact_id: str,
        *,
        access_fingerprint: str,
        section: str | None = None,
        start: int | None = None,
        end: int | None = None,
    ) -> dict[str, Any]:
        """Hydrate an authorized artifact, optionally returning one bounded section.

        The access fingerprint is deliberately mandatory.  Stage paths are never
        treated as authorization: metadata ownership is checked before any file is
        downloaded.
        """

        self.ensure_storage_exists()
        rows = self._session.sql(
            f"""
            SELECT ARTIFACT_ID, ARTIFACT_TYPE, MIME_TYPE, CONTENT_HASH, PAYLOAD,
                   SUMMARY, STAGE_PATH, ORIGINAL_SIZE_BYTES, COMPRESSED_SIZE_BYTES,
                   PROJECT_ID, MAPPING_ID, LOGICAL_CONVERSATION_ID, THREAD_SEGMENT,
                   SOURCE_ARTIFACT_IDS, SEARCH_KEYWORDS, CREATED_AT, UPDATED_AT
            FROM {self._agent_artifacts_table}
            WHERE ARTIFACT_ID = {self._quote_literal(artifact_id)}
              AND COALESCE(ACCESS_FINGERPRINT, '') =
                  {self._quote_literal(access_fingerprint)}
            LIMIT 1
            """
        ).collect()
        if not rows:
            raise SnowflakeQueryError(
                "Artifact was not found or is not authorized for this workspace."
            )
        row = rows[0]
        metadata = row.as_dict() if hasattr(row, "as_dict") else dict(row)
        payload = metadata.get("PAYLOAD") or metadata.get("payload") or {}
        stage_path = str(metadata.get("STAGE_PATH") or metadata.get("stage_path") or "")
        if stage_path:
            with tempfile.TemporaryDirectory(prefix="sttm-artifact-") as directory:
                self._session.file.get(stage_path, directory)
                candidates = [
                    os.path.join(directory, name)
                    for name in os.listdir(directory)
                    if name.endswith(".json.gz")
                ]
                if len(candidates) != 1:
                    raise SnowflakeQueryError(
                        f"Artifact content for '{artifact_id}' could not be hydrated."
                    )
                with gzip.open(candidates[0], "rb") as handle:
                    payload = json.loads(handle.read().decode("utf-8"))

        selected: Any = payload
        if section:
            if not isinstance(selected, dict) or section not in selected:
                raise SnowflakeQueryError(
                    f"Artifact '{artifact_id}' does not contain section '{section}'."
                )
            selected = selected[section]
        if start is not None or end is not None:
            lower = max(0, int(start or 0))
            upper = None if end is None else max(lower, int(end))
            if isinstance(selected, (str, list)):
                selected = selected[lower:upper]
            else:
                raise SnowflakeQueryError(
                    "Artifact range hydration is supported only for text and arrays."
                )
        return {
            "artifact_id": artifact_id,
            "artifact_type": metadata.get("ARTIFACT_TYPE")
            or metadata.get("artifact_type"),
            "mime_type": metadata.get("MIME_TYPE") or metadata.get("mime_type"),
            "content_hash": metadata.get("CONTENT_HASH")
            or metadata.get("content_hash"),
            "summary": metadata.get("SUMMARY") or metadata.get("summary"),
            "payload": selected,
            "project_id": metadata.get("PROJECT_ID") or metadata.get("project_id"),
            "mapping_id": metadata.get("MAPPING_ID") or metadata.get("mapping_id"),
            "logical_conversation_id": metadata.get("LOGICAL_CONVERSATION_ID")
            or metadata.get("logical_conversation_id"),
            "thread_segment": metadata.get("THREAD_SEGMENT")
            or metadata.get("thread_segment"),
            "source_artifact_ids": metadata.get("SOURCE_ARTIFACT_IDS")
            or metadata.get("source_artifact_ids")
            or [],
            "keywords": metadata.get("SEARCH_KEYWORDS")
            or metadata.get("search_keywords")
            or [],
        }

    def upsert_mapping_intent(
        self,
        *,
        context_key: str,
        user_id: str | None,
        session_id: str | None,
        target_table: str | None,
        source_tables: list[str] | None,
        intent: MappingIntent,
        attributes: dict[str, Any] | None = None,
    ) -> str:
        self.ensure_storage_exists()
        intent_id = f"intent_{uuid.uuid5(uuid.NAMESPACE_DNS, context_key).hex[:20]}"
        self._session.sql(
            f"""
            MERGE INTO {self._mapping_intents_table} AS target
            USING (
                SELECT
                    {self._quote_literal(intent_id)} AS INTENT_ID,
                    {self._quote_literal(context_key)} AS CONTEXT_KEY,
                    {self._quote_literal(user_id or "")} AS USER_ID,
                    {self._quote_literal(session_id or "")} AS SESSION_ID,
                    {self._quote_literal(target_table or "")} AS TARGET_TABLE,
                    PARSE_JSON({self._json_literal(source_tables or [])}) AS SOURCE_TABLES,
                    {self._quote_literal(intent.business_goal or "")} AS BUSINESS_GOAL,
                    {self._quote_literal(intent.lifecycle)} AS LIFECYCLE,
                    {self._quote_literal(intent.target_outcome or "")} AS TARGET_OUTCOME,
                    PARSE_JSON({self._json_literal(intent.domain_hints)}) AS DOMAIN_HINTS,
                    {self._quote_literal(intent.source)} AS SOURCE,
                    {str(intent.confidence) if intent.confidence is not None else 'NULL'} AS CONFIDENCE,
                    PARSE_JSON({self._json_literal(attributes or {})}) AS ATTRIBUTES
            ) AS source
            ON target.CONTEXT_KEY = source.CONTEXT_KEY
            WHEN MATCHED THEN UPDATE SET
                USER_ID = source.USER_ID,
                SESSION_ID = source.SESSION_ID,
                TARGET_TABLE = source.TARGET_TABLE,
                SOURCE_TABLES = source.SOURCE_TABLES,
                BUSINESS_GOAL = source.BUSINESS_GOAL,
                LIFECYCLE = source.LIFECYCLE,
                TARGET_OUTCOME = source.TARGET_OUTCOME,
                DOMAIN_HINTS = source.DOMAIN_HINTS,
                SOURCE = source.SOURCE,
                CONFIDENCE = source.CONFIDENCE,
                ATTRIBUTES = source.ATTRIBUTES,
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
                INTENT_ID, CONTEXT_KEY, USER_ID, SESSION_ID, TARGET_TABLE, SOURCE_TABLES,
                BUSINESS_GOAL, LIFECYCLE, TARGET_OUTCOME, DOMAIN_HINTS, SOURCE, CONFIDENCE, ATTRIBUTES
            ) VALUES (
                source.INTENT_ID, source.CONTEXT_KEY, source.USER_ID, source.SESSION_ID, source.TARGET_TABLE, source.SOURCE_TABLES,
                source.BUSINESS_GOAL, source.LIFECYCLE, source.TARGET_OUTCOME, source.DOMAIN_HINTS, source.SOURCE, source.CONFIDENCE, source.ATTRIBUTES
            )
            """
        ).collect()
        return intent_id

    def get_mapping_intent(self, *, context_key: str, user_id: str | None = None) -> MappingIntent | None:
        self.ensure_storage_exists()
        predicates = [f"CONTEXT_KEY = {self._quote_literal(context_key)}"]
        if user_id:
            predicates.append(f"COALESCE(USER_ID, '') = {self._quote_literal(user_id)}")
        rows = self._session.sql(
            f"""
            SELECT BUSINESS_GOAL, LIFECYCLE, TARGET_OUTCOME, DOMAIN_HINTS, SOURCE, CONFIDENCE, UPDATED_AT
            FROM {self._mapping_intents_table}
            WHERE {' AND '.join(predicates)}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY CONTEXT_KEY ORDER BY UPDATED_AT DESC) = 1
            """
        ).collect()
        if not rows:
            return None
        data = rows[0].as_dict()
        return MappingIntent(
            business_goal=str(data.get("BUSINESS_GOAL") or "") or None,
            lifecycle=str(data.get("LIFECYCLE") or "unknown"),
            target_outcome=str(data.get("TARGET_OUTCOME") or "") or None,
            domain_hints=self._coerce_string_list(data.get("DOMAIN_HINTS")),
            source=str(data.get("SOURCE") or "user"),
            confidence=float(data["CONFIDENCE"]) if data.get("CONFIDENCE") is not None else None,
            updated_at=str(data.get("UPDATED_AT") or "") or None,
        )

    def upsert_semantic_learning(
        self,
        *,
        learning_key: str,
        user_id: str | None,
        entity_type: str | None,
        entity_ids: list[str] | None,
        learning_type: str,
        summary: str,
        confidence: float | None,
        source: str,
        attributes: dict[str, Any] | None = None,
    ) -> str:
        self.ensure_storage_exists()
        learning_id = f"learning_{uuid.uuid5(uuid.NAMESPACE_DNS, learning_key).hex[:20]}"
        self._session.sql(
            f"""
            MERGE INTO {self._semantic_learnings_table} AS target
            USING (
                SELECT
                    {self._quote_literal(learning_id)} AS LEARNING_ID,
                    {self._quote_literal(learning_key)} AS LEARNING_KEY,
                    {self._quote_literal(user_id or "")} AS USER_ID,
                    {self._quote_literal(entity_type or "")} AS ENTITY_TYPE,
                    PARSE_JSON({self._json_literal(entity_ids or [])}) AS ENTITY_IDS,
                    {self._quote_literal(learning_type)} AS LEARNING_TYPE,
                    {self._quote_literal(summary)} AS SUMMARY,
                    {str(confidence) if confidence is not None else 'NULL'} AS CONFIDENCE,
                    {self._quote_literal(source)} AS SOURCE,
                    PARSE_JSON({self._json_literal(attributes or {})}) AS ATTRIBUTES
            ) AS source
            ON target.LEARNING_KEY = source.LEARNING_KEY
            WHEN MATCHED THEN UPDATE SET
                USER_ID = source.USER_ID,
                ENTITY_TYPE = source.ENTITY_TYPE,
                ENTITY_IDS = source.ENTITY_IDS,
                LEARNING_TYPE = source.LEARNING_TYPE,
                SUMMARY = source.SUMMARY,
                CONFIDENCE = source.CONFIDENCE,
                SOURCE = source.SOURCE,
                ATTRIBUTES = source.ATTRIBUTES,
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
                LEARNING_ID, LEARNING_KEY, USER_ID, ENTITY_TYPE, ENTITY_IDS, LEARNING_TYPE, SUMMARY, CONFIDENCE, SOURCE, ATTRIBUTES
            ) VALUES (
                source.LEARNING_ID, source.LEARNING_KEY, source.USER_ID, source.ENTITY_TYPE, source.ENTITY_IDS, source.LEARNING_TYPE, source.SUMMARY, source.CONFIDENCE, source.SOURCE, source.ATTRIBUTES
            )
            """
        ).collect()
        return learning_id

    def list_semantic_learnings(
        self,
        *,
        entity_type: str | None,
        entity_ids: list[str] | None,
        limit: int = 6,
    ) -> list[dict[str, Any]]:
        self.ensure_storage_exists()
        predicates = []
        if entity_type:
            predicates.append(f"COALESCE(ENTITY_TYPE, '') = {self._quote_literal(entity_type)}")
        if entity_ids:
            predicates.append(
                f"TO_JSON(ENTITY_IDS) = TO_JSON(PARSE_JSON({self._json_literal(entity_ids)}))"
            )
        where_clause = f"WHERE {' AND '.join(predicates)}" if predicates else ""
        rows = self._session.sql(
            f"""
            SELECT LEARNING_ID, LEARNING_TYPE, SUMMARY, CONFIDENCE, SOURCE, ATTRIBUTES, UPDATED_AT
            FROM {self._semantic_learnings_table}
            {where_clause}
            ORDER BY UPDATED_AT DESC
            LIMIT {max(1, limit)}
            """
        ).collect()
        return [
            {
                "learning_id": str(item.get("LEARNING_ID") or ""),
                "learning_type": str(item.get("LEARNING_TYPE") or ""),
                "summary": str(item.get("SUMMARY") or ""),
                "confidence": float(item["CONFIDENCE"]) if item.get("CONFIDENCE") is not None else None,
                "source": str(item.get("SOURCE") or ""),
                "attributes": self._coerce_json_object(item.get("ATTRIBUTES")),
                "updated_at": str(item.get("UPDATED_AT") or "") or None,
            }
            for item in (row.as_dict() for row in rows)
        ]

    def get_feedback_summary(
        self,
        *,
        entity_type: str | None,
        entity_id: str | None = None,
        limit: int = 200,
    ) -> dict[str, Any]:
        self.ensure_storage_exists()
        predicates = []
        if entity_type:
            predicates.append(f"COALESCE(ENTITY_TYPE, '') = {self._quote_literal(entity_type)}")
        if entity_id:
            predicates.append(f"COALESCE(ENTITY_ID, '') = {self._quote_literal(entity_id)}")
        where_clause = f"WHERE {' AND '.join(predicates)}" if predicates else ""
        rows = self._session.sql(
            f"""
            SELECT RATING, OPTION_SELECTED
            FROM {self._feedback_table}
            {where_clause}
            ORDER BY CREATED_AT DESC
            LIMIT {max(1, limit)}
            """
        ).collect()
        ratings = [float(item.get("RATING")) for item in (row.as_dict() for row in rows) if item.get("RATING") is not None]
        options = [str(item.get("OPTION_SELECTED") or "") for item in (row.as_dict() for row in rows) if str(item.get("OPTION_SELECTED") or "").strip()]
        positive_options = {"looks right", "same business entity", "these tables are related as shown"}
        negative_options = {"needs correction", "these tables should not be joined directly", "should not be joined"}
        accepted = sum(1 for item in options if item.strip().lower() in positive_options)
        corrected = sum(1 for item in options if item.strip().lower() in negative_options)
        return {
            "feedback_count": len(rows),
            "average_rating": (sum(ratings) / len(ratings)) if ratings else None,
            "accepted_count": accepted,
            "corrected_count": corrected,
        }

    def get_feedback_summary_for_context(
        self,
        *,
        context_key: str,
        limit: int = 200,
    ) -> dict[str, Any]:
        self.ensure_storage_exists()
        rows = self._session.sql(
            f"""
            SELECT RATING, OPTION_SELECTED
            FROM {self._feedback_table}
            WHERE COALESCE(SELECTION_CONTEXT:context_key::string, '') = {self._quote_literal(context_key)}
            ORDER BY CREATED_AT DESC
            LIMIT {max(1, limit)}
            """
        ).collect()
        ratings = [float(item.get("RATING")) for item in (row.as_dict() for row in rows) if item.get("RATING") is not None]
        options = [str(item.get("OPTION_SELECTED") or "") for item in (row.as_dict() for row in rows) if str(item.get("OPTION_SELECTED") or "").strip()]
        positive_options = {"looks right", "same business entity", "these tables are related as shown", "new mapping", "updating an existing mapping"}
        negative_options = {"needs correction", "these tables should not be joined directly", "should not be joined", "not now"}
        accepted = sum(1 for item in options if item.strip().lower() in positive_options)
        corrected = sum(1 for item in options if item.strip().lower() in negative_options)
        return {
            "feedback_count": len(rows),
            "average_rating": (sum(ratings) / len(ratings)) if ratings else None,
            "accepted_count": accepted,
            "corrected_count": corrected,
        }

    def get_recent_signal_summary(
        self,
        *,
        entity_type: str | None,
        entity_ids: list[str] | None,
        page: str | None,
        surface: str | None,
        limit: int = 20,
    ) -> dict[str, Any]:
        self.ensure_storage_exists()
        predicates = []
        if entity_type:
            predicates.append(f"COALESCE(ENTITY_TYPE, '') = {self._quote_literal(entity_type)}")
        if entity_ids:
            predicates.append(
                f"TO_JSON(ENTITY_IDS) = TO_JSON(PARSE_JSON({self._json_literal(entity_ids)}))"
            )
        if page:
            predicates.append(f"COALESCE(ATTRIBUTES:page::string, '') = {self._quote_literal(page)}")
        if surface:
            predicates.append(f"COALESCE(ATTRIBUTES:surface::string, '') = {self._quote_literal(surface)}")
        where_clause = f"WHERE {' AND '.join(predicates)}" if predicates else ""
        rows = self._session.sql(
            f"""
            SELECT STATUS, SIGNAL_TYPE
            FROM {self._assistant_signals_table}
            {where_clause}
            ORDER BY UPDATED_AT DESC
            LIMIT {max(1, limit)}
            """
        ).collect()
        status_counts: dict[str, int] = {}
        for item in (row.as_dict() for row in rows):
            key = str(item.get("STATUS") or "")
            status_counts[key] = status_counts.get(key, 0) + 1
        return {
            "signal_count": len(rows),
            "status_counts": status_counts,
        }

    def get_latest_fir_model_score(self, *, context_key: str) -> dict[str, Any] | None:
        self.ensure_storage_exists()
        rows = self._session.sql(
            f"""
            SELECT
                MODEL_NAME,
                MODEL_VERSION,
                CONTEXT_KEY,
                ENTITY_TYPE,
                ENTITY_ID,
                PAGE,
                SURFACE,
                FEEDBACK_NEEDED_PROBABILITY,
                RECOMMENDATION_HELPFULNESS_PROBABILITY,
                RECOMMENDATION_TYPE,
                RECOMMENDATION_PRIORITY,
                SCORE_PAYLOAD
            FROM {self._fir_model_scores_table}
            WHERE CONTEXT_KEY = {self._quote_literal(context_key)}
            ORDER BY UPDATED_AT DESC
            LIMIT 1
            """
        ).collect()
        if not rows:
            return None
        row = rows[0].as_dict()
        return {
            "model_name": row.get("MODEL_NAME"),
            "model_version": row.get("MODEL_VERSION"),
            "context_key": row.get("CONTEXT_KEY"),
            "entity_type": row.get("ENTITY_TYPE"),
            "entity_id": row.get("ENTITY_ID"),
            "page": row.get("PAGE"),
            "surface": row.get("SURFACE"),
            "feedback_needed_probability": row.get("FEEDBACK_NEEDED_PROBABILITY"),
            "recommendation_helpfulness_probability": row.get("RECOMMENDATION_HELPFULNESS_PROBABILITY"),
            "recommendation_type": row.get("RECOMMENDATION_TYPE"),
            "recommendation_priority": row.get("RECOMMENDATION_PRIORITY"),
            "score_payload": row.get("SCORE_PAYLOAD"),
        }

    def record_inference(
        self,
        *,
        inference_key: str,
        request_id: str | None,
        conversation_id: str | None,
        source: str,
        inference_type: str,
        summary: str,
        confidence: float | None,
        entity_type: str | None,
        entity_ids: list[str] | None,
        attributes: dict[str, Any] | None,
        status: str,
        user_id: str | None,
    ) -> str:
        self.ensure_storage_exists()
        inference_id = f"inference_{uuid.uuid5(uuid.NAMESPACE_DNS, inference_key).hex[:20]}"
        self._session.sql(
            f"""
            MERGE INTO {self._assistant_inferences_table} AS target
            USING (
                SELECT
                    {self._quote_literal(inference_id)} AS INFERENCE_ID,
                    {self._quote_literal(inference_key)} AS INFERENCE_KEY,
                    {self._quote_literal(request_id or "")} AS REQUEST_ID,
                    {self._quote_literal(conversation_id or "")} AS CONVERSATION_ID,
                    {self._quote_literal(source)} AS SOURCE,
                    {self._quote_literal(inference_type)} AS INFERENCE_TYPE,
                    {self._quote_literal(summary)} AS SUMMARY,
                    {str(confidence) if confidence is not None else 'NULL'} AS CONFIDENCE,
                    {self._quote_literal(entity_type or "")} AS ENTITY_TYPE,
                    PARSE_JSON({self._json_literal(entity_ids or [])}) AS ENTITY_IDS,
                    PARSE_JSON({self._json_literal(attributes or {})}) AS ATTRIBUTES,
                    {self._quote_literal(status)} AS STATUS,
                    {self._quote_literal(user_id or "")} AS USER_ID
            ) AS source
            ON target.INFERENCE_KEY = source.INFERENCE_KEY
            WHEN MATCHED THEN UPDATE SET
                REQUEST_ID = source.REQUEST_ID,
                CONVERSATION_ID = source.CONVERSATION_ID,
                SOURCE = source.SOURCE,
                INFERENCE_TYPE = source.INFERENCE_TYPE,
                SUMMARY = source.SUMMARY,
                CONFIDENCE = source.CONFIDENCE,
                ENTITY_TYPE = source.ENTITY_TYPE,
                ENTITY_IDS = source.ENTITY_IDS,
                ATTRIBUTES = source.ATTRIBUTES,
                STATUS = source.STATUS,
                USER_ID = source.USER_ID,
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
                INFERENCE_ID, INFERENCE_KEY, REQUEST_ID, CONVERSATION_ID, SOURCE, INFERENCE_TYPE,
                SUMMARY, CONFIDENCE, ENTITY_TYPE, ENTITY_IDS, ATTRIBUTES, STATUS, USER_ID
            ) VALUES (
                source.INFERENCE_ID, source.INFERENCE_KEY, source.REQUEST_ID, source.CONVERSATION_ID, source.SOURCE, source.INFERENCE_TYPE,
                source.SUMMARY, source.CONFIDENCE, source.ENTITY_TYPE, source.ENTITY_IDS, source.ATTRIBUTES, source.STATUS, source.USER_ID
            )
            """
        ).collect()
        return inference_id

    def upsert_signal(
        self,
        *,
        signal_key: str,
        request_id: str | None,
        conversation_id: str | None,
        inference_id: str | None,
        signal_type: AssistantSignalType,
        layer: str,
        source: str,
        title: str,
        message: str,
        options: list[str],
        allow_free_text: bool,
        requires_response: bool,
        entity_type: str | None,
        entity_ids: list[str] | None,
        confidence: float | None,
        attributes: dict[str, Any] | None,
        recommendation_id: str | None,
        user_id: str | None,
    ) -> str:
        self.ensure_storage_exists()
        signal_id = f"signal_{uuid.uuid5(uuid.NAMESPACE_DNS, signal_key).hex[:20]}"
        self._session.sql(
            f"""
            MERGE INTO {self._assistant_signals_table} AS target
            USING (
                SELECT
                    {self._quote_literal(signal_id)} AS SIGNAL_ID,
                    {self._quote_literal(signal_key)} AS SIGNAL_KEY,
                    {self._quote_literal(request_id or "")} AS REQUEST_ID,
                    {self._quote_literal(conversation_id or "")} AS CONVERSATION_ID,
                    {self._quote_literal(inference_id or "")} AS INFERENCE_ID,
                    {self._quote_literal(signal_type.value)} AS SIGNAL_TYPE,
                    {self._quote_literal(layer)} AS LAYER,
                    {self._quote_literal(source)} AS SOURCE,
                    'new' AS STATUS,
                    {self._quote_literal(title)} AS TITLE,
                    {self._quote_literal(message)} AS MESSAGE,
                    PARSE_JSON({self._json_literal(options)}) AS OPTIONS,
                    {str(allow_free_text).upper()} AS ALLOW_FREE_TEXT,
                    {str(requires_response).upper()} AS REQUIRES_RESPONSE,
                    {self._quote_literal(entity_type or "")} AS ENTITY_TYPE,
                    PARSE_JSON({self._json_literal(entity_ids or [])}) AS ENTITY_IDS,
                    {str(confidence) if confidence is not None else 'NULL'} AS CONFIDENCE,
                    PARSE_JSON({self._json_literal({**(attributes or {}), "recommendation_id": recommendation_id} if recommendation_id else (attributes or {}))}) AS ATTRIBUTES,
                    {self._quote_literal(user_id or "")} AS USER_ID
            ) AS source
            ON target.SIGNAL_KEY = source.SIGNAL_KEY
            WHEN MATCHED AND target.STATUS NOT IN ('responded', 'dismissed') THEN UPDATE SET
                REQUEST_ID = source.REQUEST_ID,
                CONVERSATION_ID = source.CONVERSATION_ID,
                INFERENCE_ID = source.INFERENCE_ID,
                SIGNAL_TYPE = source.SIGNAL_TYPE,
                LAYER = source.LAYER,
                SOURCE = source.SOURCE,
                TITLE = source.TITLE,
                MESSAGE = source.MESSAGE,
                OPTIONS = source.OPTIONS,
                ALLOW_FREE_TEXT = source.ALLOW_FREE_TEXT,
                REQUIRES_RESPONSE = source.REQUIRES_RESPONSE,
                ENTITY_TYPE = source.ENTITY_TYPE,
                ENTITY_IDS = source.ENTITY_IDS,
                CONFIDENCE = source.CONFIDENCE,
                ATTRIBUTES = source.ATTRIBUTES,
                USER_ID = source.USER_ID,
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
                SIGNAL_ID, SIGNAL_KEY, REQUEST_ID, CONVERSATION_ID, INFERENCE_ID, SIGNAL_TYPE, LAYER,
                SOURCE, STATUS, TITLE, MESSAGE, OPTIONS, ALLOW_FREE_TEXT, REQUIRES_RESPONSE,
                ENTITY_TYPE, ENTITY_IDS, CONFIDENCE, ATTRIBUTES, USER_ID
            ) VALUES (
                source.SIGNAL_ID, source.SIGNAL_KEY, source.REQUEST_ID, source.CONVERSATION_ID, source.INFERENCE_ID, source.SIGNAL_TYPE, source.LAYER,
                source.SOURCE, source.STATUS, source.TITLE, source.MESSAGE, source.OPTIONS, source.ALLOW_FREE_TEXT, source.REQUIRES_RESPONSE,
                source.ENTITY_TYPE, source.ENTITY_IDS, source.CONFIDENCE, source.ATTRIBUTES, source.USER_ID
            )
            """
        ).collect()
        return signal_id

    def list_signals(
        self,
        *,
        user_id: str | None,
        include_resolved: bool = False,
        limit: int = 12,
    ) -> list[AssistantSignal]:
        self.ensure_storage_exists()
        predicates = []
        if user_id:
            predicates.append(f"COALESCE(USER_ID, '') = {self._quote_literal(user_id)}")
        if not include_resolved:
            predicates.append("STATUS = 'new'")
        where_clause = f"WHERE {' AND '.join(predicates)}" if predicates else ""
        rows = self._session.sql(
            f"""
            SELECT
                SIGNAL_ID, SIGNAL_TYPE, LAYER, STATUS, SOURCE, TITLE, MESSAGE, OPTIONS,
                ALLOW_FREE_TEXT, REQUIRES_RESPONSE, CONFIDENCE, ENTITY_TYPE, ENTITY_IDS,
                INFERENCE_ID, ATTRIBUTES, CREATED_AT, UPDATED_AT
            FROM {self._assistant_signals_table}
            {where_clause}
            ORDER BY UPDATED_AT DESC
            LIMIT {max(1, limit)}
            """
        ).collect()
        signals: list[AssistantSignal] = []
        valid_layers = {"feedback", "inference", "recommendation", "notification"}
        for row in rows:
            try:
                data = row.as_dict()
                attributes = self._coerce_json_object(data.get("ATTRIBUTES"))
                options = self._coerce_string_list(data.get("OPTIONS"))
                entity_ids = self._coerce_string_list(data.get("ENTITY_IDS"))
                raw_layer = str(data.get("LAYER") or "recommendation")
                layer = raw_layer if raw_layer in valid_layers else "recommendation"
                signals.append(
                    AssistantSignal(
                        signal_id=str(data.get("SIGNAL_ID") or ""),
                        signal_type=AssistantSignalType(str(data.get("SIGNAL_TYPE") or "feedback")),
                        layer=layer,
                        status=AssistantSignalStatus(str(data.get("STATUS") or "new")),
                        source=str(data.get("SOURCE") or "rule_engine"),
                        title=str(data.get("TITLE") or ""),
                        message=str(data.get("MESSAGE") or ""),
                        options=options,
                        allow_free_text=bool(data.get("ALLOW_FREE_TEXT")),
                        requires_response=bool(data.get("REQUIRES_RESPONSE")),
                        confidence=float(data["CONFIDENCE"]) if data.get("CONFIDENCE") is not None else None,
                        entity_type=str(data.get("ENTITY_TYPE") or "") or None,
                        entity_ids=entity_ids,
                        inference_id=str(data.get("INFERENCE_ID") or "") or None,
                        recommendation_id=(
                            str(attributes.get("recommendation_id") or "") or None
                            if isinstance(attributes, dict)
                            else None
                        ),
                        attributes=attributes if isinstance(attributes, dict) else {},
                        created_at=str(data.get("CREATED_AT") or "") or None,
                        updated_at=str(data.get("UPDATED_AT") or "") or None,
                    )
                )
            except Exception:
                continue
        return signals

    @staticmethod
    def _coerce_json_object(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    @staticmethod
    def _coerce_string_list(value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(item) for item in value if str(item).strip()]
        if isinstance(value, tuple):
            return [str(item) for item in value if str(item).strip()]
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                return [text]
            if isinstance(parsed, list):
                return [str(item) for item in parsed if str(item).strip()]
            if isinstance(parsed, str) and parsed.strip():
                return [parsed.strip()]
            return []
        return []

    def update_recommendation_review(
        self,
        *,
        recommendation_id: str,
        rating: int | None,
        comment: str | None,
        status: str = "reviewed",
    ) -> None:
        self.ensure_storage_exists()
        self._session.sql(
            f"""
            UPDATE {self._recommendations_table}
            SET REVIEW_RATING = {str(rating) if rating is not None else 'NULL'},
                REVIEW_COMMENT = {self._quote_literal(comment or "")},
                REVIEW_STATUS = {self._quote_literal(status)},
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE RECOMMENDATION_ID = {self._quote_literal(recommendation_id)}
            """
        ).collect()

    def list_inferences(
        self,
        *,
        user_id: str | None,
        limit: int = 12,
    ) -> list[AssistantInferenceRecord]:
        self.ensure_storage_exists()
        where_clause = (
            f"WHERE COALESCE(USER_ID, '') = {self._quote_literal(user_id)}"
            if user_id
            else ""
        )
        rows = self._session.sql(
            f"""
            SELECT INFERENCE_ID, INFERENCE_TYPE, SUMMARY, CONFIDENCE, SOURCE, ENTITY_TYPE, ENTITY_IDS, ATTRIBUTES
            FROM {self._assistant_inferences_table}
            {where_clause}
            ORDER BY UPDATED_AT DESC
            LIMIT {max(1, limit)}
            """
        ).collect()
        return [
            AssistantInferenceRecord(
                inference_id=str(row["INFERENCE_ID"]),
                inference_type=str(row["INFERENCE_TYPE"]),
                summary=str(row["SUMMARY"]),
                confidence=float(row["CONFIDENCE"]) if row["CONFIDENCE"] is not None else None,
                source=str(row["SOURCE"]),
                entity_type=str(row["ENTITY_TYPE"] or "") or None,
                entity_ids=self._coerce_string_list(row.get("ENTITY_IDS")),
                attributes=self._coerce_json_object(row.get("ATTRIBUTES")),
            )
            for row in (item.as_dict() for item in rows)
        ]

    def update_signal_status(
        self,
        *,
        signal_id: str,
        status: AssistantSignalStatus,
    ) -> None:
        self.ensure_storage_exists()
        status_updates = ["STATUS = " + self._quote_literal(status.value), "UPDATED_AT = CURRENT_TIMESTAMP()"]
        if status == AssistantSignalStatus.RESPONDED:
            status_updates.append("RESPONDED_AT = CURRENT_TIMESTAMP()")
        if status == AssistantSignalStatus.DISMISSED:
            status_updates.append("DISMISSED_AT = CURRENT_TIMESTAMP()")
        self._session.sql(
            f"""
            UPDATE {self._assistant_signals_table}
            SET {', '.join(status_updates)}
            WHERE SIGNAL_ID = {self._quote_literal(signal_id)}
            """
        ).collect()

    def dismiss_conflicting_signals(
        self,
        *,
        keep_signal_key: str,
        entity_type: str | None,
        entity_ids: list[str] | None,
        page: str | None,
        surface: str | None,
        user_id: str | None,
    ) -> None:
        self.ensure_storage_exists()
        entity_ids_json = self._json_literal(entity_ids or [])
        predicates = [
            f"SIGNAL_KEY <> {self._quote_literal(keep_signal_key)}",
            "STATUS NOT IN ('responded', 'dismissed')",
            f"COALESCE(ENTITY_TYPE, '') = {self._quote_literal(entity_type or '')}",
            f"TO_JSON(ENTITY_IDS) = TO_JSON(PARSE_JSON({entity_ids_json}))",
            f"COALESCE(ATTRIBUTES:page::string, '') = {self._quote_literal(page or '')}",
            f"COALESCE(ATTRIBUTES:surface::string, '') = {self._quote_literal(surface or '')}",
        ]
        if user_id:
            predicates.append(f"COALESCE(USER_ID, '') = {self._quote_literal(user_id)}")
        self._session.sql(
            f"""
            UPDATE {self._assistant_signals_table}
            SET STATUS = 'dismissed',
                DISMISSED_AT = COALESCE(DISMISSED_AT, CURRENT_TIMESTAMP()),
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE {' AND '.join(predicates)}
            """
        ).collect()

    def sync_relationship_facts(self) -> int:
        self.ensure_storage_exists()
        self._session.sql(f"DELETE FROM {self._relationship_facts_table}").collect()
        self._session.sql(
            f"""
            INSERT INTO {self._relationship_facts_table} (
                RELATIONSHIP_DOC_ID, SEMANTIC_BUNDLE_ID, SOURCE_KIND, SOURCE_ENTITY_ID,
                SEMANTIC_VIEW_NAME, LEFT_TABLE, RIGHT_TABLE, JOIN_TYPE, CONSTRAINT_NAME,
                SOURCE_HASH, RELATIONSHIP_TEXT, UPDATED_AT
            )
            WITH raw_relationships AS (
                SELECT
                    CONCAT('bundle-rel:', b.SEMANTIC_BUNDLE_ID, ':', rel.index) AS RELATIONSHIP_DOC_ID,
                    b.SEMANTIC_BUNDLE_ID,
                    'semantic_bundle' AS SOURCE_KIND,
                    b.SEMANTIC_BUNDLE_ID AS SOURCE_ENTITY_ID,
                    b.SEMANTIC_VIEW_NAME,
                    CONCAT(
                        rel.value:left_table:database::string, '.', rel.value:left_table:schema::string, '.', rel.value:left_table:table::string
                    ) AS LEFT_TABLE,
                    CONCAT(
                        rel.value:right_table:database::string, '.', rel.value:right_table:schema::string, '.', rel.value:right_table:table::string
                    ) AS RIGHT_TABLE,
                    COALESCE(rel.value:join_type::string, 'INNER') AS JOIN_TYPE,
                    COALESCE(rel.value:constraint_name::string, '') AS CONSTRAINT_NAME,
                    MD5(TO_VARCHAR(rel.value)) AS SOURCE_HASH,
                    CONCAT(
                        'Document folder: relationships',
                        '\nSource kind: semantic_bundle',
                        '\nSemantic bundle id: ', COALESCE(b.SEMANTIC_BUNDLE_ID, ''),
                        '\nSemantic view: ', COALESCE(b.SEMANTIC_VIEW_NAME, ''),
                        '\nLeft table: ',
                        CONCAT(rel.value:left_table:database::string, '.', rel.value:left_table:schema::string, '.', rel.value:left_table:table::string),
                        '\nRight table: ',
                        CONCAT(rel.value:right_table:database::string, '.', rel.value:right_table:schema::string, '.', rel.value:right_table:table::string),
                        '\nJoin type: ', COALESCE(rel.value:join_type::string, 'INNER'),
                        '\nConstraint: ', COALESCE(rel.value:constraint_name::string, ''),
                        '\nConditions: ', COALESCE(TO_VARCHAR(rel.value:conditions), '[]')
                    ) AS RELATIONSHIP_TEXT,
                    CURRENT_TIMESTAMP() AS UPDATED_AT
                FROM {self._semantic_bundles_table} AS b,
                     LATERAL FLATTEN(INPUT => b.RELATIONSHIPS) AS rel
                UNION ALL
                SELECT
                    CONCAT('derived-rel:', d.DERIVED_SOURCE_ID, ':', rel.index) AS RELATIONSHIP_DOC_ID,
                    d.SEMANTIC_BUNDLE_ID,
                    'derived_source' AS SOURCE_KIND,
                    d.DERIVED_SOURCE_ID AS SOURCE_ENTITY_ID,
                    d.SEMANTIC_VIEW_NAME,
                    CONCAT(
                        rel.value:left_table:database::string, '.', rel.value:left_table:schema::string, '.', rel.value:left_table:table::string
                    ) AS LEFT_TABLE,
                    CONCAT(
                        rel.value:right_table:database::string, '.', rel.value:right_table:schema::string, '.', rel.value:right_table:table::string
                    ) AS RIGHT_TABLE,
                    COALESCE(rel.value:join_type::string, 'INNER') AS JOIN_TYPE,
                    COALESCE(rel.value:constraint_name::string, '') AS CONSTRAINT_NAME,
                    MD5(TO_VARCHAR(rel.value)) AS SOURCE_HASH,
                    CONCAT(
                        'Document folder: relationships',
                        '\nSource kind: derived_source',
                        '\nSemantic bundle id: ', COALESCE(d.SEMANTIC_BUNDLE_ID, ''),
                        '\nSemantic view: ', COALESCE(d.SEMANTIC_VIEW_NAME, ''),
                        '\nDerived source id: ', COALESCE(d.DERIVED_SOURCE_ID, ''),
                        '\nLeft table: ',
                        CONCAT(rel.value:left_table:database::string, '.', rel.value:left_table:schema::string, '.', rel.value:left_table:table::string),
                        '\nRight table: ',
                        CONCAT(rel.value:right_table:database::string, '.', rel.value:right_table:schema::string, '.', rel.value:right_table:table::string),
                        '\nJoin type: ', COALESCE(rel.value:join_type::string, 'INNER'),
                        '\nConstraint: ', COALESCE(rel.value:constraint_name::string, ''),
                        '\nConditions: ', COALESCE(TO_VARCHAR(rel.value:conditions), '[]')
                    ) AS RELATIONSHIP_TEXT,
                    CURRENT_TIMESTAMP() AS UPDATED_AT
                FROM {self._derived_sources_table} AS d,
                     LATERAL FLATTEN(INPUT => d.RELATIONSHIPS) AS rel
            )
            SELECT
                RELATIONSHIP_DOC_ID,
                SEMANTIC_BUNDLE_ID,
                SOURCE_KIND,
                SOURCE_ENTITY_ID,
                SEMANTIC_VIEW_NAME,
                LEFT_TABLE,
                RIGHT_TABLE,
                JOIN_TYPE,
                CONSTRAINT_NAME,
                SOURCE_HASH,
                RELATIONSHIP_TEXT,
                UPDATED_AT
            FROM raw_relationships
            QUALIFY ROW_NUMBER() OVER (
                PARTITION BY SOURCE_KIND, SOURCE_ENTITY_ID, LEFT_TABLE, RIGHT_TABLE, JOIN_TYPE, CONSTRAINT_NAME, SOURCE_HASH
                ORDER BY RELATIONSHIP_DOC_ID
            ) = 1
            """
        ).collect()
        return self._count_table(self._relationship_facts_table)

    def find_relationships_for_tables(
        self,
        *,
        table_names: list[str],
        semantic_bundle_id: str | None = None,
        limit: int = 3,
    ) -> list[ConversationSearchHit]:
        normalized = [item.strip().upper() for item in table_names if item and item.strip()]
        if len(normalized) < 2:
            return []

        self.ensure_storage_exists()
        table_literals = ", ".join(self._quote_literal(item) for item in normalized)
        bundle_predicate = (
            f"AND SEMANTIC_BUNDLE_ID = {self._quote_literal(semantic_bundle_id.strip())}"
            if semantic_bundle_id and semantic_bundle_id.strip()
            else ""
        )
        rows = self._session.sql(
            f"""
            SELECT
                RELATIONSHIP_DOC_ID,
                LEFT_TABLE,
                RIGHT_TABLE,
                JOIN_TYPE,
                CONSTRAINT_NAME,
                RELATIONSHIP_TEXT,
                SEMANTIC_BUNDLE_ID,
                SEMANTIC_VIEW_NAME,
                UPDATED_AT
            FROM {self._relationship_facts_table}
            WHERE UPPER(LEFT_TABLE) IN ({table_literals})
              AND UPPER(RIGHT_TABLE) IN ({table_literals})
              AND UPPER(LEFT_TABLE) <> UPPER(RIGHT_TABLE)
              {bundle_predicate}
            ORDER BY UPDATED_AT DESC
            LIMIT {max(1, limit)}
            """
        ).collect()

        hits: list[ConversationSearchHit] = []
        for row in rows:
            data = row.as_dict()
            doc_id = str(data.get("RELATIONSHIP_DOC_ID") or "").strip()
            if not doc_id:
                continue
            left_table = str(data.get("LEFT_TABLE") or "").strip()
            right_table = str(data.get("RIGHT_TABLE") or "").strip()
            join_type = str(data.get("JOIN_TYPE") or "INNER").strip() or "INNER"
            constraint_name = str(data.get("CONSTRAINT_NAME") or "").strip() or None
            hits.append(
                ConversationSearchHit(
                    doc_id=doc_id,
                    doc_folder="relationships",
                    doc_type="relationship_fact",
                    title=f"{left_table} -> {right_table}",
                    snippet=str(data.get("RELATIONSHIP_TEXT") or "")[:800] or None,
                    semantic_bundle_id=str(data.get("SEMANTIC_BUNDLE_ID") or "").strip() or None,
                    semantic_view_name=str(data.get("SEMANTIC_VIEW_NAME") or "").strip() or None,
                    score=1.0,
                )
            )
        return hits

    def index_mapping_rows(
        self,
        sttm_id: str,
        rows: list[dict[str, Any]],
        project_id: str | None = None,
        sttm_name: str | None = None,
    ) -> int:
        """Index accepted mapping rows for RAG retrieval.

        This enables Cortex Search to find similar mappings based on
        target column names, source columns, and transformation logic.

        Args:
            sttm_id: The STTM identifier
            rows: List of mapping row dictionaries
            project_id: Optional project identifier
            sttm_name: Optional STTM name for display

        Returns:
            Number of rows indexed
        """
        self.ensure_storage_exists()
        indexed = 0

        for row in rows:
            target_column = row.get("target_column", "")
            source_columns = row.get("source_columns", [])
            if not target_column:
                continue

            doc_id = f"mapping:{sttm_id}:{target_column}"
            source_list = ", ".join(source_columns) if isinstance(source_columns, list) else str(source_columns)
            preprocessing_rule = row.get("preprocessing_rule", "Direct")
            preprocessing_nl = row.get("preprocessing_nl_rule", "")
            confidence = row.get("confidence", 0.0)
            description = row.get("description", "")

            search_text = f"""Document folder: mappings
Document type: mapping_row
STTM ID: {sttm_id}
STTM Name: {sttm_name or sttm_id}
Project ID: {project_id or ''}
Target column: {target_column}
Source columns: {source_list}
Preprocessing rule type: {row.get("preprocessing_rule_type", "Direct")}
Preprocessing rule: {preprocessing_rule}
Natural language rule: {preprocessing_nl}
Confidence: {confidence}
Description: {description}
"""

            self._session.sql(
                f"""
                MERGE INTO {self._rag_documents_table} AS target
                USING (
                    SELECT
                        {self._quote_literal(doc_id)} AS DOC_ID,
                        'mappings' AS DOC_FOLDER,
                        'mapping_row' AS DOC_TYPE,
                        {self._quote_literal(f"{sttm_id}:{target_column}")} AS ENTITY_ID,
                        {self._quote_literal(f"Mapping: {source_list} -> {target_column}")} AS TITLE,
                        {self._quote_literal(search_text)} AS SEARCH_TEXT,
                        NULL AS SEMANTIC_BUNDLE_ID,
                        NULL AS SEMANTIC_VIEW_NAME,
                        NULL AS REQUEST_ID,
                        NULL AS CONVERSATION_ID,
                        NULL AS SOURCE_HASH,
                        PARSE_JSON({self._json_literal({
                            "sttm_id": sttm_id,
                            "project_id": project_id,
                            "target_column": target_column,
                            "source_columns": source_columns,
                            "preprocessing_rule_type": row.get("preprocessing_rule_type", "Direct"),
                            "confidence": confidence,
                        })}) AS ATTRIBUTES,
                        CURRENT_TIMESTAMP() AS UPDATED_AT
                ) AS source
                ON target.DOC_ID = source.DOC_ID
                WHEN MATCHED THEN UPDATE SET
                    TITLE = source.TITLE,
                    SEARCH_TEXT = source.SEARCH_TEXT,
                    ATTRIBUTES = source.ATTRIBUTES,
                    UPDATED_AT = source.UPDATED_AT
                WHEN NOT MATCHED THEN INSERT (
                    DOC_ID, DOC_FOLDER, DOC_TYPE, ENTITY_ID, TITLE, SEARCH_TEXT,
                    SEMANTIC_BUNDLE_ID, SEMANTIC_VIEW_NAME, REQUEST_ID, CONVERSATION_ID,
                    SOURCE_HASH, ATTRIBUTES, UPDATED_AT
                ) VALUES (
                    source.DOC_ID, source.DOC_FOLDER, source.DOC_TYPE, source.ENTITY_ID,
                    source.TITLE, source.SEARCH_TEXT, source.SEMANTIC_BUNDLE_ID,
                    source.SEMANTIC_VIEW_NAME, source.REQUEST_ID, source.CONVERSATION_ID,
                    source.SOURCE_HASH, source.ATTRIBUTES, source.UPDATED_AT
                )
                """
            ).collect()
            indexed += 1

        return indexed

    def index_published_sttm(
        self,
        sttm_id: str,
        version: int,
        project_id: str | None = None,
        sttm_name: str | None = None,
        target_table: str | None = None,
        source_tables: list[str] | None = None,
        mapping_count: int = 0,
        generated_sql: str | None = None,
        business_purpose: str | None = None,
    ) -> bool:
        """Index published STTM content for RAG retrieval.

        Args:
            sttm_id: The STTM identifier
            version: Published version number
            project_id: Project identifier
            sttm_name: STTM display name
            target_table: Target table qualified name
            source_tables: List of source table qualified names
            mapping_count: Number of mappings
            generated_sql: Generated SQL for the STTM
            business_purpose: Business purpose description

        Returns:
            True if indexed successfully
        """
        self.ensure_storage_exists()

        doc_id = f"published:{sttm_id}:v{version}"
        source_list = ", ".join(source_tables or [])

        search_text = f"""Document folder: published
Document type: published_sttm
STTM ID: {sttm_id}
STTM Name: {sttm_name or sttm_id}
Version: {version}
Project ID: {project_id or ''}
Target table: {target_table or ''}
Source tables: {source_list}
Mapping count: {mapping_count}
Business purpose: {business_purpose or ''}
Generated SQL: {(generated_sql or '')[:2000]}
"""

        try:
            self._session.sql(
                f"""
                MERGE INTO {self._rag_documents_table} AS target
                USING (
                    SELECT
                        {self._quote_literal(doc_id)} AS DOC_ID,
                        'published' AS DOC_FOLDER,
                        'published_sttm' AS DOC_TYPE,
                        {self._quote_literal(sttm_id)} AS ENTITY_ID,
                        {self._quote_literal(f"[Published] {sttm_name or sttm_id} v{version}")} AS TITLE,
                        {self._quote_literal(search_text)} AS SEARCH_TEXT,
                        NULL AS SEMANTIC_BUNDLE_ID,
                        NULL AS SEMANTIC_VIEW_NAME,
                        NULL AS REQUEST_ID,
                        NULL AS CONVERSATION_ID,
                        NULL AS SOURCE_HASH,
                        PARSE_JSON({self._json_literal({
                            "sttm_id": sttm_id,
                            "version": version,
                            "project_id": project_id,
                            "target_table": target_table,
                            "source_tables": source_tables,
                            "mapping_count": mapping_count,
                            "business_purpose": business_purpose,
                        })}) AS ATTRIBUTES,
                        CURRENT_TIMESTAMP() AS UPDATED_AT
                ) AS source
                ON target.DOC_ID = source.DOC_ID
                WHEN MATCHED THEN UPDATE SET
                    TITLE = source.TITLE,
                    SEARCH_TEXT = source.SEARCH_TEXT,
                    ATTRIBUTES = source.ATTRIBUTES,
                    UPDATED_AT = source.UPDATED_AT
                WHEN NOT MATCHED THEN INSERT (
                    DOC_ID, DOC_FOLDER, DOC_TYPE, ENTITY_ID, TITLE, SEARCH_TEXT,
                    SEMANTIC_BUNDLE_ID, SEMANTIC_VIEW_NAME, REQUEST_ID, CONVERSATION_ID,
                    SOURCE_HASH, ATTRIBUTES, UPDATED_AT
                ) VALUES (
                    source.DOC_ID, source.DOC_FOLDER, source.DOC_TYPE, source.ENTITY_ID,
                    source.TITLE, source.SEARCH_TEXT, source.SEMANTIC_BUNDLE_ID,
                    source.SEMANTIC_VIEW_NAME, source.REQUEST_ID, source.CONVERSATION_ID,
                    source.SOURCE_HASH, source.ATTRIBUTES, source.UPDATED_AT
                )
                """
            ).collect()
            return True
        except Exception as exc:
            logger.warning("Failed to index published STTM %s: %s", sttm_id, exc)
            return False

    def sync_rag_documents(
        self,
        *,
        include_conversation_docs: bool = True,
        include_feedback_docs: bool = True,
        include_inference_docs: bool = True,
        include_recommendation_docs: bool = True,
        include_semantic_docs: bool = True,
        include_relationship_docs: bool = True,
        include_client_knowledge_docs: bool = True,
        include_mapping_docs: bool = True,
        include_published_docs: bool = True,
    ) -> int:
        self.ensure_storage_exists()
        folders: list[str] = []
        if include_semantic_docs:
            folders.extend(["semantic", "derived_sources"])
        if include_relationship_docs:
            folders.append("relationships")
        if include_conversation_docs:
            folders.append("conversations")
        if include_feedback_docs:
            folders.append("feedback")
        if include_inference_docs:
            folders.append("inferences")
        if include_recommendation_docs:
            folders.append("recommendations")
        if include_client_knowledge_docs:
            folders.extend(["knowledge_notes", "historical_sql"])
        if include_mapping_docs:
            folders.append("mappings")
        if include_published_docs:
            folders.append("published")
        if folders:
            folder_sql = ", ".join(self._quote_literal(item) for item in folders)
            self._session.sql(
                f"DELETE FROM {self._rag_documents_table} WHERE DOC_FOLDER IN ({folder_sql})"
            ).collect()

        if include_semantic_docs:
            self._session.sql(
                f"""
                INSERT INTO {self._rag_documents_table} (
                    DOC_ID, DOC_FOLDER, DOC_TYPE, ENTITY_ID, TITLE, SEARCH_TEXT,
                    SEMANTIC_BUNDLE_ID, SEMANTIC_VIEW_NAME, REQUEST_ID, CONVERSATION_ID,
                    SOURCE_HASH, ATTRIBUTES, UPDATED_AT
                )
                SELECT
                    CONCAT('bundle:', SEMANTIC_BUNDLE_ID),
                    'semantic',
                    'semantic_bundle',
                    SEMANTIC_BUNDLE_ID,
                    BUNDLE_LABEL,
                    CONCAT(
                        'Document folder: semantic',
                        '\nDocument type: semantic_bundle',
                        '\nSemantic bundle id: ', COALESCE(SEMANTIC_BUNDLE_ID, ''),
                        '\nBundle label: ', COALESCE(BUNDLE_LABEL, ''),
                        '\nSemantic level: ', COALESCE(SEMANTIC_LEVEL, ''),
                        '\nStatus: ', COALESCE(STATUS, ''),
                        '\nSemantic view: ', COALESCE(SEMANTIC_VIEW_NAME, ''),
                        '\nSource tables: ', COALESCE(TO_VARCHAR(SOURCE_TABLES), '[]'),
                        '\nDerived source ids: ', COALESCE(TO_VARCHAR(DERIVED_SOURCE_IDS), '[]'),
                        '\nRelationships: ', COALESCE(TO_VARCHAR(RELATIONSHIPS), '[]'),
                        '\nDataHub context: ', COALESCE(TO_VARCHAR(DATAHUB_CONTEXT), '{{}}')
                    ),
                    SEMANTIC_BUNDLE_ID,
                    SEMANTIC_VIEW_NAME,
                    NULL,
                    NULL,
                    BUNDLE_HASH,
                    OBJECT_CONSTRUCT(
                        'source_tables', SOURCE_TABLES,
                        'derived_source_ids', DERIVED_SOURCE_IDS,
                        'semantic_level', SEMANTIC_LEVEL,
                        'status', STATUS
                    ),
                    UPDATED_AT
                FROM {self._semantic_bundles_table}
                UNION ALL
                SELECT
                    CONCAT('model:', SCOPE, ':', DB_NAME, '.', SCHEMA_NAME, '.', TABLE_NAME, '.', ATTRIBUTE_NAME),
                    'semantic',
                    'semantic_model',
                    CONCAT(DB_NAME, '.', SCHEMA_NAME, '.', TABLE_NAME, '.', ATTRIBUTE_NAME),
                    CONCAT(SCOPE, ' ', DB_NAME, '.', SCHEMA_NAME, IFF(TABLE_NAME = '', '', CONCAT('.', TABLE_NAME)), IFF(ATTRIBUTE_NAME = '', '', CONCAT('.', ATTRIBUTE_NAME))),
                    CONCAT(
                        'Document folder: semantic',
                        '\nDocument type: semantic_model',
                        '\nScope: ', SCOPE,
                        '\nObject: ', DB_NAME, '.', SCHEMA_NAME, IFF(TABLE_NAME = '', '', CONCAT('.', TABLE_NAME)), IFF(ATTRIBUTE_NAME = '', '', CONCAT('.', ATTRIBUTE_NAME)),
                        '\nDDL hash: ', COALESCE(DDL_HASH, ''),
                        '\nSemantic model JSON: ', TO_VARCHAR(SEMANTIC_MODEL)
                    ),
                    NULL,
                    NULL,
                    NULL,
                    NULL,
                    DDL_HASH,
                    OBJECT_CONSTRUCT('scope', SCOPE),
                    UPDATED_AT
                FROM {self._semantic_models_table}
                UNION ALL
                SELECT
                    CONCAT('derived:', DERIVED_SOURCE_ID),
                    'derived_sources',
                    'derived_source',
                    DERIVED_SOURCE_ID,
                    DERIVED_SOURCE_NAME,
                    CONCAT(
                        'Document folder: derived_sources',
                        '\nDocument type: derived_source',
                        '\nDerived source id: ', COALESCE(DERIVED_SOURCE_ID, ''),
                        '\nDerived source: ', COALESCE(DERIVED_SOURCE_NAME, ''),
                        '\nDriving table: ', COALESCE(DRIVING_TABLE, ''),
                        '\nSQL: ', COALESCE(SQL_TEXT, ''),
                        '\nSource tables: ', COALESCE(TO_VARCHAR(SOURCE_TABLES), '[]'),
                        '\nRelationships: ', COALESCE(TO_VARCHAR(RELATIONSHIPS), '[]')
                    ),
                    SEMANTIC_BUNDLE_ID,
                    SEMANTIC_VIEW_NAME,
                    NULL,
                    NULL,
                    COALESCE(UPSTREAM_HASH, MD5(COALESCE(SQL_TEXT, ''))),
                    OBJECT_CONSTRUCT('source_tables', SOURCE_TABLES, 'lineage_depth', LINEAGE_DEPTH),
                    UPDATED_AT
                FROM {self._derived_sources_table}
                """
            ).collect()

        if include_relationship_docs:
            self.sync_relationship_facts()
            self._session.sql(
                f"""
                INSERT INTO {self._rag_documents_table} (
                    DOC_ID, DOC_FOLDER, DOC_TYPE, ENTITY_ID, TITLE, SEARCH_TEXT,
                    SEMANTIC_BUNDLE_ID, SEMANTIC_VIEW_NAME, REQUEST_ID, CONVERSATION_ID,
                    SOURCE_HASH, ATTRIBUTES, UPDATED_AT
                )
                SELECT
                    RELATIONSHIP_DOC_ID,
                    'relationships',
                    'relationship_fact',
                    SOURCE_ENTITY_ID,
                    CONCAT(LEFT_TABLE, ' -> ', RIGHT_TABLE),
                    RELATIONSHIP_TEXT,
                    SEMANTIC_BUNDLE_ID,
                    SEMANTIC_VIEW_NAME,
                    NULL,
                    NULL,
                    SOURCE_HASH,
                    OBJECT_CONSTRUCT(
                        'left_table', LEFT_TABLE,
                        'right_table', RIGHT_TABLE,
                        'join_type', JOIN_TYPE,
                        'constraint_name', CONSTRAINT_NAME,
                        'source_kind', SOURCE_KIND
                    ),
                    UPDATED_AT
                FROM {self._relationship_facts_table}
                """
            ).collect()

        if include_conversation_docs:
            self._session.sql(
                f"""
                INSERT INTO {self._rag_documents_table} (
                    DOC_ID, DOC_FOLDER, DOC_TYPE, ENTITY_ID, TITLE, SEARCH_TEXT,
                    SEMANTIC_BUNDLE_ID, SEMANTIC_VIEW_NAME, REQUEST_ID, CONVERSATION_ID,
                    SOURCE_HASH, ATTRIBUTES, UPDATED_AT
                )
                SELECT
                    CONCAT('turn:', TURN_ID),
                    'conversations',
                    CONCAT('conversation_', LOWER(ROLE)),
                    TURN_ID,
                    CONCAT(UPPER(ROLE), ' turn ', TURN_ID),
                    CONCAT(
                        'Document folder: conversations',
                        '\nRole: ', COALESCE(ROLE, ''),
                        '\nRoute: ', COALESCE(ROUTE, ''),
                        '\nIntent class: ', COALESCE(INTENT_CLASS, ''),
                        '\nMessage: ', COALESCE(MESSAGE, ''),
                        '\nCitations: ', COALESCE(TO_VARCHAR(CITATIONS), '[]')
                    ),
                    NULL,
                    NULL,
                    REQUEST_ID,
                    CONVERSATION_ID,
                    MD5(COALESCE(MESSAGE, '')),
                    OBJECT_CONSTRUCT(
                        'role', ROLE,
                        'route', ROUTE,
                        'intent_class', INTENT_CLASS,
                        'citations', CITATIONS
                    ),
                    CREATED_AT
                FROM {self._turns_table}
                WHERE COALESCE(MESSAGE, '') <> ''
                """
            ).collect()

        if include_feedback_docs:
            self._session.sql(
                f"""
                INSERT INTO {self._rag_documents_table} (
                    DOC_ID, DOC_FOLDER, DOC_TYPE, ENTITY_ID, TITLE, SEARCH_TEXT,
                    SEMANTIC_BUNDLE_ID, SEMANTIC_VIEW_NAME, REQUEST_ID, CONVERSATION_ID,
                    SOURCE_HASH, ATTRIBUTES, UPDATED_AT
                )
                SELECT
                    CONCAT('feedback:', FEEDBACK_ID),
                    'feedback',
                    'feedback',
                    FEEDBACK_ID,
                    CONCAT('Feedback ', FEEDBACK_ID),
                    CONCAT(
                        'Document folder: feedback',
                        '\nFeedback id: ', COALESCE(FEEDBACK_ID, ''),
                        '\nFeedback type: ', COALESCE(FEEDBACK_TYPE, ''),
                        '\nCategory: ', COALESCE(CATEGORY, ''),
                        '\nOption selected: ', COALESCE(OPTION_SELECTED, ''),
                        '\nRating: ', COALESCE(TO_VARCHAR(RATING), ''),
                        '\nComment: ', COALESCE(COMMENT, ''),
                        '\nTarget request id: ', COALESCE(TARGET_REQUEST_ID, ''),
                        '\nEntity type: ', COALESCE(ENTITY_TYPE, ''),
                        '\nEntity id: ', COALESCE(ENTITY_ID, '')
                    ),
                    NULL,
                    NULL,
                    REQUEST_ID,
                    CONVERSATION_ID,
                    MD5(CONCAT(COALESCE(CATEGORY, ''), '|', COALESCE(COMMENT, ''))),
                    OBJECT_CONSTRUCT(
                        'feedback_type', FEEDBACK_TYPE,
                        'category', CATEGORY,
                        'option_selected', OPTION_SELECTED,
                        'rating', RATING,
                        'target_request_id', TARGET_REQUEST_ID,
                        'entity_type', ENTITY_TYPE,
                        'entity_id', ENTITY_ID
                    ),
                    CREATED_AT
                FROM {self._feedback_table}
                """
            ).collect()

        if include_inference_docs:
            self._session.sql(
                f"""
                INSERT INTO {self._rag_documents_table} (
                    DOC_ID, DOC_FOLDER, DOC_TYPE, ENTITY_ID, TITLE, SEARCH_TEXT,
                    SEMANTIC_BUNDLE_ID, SEMANTIC_VIEW_NAME, REQUEST_ID, CONVERSATION_ID,
                    SOURCE_HASH, ATTRIBUTES, UPDATED_AT
                )
                SELECT
                    CONCAT('inference:', INFERENCE_ID),
                    'inferences',
                    'inference',
                    INFERENCE_ID,
                    CONCAT('Inference ', INFERENCE_TYPE),
                    CONCAT(
                        'Document folder: inferences',
                        '\nInference id: ', COALESCE(INFERENCE_ID, ''),
                        '\nInference type: ', COALESCE(INFERENCE_TYPE, ''),
                        '\nSource: ', COALESCE(SOURCE, ''),
                        '\nSummary: ', COALESCE(SUMMARY, ''),
                        '\nEntity type: ', COALESCE(ENTITY_TYPE, ''),
                        '\nEntity ids: ', COALESCE(TO_VARCHAR(ENTITY_IDS), '[]'),
                        '\nConfidence: ', COALESCE(TO_VARCHAR(CONFIDENCE), '')
                    ),
                    NULL,
                    NULL,
                    REQUEST_ID,
                    CONVERSATION_ID,
                    MD5(COALESCE(SUMMARY, '')),
                    OBJECT_CONSTRUCT(
                        'source', SOURCE,
                        'inference_type', INFERENCE_TYPE,
                        'confidence', CONFIDENCE,
                        'entity_type', ENTITY_TYPE,
                        'entity_ids', ENTITY_IDS,
                        'attributes', ATTRIBUTES
                    ),
                    UPDATED_AT
                FROM {self._assistant_inferences_table}
                """
            ).collect()

        if include_recommendation_docs:
            self._session.sql(
                f"""
                INSERT INTO {self._rag_documents_table} (
                    DOC_ID, DOC_FOLDER, DOC_TYPE, ENTITY_ID, TITLE, SEARCH_TEXT,
                    SEMANTIC_BUNDLE_ID, SEMANTIC_VIEW_NAME, REQUEST_ID, CONVERSATION_ID,
                    SOURCE_HASH, ATTRIBUTES, UPDATED_AT
                )
                SELECT
                    CONCAT('recommendation:', RECOMMENDATION_ID),
                    'recommendations',
                    'recommendation',
                    RECOMMENDATION_ID,
                    CONCAT('Recommendation ', RECOMMENDATION_ID),
                    CONCAT(
                        'Document folder: recommendations',
                        '\nRecommendation id: ', COALESCE(RECOMMENDATION_ID, ''),
                        '\nRecommendation type: ', COALESCE(RECOMMENDATION_TYPE, ''),
                        '\nStatus: ', COALESCE(STATUS, ''),
                        '\nApproval required: ', IFF(APPROVAL_REQUIRED, 'true', 'false'),
                        '\nEntity type: ', COALESCE(ENTITY_TYPE, ''),
                        '\nEntity ids: ', COALESCE(TO_VARCHAR(ENTITY_IDS), '[]'),
                        '\nConfidence: ', COALESCE(TO_VARCHAR(CONFIDENCE), ''),
                        '\nMessage: ', COALESCE(MESSAGE, ''),
                        '\nCitations: ', COALESCE(TO_VARCHAR(CITATIONS), '[]')
                    ),
                    NULL,
                    NULL,
                    REQUEST_ID,
                    CONVERSATION_ID,
                    MD5(COALESCE(MESSAGE, '')),
                    OBJECT_CONSTRUCT(
                        'recommendation_type', RECOMMENDATION_TYPE,
                        'citations', CITATIONS,
                        'entity_type', ENTITY_TYPE,
                        'entity_ids', ENTITY_IDS,
                        'confidence', CONFIDENCE,
                        'attributes', ATTRIBUTES,
                        'approval_required', APPROVAL_REQUIRED,
                        'status', STATUS
                    ),
                    UPDATED_AT
                FROM {self._recommendations_table}
                WHERE COALESCE(MESSAGE, '') <> ''
                """
            ).collect()

        if include_client_knowledge_docs:
            self._session.sql(
                f"""
                INSERT INTO {self._rag_documents_table} (
                    DOC_ID, DOC_FOLDER, DOC_TYPE, ENTITY_ID, TITLE, SEARCH_TEXT,
                    SEMANTIC_BUNDLE_ID, SEMANTIC_VIEW_NAME, REQUEST_ID, CONVERSATION_ID,
                    SOURCE_HASH, ATTRIBUTES, UPDATED_AT
                )
                SELECT
                    CONCAT('client-note:', NOTE_ID),
                    'knowledge_notes',
                    'client_note',
                    NOTE_ID,
                    COALESCE(TITLE, CONCAT('Client note ', NOTE_ID)),
                    CONCAT(
                        'Document folder: knowledge_notes',
                        '\nProject id: ', COALESCE(PROJECT_ID, ''),
                        '\nEntity type: ', COALESCE(ENTITY_TYPE, ''),
                        '\nEntity ids: ', COALESCE(TO_VARCHAR(ENTITY_IDS), '[]'),
                        '\nTitle: ', COALESCE(TITLE, ''),
                        '\nSource label: ', COALESCE(SOURCE_LABEL, ''),
                        '\nAuthor: ', COALESCE(AUTHOR_NAME, ''),
                        '\nTags: ', COALESCE(TO_VARCHAR(TAGS), '[]'),
                        '\nNote: ', COALESCE(NOTE_TEXT, '')
                    ),
                    NULL,
                    NULL,
                    NULL,
                    NULL,
                    MD5(CONCAT(COALESCE(PROJECT_ID, ''), '|', COALESCE(TITLE, ''), '|', COALESCE(NOTE_TEXT, ''))),
                    OBJECT_CONSTRUCT(
                        'project_id', PROJECT_ID,
                        'entity_type', ENTITY_TYPE,
                        'entity_ids', ENTITY_IDS,
                        'source_label', SOURCE_LABEL,
                        'author_name', AUTHOR_NAME,
                        'tags', TAGS,
                        'attributes', ATTRIBUTES,
                        'status', STATUS
                    ),
                    UPDATED_AT
                FROM {self._client_notes_table}
                WHERE COALESCE(STATUS, 'active') <> 'archived'
                  AND COALESCE(NOTE_TEXT, '') <> ''
                UNION ALL
                SELECT
                    CONCAT('client-sql:', SQL_ASSET_ID),
                    'historical_sql',
                    'client_sql_asset',
                    SQL_ASSET_ID,
                    COALESCE(TITLE, CONCAT('SQL asset ', SQL_ASSET_ID)),
                    CONCAT(
                        'Document folder: historical_sql',
                        '\nProject id: ', COALESCE(PROJECT_ID, ''),
                        '\nEntity type: ', COALESCE(ENTITY_TYPE, ''),
                        '\nEntity ids: ', COALESCE(TO_VARCHAR(ENTITY_IDS), '[]'),
                        '\nTitle: ', COALESCE(TITLE, ''),
                        '\nSQL kind: ', COALESCE(SQL_KIND, ''),
                        '\nDialect: ', COALESCE(DIALECT, ''),
                        '\nDescription: ', COALESCE(DESCRIPTION, ''),
                        '\nSource label: ', COALESCE(SOURCE_LABEL, ''),
                        '\nAuthor: ', COALESCE(AUTHOR_NAME, ''),
                        '\nTags: ', COALESCE(TO_VARCHAR(TAGS), '[]'),
                        '\nSQL: ', COALESCE(SQL_TEXT, '')
                    ),
                    NULL,
                    NULL,
                    NULL,
                    NULL,
                    MD5(CONCAT(COALESCE(PROJECT_ID, ''), '|', COALESCE(TITLE, ''), '|', COALESCE(SQL_TEXT, ''))),
                    OBJECT_CONSTRUCT(
                        'project_id', PROJECT_ID,
                        'entity_type', ENTITY_TYPE,
                        'entity_ids', ENTITY_IDS,
                        'sql_kind', SQL_KIND,
                        'dialect', DIALECT,
                        'description', DESCRIPTION,
                        'source_label', SOURCE_LABEL,
                        'author_name', AUTHOR_NAME,
                        'tags', TAGS,
                        'attributes', ATTRIBUTES,
                        'status', STATUS
                    ),
                    UPDATED_AT
                FROM {self._client_sql_assets_table}
                WHERE COALESCE(STATUS, 'active') <> 'archived'
                  AND COALESCE(SQL_TEXT, '') <> ''
                """
            ).collect()

        return self._count_table(self._rag_documents_table)

    def ensure_search_service(self, *, rebuild: bool = False) -> str:
        self.ensure_storage_exists()
        self.sync_rag_documents()
        create_prefix = "CREATE OR REPLACE" if rebuild else "CREATE"
        try:
            self._session.sql(
                f"""
                {create_prefix} CORTEX SEARCH SERVICE {self._search_service_name}
                ON SEARCH_TEXT
                PRIMARY KEY (DOC_ID)
                ATTRIBUTES DOC_FOLDER, DOC_TYPE, TITLE, SEMANTIC_BUNDLE_ID, SEMANTIC_VIEW_NAME, UPDATED_AT
                WAREHOUSE = {self._quote_identifier(self._settings.snowflake_warehouse)}
                TARGET_LAG = '1 hour'
                REFRESH_MODE = INCREMENTAL
                INITIALIZE = ON_CREATE
                AS
                SELECT
                    DOC_ID, DOC_FOLDER, DOC_TYPE, TITLE, SEMANTIC_BUNDLE_ID,
                    SEMANTIC_VIEW_NAME, UPDATED_AT, SEARCH_TEXT
                FROM {self._rag_documents_table}
                """
            ).collect()
        except Exception as exc:
            message = str(exc)
            if not rebuild and "already exists" in message.lower():
                return self._search_service_name
            raise SnowflakeQueryError(f"Failed to ensure Cortex Search service exists: {exc}") from exc
        return self._search_service_name

    def search(
        self,
        *,
        query: str,
        limit: int,
        folders: list[str] | None = None,
        semantic_bundle_id: str | None = None,
        semantic_view_name: str | None = None,
    ) -> list[ConversationSearchHit]:
        search_service_name = self._search_service_name
        if search_service_name in self._search_preview_unavailable_services:
            return []

        payload = {
            "query": query,
            "columns": [
                "DOC_ID",
                "DOC_FOLDER",
                "DOC_TYPE",
                "TITLE",
                "SEARCH_TEXT",
                "SEMANTIC_BUNDLE_ID",
                "SEMANTIC_VIEW_NAME",
            ],
            "limit": max(limit * 4, limit),
        }
        try:
            rows = self._session.sql(
                f"""
                SELECT SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
                    {self._quote_literal(search_service_name)},
                    {self._json_literal(payload)}
                ) AS RESULT
                """
            ).collect()
        except Exception as exc:
            message = str(exc)
            if "Unknown user-defined function SNOWFLAKE.CORTEX.SEARCH_PREVIEW" in message:
                self._search_preview_unavailable_services.add(search_service_name)
                logger.warning(
                    "Cortex Search preview is unavailable for %s; disabling FIR search preview for this service.",
                    search_service_name,
                )
                return []
            raise SnowflakeQueryError(f"Failed to query Cortex Search service: {exc}") from exc
        if not rows:
            return []
        result_value = rows[0].as_dict().get("RESULT")
        if isinstance(result_value, str):
            parsed = json.loads(result_value)
        elif isinstance(result_value, dict):
            parsed = result_value
        else:
            parsed = json.loads(str(result_value))
        results = parsed.get("results") or []
        hits: list[ConversationSearchHit] = []
        folder_set = {item.strip().lower() for item in (folders or []) if item and item.strip()}
        folder_priority = {
            item.strip().lower(): index
            for index, item in enumerate(folders or [])
            if item and item.strip()
        }
        for item in results:
            if not isinstance(item, dict):
                continue
            folder = str(item.get("DOC_FOLDER") or "").strip().lower()
            bundle_value = str(item.get("SEMANTIC_BUNDLE_ID") or "").strip() or None
            view_value = str(item.get("SEMANTIC_VIEW_NAME") or "").strip() or None
            if folder_set and folder not in folder_set:
                continue
            if semantic_bundle_id and bundle_value != semantic_bundle_id:
                continue
            if semantic_view_name and view_value != semantic_view_name:
                continue
            scores = item.get("@scores") or {}
            score = None
            if isinstance(scores, dict):
                raw_score = scores.get("reranker_score") or scores.get("cosine_similarity") or scores.get("text_match")
                try:
                    score = float(raw_score) if raw_score is not None else None
                except (TypeError, ValueError):
                    score = None
            hits.append(
                ConversationSearchHit(
                    doc_id=str(item.get("DOC_ID") or ""),
                    doc_folder=str(item.get("DOC_FOLDER") or ""),
                    doc_type=str(item.get("DOC_TYPE") or ""),
                    title=str(item.get("TITLE") or "") or None,
                    snippet=str(item.get("SEARCH_TEXT") or "")[:400] or None,
                    semantic_bundle_id=bundle_value,
                    semantic_view_name=view_value,
                    score=score,
                )
            )
        if folder_priority:
            hits.sort(
                key=lambda item: (
                    folder_priority.get(item.doc_folder.strip().lower(), len(folder_priority)),
                    -999999.0 if item.score is None else -float(item.score),
                )
            )
        return hits[:limit]

    def sync_all(
        self,
        *,
        rebuild_search_service: bool = False,
        include_conversation_docs: bool = True,
        include_feedback_docs: bool = True,
        include_inference_docs: bool = True,
        include_recommendation_docs: bool = True,
        include_semantic_docs: bool = True,
        include_relationship_docs: bool = True,
        include_client_knowledge_docs: bool = True,
    ) -> dict[str, int | str]:
        self.ensure_storage_exists()
        relationship_count = self.sync_relationship_facts() if include_relationship_docs else self._count_table(
            self._relationship_facts_table
        )
        rag_count = self.sync_rag_documents(
            include_conversation_docs=include_conversation_docs,
            include_feedback_docs=include_feedback_docs,
            include_inference_docs=include_inference_docs,
            include_recommendation_docs=include_recommendation_docs,
            include_semantic_docs=include_semantic_docs,
            include_relationship_docs=include_relationship_docs,
            include_client_knowledge_docs=include_client_knowledge_docs,
        )
        service_name = self.ensure_search_service(rebuild=rebuild_search_service)
        return {
            "conversation_turn_count": self._count_table(self._turns_table),
            "feedback_count": self._count_table(self._feedback_table),
            "inference_count": self._count_table(self._assistant_inferences_table),
            "recommendation_count": self._count_table(self._recommendations_table),
            "relationship_fact_count": relationship_count,
            "rag_document_count": rag_count,
            "search_service": service_name,
        }

    def _count_table(self, table_name: str) -> int:
        rows = self._session.sql(f"SELECT COUNT(*) AS ROW_COUNT FROM {table_name}").collect()
        return int(rows[0].as_dict().get("ROW_COUNT") or 0) if rows else 0

    def find_fir_recommendations_for_context(
        self,
        *,
        selected_tables: list[str],
        target_table: str | None = None,
        project_id: str | None = None,
        sttm_id: str | None = None,
        user_id: str | None = None,
        recommendation_types: list[str] | None = None,
        context_key: str | None = None,
        source_set_hash: str | None = None,
        derived_set_hash: str | None = None,
        milestone: str | None = None,
        scope_key: str | None = None,
        scope_type: str | None = None,
        schema_fqn: str | None = None,
        candidate_tables: list[str] | None = None,
        target_agent: str = "APP_USER_NOTIFICATION",
        allow_search_fallback: bool = False,
        limit: int = 3,
    ) -> list[dict[str, Any]]:
        """Query FIR agent recommendations matching the user's current workspace context.

        Exact context identity is attempted first, followed by structured source,
        target, derived-set, and milestone identity. No broad table-overlap match is used.
        """
        fir_table = self._settings.qualify_metadata_object_name("TBL_FIR_AGENT_RECOMMENDATIONS")
        fir_360_table = self._settings.qualify_metadata_object_name("TBL_AGENT_FIR_360")
        checkpoint_table = self._settings.qualify_metadata_object_name(
            "TBL_FIR_CHECKPOINT_DEFINITIONS"
        )
        if (
            not selected_tables
            and not target_table
            and not context_key
            and not scope_key
            and not schema_fqn
            and not project_id
        ):
            return []

        type_filter = ""
        if recommendation_types:
            type_literals = ", ".join(self._quote_literal(t) for t in recommendation_types)
            type_filter = f"AND RECOMMENDATION_TYPE IN ({type_literals})"

        identity_filter_parts: list[str] = []
        if user_id:
            identity_filter_parts.append(
                "AND (COALESCE(r.USER_ID, '') = '' OR "
                f"r.USER_ID = {self._quote_literal(user_id)})"
            )
        if project_id:
            identity_filter_parts.append(
                "AND (COALESCE(r.PROJECT_ID, '') = '' OR "
                f"r.PROJECT_ID = {self._quote_literal(project_id)})"
            )
        if sttm_id:
            identity_filter_parts.append(
                "AND (COALESCE(r.STTM_ID, '') = '' OR "
                f"r.STTM_ID = {self._quote_literal(sttm_id)})"
            )
        identity_filter = "\n".join(identity_filter_parts)

        milestone_aliases = {
            "project_created": ("project_created", "on_project_create"),
            "project_opened": ("project_opened",),
            "mapping_created": ("mapping_created", "on_mapping_create"),
            "schema_browsed": ("schema_browsed",),
            "selection_changed": ("selection_changed", "on_source_selection"),
            "source_set_completed": ("source_set_completed",),
            "target_selected": ("target_selected", "on_target_selection"),
            "join_completed": ("join_completed", "on_join_creation"),
            "derived_source_planning": (
                "derived_source_planning",
                "on_derived_source_create",
            ),
            "derived_source_selected": (
                "derived_source_selected",
                "on_derived_source_select",
            ),
            "derived_source_saved": ("derived_source_saved", "on_derived_source_save"),
            "source_query_review": ("source_query_review",),
            "mapping_ready": ("mapping_ready",),
            "before_auto_map": ("before_auto_map", "on_mapping_start"),
            "on_auto_map_review": ("on_auto_map_review",),
            "on_transformation_review": (
                "on_transformation_review",
                "on_transform_request",
            ),
            "before_validation": ("before_validation",),
            "after_validation": ("after_validation",),
            "before_publish": ("before_publish",),
            "sttm_published": ("sttm_published", "on_sttm_publish", "on_publish"),
            "document_uploaded": ("document_uploaded", "on_document_upload"),
            "analyst_answer_review": ("analyst_answer_review",),
        }.get(str(milestone or "").strip().lower(), (str(milestone or "").strip(),))
        milestone_aliases = tuple(value for value in milestone_aliases if value)
        preferred_questions = {
            "project_created": ("Q1", "Q4", "Q10"),
            "project_opened": ("Q4", "Q10"),
            "mapping_created": ("Q1", "Q4"),
            "schema_browsed": ("Q1", "Q6"),
            "selection_changed": ("Q1",),
            "source_set_completed": ("Q6",),
            "target_selected": ("Q1",),
            "join_completed": ("Q6",),
            "derived_source_planning": ("Q7",),
            "derived_source_selected": ("Q7",),
            "derived_source_saved": ("Q7",),
            "source_query_review": ("Q6", "Q7"),
            "mapping_ready": ("Q1", "Q2", "Q6", "Q7"),
            "before_auto_map": ("Q1", "Q6"),
            "on_auto_map_review": ("Q2",),
            "on_transformation_review": ("Q7",),
            "before_validation": ("Q2", "Q6", "Q7"),
            "after_validation": ("Q2", "Q6", "Q7"),
            "before_publish": ("Q3", "Q5", "Q6", "Q7", "Q4", "Q10"),
            "sttm_published": ("Q8", "Q9"),
            "document_uploaded": ("Q1", "Q2", "Q6", "Q7"),
            "analyst_answer_review": ("Q9", "Q10"),
        }.get(str(milestone or "").strip().lower(), ())
        question_priority = "CASE WHEN QUESTION_ID IS NOT NULL THEN 10 ELSE 20 END"
        if preferred_questions:
            preferred_cases = " ".join(
                f"WHEN QUESTION_ID = {self._quote_literal(question_id)} THEN {index}"
                for index, question_id in enumerate(preferred_questions)
            )
            question_priority = (
                f"CASE {preferred_cases} WHEN QUESTION_ID IS NOT NULL THEN 10 ELSE 20 END"
            )
        trigger_scope = ""
        if milestone_aliases:
            literals = ", ".join(self._quote_literal(value) for value in milestone_aliases)
            trigger_scope = f"AND (MILESTONE IN ({literals}) OR TRIGGER_TYPE IN ({literals}))"

        def _query(
            match_predicate: str,
            *,
            scoped: bool = True,
            match_priority_expression: str = "1",
        ) -> list[Any]:
            return self._session.sql(f"""
                SELECT
                    AGENT_RECOMMENDATION_ID,
                    r.FIR_RECORD_ID,
                    RECOMMENDATION_TYPE,
                    RECOMMENDATION_PRIORITY,
                    CONFIDENCE,
                    DISPLAY_MESSAGE,
                    DISPLAY_OPTIONS,
                    ACTION_CONTRACT,
                    NOTIFICATION_LAYER,
                    APPLICABLE_PROJECTS,
                    APPLICABLE_TABLES,
                    APPLICABLE_COLUMNS,
                    APPLICABLE_SCHEMAS,
                    r.USER_ID,
                    r.PROJECT_ID,
                    r.STTM_ID,
                    r.CHECKPOINT,
                    SCOPE_TYPE,
                    SCOPE_KEY,
                    RECOMMENDATION_CATEGORY,
                    GROUP_KEY,
                    CONTENT_VERSION,
                    EVIDENCE_SUMMARY,
                    AGENT_NOTES,
                    AGENT_PAYLOAD,
                    f.FIR_INFERENCE_ID,
                    CONTEXT_KEY,
                    MILESTONE,
                    QUESTION_ID,
                    EVIDENCE_IDS,
                    VALIDATION_STATUS,
                    CREATED_AT,
                    c.ELIGIBLE_GOALS AS CHECKPOINT_ELIGIBLE_GOALS,
                    c.RECOMMENDATION_CATEGORIES AS CHECKPOINT_RECOMMENDATION_CATEGORIES,
                    c.MAX_INLINE_ITEMS AS CHECKPOINT_MAX_INLINE_ITEMS,
                    c.MAX_INTERRUPTIVE_QUESTIONS AS CHECKPOINT_MAX_INTERRUPTIVE_QUESTIONS,
                    c.DISPLAY_SURFACES AS CHECKPOINT_DISPLAY_SURFACES,
                    {match_priority_expression} AS MATCH_PRIORITY
                FROM {fir_table} r
                LEFT JOIN (
                    SELECT FIR_RECORD_ID, MAX(INFERENCE_ID) AS FIR_INFERENCE_ID
                    FROM {fir_360_table}
                    GROUP BY FIR_RECORD_ID
                ) f ON f.FIR_RECORD_ID = r.FIR_RECORD_ID
                LEFT JOIN (
                    SELECT CHECKPOINT_ID, ELIGIBLE_GOALS, RECOMMENDATION_CATEGORIES,
                           MAX_INLINE_ITEMS, MAX_INTERRUPTIVE_QUESTIONS, DISPLAY_SURFACES
                    FROM {checkpoint_table}
                    WHERE STATUS = 'active'
                ) c ON c.CHECKPOINT_ID = {self._quote_literal(str(milestone or "").strip().lower())}
                WHERE r.STATUS = 'active'
                  AND TARGET_AGENT = {self._quote_literal(target_agent)}
                  {type_filter}
                  {identity_filter}
                  {match_predicate}
                  {trigger_scope if scoped else ""}
                QUALIFY MATCH_PRIORITY = MIN(MATCH_PRIORITY) OVER ()
                ORDER BY MATCH_PRIORITY, {question_priority}, RECOMMENDATION_PRIORITY DESC,
                         CONFIDENCE DESC, CREATED_AT DESC
                LIMIT {max(1, limit)}
            """).collect()

        try:
            rows = []
            retrieval_mode = None
            identity_matches: list[tuple[str, int, str]] = []
            if context_key:
                identity_matches.append(
                    (
                        f"CONTEXT_KEY = {self._quote_literal(context_key)}",
                        1,
                        "exact_context",
                    )
                )
            if scope_key:
                identity_matches.append(
                    (
                        f"SCOPE_KEY = {self._quote_literal(scope_key)} "
                        f"AND COALESCE(SCOPE_TYPE, '') = {self._quote_literal(scope_type or '')}",
                        2,
                        "exact_scope",
                    )
                )
            if source_set_hash:
                source_identity = [
                    f"SOURCE_SET_HASH = {self._quote_literal(source_set_hash)}",
                ]
                if target_table and target_table.strip():
                    source_identity.append(
                        f"TARGET_FQN = {self._quote_literal(target_table.strip().upper())}"
                    )
                if derived_set_hash:
                    source_identity.append(
                        f"DERIVED_SET_HASH = {self._quote_literal(derived_set_hash)}"
                    )
                identity_matches.append(
                    (" AND ".join(source_identity), 3, "structured")
                )
            if schema_fqn:
                identity_matches.append(
                    (
                        "("
                        f"SCOPE_KEY = {self._quote_literal(scope_key or '')} "
                        "OR ARRAY_CONTAINS("
                        f"{self._quote_literal(schema_fqn.upper())}::VARIANT, "
                        "APPLICABLE_SCHEMAS"
                        "))",
                        4,
                        "structured",
                    )
                )
            if (
                project_id
                and not context_key
                and not scope_key
                and not schema_fqn
                and not source_set_hash
            ):
                identity_matches.append(
                    (
                        "(COALESCE(ARRAY_SIZE(APPLICABLE_PROJECTS), 0) = 0 "
                        f"OR ARRAY_CONTAINS({self._quote_literal(project_id)}::VARIANT, APPLICABLE_PROJECTS))",
                        5,
                        "project",
                    )
                )

            if identity_matches:
                ranked_matches: list[tuple[str, int, str]] = [
                    (
                        f"({predicate} {trigger_scope})" if trigger_scope else predicate,
                        priority,
                        mode,
                    )
                    for predicate, priority, mode in identity_matches
                ]
                if (
                    str(milestone or "").strip().lower() != "schema_browsed"
                    and (selected_tables or target_table)
                ):
                    relevant_tables = sorted(
                        {
                            value.strip().upper()
                            for value in [*selected_tables, target_table or ""]
                            if value and value.strip()
                        }
                    )
                    compatibility_parts = [
                        "(" + " OR ".join(
                            "ARRAY_CONTAINS("
                            f"{self._quote_literal(value)}::VARIANT, APPLICABLE_TABLES)"
                            for value in relevant_tables
                        ) + ")"
                    ]
                    if project_id and project_id.strip():
                        compatibility_parts.append(
                            "(COALESCE(ARRAY_SIZE(APPLICABLE_PROJECTS), 0) = 0 OR "
                            "ARRAY_CONTAINS("
                            f"{self._quote_literal(project_id.strip())}::VARIANT, "
                            "APPLICABLE_PROJECTS))"
                        )
                    ranked_matches.append(
                        (
                            " AND ".join(compatibility_parts),
                            10,
                            "compatible_knowledge",
                        )
                    )

                predicates = [item[0] for item in ranked_matches]
                priority_expression = "CASE " + " ".join(
                    f"WHEN ({predicate}) THEN {priority}"
                    for predicate, priority, _ in ranked_matches
                ) + " ELSE 99 END"
                rows = _query(
                    "AND (" + " OR ".join(f"({item})" for item in predicates) + ")",
                    scoped=False,
                    match_priority_expression=priority_expression,
                )
                if rows:
                    first = (
                        rows[0].as_dict()
                        if hasattr(rows[0], "as_dict")
                        else rows[0]
                    )
                    match_priority = int(first.get("MATCH_PRIORITY") or 99)
                    retrieval_mode = next(
                        (
                            mode
                            for _, priority, mode in ranked_matches
                            if priority == match_priority
                        ),
                        "structured",
                    )
            if (
                not rows
                and str(milestone or "").strip().lower() == "schema_browsed"
                and candidate_tables
            ):
                candidate_predicates = [
                    "ARRAY_CONTAINS("
                    f"{self._quote_literal(value.strip().upper())}::VARIANT, "
                    "APPLICABLE_TABLES)"
                    for value in sorted(set(candidate_tables))
                    if value and value.strip()
                ]
                if candidate_predicates:
                    rows = _query(
                        "AND (MILESTONE = 'selection_changed' "
                        "OR TRIGGER_TYPE IN ('selection_changed', 'on_source_selection')) "
                        "AND ("
                        + " OR ".join(candidate_predicates)
                        + ")",
                        scoped=False,
                    )
                    if rows:
                        retrieval_mode = "schema_candidate"
            if not rows and allow_search_fallback:
                search_query = " ".join(
                    value
                    for value in [
                        *selected_tables,
                        target_table or "",
                        schema_fqn or "",
                        milestone or "",
                    ]
                    if value
                ).strip()
                search_hits = self.search_fir_knowledge(
                    query_text=search_query,
                    checkpoint=milestone,
                    target_agent=target_agent,
                    target_fqn=target_table,
                    project_id=project_id,
                    limit=limit,
                )
                recommendation_ids = [
                    str(item.get("knowledge_id") or "")
                    for item in search_hits
                    if item.get("knowledge_type") == "recommendation"
                    and item.get("knowledge_id")
                ]
                if recommendation_ids:
                    id_literals = ", ".join(
                        self._quote_literal(value) for value in recommendation_ids
                    )
                    rows = _query(
                        f"AND AGENT_RECOMMENDATION_ID IN ({id_literals})"
                    )
                    retrieval_mode = "similar_context"
        except Exception:
            logger.warning("find_fir_recommendations_for_context query failed", exc_info=True)
            return []

        results: list[dict[str, Any]] = []

        def _parse_variant(value: Any, default: Any) -> Any:
            if value is None:
                return default
            if isinstance(value, str):
                try:
                    return json.loads(value)
                except (json.JSONDecodeError, TypeError):
                    return default
            return value

        for row in rows:
            data = row.as_dict() if hasattr(row, "as_dict") else row
            options = data.get("DISPLAY_OPTIONS")
            if isinstance(options, str):
                try:
                    options = json.loads(options)
                except (json.JSONDecodeError, TypeError):
                    options = None
            action_contract = _parse_variant(data.get("ACTION_CONTRACT"), [])

            applicable_projects = data.get("APPLICABLE_PROJECTS")
            if isinstance(applicable_projects, str):
                try:
                    applicable_projects = json.loads(applicable_projects)
                except (json.JSONDecodeError, TypeError):
                    applicable_projects = None

            applicable_tables = data.get("APPLICABLE_TABLES")
            if isinstance(applicable_tables, str):
                try:
                    applicable_tables = json.loads(applicable_tables)
                except (json.JSONDecodeError, TypeError):
                    applicable_tables = None
            applicable_schemas = _parse_variant(data.get("APPLICABLE_SCHEMAS"), [])

            raw_display = data.get("DISPLAY_MESSAGE")
            if not raw_display or str(raw_display).strip().lower() == "none":
                raw_display = None

            # Extract user-facing summary from AGENT_PAYLOAD
            agent_payload = data.get("AGENT_PAYLOAD")
            payload_summary = None
            payload_context = None
            if isinstance(agent_payload, str):
                try:
                    agent_payload = json.loads(agent_payload)
                except (json.JSONDecodeError, TypeError):
                    agent_payload = None
            if isinstance(agent_payload, dict):
                payload_summary = (
                    agent_payload.get("inference_summary")
                    or agent_payload.get("key_finding")
                    or agent_payload.get("notification_message")
                )
                payload_context = agent_payload.get("usage_context") or agent_payload.get("critical_constraint")

            display_message = raw_display or payload_summary or ""
            if isinstance(display_message, str) and display_message.strip().lower() == "none":
                display_message = ""

            results.append({
                "recommendation_id": data.get("AGENT_RECOMMENDATION_ID"),
                "fir_record_id": data.get("FIR_RECORD_ID"),
                "fir_inference_id": data.get("FIR_INFERENCE_ID"),
                "recommendation_type": data.get("RECOMMENDATION_TYPE"),
                "recommendation_priority": data.get("RECOMMENDATION_PRIORITY"),
                "confidence": data.get("CONFIDENCE"),
                "display_message": display_message,
                "display_context": payload_context or "",
                "display_options": options,
                "action_contract": action_contract,
                "notification_layer": data.get("NOTIFICATION_LAYER"),
                "applicable_projects": applicable_projects,
                "applicable_tables": applicable_tables,
                "applicable_schemas": applicable_schemas,
                "user_id": data.get("USER_ID"),
                "project_id": data.get("PROJECT_ID"),
                "sttm_id": data.get("STTM_ID"),
                "scope_type": data.get("SCOPE_TYPE"),
                "scope_key": data.get("SCOPE_KEY"),
                "recommendation_category": data.get("RECOMMENDATION_CATEGORY"),
                "group_key": data.get("GROUP_KEY"),
                "content_version": data.get("CONTENT_VERSION") or 1,
                "evidence_summary": data.get("EVIDENCE_SUMMARY"),
                "agent_payload": agent_payload if isinstance(agent_payload, dict) else {},
                "context_key": data.get("CONTEXT_KEY"),
                "milestone": (
                    milestone
                    if retrieval_mode in {"schema_candidate", "compatible_knowledge"}
                    else data.get("MILESTONE")
                ),
                "question_id": data.get("QUESTION_ID"),
                "evidence_ids": _parse_variant(data.get("EVIDENCE_IDS"), []),
                "validation_status": data.get("VALIDATION_STATUS"),
                "checkpoint_definition": {
                    "eligible_goals": _parse_variant(
                        data.get("CHECKPOINT_ELIGIBLE_GOALS"), []
                    ),
                    "recommendation_categories": _parse_variant(
                        data.get("CHECKPOINT_RECOMMENDATION_CATEGORIES"), []
                    ),
                    "max_inline_items": int(
                        data.get("CHECKPOINT_MAX_INLINE_ITEMS") or 5
                    ),
                    "max_interruptive_questions": int(
                        data.get("CHECKPOINT_MAX_INTERRUPTIVE_QUESTIONS") or 1
                    ),
                    "display_surfaces": _parse_variant(
                        data.get("CHECKPOINT_DISPLAY_SURFACES"), []
                    ),
                },
                "retrieval_mode": retrieval_mode or "structured",
                "created_at": data.get("CREATED_AT"),
            })

        if project_id and project_id.strip():
            results = [
                r for r in results
                if not r.get("applicable_projects")
                or project_id.strip() in (r.get("applicable_projects") or [])
            ]

        return results

    def search_fir_knowledge(
        self,
        *,
        query_text: str,
        checkpoint: str | None = None,
        target_agent: str | None = None,
        target_fqn: str | None = None,
        project_id: str | None = None,
        domain: str | None = None,
        mapping_lifecycle: str | None = None,
        grain: str | None = None,
        semantic_role: str | None = None,
        derived_source_present: bool | None = None,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Search validated FIR knowledge after deterministic retrieval misses."""
        if not query_text.strip():
            return []
        service = self._settings.qualify_metadata_object_name("CSS_FIR_KNOWLEDGE")
        escaped_query = query_text.replace("'", "''")
        try:
            rows = self._session.sql(
                f"""
                SELECT *
                FROM TABLE(
                    {service}!SEARCH(
                        query => '{escaped_query}',
                        columns => ['SEARCH_TEXT'],
                        limit => {max(1, min(limit * 4, 50))}
                    )
                )
                """
            ).collect()
        except Exception:
            logger.debug("CSS_FIR_KNOWLEDGE search failed", exc_info=True)
            return []

        compatible: list[dict[str, Any]] = []
        for row in rows:
            data = row.as_dict() if hasattr(row, "as_dict") else dict(row)
            row_checkpoint = str(data.get("CHECKPOINT") or "").strip().lower()
            row_agent = str(data.get("TARGET_AGENT") or "").strip().upper()
            row_target = str(data.get("TARGET_FQN") or "").strip().upper()
            row_project = str(data.get("PROJECT_ID") or "").strip()
            row_domain = str(data.get("DOMAIN") or "").strip().lower()
            row_lifecycle = str(data.get("MAPPING_LIFECYCLE") or "").strip().lower()
            row_grain = str(data.get("GRAIN") or "").strip().lower()
            row_role = str(data.get("SEMANTIC_ROLE") or "").strip().lower()
            row_derived = data.get("DERIVED_SOURCE_PRESENT")
            if checkpoint and row_checkpoint and row_checkpoint != checkpoint.strip().lower():
                continue
            if target_agent and row_agent and row_agent != target_agent.strip().upper():
                continue
            if target_fqn and row_target and row_target != target_fqn.strip().upper():
                continue
            if project_id and row_project and row_project != project_id.strip():
                continue
            if domain and row_domain and row_domain != domain.strip().lower():
                continue
            if (
                mapping_lifecycle
                and row_lifecycle
                and row_lifecycle != mapping_lifecycle.strip().lower()
            ):
                continue
            if grain and row_grain and row_grain != grain.strip().lower():
                continue
            if semantic_role and row_role and row_role != semantic_role.strip().lower():
                continue
            if (
                derived_source_present is not None
                and row_derived is not None
                and bool(row_derived) != derived_source_present
            ):
                continue
            if str(data.get("VALIDATION_STATUS") or "").lower() in {
                "rejected",
                "contradicted",
            }:
                continue
            if str(data.get("CONTRADICTION_STATUS") or "").lower() in {
                "rejected",
                "contradicted",
                "suppressed",
            }:
                continue
            compatible.append(
                {
                    "knowledge_id": data.get("KNOWLEDGE_ID"),
                    "knowledge_type": str(data.get("KNOWLEDGE_TYPE") or "").lower(),
                    "confidence": min(float(data.get("CONFIDENCE") or 0.5) * 0.9, 0.85),
                    "checkpoint": data.get("CHECKPOINT"),
                    "target_fqn": data.get("TARGET_FQN"),
                    "project_id": data.get("PROJECT_ID"),
                    "domain": data.get("DOMAIN"),
                    "mapping_lifecycle": data.get("MAPPING_LIFECYCLE"),
                    "grain": data.get("GRAIN"),
                    "semantic_role": data.get("SEMANTIC_ROLE"),
                    "derived_source_present": data.get("DERIVED_SOURCE_PRESENT"),
                    "search_text": data.get("SEARCH_TEXT"),
                }
            )
            if len(compatible) >= limit:
                break
        return compatible

    def readiness(self) -> dict[str, Any]:
        """Check runtime turn-write capability without mutating durable state."""
        try:
            self._session.sql(
                f"""
                INSERT INTO {self._turns_table} (
                    TURN_ID, CONVERSATION_ID, ROLE, ROUTE, INTENT_CLASS, MESSAGE
                )
                SELECT 'readiness_probe', 'readiness_probe', 'system',
                       'readiness', 'readiness', NULL
                WHERE 1 = 0
                """
            ).collect()
            return {"conversation_memory_writable": True, "error": None}
        except Exception as exc:
            logger.error("Conversation memory is not writable: %s", exc)
            increment("conversation_memory.readiness.not_writable")
            return {
                "conversation_memory_writable": False,
                "error": str(exc),
            }

    def prepared_cache_readiness(self) -> dict[str, Any]:
        """Report durable cache freshness without reading any cached payload."""
        result: dict[str, Any] = {}
        for label, object_name in (
            ("prepared_workspace", "TBL_PREPARED_WORKSPACE_CONTEXTS"),
            ("prepared_learning", "TBL_PREPARED_LEARNING_CONTEXTS"),
        ):
            table = self._settings.qualify_metadata_object_name(object_name)
            try:
                rows = self._session.sql(
                    f"SELECT COUNT(*) AS ROW_COUNT, MAX(UPDATED_AT) AS LAST_UPDATED_AT "
                    f"FROM {table}"
                ).collect()
                row = rows[0].as_dict() if rows else {}
                result[label] = {
                    "row_count": int(row.get("ROW_COUNT") or 0),
                    "last_updated_at": str(row.get("LAST_UPDATED_AT") or "") or None,
                    "readable": True,
                }
            except Exception as exc:
                result[label] = {
                    "row_count": None,
                    "last_updated_at": None,
                    "readable": False,
                    "error": str(exc),
                }
        return result
