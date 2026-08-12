from types import SimpleNamespace

import pytest

from app.core.cortex_completion import CortexCompletionUnavailable, complete_text


class _Query:
    def __init__(self, result=None, error: Exception | None = None) -> None:
        self.result = result
        self.error = error

    def collect(self):
        if self.error:
            raise self.error
        return [SimpleNamespace(as_dict=lambda recursive=True: {"RESPONSE": self.result})]


class _Session:
    def __init__(self, responses: list[object]) -> None:
        self.responses = responses
        self.queries: list[str] = []

    def sql(self, query: str, params=None):
        self.queries.append(query)
        response = self.responses.pop(0)
        return _Query(error=response) if isinstance(response, Exception) else _Query(response)


def test_complete_text_prefers_ai_complete() -> None:
    session = _Session(['{"overview":"ok"}'])
    assert complete_text(session, model="model", prompt="prompt") == '{"overview":"ok"}'
    assert session.queries == ["SELECT AI_COMPLETE(?, ?) AS RESPONSE"]


def test_complete_text_falls_back_for_unknown_current_function() -> None:
    session = _Session([
        RuntimeError("Unknown user-defined function AI_COMPLETE"),
        '{"overview":"legacy"}',
    ])
    assert "legacy" in complete_text(session, model="model", prompt="prompt")
    assert "SNOWFLAKE.CORTEX.COMPLETE" in session.queries[1]


def test_complete_text_reports_missing_caller_privilege() -> None:
    session = _Session([RuntimeError("insufficient privileges")])
    with pytest.raises(CortexCompletionUnavailable):
        complete_text(session, model="model", prompt="prompt")
