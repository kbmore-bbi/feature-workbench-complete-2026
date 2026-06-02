from __future__ import annotations

import uuid

from fastapi import Request


def ensure_trace_id(request: Request) -> str:
    existing = getattr(request.state, "trace_id", None)
    if isinstance(existing, str) and existing:
        return existing

    for header_name in ("x-trace-id", "x-request-id", "x-correlation-id"):
        value = request.headers.get(header_name, "").strip()
        if value:
            request.state.trace_id = value
            return value

    trace_id = str(uuid.uuid4())
    request.state.trace_id = trace_id
    return trace_id
