"""Signal Bus for real-time FIR recommendation delivery.

This module provides a pub/sub mechanism for delivering FIR signals
in real-time via WebSocket connections.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Awaitable
from uuid import uuid4

logger = logging.getLogger(__name__)


class SignalPriority(str, Enum):
    """Priority levels for signals."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFORMATIONAL = "informational"


class SignalLayer(str, Enum):
    """Display layer for signals."""
    INLINE = "inline"
    NOTIFICATION = "notification"
    TOAST = "toast"
    PANEL = "panel"


@dataclass
class Signal:
    """A signal to be delivered to the client."""
    signal_id: str
    signal_type: str
    title: str
    message: str
    priority: SignalPriority = SignalPriority.MEDIUM
    layer: SignalLayer = SignalLayer.NOTIFICATION
    options: list[dict[str, Any]] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    inference_id: str | None = None
    template_id: str | None = None
    expires_at: float | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert signal to dictionary for serialization."""
        return {
            "signal_id": self.signal_id,
            "signal_type": self.signal_type,
            "title": self.title,
            "message": self.message,
            "priority": self.priority.value,
            "layer": self.layer.value,
            "options": self.options,
            "metadata": self.metadata,
            "created_at": self.created_at,
            "inference_id": self.inference_id,
            "template_id": self.template_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Signal":
        """Create signal from dictionary."""
        return cls(
            signal_id=data.get("signal_id", str(uuid4())),
            signal_type=data.get("signal_type", "recommendation"),
            title=data.get("title", ""),
            message=data.get("message", ""),
            priority=SignalPriority(data.get("priority", "medium")),
            layer=SignalLayer(data.get("layer", "notification")),
            options=data.get("options"),
            metadata=data.get("metadata", {}),
            created_at=data.get("created_at", time.time()),
            inference_id=data.get("inference_id"),
            template_id=data.get("template_id"),
        )


class SignalBatcher:
    """Batches signals to prevent overwhelming the UI.

    Design decision: Max 3 signals per 30-second window.
    """

    MAX_SIGNALS_PER_WINDOW = 3
    WINDOW_SECONDS = 30.0
    PRIORITY_ORDER = [
        SignalPriority.CRITICAL,
        SignalPriority.HIGH,
        SignalPriority.MEDIUM,
        SignalPriority.LOW,
        SignalPriority.INFORMATIONAL,
    ]

    def __init__(
        self,
        max_signals: int = MAX_SIGNALS_PER_WINDOW,
        window_seconds: float = WINDOW_SECONDS,
    ) -> None:
        self._max_signals = max_signals
        self._window_seconds = window_seconds
        self._windows: dict[str, list[float]] = defaultdict(list)

    def can_send(self, session_id: str) -> bool:
        """Check if we can send another signal in this window."""
        self._cleanup_window(session_id)
        return len(self._windows[session_id]) < self._max_signals

    def record_send(self, session_id: str) -> None:
        """Record that a signal was sent."""
        self._cleanup_window(session_id)
        self._windows[session_id].append(time.time())

    def time_until_next_slot(self, session_id: str) -> float:
        """Return seconds until the next available slot."""
        self._cleanup_window(session_id)
        if len(self._windows[session_id]) < self._max_signals:
            return 0.0
        oldest = min(self._windows[session_id])
        return max(0.0, oldest + self._window_seconds - time.time())

    def batch_signals(self, signals: list[Signal]) -> list[Signal]:
        """Sort and limit signals by priority.

        Returns the top signals that should be sent, sorted by priority.
        """
        sorted_signals = sorted(
            signals,
            key=lambda s: (self.PRIORITY_ORDER.index(s.priority), s.created_at),
        )
        return sorted_signals[: self._max_signals]

    def _cleanup_window(self, session_id: str) -> None:
        """Remove expired timestamps from the window."""
        cutoff = time.time() - self._window_seconds
        self._windows[session_id] = [
            ts for ts in self._windows[session_id] if ts > cutoff
        ]


SignalCallback = Callable[[Signal], Awaitable[None]]


class SignalBus:
    """Pub/sub bus for delivering signals to WebSocket connections.

    Features:
    - Per-session subscriptions
    - Signal batching to prevent UI overload
    - Priority-based delivery
    - Pending signal queue for reconnection scenarios
    """

    def __init__(
        self,
        max_signals_per_window: int = SignalBatcher.MAX_SIGNALS_PER_WINDOW,
        window_seconds: float = SignalBatcher.WINDOW_SECONDS,
        max_pending_per_session: int = 20,
    ) -> None:
        self._subscriptions: dict[str, list[SignalCallback]] = defaultdict(list)
        self._pending_signals: dict[str, list[Signal]] = defaultdict(list)
        self._batcher = SignalBatcher(max_signals_per_window, window_seconds)
        self._max_pending = max_pending_per_session
        self._lock = asyncio.Lock()

    async def subscribe(
        self,
        session_id: str,
        callback: SignalCallback,
    ) -> None:
        """Subscribe to signals for a session.

        Args:
            session_id: The session identifier
            callback: Async function to call when a signal arrives
        """
        async with self._lock:
            self._subscriptions[session_id].append(callback)
            logger.debug("Subscribed to signals for session %s", session_id)

            pending = self._get_fresh_pending_signals(session_id)
            self._pending_signals.pop(session_id, None)
            if pending:
                logger.info(
                    "Delivering %d fresh pending signals to session %s (filtered out stale)",
                    len(pending),
                    session_id,
                )
                for signal in pending:
                    await self._deliver_signal(session_id, signal)

    async def unsubscribe(self, session_id: str, callback: SignalCallback | None = None) -> None:
        """Unsubscribe from signals for a session.

        Args:
            session_id: The session identifier
            callback: Specific callback to remove, or None to remove all
        """
        async with self._lock:
            if callback is None:
                self._subscriptions.pop(session_id, None)
            elif session_id in self._subscriptions:
                self._subscriptions[session_id] = [
                    cb for cb in self._subscriptions[session_id] if cb != callback
                ]
            logger.debug("Unsubscribed from signals for session %s", session_id)

    async def publish(
        self,
        session_id: str,
        signal: Signal,
        force: bool = False,
    ) -> bool:
        """Publish a signal to a session.

        Args:
            session_id: The session identifier
            signal: The signal to publish
            force: If True, bypass batching limits

        Returns:
            True if the signal was delivered, False if queued or dropped
        """
        async with self._lock:
            if session_id not in self._subscriptions or not self._subscriptions[session_id]:
                self._queue_pending(session_id, signal)
                return False

            if not force and not self._batcher.can_send(session_id):
                logger.debug(
                    "Rate limit reached for session %s, queueing signal %s",
                    session_id,
                    signal.signal_id,
                )
                self._queue_pending(session_id, signal)
                return False

            delivered = await self._deliver_signal(session_id, signal)
            if delivered:
                self._batcher.record_send(session_id)
            return delivered

    async def publish_batch(
        self,
        session_id: str,
        signals: list[Signal],
    ) -> list[str]:
        """Publish multiple signals, respecting batch limits.

        Args:
            session_id: The session identifier
            signals: List of signals to publish

        Returns:
            List of signal IDs that were delivered
        """
        batched = self._batcher.batch_signals(signals)
        delivered_ids = []

        for signal in batched:
            if await self.publish(session_id, signal):
                delivered_ids.append(signal.signal_id)

        remaining = [s for s in signals if s.signal_id not in delivered_ids]
        for signal in remaining:
            self._queue_pending(session_id, signal)

        return delivered_ids

    def get_pending(self, session_id: str) -> list[Signal]:
        """Get pending signals for a session."""
        return list(self._pending_signals.get(session_id, []))

    def clear_pending(self, session_id: str) -> int:
        """Clear pending signals for a session."""
        count = len(self._pending_signals.get(session_id, []))
        self._pending_signals.pop(session_id, None)
        return count

    def get_active_sessions(self) -> list[str]:
        """Return list of session IDs with active subscriptions."""
        return [sid for sid, cbs in self._subscriptions.items() if cbs]

    def get_stats(self) -> dict[str, Any]:
        """Get statistics about the signal bus."""
        return {
            "active_subscriptions": len(self._subscriptions),
            "sessions_with_pending": len(self._pending_signals),
            "total_pending_signals": sum(
                len(signals) for signals in self._pending_signals.values()
            ),
        }

    async def _deliver_signal(self, session_id: str, signal: Signal) -> bool:
        """Deliver a signal to all subscribers."""
        callbacks = self._subscriptions.get(session_id, [])
        if not callbacks:
            return False

        delivered = False
        for callback in callbacks:
            try:
                await callback(signal)
                delivered = True
            except Exception as exc:
                logger.warning(
                    "Failed to deliver signal %s to callback: %s",
                    signal.signal_id,
                    exc,
                )

        return delivered

    def _queue_pending(self, session_id: str, signal: Signal) -> None:
        """Queue a signal for later delivery."""
        pending = self._pending_signals[session_id]
        if len(pending) >= self._max_pending:
            pending = self._batcher.batch_signals(pending + [signal])
            pending = pending[: self._max_pending]
        else:
            pending.append(signal)
        self._pending_signals[session_id] = pending

    def _get_fresh_pending_signals(self, session_id: str) -> list[Signal]:
        """Get pending signals, filtering out expired ones.

        Signals are considered stale if:
        - They have an expires_at time that has passed
        - They are older than 1 minute (default max age)
        """
        now = time.time()
        max_age_seconds = 60  # 1 minute
        pending = self._pending_signals.get(session_id, [])
        fresh = []
        for signal in pending:
            if signal.expires_at and signal.expires_at < now:
                logger.debug("Filtering out expired signal %s", signal.signal_id)
                continue
            if now - signal.created_at > max_age_seconds:
                logger.debug("Filtering out stale signal %s (age: %.1fs)", signal.signal_id, now - signal.created_at)
                continue
            fresh.append(signal)
        return fresh


_global_signal_bus: SignalBus | None = None


def get_signal_bus() -> SignalBus:
    """Get the global signal bus instance."""
    global _global_signal_bus
    if _global_signal_bus is None:
        _global_signal_bus = SignalBus()
    return _global_signal_bus


def create_signal(
    signal_type: str,
    title: str,
    message: str,
    priority: SignalPriority | str = SignalPriority.MEDIUM,
    layer: SignalLayer | str = SignalLayer.NOTIFICATION,
    options: list[dict[str, Any]] | None = None,
    metadata: dict[str, Any] | None = None,
    inference_id: str | None = None,
    template_id: str | None = None,
) -> Signal:
    """Factory function to create a signal."""
    if isinstance(priority, str):
        priority = SignalPriority(priority)
    if isinstance(layer, str):
        layer = SignalLayer(layer)

    return Signal(
        signal_id=f"sig_{uuid4().hex[:16]}",
        signal_type=signal_type,
        title=title,
        message=message,
        priority=priority,
        layer=layer,
        options=options,
        metadata=metadata or {},
        inference_id=inference_id,
        template_id=template_id,
    )
