from __future__ import annotations

import copy
import threading
import time
from collections.abc import Callable
from typing import Any, TypeVar

from app.core.performance import increment


_T = TypeVar("_T")
_LOCK = threading.Lock()
_VALUES: dict[str, tuple[float, Any]] = {}
_INFLIGHT: dict[str, threading.Event] = {}


def read_through(
    key: str,
    *,
    ttl_seconds: float,
    loader: Callable[[], _T],
    sliding: bool = False,
) -> _T:
    now = time.monotonic()
    with _LOCK:
        cached = _VALUES.get(key)
        if cached and cached[0] > now:
            if sliding:
                _VALUES[key] = (
                    now + max(0.1, ttl_seconds),
                    cached[1],
                )
            increment("backend_read_cache.hit")
            return copy.deepcopy(cached[1])
        if cached:
            _VALUES.pop(key, None)
            increment("backend_read_cache.stale")
        event = _INFLIGHT.get(key)
        if event is None:
            event = threading.Event()
            _INFLIGHT[key] = event
            owner = True
        else:
            owner = False
    if not owner:
        increment("backend_read_cache.coalesced_wait")
        event.wait(timeout=120)
        with _LOCK:
            cached = _VALUES.get(key)
            if cached and cached[0] > time.monotonic():
                if sliding:
                    _VALUES[key] = (
                        time.monotonic() + max(0.1, ttl_seconds),
                        cached[1],
                    )
                return copy.deepcopy(cached[1])
    increment("backend_read_cache.miss")
    try:
        value = loader()
        with _LOCK:
            _VALUES[key] = (time.monotonic() + max(0.1, ttl_seconds), copy.deepcopy(value))
        return value
    finally:
        if owner:
            with _LOCK:
                completed = _INFLIGHT.pop(key, None)
                if completed is not None:
                    completed.set()


def invalidate_read_cache(*prefixes: str) -> None:
    normalized = tuple(prefix for prefix in prefixes if prefix)
    with _LOCK:
        if not normalized:
            _VALUES.clear()
        else:
            for key in list(_VALUES):
                if key.startswith(normalized):
                    _VALUES.pop(key, None)
    increment("backend_read_cache.invalidate")


def cache_snapshot() -> dict[str, int]:
    with _LOCK:
        return {"entries": len(_VALUES), "inflight": len(_INFLIGHT)}
