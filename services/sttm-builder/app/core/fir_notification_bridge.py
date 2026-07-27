"""FIR Notification Bridge — delivers agent recommendations to users via SignalBus.

Polls STM_FIR_RECOMMENDATIONS stream for new APP_USER_NOTIFICATION recommendations,
converts them to Signal objects, and publishes to active WebSocket sessions.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from .signal_bus import (
    Signal,
    SignalPriority,
    SignalLayer,
    get_signal_bus,
)
from .notification_scorer import score_notifications

logger = logging.getLogger(__name__)


def _priority_from_score(score: int) -> SignalPriority:
    if score >= 80:
        return SignalPriority.HIGH
    if score >= 50:
        return SignalPriority.MEDIUM
    if score >= 30:
        return SignalPriority.LOW
    return SignalPriority.INFORMATIONAL


def _layer_from_string(layer_str: str | None) -> SignalLayer:
    mapping = {
        "inline": SignalLayer.INLINE,
        "notification": SignalLayer.NOTIFICATION,
        "toast": SignalLayer.TOAST,
        "panel": SignalLayer.PANEL,
    }
    return mapping.get(layer_str or "notification", SignalLayer.NOTIFICATION)


class FIRNotificationBridge:
    """Bridges FIR agent recommendations to the WebSocket signal system.

    Polls the STM_FIR_RECOMMENDATIONS stream every poll_interval seconds.
    Converts APP_USER_NOTIFICATION recommendations into Signal objects
    and publishes them to the SignalBus for active sessions.
    """

    def __init__(
        self,
        session_factory,
        namespace: str,
        poll_interval: float = 5.0,
    ) -> None:
        self._session_factory = session_factory
        self._namespace = namespace
        self._poll_interval = poll_interval
        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._poll_loop())
        logger.info("FIR Notification Bridge started (poll_interval=%.1fs)", self._poll_interval)

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("FIR Notification Bridge stopped")

    async def _poll_loop(self) -> None:
        while self._running:
            try:
                await self._check_and_deliver()
            except Exception as exc:
                logger.error("FIR Notification Bridge poll error: %s", exc)
            await asyncio.sleep(self._poll_interval)

    async def _check_and_deliver(self) -> None:
        session = self._session_factory()
        has_data = session.sql(
            f"SELECT SYSTEM$STREAM_HAS_DATA('{self._namespace}.STM_FIR_RECOMMENDATIONS') AS HAS_DATA"
        ).collect()

        if not has_data or str(has_data[0]["HAS_DATA"]).lower() != "true":
            return

        rows = session.sql(f"""
            SELECT
                AGENT_RECOMMENDATION_ID,
                FIR_RECORD_ID,
                RECOMMENDATION_TYPE,
                RECOMMENDATION_PRIORITY,
                AGENT_PAYLOAD,
                AGENT_NOTES,
                DISPLAY_MESSAGE,
                DISPLAY_OPTIONS,
                NOTIFICATION_LAYER,
                CONFIDENCE,
                APPLICABLE_PROJECTS,
                APPLICABLE_TABLES,
                CONTEXT_KEY,
                MILESTONE,
                QUESTION_ID,
                EVIDENCE_IDS,
                CREATED_AT
            FROM {self._namespace}.STM_FIR_RECOMMENDATIONS
            WHERE TARGET_AGENT = 'APP_USER_NOTIFICATION'
              AND METADATA$ACTION = 'INSERT'
            ORDER BY RECOMMENDATION_PRIORITY DESC
        """).collect()

        if not rows:
            return

        logger.info("FIR Notification Bridge: %d new user notifications", len(rows))

        # Convert rows to dicts for scoring
        notification_dicts = []
        for row in rows:
            row_dict = row.as_dict() if hasattr(row, "as_dict") else row
            created_at = row_dict.get("CREATED_AT")
            notification_dicts.append({
                "recommendation_id": row_dict.get("AGENT_RECOMMENDATION_ID"),
                "fir_record_id": row_dict.get("FIR_RECORD_ID"),
                "recommendation_type": row_dict.get("RECOMMENDATION_TYPE"),
                "recommendation_priority": row_dict.get("RECOMMENDATION_PRIORITY", 50),
                "confidence": row_dict.get("CONFIDENCE", 0.5) * 100,
                "display_message": row_dict.get("DISPLAY_MESSAGE"),
                "display_options": row_dict.get("DISPLAY_OPTIONS"),
                "notification_layer": row_dict.get("NOTIFICATION_LAYER"),
                "applicable_projects": row_dict.get("APPLICABLE_PROJECTS"),
                "applicable_tables": row_dict.get("APPLICABLE_TABLES"),
                "agent_notes": row_dict.get("AGENT_NOTES"),
                "created_at": created_at.timestamp() if hasattr(created_at, "timestamp") else None,
                "_raw_row": row,
            })

        # Score and rank notifications (top 3 per delivery)
        scored = score_notifications(
            notification_dicts,
            active_project_id=None,
            mapped_tables=None,
            max_notifications=3,
        )

        logger.info(
            "FIR Notification Bridge: delivering %d/%d (scored)",
            len(scored), len(notification_dicts),
        )

        signal_bus = get_signal_bus()
        active_sessions = signal_bus.get_active_sessions()
        if not active_sessions:
            logger.debug("FIR Notification Bridge: no active sessions, deferring delivery")
            return

        for notif in scored:
            signal = self._row_to_signal(notif["_raw_row"])
            target_sessions = self._target_sessions(notif["_raw_row"])
            for sid in target_sessions.intersection(active_sessions):
                delivered = await signal_bus.publish(sid, signal)
                if delivered:
                    row_dict = notif["_raw_row"].as_dict() if hasattr(notif["_raw_row"], "as_dict") else notif["_raw_row"]
                    session.sql(f"""
                        INSERT INTO {self._namespace}.TBL_FIR_RECOMMENDATION_OUTCOMES (
                            OUTCOME_ID, AGENT_RECOMMENDATION_ID, CONTEXT_KEY,
                            USER_ID, OUTCOME_TYPE, OUTCOME_PAYLOAD
                        ) SELECT UUID_STRING(), ?, ?, '', 'shown', PARSE_JSON(?)
                    """, [
                        row_dict.get("AGENT_RECOMMENDATION_ID"),
                        row_dict.get("CONTEXT_KEY"),
                        json.dumps({"session_id": sid, "delivery": "websocket_bridge"}),
                    ]).collect()

    @staticmethod
    def _target_sessions(row: Any) -> set[str]:
        row_dict = row.as_dict() if hasattr(row, "as_dict") else row
        payload = row_dict.get("AGENT_PAYLOAD") or {}
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except (json.JSONDecodeError, TypeError):
                payload = {}
        delivery = payload.get("delivery_context") or {} if isinstance(payload, dict) else {}
        session_id = payload.get("session_id") if isinstance(payload, dict) else None
        session_id = session_id or (delivery.get("session_id") if isinstance(delivery, dict) else None)
        # Context-only recommendations are delivered by the UI checkpoint lookup,
        # never broadcast to unrelated active sessions.
        return {str(session_id)} if session_id else set()

    def _row_to_signal(self, row: Any) -> Signal:
        row_dict = row.as_dict() if hasattr(row, "as_dict") else row

        options = None
        raw_opts = row_dict.get("DISPLAY_OPTIONS")
        if raw_opts:
            if isinstance(raw_opts, str):
                try:
                    options = json.loads(raw_opts)
                except (json.JSONDecodeError, TypeError):
                    options = None
            elif isinstance(raw_opts, list):
                options = raw_opts
            else:
                try:
                    options = list(raw_opts) if raw_opts else None
                except (TypeError, ValueError):
                    options = None

        priority = _priority_from_score(row_dict.get("RECOMMENDATION_PRIORITY", 50))
        layer = _layer_from_string(row_dict.get("NOTIFICATION_LAYER"))
        rec_type = row_dict.get("RECOMMENDATION_TYPE", "recommendation")

        title_map = {
            "mapping_insight": "Mapping Insight",
            "feedback_question": "Question",
            "context_enrichment": "Context Update",
            "table_suggestion": "Table Suggestion",
            "pattern_reuse": "Pattern Detected",
        }

        return Signal(
            signal_id=row_dict["AGENT_RECOMMENDATION_ID"],
            signal_type=f"fir.{rec_type}",
            title=title_map.get(rec_type, "FIR Insight"),
            message=row_dict.get("DISPLAY_MESSAGE") or row_dict.get("AGENT_NOTES") or "",
            priority=priority,
            layer=layer,
            options=options,
            metadata={
                "recommendation_id": row_dict["AGENT_RECOMMENDATION_ID"],
                "fir_record_id": row_dict.get("FIR_RECORD_ID"),
                "confidence": row_dict.get("CONFIDENCE"),
                "recommendation_type": rec_type,
                "context_key": row_dict.get("CONTEXT_KEY"),
                "milestone": row_dict.get("MILESTONE"),
                "question_id": row_dict.get("QUESTION_ID"),
                "evidence_ids": row_dict.get("EVIDENCE_IDS") or [],
                "trigger": rec_type.replace("_", " ").title(),
            },
        )


_bridge_instance: FIRNotificationBridge | None = None


def get_notification_bridge() -> FIRNotificationBridge | None:
    return _bridge_instance


def init_notification_bridge(
    session_factory,
    namespace: str,
    poll_interval: float = 5.0,
) -> FIRNotificationBridge:
    global _bridge_instance
    _bridge_instance = FIRNotificationBridge(session_factory, namespace, poll_interval)
    return _bridge_instance
