import threading
import time

import app.core.read_cache as read_cache_module
from app.core.read_cache import invalidate_read_cache, read_through


def test_read_cache_is_key_isolated_and_invalidates_by_prefix() -> None:
    invalidate_read_cache()
    calls = []

    def loader(value):
        calls.append(value)
        return {"value": value}

    assert read_through("projects:user-a", ttl_seconds=15, loader=lambda: loader("a")) == {"value": "a"}
    assert read_through("projects:user-a", ttl_seconds=15, loader=lambda: loader("changed")) == {"value": "a"}
    assert read_through("projects:user-b", ttl_seconds=15, loader=lambda: loader("b")) == {"value": "b"}
    invalidate_read_cache("projects:user-a")
    assert read_through("projects:user-a", ttl_seconds=15, loader=lambda: loader("a2")) == {"value": "a2"}
    assert calls == ["a", "b", "a2"]


def test_read_cache_singleflight_builds_once() -> None:
    invalidate_read_cache()
    started = threading.Event()
    release = threading.Event()
    calls = 0
    results = []

    def loader():
        nonlocal calls
        calls += 1
        started.set()
        release.wait(timeout=2)
        return {"complete": True}

    threads = [
        threading.Thread(
            target=lambda: results.append(
                read_through("recommendations:same", ttl_seconds=15, loader=loader)
            )
        )
        for _ in range(4)
    ]
    for thread in threads:
        thread.start()
    assert started.wait(timeout=1)
    time.sleep(0.05)
    release.set()
    for thread in threads:
        thread.join(timeout=2)

    assert calls == 1
    assert results == [{"complete": True}] * 4


def test_sliding_cache_renews_expiry_until_idle(monkeypatch) -> None:
    invalidate_read_cache()
    clock = [100.0]
    calls = []
    monkeypatch.setattr(read_cache_module.time, "monotonic", lambda: clock[0])

    def loader():
        calls.append(clock[0])
        return {"loaded_at": clock[0]}

    assert read_through(
        "projects:sliding",
        ttl_seconds=300,
        loader=loader,
        sliding=True,
    ) == {"loaded_at": 100.0}

    # Each active read renews the five-minute idle deadline.
    clock[0] = 350.0
    assert read_through(
        "projects:sliding",
        ttl_seconds=300,
        loader=loader,
        sliding=True,
    ) == {"loaded_at": 100.0}
    clock[0] = 600.0
    assert read_through(
        "projects:sliding",
        ttl_seconds=300,
        loader=loader,
        sliding=True,
    ) == {"loaded_at": 100.0}

    # More than five idle minutes forces a fresh Snowflake-backed load.
    clock[0] = 901.0
    assert read_through(
        "projects:sliding",
        ttl_seconds=300,
        loader=loader,
        sliding=True,
    ) == {"loaded_at": 901.0}
    assert calls == [100.0, 901.0]
