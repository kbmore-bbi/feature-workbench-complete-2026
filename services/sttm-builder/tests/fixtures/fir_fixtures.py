"""Test fixtures for FIR system tests.

Provides sample data for unit and integration tests.
"""

import uuid
from datetime import datetime, timedelta


def generate_uuid() -> str:
    """Generate a UUID string."""
    return str(uuid.uuid4())


# ─── Sample Feedback Records ────────────────────────────────────────


def sample_explicit_feedback(
    feedback_id: str | None = None,
    user_id: str = "test_user",
    conversation_id: str | None = None,
    category: str = "agent_quality",
    rating: int = 4,
) -> dict:
    """Create a sample explicit feedback record."""
    return {
        "FEEDBACK_ID": feedback_id or generate_uuid(),
        "REQUEST_ID": generate_uuid(),
        "CONVERSATION_ID": conversation_id or generate_uuid(),
        "SIGNAL_ID": None,
        "FEEDBACK_TYPE": "agent_quality",
        "CATEGORY": category,
        "OPTION_SELECTED": "helpful",
        "RATING": rating,
        "COMMENT": "The mapping suggestion was accurate",
        "ENTITY_TYPE": "mapping_row",
        "ENTITY_ID": generate_uuid(),
        "SELECTION_CONTEXT": {"surface": "MAPPING"},
        "USER_ID": user_id,
        "CREATED_AT": datetime.utcnow().isoformat(),
    }


def sample_mapping_feedback(
    attribute_id: str | None = None,
    sttm_id: str | None = None,
    user_id: str = "test_user",
    mapping_source: str = "ai",
    event_type: str = "mapping.accept",
) -> dict:
    """Create a sample mapping feedback record (from STTM attributes)."""
    return {
        "ATTRIBUTE_ID": attribute_id or generate_uuid(),
        "STTM_ID": sttm_id or generate_uuid(),
        "VERSION_ID": generate_uuid(),
        "TARGET_COLUMN_NAME": "CUSTOMER_ID",
        "SOURCE_COLUMN_NAME": "CUST_KEY",
        "PROCESSING_RULE": "CAST(CUST_KEY AS VARCHAR)",
        "CONFIDENCE": 0.85,
        "MAPPING_SOURCE": mapping_source,
        "MAPPING_RATIONALE": "Direct customer identifier mapping",
        "TRANSFORMATION_EXPRESSION": "CAST(CUST_KEY AS VARCHAR(50))",
        "USER_ID": user_id,
        "CREATED_AT": datetime.utcnow().isoformat(),
        "UPDATED_AT": datetime.utcnow().isoformat(),
        "METADATA$ACTION": "INSERT",
        "METADATA$ISUPDATE": event_type == "mapping.edit",
    }


def sample_derived_source_feedback(
    derived_source_id: str | None = None,
    user_id: str = "test_user",
    semantic_bundle_id: str | None = None,
) -> dict:
    """Create a sample derived source feedback record."""
    return {
        "DERIVED_SOURCE_ID": derived_source_id or generate_uuid(),
        "DERIVED_SOURCE_NAME": "VW_CUSTOMER_360",
        "SQL_TEXT": "SELECT c.*, a.* FROM CUSTOMER c JOIN ACCOUNT a ON c.ID = a.CUST_ID",
        "PURPOSE": "Create unified customer view with accounts",
        "BUSINESS_DESCRIPTION": "Combines customer master data with account information",
        "SOURCE_TABLES": ["DB.SCHEMA.CUSTOMER", "DB.SCHEMA.ACCOUNT"],
        "RELATIONSHIPS": [
            {
                "left_table": "CUSTOMER",
                "right_table": "ACCOUNT",
                "join_type": "INNER",
                "on_columns": ["ID", "CUST_ID"],
            }
        ],
        "SEMANTIC_BUNDLE_ID": semantic_bundle_id or generate_uuid(),
        "CREATED_BY": user_id,
        "CREATED_AT": datetime.utcnow().isoformat(),
        "IS_ACTIVE": True,
        "METADATA$ACTION": "INSERT",
        "METADATA$ISUPDATE": False,
    }


