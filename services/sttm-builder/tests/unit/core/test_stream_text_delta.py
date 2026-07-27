from app.core.sttm_builder import (
    _StructuredAnswerDeltaFilter,
    _extract_stream_text_delta,
)


def test_extracts_cortex_agent_answer_token() -> None:
    assert (
        _extract_stream_text_delta(
            "response.text.delta",
            {"content_index": 0, "text": "Hello"},
        )
        == "Hello"
    )


def test_does_not_expose_cortex_agent_thinking_token() -> None:
    assert (
        _extract_stream_text_delta(
            "response.thinking.delta",
            {"content_index": 0, "text": "private reasoning"},
        )
        is None
    )


def test_structured_answer_filter_suppresses_chunked_json_contract() -> None:
    filter_ = _StructuredAnswerDeltaFilter()

    assert filter_.push("  ") is None
    assert filter_.push("{") is None
    assert filter_.push('"contract_version": "1.0"') is None


def test_structured_answer_filter_preserves_plain_markdown() -> None:
    filter_ = _StructuredAnswerDeltaFilter()

    assert filter_.push("## Result") == "## Result"
    assert filter_.push("\nThe answer is 2.") == "\nThe answer is 2."
