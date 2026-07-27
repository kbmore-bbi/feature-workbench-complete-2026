from unittest.mock import MagicMock

from app.core.conversation_memory import ConversationMemoryService


def _memory_with_empty_results() -> tuple[ConversationMemoryService, MagicMock]:
    session = MagicMock()
    query = MagicMock()
    query.collect.return_value = []
    session.sql.return_value = query
    settings = MagicMock()
    settings.qualify_metadata_object_name.side_effect = (
        lambda name: f"TEST_DB.TEST_SCHEMA.{name}"
    )
    return ConversationMemoryService(session, settings), session


def test_fir_retrieval_ranks_context_and_structured_identity_in_one_query() -> None:
    memory, session = _memory_with_empty_results()

    result = memory.find_fir_recommendations_for_context(
        selected_tables=["DB.SRC.CUSTOMER"],
        target_table="DB.TGT.DIM_CUSTOMER",
        project_id="project-1",
        context_key="ctx_exact",
        source_set_hash="source-hash",
        derived_set_hash="derived-hash",
        milestone="before_auto_map",
    )

    assert result == []
    assert session.sql.call_count == 1
    query_sql = session.sql.call_args.args[0]
    assert "CONTEXT_KEY = 'ctx_exact'" in query_sql
    assert "SOURCE_SET_HASH = 'source-hash'" in query_sql
    assert "TARGET_FQN = 'DB.TGT.DIM_CUSTOMER'" in query_sql
    assert "DERIVED_SET_HASH = 'derived-hash'" in query_sql
    assert "MILESTONE IN ('before_auto_map', 'on_mapping_start')" in query_sql
    assert "TRIGGER_TYPE IN ('before_auto_map', 'on_mapping_start')" in query_sql
    assert "QUALIFY MATCH_PRIORITY = MIN(MATCH_PRIORITY) OVER ()" in query_sql
    assert "ARRAYS_OVERLAP" not in query_sql


def test_source_set_match_does_not_require_blank_target_before_target_selection() -> None:
    memory, session = _memory_with_empty_results()

    memory.find_fir_recommendations_for_context(
        selected_tables=["DB.SRC.CUSTOMER", "DB.SRC.NOTE"],
        source_set_hash="source-hash",
        derived_set_hash="derived-hash",
        milestone="source_set_completed",
    )

    query_sql = session.sql.call_args.args[0]
    assert "SOURCE_SET_HASH = 'source-hash'" in query_sql
    assert "DERIVED_SET_HASH = 'derived-hash'" in query_sql
    assert "COALESCE(TARGET_FQN, '') = ''" not in query_sql


def test_schema_browse_falls_back_to_visible_table_selection_guidance() -> None:
    memory, session = _memory_with_empty_results()

    memory.find_fir_recommendations_for_context(
        selected_tables=[],
        milestone="schema_browsed",
        schema_fqn="DB.SRC",
        scope_key="scope-schema",
        scope_type="schema",
        candidate_tables=["DB.SRC.CUSTOMER", "DB.SRC.NOTE"],
    )

    assert session.sql.call_count == 2
    candidate_sql = session.sql.call_args_list[1].args[0]
    assert "MILESTONE = 'selection_changed'" in candidate_sql
    assert "ARRAY_CONTAINS('DB.SRC.CUSTOMER'::VARIANT, APPLICABLE_TABLES)" in candidate_sql
    assert "ARRAY_CONTAINS('DB.SRC.NOTE'::VARIANT, APPLICABLE_TABLES)" in candidate_sql


def test_fir_retrieval_does_not_query_without_exact_identity() -> None:
    memory, session = _memory_with_empty_results()

    result = memory.find_fir_recommendations_for_context(
        selected_tables=["DB.SRC.CUSTOMER"],
        target_table=None,
    )

    assert result == []
    session.sql.assert_not_called()


def test_join_checkpoint_keeps_only_its_legacy_alias_eligible() -> None:
    memory, session = _memory_with_empty_results()

    memory.find_fir_recommendations_for_context(
        selected_tables=["DB.SRC.CUSTOMER", "DB.SRC.NOTE"],
        target_table="DB.TGT.DIM_CUSTOMER",
        source_set_hash="source-hash",
        derived_set_hash="derived-hash",
        milestone="join_completed",
    )

    query_sql = session.sql.call_args.args[0]
    assert "'on_join_creation'" in query_sql
    assert "'on_target_selection'" not in query_sql
    assert "'on_source_selection'" not in query_sql
    assert "MAX(INFERENCE_ID) AS FIR_INFERENCE_ID" in query_sql
    assert "LIMIT 1\n                    ) AS FIR_INFERENCE_ID" not in query_sql
    assert "TARGET_AGENT = 'APP_USER_NOTIFICATION'" in query_sql
    assert "'on_sttm_publish'" not in query_sql
    assert "WHEN QUESTION_ID = 'Q6' THEN 0" in query_sql
    assert "WHEN QUESTION_ID IS NOT NULL THEN 10 ELSE 20" in query_sql


def test_publish_checkpoint_prioritizes_structured_questions() -> None:
    memory, session = _memory_with_empty_results()

    memory.find_fir_recommendations_for_context(
        selected_tables=["DB.SRC.CUSTOMER"],
        target_table="DB.TGT.DIM_CUSTOMER",
        source_set_hash="source-hash",
        milestone="before_publish",
    )

    query_sql = session.sql.call_args.args[0]
    for index, question_id in enumerate(("Q3", "Q5", "Q6", "Q7", "Q4", "Q10")):
        assert f"WHEN QUESTION_ID = '{question_id}' THEN {index}" in query_sql
