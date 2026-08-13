"""Compatibility wrapper for Snowflake text completion functions."""
from __future__ import annotations

from typing import Any


class CortexCompletionUnavailable(RuntimeError):
    """Raised when neither supported Snowflake completion function is callable."""


def _is_unknown_function(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "unknown user-defined function" in message
        or "unknown function" in message
        or "does not exist or not authorized" in message
    )


def _response_value(rows: list[Any]) -> Any:
    if not rows:
        return None
    row = rows[0]
    if hasattr(row, "as_dict"):
        data = row.as_dict(recursive=True)
        return data.get("RESPONSE") or data.get("response")
    if isinstance(row, dict):
        return row.get("RESPONSE") or row.get("response")
    return row[0]


def complete_text(session: Any, *, model: str, prompt: str) -> Any:
    """Call current AI_COMPLETE, falling back to legacy Cortex COMPLETE.

    AI_COMPLETE is Snowflake's current interface. The legacy function remains a
    compatibility path for accounts where the newer alias has not been enabled.
    Non-function errors (for example an invalid model) are preserved instead of
    being hidden behind a second call.
    """

    try:
        rows = session.sql(
            "SELECT AI_COMPLETE(?, ?) AS RESPONSE",
            params=[model, prompt],
        ).collect()
        response = _response_value(rows)
        if response is not None:
            return response
    except Exception as current_exc:
        if not _is_unknown_function(current_exc):
            raise CortexCompletionUnavailable(str(current_exc)) from current_exc

    try:
        rows = session.sql(
            "SELECT SNOWFLAKE.CORTEX.COMPLETE(?, ?) AS RESPONSE",
            params=[model, prompt],
        ).collect()
        return _response_value(rows)
    except Exception as legacy_exc:
        raise CortexCompletionUnavailable(
            "Snowflake AI completion is unavailable for the active caller role. "
            "Grant SNOWFLAKE.AI_FUNCTIONS_USER and confirm regional/model availability."
        ) from legacy_exc
