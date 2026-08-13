from unittest.mock import MagicMock

from app.core.config import Settings
from app.core.conversation_memory import ConversationMemoryService


def test_record_turn_uses_bound_idempotent_merge() -> None:
    session = MagicMock()
    session.sql.return_value.collect.return_value = []
    settings = Settings(
        AUTH_MODE="custom_oauth",
        SPCS_EXECUTE_AS_CALLER_ENABLED=True,
        SNOWFLAKE_DATABASE="DB",
        SNOWFLAKE_SCHEMA="META",
        CONVERSATION_MEMORY_V2=True,
    )
    service = ConversationMemoryService(session, settings)

    first = service.record_turn(
        conversation_id="conversation-1",
        request_id="request-1",
        trace_id="trace-1",
        role="user",
        route="assistant",
        intent_class="mapping",
        message="Explain the mapping — safely.",
        citations=[],
        guardrails_meta={"status": "ok"},
        user_id="user-1",
    )
    second = service.record_turn(
        conversation_id="conversation-1",
        request_id="request-1",
        trace_id="trace-1",
        role="user",
        route="assistant",
        intent_class="mapping",
        message="Explain the mapping — safely.",
        citations=[],
        guardrails_meta={"status": "ok"},
        user_id="user-1",
    )

    assert first == second
    sql_call = session.sql.call_args_list[-1]
    assert "MERGE INTO" in sql_call.args[0]
    assert "PARSE_JSON(?)" in sql_call.args[0]
    assert sql_call.kwargs["params"][7] == "Explain the mapping — safely."


def test_readiness_reports_runtime_dml_capability() -> None:
    session = MagicMock()
    session.sql.return_value.collect.return_value = []
    service = ConversationMemoryService(
        session,
        Settings(
            AUTH_MODE="custom_oauth",
            SPCS_EXECUTE_AS_CALLER_ENABLED=True,
            SNOWFLAKE_DATABASE="DB",
            SNOWFLAKE_SCHEMA="META",
            CONVERSATION_MEMORY_V2=True,
        ),
    )

    assert service.readiness()["conversation_memory_writable"] is True
    statement = session.sql.call_args.args[0]
    assert "INSERT INTO" in statement
    assert "WHERE 1 = 0" in statement


def test_readiness_surfaces_caller_rights_failure() -> None:
    session = MagicMock()
    session.sql.side_effect = RuntimeError("insufficient privileges")
    service = ConversationMemoryService(
        session,
        Settings(
            SNOWFLAKE_DATABASE="DB",
            SNOWFLAKE_SCHEMA="META",
            CONVERSATION_MEMORY_V2=True,
        ),
    )

    readiness = service.readiness()
    assert readiness["conversation_memory_writable"] is False
    assert "insufficient privileges" in readiness["error"]
