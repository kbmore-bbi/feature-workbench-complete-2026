from unittest.mock import MagicMock

from app.core.learning_retrieval import LearningRetrievalService
from app.schema.sttm_builder import LearningContext


class _Row:
    def __init__(self, **values):
        self._values = values

    def as_dict(self):
        return self._values


class _Query:
    def __init__(self, rows):
        self._rows = rows

    def collect(self):
        return self._rows


def test_link_scope_is_directed_from_current_workspace_only() -> None:
    session = MagicMock()

    def run(query: str):
        if "TBL_FIR_PROJECT_LINKS" in query:
            assert "PROJECT_ID = 'current_project'" in query
            assert "PRECEDENT_PROJECT_ID = 'current_project'" not in query
            return _Query(
                [
                    _Row(
                        PRECEDENT_PROJECT_ID="precedent_project",
                        PRIORITY=90,
                        KNOWLEDGE_CATEGORIES=["relationships", "mappings"],
                        ALLOW_PROJECT_SPECIFIC_VALUES=False,
                    )
                ]
            )
        assert "STTM_ID = 'current_mapping'" in query
        assert "PRECEDENT_STTM_ID = 'current_mapping'" not in query
        return _Query(
            [
                _Row(
                    PRECEDENT_STTM_ID="precedent_mapping",
                    PRIORITY=95,
                    KNOWLEDGE_CATEGORIES=["transformations"],
                    TARGET_COMPATIBILITY="same_role",
                    CONFIDENCE=0.92,
                    ALLOW_PROJECT_SPECIFIC_VALUES=False,
                )
            ]
        )

    session.sql.side_effect = run
    settings = MagicMock()
    settings.qualify_metadata_object_name.side_effect = lambda name: f"DB.META.{name}"
    service = LearningRetrievalService(session, settings)

    scope = service._get_link_scope(
        project_id="current_project",
        sttm_id="current_mapping",
    )

    assert scope["project_ids"] == ["precedent_project"]
    assert scope["sttm_ids"] == ["precedent_mapping"]
    assert [item["retrieval_mode"] for item in scope["explanations"]] == [
        "linked_project",
        "linked_mapping",
    ]


def test_complete_precedent_returns_all_rows_including_value_mappings() -> None:
    session = MagicMock()
    metadata = _Row(
        STTM_ID="1101",
        PROJECT_ID="903",
        STATUS="Complete",
        CURRENT_VERSION=1,
        LAST_SNAPSHOT_ID="snapshot-canonical",
        PARSED_MAPPING_MODEL={
            "join_patterns": [{"left_table": "CONTACTS", "right_table": "ADDRESSES"}],
            "business_rules": [{"rule_type": "qualify_filter"}],
            "ctes": [{"name": "households"}],
        },
        RAW_MAPPING_SQL="SELECT 1",
    )
    attributes = []
    for index in range(26):
        is_value = index in {0, 1, 3, 6}
        attributes.append(
            _Row(
                STTM_ID="1101",
                ATTRIBUTE_ID=str(index + 1),
                ATTRIBUTE_NAME=f"TARGET_{index + 1}",
                SOURCE_COLUMN=None if is_value else f"DB.SCH.SRC.COL_{index + 1}",
                DATA_TYPE="VARCHAR",
                TRANSFORMATION_LOGIC=(
                    "$Prefix || DB.SCH.SRC.COL_3" if index == 2 else None
                ),
                DESCRIPTION=f"Target {index + 1}",
                CONDITION=(
                    {
                        "mapping_mode": "constant",
                        "constant_value": "$ParentOfficeID" if index == 1 else f"$Value{index + 1}",
                        "source_columns": [],
                        "preprocessing_rule_type": "Value",
                    }
                    if is_value
                    else {
                        "mapping_mode": "source",
                        "source_columns": [f"DB.SCH.SRC.COL_{index + 1}"],
                        "preprocessing_rule": "Custom" if index == 2 else "Direct",
                    }
                ),
                EFFECTIVE_FROM_VERSION=1,
                EFFECTIVE_THROUGH_VERSION=None,
            )
        )

    session.sql.side_effect = [_Query([metadata]), _Query(attributes)]
    settings = MagicMock()
    settings.qualify_table_name.side_effect = lambda name: f"DB.META.{name}"
    service = LearningRetrievalService(session, settings)

    precedents = service._get_mapping_precedents(
        linked_sttm_ids=["1101"],
        link_explanations=[
            {
                "precedent_sttm_id": "1101",
                "priority": 100,
                "confidence": 1.0,
                "target_compatibility": "exact",
                "allow_project_specific_values": False,
            }
        ],
        target_columns=[f"TARGET_{index + 1}" for index in range(26)],
    )

    assert len(precedents) == 1
    assert len(precedents[0].mappings) == 26
    parent = precedents[0].mappings[1]
    assert parent["mapping_mode"] == "constant"
    assert parent["constant_value"] == "$ParentOfficeID"
    assert parent["source_columns"] == []
    assert precedents[0].mappings[2]["preprocessing_rule_type"] == "Custom"
    assert precedents[0].mappings[2]["preprocessing_rule"] == "$Prefix || DB.SCH.SRC.COL_3"
    assert precedents[0].relationships
    assert precedents[0].business_rules
    attribute_query = session.sql.call_args_list[1].args[0]
    assert "COALESCE(a.IS_DRAFT, FALSE) = FALSE" in attribute_query
    assert "UPPER(COALESCE(s.STATUS, '')) IN ('COMPLETE', 'PUBLISHED')" in attribute_query