def sample_conversation_feedback(
    turn_id: str | None = None,
    conversation_id: str | None = None,
    user_id: str = "test_user",
    agent_name: str = "AGT_STTM_BUILDER",
) -> dict:
    """Create a sample conversation feedback record."""
    return {
        "TURN_ID": turn_id or generate_uuid(),
        "CONVERSATION_ID": conversation_id or generate_uuid(),
        "REQUEST_ID": generate_uuid(),
        "ROLE": "assistant",
        "CONTENT": "I've analyzed the mapping request and suggest...",
        "AGENT_NAME": agent_name,
        "TOOL_CALLS": [{"name": "AGT_SOURCE_MAPPING", "arguments": {}}],
        "USER_ID": user_id,
        "CREATED_AT": datetime.utcnow().isoformat(),
    }


def sample_publish_feedback(
    version_id: str | None = None,
    sttm_id: str | None = None,
    user_id: str = "test_user",
) -> dict:
    """Create a sample STTM publish feedback record (high confidence)."""
    return {
        "VERSION_ID": version_id or generate_uuid(),
        "STTM_ID": sttm_id or generate_uuid(),
        "VERSION_NUMBER": 1,
        "VERSION_LABEL": "v1.0",
        "SNAPSHOT_PAYLOAD": {"mappings": [], "transformations": []},
        "PUBLISHED_BY": user_id,
        "PUBLISHED_AT": datetime.utcnow().isoformat(),
    }


# ─── Sample FIR 360 Records ─────────────────────────────────────────


def sample_fir_360_record(
    fir_record_id: str | None = None,
    source_type: str = "mapping_feedback",
    source_event_type: str = "mapping.accept",
    processing_stage: str = "pending",
    initial_confidence: float = 0.85,
) -> dict:
    """Create a sample FIR 360 record."""
    return {
        "FIR_RECORD_ID": fir_record_id or generate_uuid(),
        "FIR_RECORD_KEY": f"{source_type}:{generate_uuid()[:16]}",
        "FEEDBACK_ID": generate_uuid(),
        "INFERENCE_ID": None,
        "RECOMMENDATION_ID": None,
        "SOURCE_TYPE": source_type,
        "SOURCE_EVENT_TYPE": source_event_type,
        "USER_ID": "test_user",
        "SESSION_ID": generate_uuid(),
        "PROJECT_ID": generate_uuid(),
        "STTM_ID": generate_uuid(),
        "SEMANTIC_BUNDLE_ID": generate_uuid(),
        "ENTITY_TYPE": "mapping_attribute",
        "ENTITY_IDS": [generate_uuid()],
        "PROCESSING_STAGE": processing_stage,
        "PROCESSING_VERSION": "1.0",
        "FEEDBACK_PAYLOAD": {
            "target_column": "CUSTOMER_ID",
            "source_column": "CUST_KEY",
            "processing_rule": "CAST",
            "mapping_source": "ai",
            "ai_confidence": 0.85,
        },
        "INFERENCE_PAYLOAD": None,
        "RECOMMENDATION_PAYLOAD": None,
        "INITIAL_CONFIDENCE": initial_confidence,
        "CURRENT_CONFIDENCE": initial_confidence,
        "DECAY_FACTOR": 0.95,
        "LAST_DECAY_AT": None,
        "TARGET_AGENTS": ["AGT_SOURCE_MAPPING", "AGT_TRANSFORMATION_RULE"],
        "CREATED_AT": datetime.utcnow().isoformat(),
        "UPDATED_AT": datetime.utcnow().isoformat(),
        "PROCESSED_BY": None,
        "PROCESSING_ERROR": None,
    }


# ─── Sample Inference Records ───────────────────────────────────────


def sample_inference_record(
    inference_id: str | None = None,
    inference_type: str = "mapping_pattern",
    confidence: float = 0.85,
) -> dict:
    """Create a sample inference record."""
    return {
        "INFERENCE_ID": inference_id or generate_uuid(),
        "INFERENCE_KEY": f"{inference_type}:{generate_uuid()[:16]}",
        "REQUEST_ID": generate_uuid(),
        "CONVERSATION_ID": generate_uuid(),
        "SOURCE": "fir_system",
        "INFERENCE_TYPE": inference_type,
        "SUMMARY": f"Mapping pattern: CUST_KEY → CUSTOMER_ID with rule CAST",
        "CONFIDENCE": confidence,
        "ENTITY_TYPE": "mapping_attribute",
        "ENTITY_IDS": [generate_uuid()],
        "ATTRIBUTES": {
            "business_understanding": {
                "column_relationship": {
                    "source": "CUST_KEY",
                    "target": "CUSTOMER_ID",
                    "rule": "CAST",
                    "rationale": "Customer identifier mapping",
                }
            }
        },
        "STATUS": "active",
        "USER_ID": "test_user",
        "CREATED_AT": datetime.utcnow().isoformat(),
        "UPDATED_AT": datetime.utcnow().isoformat(),
    }


