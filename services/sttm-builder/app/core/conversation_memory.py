from __future__ import annotations

import json
import math
import uuid
from typing import Any

from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.exceptions import SnowflakeQueryError
from app.schema.conversation import ConversationSearchHit, EvidenceCitation, FeedbackInput


class ConversationMemoryService:
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
        parts = [part.strip() for part in name.split(".")]
        if len(parts) != 3 or not all(parts):
            raise SnowflakeQueryError(
                f"Expected fully qualified DATABASE.SCHEMA.OBJECT name, got '{name}'."
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
    def _relationship_facts_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_relationship_facts_table)

    @property
    def _rag_documents_table(self) -> str:
        return self._qualified_name(self._settings.snowflake_rag_documents_table)

    @property
    def _search_service_name(self) -> str:
        return self._settings.snowflake_rag_search_service

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
                CATEGORY STRING,
                RATING NUMBER,
                COMMENT STRING,
                USER_ID STRING,
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._recommendations_table} (
                RECOMMENDATION_ID STRING,
                REQUEST_ID STRING,
                CONVERSATION_ID STRING,
                MESSAGE STRING,
                CITATIONS VARIANT,
                APPROVAL_REQUIRED BOOLEAN,
                STATUS STRING,
                USER_ID STRING,
                CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
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
        ]
        for statement in statements:
            self._session.sql(statement).collect()

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
        turn_id = f"turn_{uuid.uuid4().hex[:16]}"
        self._session.sql(
            f"""
            INSERT INTO {self._turns_table} (
                TURN_ID, CONVERSATION_ID, REQUEST_ID, TRACE_ID, ROLE, ROUTE, INTENT_CLASS,
                MESSAGE, CITATIONS, GUARDRAILS_META, USER_ID
            )
            SELECT
                {self._quote_literal(turn_id)},
                {self._quote_literal(conversation_id)},
                {self._quote_literal(request_id or "")},
                {self._quote_literal(trace_id or "")},
                {self._quote_literal(role)},
                {self._quote_literal(route)},
                {self._quote_literal(intent_class)},
                {self._quote_literal(message or "")},
                PARSE_JSON({self._json_literal([item.model_dump(mode="json") for item in citations])}),
                PARSE_JSON({self._json_literal(guardrails_meta)}),
                {self._quote_literal(user_id or "")}
            """
        ).collect()
        return turn_id

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
                FEEDBACK_ID, REQUEST_ID, TARGET_REQUEST_ID, CONVERSATION_ID, CATEGORY,
                RATING, COMMENT, USER_ID
            )
            SELECT
                {self._quote_literal(feedback_id)},
                {self._quote_literal(request_id or "")},
                {self._quote_literal(feedback.target_request_id or "")},
                {self._quote_literal(conversation_id)},
                {self._quote_literal(feedback.category)},
                {str(feedback.rating) if feedback.rating is not None else 'NULL'},
                {self._quote_literal(feedback.comment or "")},
                {self._quote_literal(user_id or "")}
            """
        ).collect()
        return feedback_id

    def record_recommendation(
        self,
        *,
        request_id: str | None,
        conversation_id: str,
        message: str | None,
        citations: list[EvidenceCitation],
        approval_required: bool,
        status: str,
        user_id: str | None,
    ) -> str:
        self.ensure_storage_exists()
        recommendation_id = f"recommendation_{uuid.uuid4().hex[:16]}"
        self._session.sql(
            f"""
            INSERT INTO {self._recommendations_table} (
                RECOMMENDATION_ID, REQUEST_ID, CONVERSATION_ID, MESSAGE, CITATIONS,
                APPROVAL_REQUIRED, STATUS, USER_ID
            )
            SELECT
                {self._quote_literal(recommendation_id)},
                {self._quote_literal(request_id or "")},
                {self._quote_literal(conversation_id)},
                {self._quote_literal(message or "")},
                PARSE_JSON({self._json_literal([item.model_dump(mode="json") for item in citations])}),
                {str(bool(approval_required)).upper()},
                {self._quote_literal(status)},
                {self._quote_literal(user_id or "")}
            """
        ).collect()
        return recommendation_id

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

    def sync_rag_documents(
        self,
        *,
        include_conversation_docs: bool = True,
        include_feedback_docs: bool = True,
        include_recommendation_docs: bool = True,
        include_semantic_docs: bool = True,
        include_relationship_docs: bool = True,
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
        if include_recommendation_docs:
            folders.append("recommendations")
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
                        '\nCategory: ', COALESCE(CATEGORY, ''),
                        '\nRating: ', COALESCE(TO_VARCHAR(RATING), ''),
                        '\nComment: ', COALESCE(COMMENT, ''),
                        '\nTarget request id: ', COALESCE(TARGET_REQUEST_ID, '')
                    ),
                    NULL,
                    NULL,
                    REQUEST_ID,
                    CONVERSATION_ID,
                    MD5(CONCAT(COALESCE(CATEGORY, ''), '|', COALESCE(COMMENT, ''))),
                    OBJECT_CONSTRUCT(
                        'category', CATEGORY,
                        'rating', RATING,
                        'target_request_id', TARGET_REQUEST_ID
                    ),
                    CREATED_AT
                FROM {self._feedback_table}
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
                        '\nStatus: ', COALESCE(STATUS, ''),
                        '\nApproval required: ', IFF(APPROVAL_REQUIRED, 'true', 'false'),
                        '\nMessage: ', COALESCE(MESSAGE, ''),
                        '\nCitations: ', COALESCE(TO_VARCHAR(CITATIONS), '[]')
                    ),
                    NULL,
                    NULL,
                    REQUEST_ID,
                    CONVERSATION_ID,
                    MD5(COALESCE(MESSAGE, '')),
                    OBJECT_CONSTRUCT(
                        'citations', CITATIONS,
                        'approval_required', APPROVAL_REQUIRED,
                        'status', STATUS
                    ),
                    UPDATED_AT
                FROM {self._recommendations_table}
                WHERE COALESCE(MESSAGE, '') <> ''
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
                    {self._quote_literal(self._search_service_name)},
                    {self._json_literal(payload)}
                ) AS RESULT
                """
            ).collect()
        except Exception as exc:
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
        include_recommendation_docs: bool = True,
        include_semantic_docs: bool = True,
        include_relationship_docs: bool = True,
    ) -> dict[str, int | str]:
        self.ensure_storage_exists()
        relationship_count = self.sync_relationship_facts() if include_relationship_docs else self._count_table(
            self._relationship_facts_table
        )
        rag_count = self.sync_rag_documents(
            include_conversation_docs=include_conversation_docs,
            include_feedback_docs=include_feedback_docs,
            include_recommendation_docs=include_recommendation_docs,
            include_semantic_docs=include_semantic_docs,
            include_relationship_docs=include_relationship_docs,
        )
        service_name = self.ensure_search_service(rebuild=rebuild_search_service)
        return {
            "conversation_turn_count": self._count_table(self._turns_table),
            "feedback_count": self._count_table(self._feedback_table),
            "recommendation_count": self._count_table(self._recommendations_table),
            "relationship_fact_count": relationship_count,
            "rag_document_count": rag_count,
            "search_service": service_name,
        }

    def _count_table(self, table_name: str) -> int:
        rows = self._session.sql(f"SELECT COUNT(*) AS ROW_COUNT FROM {table_name}").collect()
        return int(rows[0].as_dict().get("ROW_COUNT") or 0) if rows else 0
