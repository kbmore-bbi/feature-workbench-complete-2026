-- ============================================================
-- SP_FIR_STORE_QA_PAIR
-- Stores a question-and-answer pair from user notification responses into
-- the semantic view's QA_HISTORY and the active curated version.
-- ============================================================

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_STORE_QA_PAIR(
    "SEMANTIC_VIEW_FQN" VARCHAR,
    "QUESTION" VARCHAR,
    "ANSWER" VARCHAR,
    "CONFIDENCE" FLOAT,
    "SOURCE_FIR_RECORD_ID" VARCHAR DEFAULT NULL,
    "AGENT_NOTES" VARCHAR DEFAULT NULL
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'store_qa_pair'
EXECUTE AS OWNER
AS
$$
import json
import uuid
from datetime import datetime


def store_qa_pair(
    session,
    semantic_view_fqn: str,
    question: str,
    answer: str,
    confidence: float,
    source_fir_record_id: str = None,
    agent_notes: str = None
) -> dict:
    """Store a question-and-answer pair in the active curated semantic version."""

    qa_id = str(uuid.uuid4())
    qa_pair = {
        'qa_id': qa_id,
        'question': question,
        'answer': answer,
        'confidence': confidence,
        'source_fir_record_id': source_fir_record_id,
        'agent_notes': agent_notes,
        'created_at': datetime.utcnow().isoformat()
    }

    # Base semantics are immutable agent output in the configured external registry.
    # User-confirmed Q&A belongs in the workbench curated overlay.
    session.sql("""
        UPDATE __STTM_METADATA_NAMESPACE__.TBL_SEMANTIC_VIEW_VERSIONS
        SET QA_PAIRS = ARRAY_APPEND(COALESCE(QA_PAIRS, ARRAY_CONSTRUCT()), PARSE_JSON(?)),
            AGENT_NOTES = COALESCE(AGENT_NOTES, '') || '\n[QA] ' || ?,
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE SEMANTIC_VIEW_FQN = ?
          AND STATUS = 'active'
          AND VERSION_LABEL LIKE 'CURATED_%'
    """, [json.dumps(qa_pair), question[:100], semantic_view_fqn]).collect()

    return {
        'status': 'success',
        'qa_id': qa_id,
        'semantic_view_fqn': semantic_view_fqn,
        'question': question[:100],
        'answer': answer[:100]
    }
$$;