# ─── Sample Recommendation Records ──────────────────────────────────


def sample_recommendation_record(
    agent_recommendation_id: str | None = None,
    target_agent: str = "AGT_SOURCE_MAPPING",
    trigger_type: str = "on_mapping_start",
    recommendation_type: str = "pattern_reuse",
    confidence: float = 0.85,
    priority: int = 75,
) -> dict:
    """Create a sample agent recommendation record."""
    return {
        "AGENT_RECOMMENDATION_ID": agent_recommendation_id or generate_uuid(),
        "FIR_RECORD_ID": generate_uuid(),
        "TARGET_AGENT": target_agent,
        "TRIGGER_TYPE": trigger_type,
        "TRIGGER_CONDITION": None,
        "RECOMMENDATION_TYPE": recommendation_type,
        "RECOMMENDATION_PRIORITY": priority,
        "AGENT_PAYLOAD": {
            "recommendation_source": "fir_system",
            "mapping_pattern": {
                "source_column": "CUST_KEY",
                "target_column": "CUSTOMER_ID",
                "processing_rule": "CAST",
                "rationale": "Customer identifier mapping pattern",
            },
            "confidence": confidence,
        },
        "APPLICABLE_PROJECTS": None,
        "APPLICABLE_TABLES": ["DB.SCHEMA.CUSTOMER"],
        "APPLICABLE_COLUMNS": ["CUST_KEY", "CUSTOMER_ID"],
        "CONFIDENCE": confidence,
        "USAGE_COUNT": 0,
        "SUCCESS_COUNT": 0,
        "LAST_USED_AT": None,
        "CREATED_AT": datetime.utcnow().isoformat(),
        "UPDATED_AT": datetime.utcnow().isoformat(),
        "STATUS": "active",
    }


# ─── Sample Semantic Version Records ────────────────────────────────


