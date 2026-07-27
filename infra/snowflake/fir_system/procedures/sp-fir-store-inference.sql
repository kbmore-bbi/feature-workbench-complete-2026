-- ============================================================
-- SP_FIR_STORE_INFERENCE
-- Thin CRUD tool for AGT_FIR_SYSTEM: stores the agent's inference analysis.
-- The agent provides ALL content (type, summary, understanding, reasoning).
-- This procedure just writes to the database.
-- ============================================================

-- The FIR 1.x procedure had seven required arguments. The 2.0 signature adds
-- optional evidence fields, which otherwise makes seven-argument calls
-- ambiguous during an in-place upgrade.
DROP PROCEDURE IF EXISTS __STTM_METADATA_NAMESPACE__.SP_FIR_STORE_INFERENCE(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, FLOAT, VARCHAR, VARCHAR
);

CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_STORE_INFERENCE(
    "FIR_RECORD_ID" VARCHAR,
    "INFERENCE_TYPE" VARCHAR,
    "SUMMARY" VARCHAR,
    "BUSINESS_UNDERSTANDING" VARCHAR,
    "CONFIDENCE" FLOAT,
    "AGENT_NOTES" VARCHAR,
    "AGENT_REASONING_PAYLOAD" VARCHAR DEFAULT NULL,
    "INFERENCE_GOAL_ID" VARCHAR DEFAULT NULL,
    "SUBJECT_KEY" VARCHAR DEFAULT NULL,
    "CONTEXT_KEY" VARCHAR DEFAULT NULL,
    "EVIDENCE_IDS" VARCHAR DEFAULT NULL,
    "CONTRADICTIONS" VARCHAR DEFAULT NULL,
    "VALIDATION_STATUS" VARCHAR DEFAULT 'unvalidated'
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'store_inference'
EXECUTE AS OWNER
AS
$$
import json
import uuid
from datetime import datetime


def store_inference(
    session,
    fir_record_id: str,
    inference_type: str,
    summary: str,
    business_understanding: str,
    confidence: float,
    agent_notes: str,
    agent_reasoning_payload: str = None,
    inference_goal_id: str = None,
    subject_key: str = None,
    context_key: str = None,
    evidence_ids: str = None,
    contradictions: str = None,
    validation_status: str = 'unvalidated'
) -> dict:
    """Store the agent's inference analysis into TBL_AGENT_FIR_360 and TBL_WORKBENCH_INFERENCES."""

    inference_id = str(uuid.uuid4())

    def _clean_identifier(value):
        if value is None:
            return None
        normalized = str(value).strip()
        if normalized.lower() in {'', 'none', 'null', 'undefined', 'n/a'}:
            return None
        return normalized

    fir_record_id = _clean_identifier(fir_record_id)
    inference_goal_id = _clean_identifier(inference_goal_id)
    subject_key = _clean_identifier(subject_key)
    context_key = _clean_identifier(context_key)
    validation_status = _clean_identifier(validation_status) or 'unvalidated'

    # The enriched FIR record is the authority for execution context. The
    # model may classify and explain an inference, but it cannot choose a
    # different context key for the stored learning.
    lineage_rows = session.sql("""
        SELECT FIR_RECORD_ID, CONTEXT_KEY, FIR_RECORD_KEY
        FROM __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
        WHERE FIR_RECORD_ID = ? OR FIR_RECORD_KEY = ?
        LIMIT 1
    """, [fir_record_id, fir_record_id]).collect() if fir_record_id else []
    if not lineage_rows:
        return {
            'status': 'rejected',
            'error': 'Unknown FIR record. Use fir_record_id exactly as returned by ReadPendingFIR.',
            'supplied_fir_record_id': fir_record_id,
        }

    lineage = lineage_rows[0]
    fir_record_id = _clean_identifier(lineage['FIR_RECORD_ID'])
    authoritative_context_key = (
        _clean_identifier(lineage['CONTEXT_KEY'])
        or _clean_identifier(lineage['FIR_RECORD_KEY'])
    )
    if authoritative_context_key:
        context_key = authoritative_context_key

    # Parse the business_understanding JSON string
    try:
        bu_parsed = json.loads(business_understanding) if business_understanding else {}
    except (json.JSONDecodeError, TypeError):
        bu_parsed = {'raw': business_understanding}

    # Parse agent_reasoning_payload if provided
    try:
        reasoning_parsed = json.loads(agent_reasoning_payload) if agent_reasoning_payload else None
    except (json.JSONDecodeError, TypeError):
        reasoning_parsed = {'raw': agent_reasoning_payload}
    try:
        evidence_parsed = json.loads(evidence_ids) if evidence_ids else []
    except (json.JSONDecodeError, TypeError):
        evidence_parsed = [evidence_ids] if evidence_ids else []
    try:
        contradictions_parsed = json.loads(contradictions) if contradictions else []
    except (json.JSONDecodeError, TypeError):
        contradictions_parsed = [contradictions] if contradictions else []
    confidence_band = 'high' if confidence >= 0.8 else 'medium' if confidence >= 0.55 else 'low'

    inference_payload = {
        'inference_id': inference_id,
        'inference_type': inference_type,
        'summary': summary,
        'confidence': confidence,
        'business_understanding': bu_parsed,
        'generated_by': 'AGT_FIR_SYSTEM',
        'generated_at': datetime.utcnow().isoformat()
    }

    # Update TBL_AGENT_FIR_360 with inference data
    reasoning_json = json.dumps(reasoning_parsed) if reasoning_parsed else '{}'
    session.sql("""
        UPDATE __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360
        SET INFERENCE_ID = ?,
            INFERENCE_PAYLOAD = PARSE_JSON(?),
            PROCESSING_STAGE = 'inference_generated',
            CURRENT_CONFIDENCE = ?,
            AGENT_NOTES = ?,
            AGENT_REASONING_PAYLOAD = PARSE_JSON(?),
            PROCESSED_BY = 'AGT_FIR_SYSTEM',
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE FIR_RECORD_ID = ?
    """, [
        inference_id,
        json.dumps(inference_payload),
        confidence,
        agent_notes,
        reasoning_json,
        fir_record_id
    ]).collect()

    # Also store in TBL_WORKBENCH_INFERENCES for Cortex Search indexing
    session.sql("""
        INSERT INTO __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES (
            INFERENCE_ID, INFERENCE_KEY, REQUEST_ID, SOURCE,
            INFERENCE_TYPE, SUMMARY, CONFIDENCE,
            ENTITY_TYPE, ATTRIBUTES,
            AGENT_NOTES, STATUS, CREATED_AT, UPDATED_AT
            , INFERENCE_GOAL_ID, SUBJECT_KEY, CONTEXT_KEY, STRUCTURED_ANSWER,
              CONFIDENCE_BAND, SUPPORT_COUNT, CONTRADICTION_COUNT, VALIDATION_STATUS
              , PROJECT_ID, STTM_ID, EVIDENCE_IDS, CONTRADICTIONS, PROVENANCE
        )
        SELECT ?, ?, ?, 'AGT_FIR_SYSTEM',
               ?, ?, ?,
               ?, PARSE_JSON(?),
               ?, 'active', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(),
               ?, ?, ?, PARSE_JSON(?), ?, ?, ?, ?,
               (SELECT PROJECT_ID FROM __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 WHERE FIR_RECORD_ID = ?),
               (SELECT STTM_ID FROM __STTM_METADATA_NAMESPACE__.TBL_AGENT_FIR_360 WHERE FIR_RECORD_ID = ?),
               PARSE_JSON(?), PARSE_JSON(?),
               OBJECT_CONSTRUCT('fir_record_id', ?, 'agent', 'AGT_FIR_SYSTEM', 'goal_version', '2.0')
        WHERE NOT EXISTS (
            SELECT 1 FROM __STTM_METADATA_NAMESPACE__.TBL_WORKBENCH_INFERENCES
            WHERE INFERENCE_ID = ?
        )
    """, [
        inference_id, f"fir_{fir_record_id}", fir_record_id,
        inference_type, summary, confidence,
        inference_type, json.dumps(bu_parsed),
        agent_notes,
        inference_goal_id, subject_key, context_key, json.dumps(bu_parsed),
        confidence_band, len(evidence_parsed), len(contradictions_parsed), validation_status,
        fir_record_id, fir_record_id, json.dumps(evidence_parsed), json.dumps(contradictions_parsed),
        fir_record_id, inference_id
    ]).collect()

    for evidence_id in evidence_parsed:
        session.sql("""
            INSERT INTO __STTM_METADATA_NAMESPACE__.TBL_FIR_INFERENCE_EVIDENCE (
                INFERENCE_EVIDENCE_ID, INFERENCE_ID, EVIDENCE_ID, EVIDENCE_TYPE,
                POLARITY, WEIGHT, EVIDENCE_PAYLOAD
            ) SELECT UUID_STRING(), ?, ?, 'fir_evidence', 'supports', 1.0, PARSE_JSON('{}')
        """, [inference_id, str(evidence_id)]).collect()
    for contradiction in contradictions_parsed:
        session.sql("""
            INSERT INTO __STTM_METADATA_NAMESPACE__.TBL_FIR_INFERENCE_EVIDENCE (
                INFERENCE_EVIDENCE_ID, INFERENCE_ID, EVIDENCE_ID, EVIDENCE_TYPE,
                POLARITY, WEIGHT, EVIDENCE_PAYLOAD
            ) SELECT UUID_STRING(), ?, ?, 'contradiction', 'contradicts', 1.0, PARSE_JSON(?)
        """, [inference_id, str(contradiction), json.dumps({'value': contradiction})]).collect()

    return {
        'status': 'success',
        'inference_id': inference_id,
        'fir_record_id': fir_record_id,
        'inference_type': inference_type,
        'confidence': confidence
        , 'inference_goal_id': inference_goal_id
        , 'context_key': context_key
    }
$$;
