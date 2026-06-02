from __future__ import annotations

from typing import Any


_SAMPLE_KEYS = {"sample_values", "preview_rows", "rows", "raw_rows"}


def strip_sample_data(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            if key in _SAMPLE_KEYS:
                sanitized[key] = []
            else:
                sanitized[key] = strip_sample_data(item)
        return sanitized
    if isinstance(value, list):
        return [strip_sample_data(item) for item in value]
    return value