def sample_semantic_version_chain() -> list[dict]:
    """Create a sample semantic version chain: RAW → CURATED_V1 → CURATED_V2."""
    raw_id = generate_uuid()
    v1_id = generate_uuid()
    v2_id = generate_uuid()
    view_fqn = "DB.SCHEMA.CUSTOMER"

    raw = {
        "VERSION_ID": raw_id,
        "SEMANTIC_VIEW_FQN": view_fqn,
        "VERSION_NUMBER": 0,
        "VERSION_LABEL": "RAW",
        "PARENT_VERSION_ID": None,
        "PROMOTION_REASON": "Initial raw semantic view",
        "BUSINESS_GLOSSARY": {},
        "RELATIONSHIP_RULES": [],
        "TRANSFORMATION_PATTERNS": [],
        "COLUMN_SEMANTICS": {},
        "DERIVED_SOURCE_PATTERNS": [],
        "LEARNING_SOURCES": [],
        "MAPPING_EXECUTION_IDS": [],
        "PROJECT_IDS": [],
        "CONFIDENCE": 0.5,
        "VALIDATION_STATUS": "validated",
        "STATUS": "superseded",
        "CREATED_AT": (datetime.utcnow() - timedelta(days=30)).isoformat(),
    }

    v1 = {
        "VERSION_ID": v1_id,
        "SEMANTIC_VIEW_FQN": view_fqn,
        "VERSION_NUMBER": 1,
        "VERSION_LABEL": "CURATED_V1",
        "PARENT_VERSION_ID": raw_id,
        "PROMOTION_REASON": "Created from 5 inferences",
        "BUSINESS_GLOSSARY": {
            "CUST_KEY": {
                "rationale": "Primary customer identifier",
                "maps_to": "CUSTOMER_ID",
            }
        },
        "RELATIONSHIP_RULES": [
            {
                "source_table": "CUSTOMER",
                "target_table": "ACCOUNT",
                "join_type": "INNER",
                "business_context": "Customer to account relationship",
            }
        ],
        "TRANSFORMATION_PATTERNS": [
            {"pattern": "CAST(CUST_KEY AS VARCHAR)", "rule_type": "CAST"}
        ],
        "COLUMN_SEMANTICS": {
            "CUST_KEY": {"mappings": [{"target": "CUSTOMER_ID", "rule": "CAST"}]}
        },
        "DERIVED_SOURCE_PATTERNS": [],
        "LEARNING_SOURCES": [generate_uuid() for _ in range(5)],
        "MAPPING_EXECUTION_IDS": [generate_uuid()],
        "PROJECT_IDS": [generate_uuid()],
        "CONFIDENCE": 0.75,
        "VALIDATION_STATUS": "validated",
        "STATUS": "superseded",
        "CREATED_AT": (datetime.utcnow() - timedelta(days=15)).isoformat(),
    }

    v2 = {
        "VERSION_ID": v2_id,
        "SEMANTIC_VIEW_FQN": view_fqn,
        "VERSION_NUMBER": 2,
        "VERSION_LABEL": "CURATED_V2",
        "PARENT_VERSION_ID": v1_id,
        "PROMOTION_REASON": "Created from 8 inferences",
        "BUSINESS_GLOSSARY": {
            **v1["BUSINESS_GLOSSARY"],
            "ACCT_NUM": {"rationale": "Account number identifier", "maps_to": "ACCOUNT_ID"},
        },
        "RELATIONSHIP_RULES": v1["RELATIONSHIP_RULES"],
        "TRANSFORMATION_PATTERNS": [
            *v1["TRANSFORMATION_PATTERNS"],
            {"pattern": "TRIM(UPPER(NAME))", "rule_type": "Custom"},
        ],
        "COLUMN_SEMANTICS": {
            **v1["COLUMN_SEMANTICS"],
            "ACCT_NUM": {"mappings": [{"target": "ACCOUNT_ID", "rule": "Direct"}]},
        },
        "DERIVED_SOURCE_PATTERNS": [
            {"name": "VW_CUSTOMER_360", "purpose": "Unified customer view"}
        ],
        "LEARNING_SOURCES": [generate_uuid() for _ in range(8)],
        "MAPPING_EXECUTION_IDS": [generate_uuid(), generate_uuid()],
        "PROJECT_IDS": [generate_uuid()],
        "CONFIDENCE": 0.85,
        "VALIDATION_STATUS": "validated",
        "STATUS": "active",
        "CREATED_AT": datetime.utcnow().isoformat(),
    }

    return [raw, v1, v2]


# ─── Sample Task Payloads ───────────────────────────────────────────


def sample_task_payload(
    task_type: str = "stream_triggered",
    batch_size: int = 100,
    collect_feedback: bool = True,
    generate_inferences: bool = True,
    create_semantic_versions: bool = True,
    generate_recommendations: bool = True,
    apply_decay: bool = False,
) -> dict:
    """Create a sample task payload for SP_FIR_ORCHESTRATE_BATCH."""
    return {
        "task_type": task_type,
        "streams_with_changes": [
            "STM_FIR_WORKBENCH_FEEDBACK",
            "STM_FIR_STTM_ATTRIBUTES",
        ],
        "batch_size": batch_size,
        "processing_options": {
            "collect_feedback": collect_feedback,
            "generate_inferences": generate_inferences,
            "create_semantic_versions": create_semantic_versions,
            "generate_recommendations": generate_recommendations,
            "apply_decay": apply_decay,
        },
    }


# ─── Confidence Decay Test Data ─────────────────────────────────────


def sample_records_for_decay_test() -> list[dict]:
    """Create FIR 360 records with different ages for decay testing."""
    now = datetime.utcnow()

    return [
        {
            **sample_fir_360_record(processing_stage="completed", initial_confidence=1.0),
            "CREATED_AT": (now - timedelta(days=0)).isoformat(),
        },
        {
            **sample_fir_360_record(processing_stage="completed", initial_confidence=1.0),
            "CREATED_AT": (now - timedelta(days=30)).isoformat(),
        },
        {
            **sample_fir_360_record(processing_stage="completed", initial_confidence=1.0),
            "CREATED_AT": (now - timedelta(days=60)).isoformat(),
        },
        {
            **sample_fir_360_record(processing_stage="completed", initial_confidence=1.0),
            "CREATED_AT": (now - timedelta(days=180)).isoformat(),
        },
        {
            **sample_fir_360_record(processing_stage="completed", initial_confidence=1.0),
            "CREATED_AT": (now - timedelta(days=365)).isoformat(),
        },
    ]