def test_provided_mapping_intent_accepts_null_confidence() -> None:
    service = LearningRetrievalService(MagicMock(), MagicMock())

    intent = service._get_or_infer_mapping_intent(
        project_id="1101",
        target_table="DB.SCH.EVERNEST_HH",
        source_tables=["DB.SCH.CONTACTS"],
        provided_intent={
            "business_goal": "Build an eligible EverNest household row",
            "target_outcome": None,
            "lifecycle": None,
            "domain_hints": None,
            "captured_from": None,
            "confidence": None,
        },
    )

    assert intent is not None
    assert intent.target_outcome == ""
    assert intent.lifecycle == "initial"
    assert intent.domain_hints == []
    assert intent.captured_from == "user_response"
    assert intent.confidence == 0.8


def test_prepared_learning_context_hydrates_from_access_scoped_l2_cache() -> None:
    session = MagicMock()
    session.sql.return_value = _Query(
        [
            _Row(
                CONTEXT_PAYLOAD={
                    "learning_context_id": "learn_123",
                    "learning_context_hash": "abc123",
                    "cache_status": "miss",
                }
            )
        ]
    )
    settings = MagicMock()
    settings.qualify_metadata_object_name.side_effect = lambda name: f"DB.META.{name}"
    service = LearningRetrievalService(session, settings, access_scope="user:admin")

    result = service._load_durable_context("context-key")

    assert result is not None
    assert result.learning_context_id == "learn_123"
    assert result.cache_status == "l2"
    query = session.sql.call_args.args[0]
    assert "TBL_PREPARED_LEARNING_CONTEXTS" in query
    assert "ACCESS_FINGERPRINT" in query
    assert "DATEADD" in query


def test_prepared_learning_context_persists_exact_payload() -> None:
    session = MagicMock()
    session.sql.return_value = _Query([])
    settings = MagicMock()
    settings.qualify_metadata_object_name.side_effect = lambda name: f"DB.META.{name}"
    service = LearningRetrievalService(session, settings, access_scope="user:admin")

    service._persist_durable_context(
        "context-key",
        LearningContext(
            learning_context_id="learn_123",
            learning_context_hash="abc123",
        ),
    )

    query = session.sql.call_args.args[0]
    params = session.sql.call_args.kwargs["params"]
    assert "MERGE INTO DB.META.TBL_PREPARED_LEARNING_CONTEXTS" in query
    assert "PARSE_JSON(?)" in query
    assert params[2] == "learn_123"
    assert params[3] == "abc123"
