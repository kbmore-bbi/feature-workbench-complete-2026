"""Small in-process performance counters for rollout diagnostics.

The registry deliberately stores counts and durations only. It never stores SQL,
tokens, user text, or semantic evidence. Snowflake query history remains the
source of truth for warehouse execution and credit measurements.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from contextlib import contextmanager
from typing import Any, Iterator


_LOCK = threading.Lock()
_COUNTERS: dict[str, int] = defaultdict(int)
_DURATIONS: dict[str, dict[str, float]] = defaultdict(
    lambda: {"count": 0.0, "total_ms": 0.0, "max_ms": 0.0}
)


def _metric_key(metric: str, labels: dict[str, Any]) -> str:
    if not labels:
        return metric
    suffix = ",".join(
        f"{key}={str(value)[:96]}" for key, value in sorted(labels.items())
    )
    return f"{metric}{{{suffix}}}"


def increment(metric: str, amount: int = 1, **labels: Any) -> None:
    with _LOCK:
        _COUNTERS[_metric_key(metric, labels)] += amount


def observe(metric: str, duration_ms: float, **labels: Any) -> None:
    with _LOCK:
        value = _DURATIONS[_metric_key(metric, labels)]
        value["count"] += 1
        value["total_ms"] += float(duration_ms)
        value["max_ms"] = max(value["max_ms"], float(duration_ms))


@contextmanager
def timed(metric: str) -> Iterator[None]:
    started = time.perf_counter()
    try:
        yield
    finally:
        observe(metric, (time.perf_counter() - started) * 1000)


def snapshot() -> dict[str, Any]:
    with _LOCK:
        durations = {
            name: {
                **values,
                "avg_ms": (
                    values["total_ms"] / values["count"]
                    if values["count"]
                    else 0.0
                ),
            }
            for name, values in _DURATIONS.items()
        }
        counters = dict(_COUNTERS)

        def total(prefixes: tuple[str, ...]) -> int:
            return sum(value for name, value in counters.items() if name.startswith(prefixes))

        prepared_hits = total(("prepared_context.cache.l1_hit", "prepared_context.cache.l2_hit"))
        prepared_misses = total(("prepared_context.cache.l1_miss", "prepared_context.cache.l2_miss"))
        learning_hits = total(("learning_context.cache.l1_hit", "learning_context.cache.l2_hit"))
        learning_misses = total(("learning_context.cache.l1_miss", "learning_context.cache.l2_miss"))
        return {
            "counters": counters,
            "durations": durations,
            "rates": {
                "prepared_context_hit_rate": prepared_hits / max(1, prepared_hits + prepared_misses),
                "learning_context_hit_rate": learning_hits / max(1, learning_hits + learning_misses),
            },
        }
