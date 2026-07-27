"""FIR Event Triggers for real-time signal generation.

This module defines trigger points that evaluate FIR conditions
and generate signals based on user actions.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from app.core.signal_bus import (
    Signal,
    SignalPriority,
    SignalLayer,
    create_signal,
    get_signal_bus,
)

logger = logging.getLogger(__name__)


@dataclass
class TriggerContext:
    """Context passed to trigger functions."""
    session_id: str
    user_id: str | None
    project_id: str | None
    sttm_id: str | None = None
    conversation_id: str | None = None
    surface: str = "MAPPING"
    metadata: dict[str, Any] | None = None


class FIRTriggerService:
    """Service for evaluating FIR triggers and generating signals.

    Trigger points:
    - on_table_selection_change: User adds/removes source tables
    - on_target_selection: User selects target table
    - on_mapping_row_focus: User clicks on mapping row
    - on_mapping_edit: User modifies mapping
    - on_mapping_accept: User accepts AI suggestion
    - on_derived_source_created: User saves derived source
    - on_validation_complete: Validation finishes
    """

    def __init__(self, memory_service: Any = None) -> None:
        self._memory_service = memory_service
        self._signal_bus = get_signal_bus()

    async def on_table_selection_change(
        self,
        context: TriggerContext,
        tables: list[dict[str, Any]],
        action: str,  # "add" or "remove"
    ) -> list[Signal]:
        """Trigger when user adds or removes source tables.

        Generates signals for:
        - Relationship suggestions based on selected tables
        - Semantic context gaps (missing related tables)
        - Similar project patterns
        """
        signals: list[Signal] = []

        if len(tables) >= 2 and action == "add":
            signal = create_signal(
                signal_type="relationship_suggestion",
                title="Relationship Detected",
                message=f"Found potential relationships between {len(tables)} selected tables. Would you like to auto-detect join conditions?",
                priority=SignalPriority.MEDIUM,
                layer=SignalLayer.NOTIFICATION,
                options=[
                    {"id": "auto_detect", "label": "Auto-detect", "action": "detect_relationships"},
                    {"id": "manual", "label": "I'll define manually", "action": "dismiss"},
                ],
                metadata={
                    "trigger": "table_selection_change",
                    "table_count": len(tables),
                    "action": action,
                },
            )
            signals.append(signal)

        if action == "add" and len(tables) == 1:
            table = tables[0]
            table_name = table.get("table", table.get("table_name", ""))
            signal = create_signal(
                signal_type="semantic_hint",
                title="Table Added",
                message=f"Loading semantic context for {table_name}...",
                priority=SignalPriority.LOW,
                layer=SignalLayer.TOAST,
                metadata={
                    "trigger": "table_selection_change",
                    "table": table_name,
                },
            )
            signals.append(signal)

        await self._publish_signals(context.session_id, signals)
        return signals

    async def on_target_selection(
        self,
        context: TriggerContext,
        target_table: dict[str, Any],
        source_tables: list[dict[str, Any]],
    ) -> list[Signal]:
        """Trigger when user selects target table.

        Generates signals for:
        - Mapping intent capture prompt
        - Similar STTM hints from same/other projects
        """
        signals: list[Signal] = []

        target_name = target_table.get("table", target_table.get("table_name", ""))

        signal = create_signal(
            signal_type="mapping_intent_prompt",
            title="Mapping Intent",
            message=f"What's the goal for mapping to {target_name}? This helps me provide better suggestions.",
            priority=SignalPriority.MEDIUM,
            layer=SignalLayer.PANEL,
            options=[
                {"id": "migration", "label": "Data Migration", "value": "migration"},
                {"id": "consolidation", "label": "Data Consolidation", "value": "consolidation"},
                {"id": "transformation", "label": "Data Transformation", "value": "transformation"},
                {"id": "skip", "label": "Skip for now", "action": "dismiss"},
            ],
            metadata={
                "trigger": "target_selection",
                "target_table": target_name,
                "source_count": len(source_tables),
            },
        )
        signals.append(signal)

        await self._publish_signals(context.session_id, signals)
        return signals

    async def on_mapping_row_focus(
        self,
        context: TriggerContext,
        mapping_row: dict[str, Any],
        source_columns: list[dict[str, Any]],
    ) -> list[Signal]:
        """Trigger when user focuses on a mapping row.

        Generates signals for:
        - Source column suggestions with confidence
        - Confidence explanation
        - Alternative mapping options
        """
        signals: list[Signal] = []

        target_column = mapping_row.get("target_column", "")
        current_source = mapping_row.get("source_columns", [])
        confidence = mapping_row.get("confidence", 0)
        confidence_reason = mapping_row.get("confidence_reason", "")

        if confidence and confidence < 0.7 and not current_source:
            signal = create_signal(
                signal_type="mapping_suggestion",
                title="Low Confidence Mapping",
                message=f"The mapping for '{target_column}' has low confidence ({confidence:.0%}). {confidence_reason}",
                priority=SignalPriority.MEDIUM,
                layer=SignalLayer.INLINE,
                metadata={
                    "trigger": "mapping_row_focus",
                    "target_column": target_column,
                    "confidence": confidence,
                    "mapping_row_id": mapping_row.get("id"),
                },
            )
            signals.append(signal)

        alternatives = mapping_row.get("alternatives", [])
        if alternatives and len(alternatives) > 0:
            alt_list = ", ".join(
                f"{a.get('source_column')} ({a.get('confidence', 0):.0%})"
                for a in alternatives[:3]
            )
            signal = create_signal(
                signal_type="alternative_mappings",
                title="Alternative Sources",
                message=f"Other possible sources for '{target_column}': {alt_list}",
                priority=SignalPriority.LOW,
                layer=SignalLayer.INLINE,
                metadata={
                    "trigger": "mapping_row_focus",
                    "target_column": target_column,
                    "alternatives": alternatives[:3],
                },
            )
            signals.append(signal)

        await self._publish_signals(context.session_id, signals)
        return signals

    async def on_mapping_edit(
        self,
        context: TriggerContext,
        before_state: dict[str, Any],
        after_state: dict[str, Any],
    ) -> list[Signal]:
        """Trigger when user modifies a mapping.

        Generates signals for:
        - Correction feedback confirmation
        - Alternative suggestion based on edit
        - Similar pattern detection
        """
        signals: list[Signal] = []

        target_column = after_state.get("target_column", "")
        before_source = before_state.get("source_columns", [])
        after_source = after_state.get("source_columns", [])
        was_ai_suggested = before_state.get("was_ai_suggested", False)

        if was_ai_suggested and before_source != after_source:
            signal = create_signal(
                signal_type="correction_feedback",
                title="Mapping Corrected",
                message=f"Thanks for correcting the mapping for '{target_column}'. This helps improve future suggestions.",
                priority=SignalPriority.LOW,
                layer=SignalLayer.TOAST,
                metadata={
                    "trigger": "mapping_edit",
                    "target_column": target_column,
                    "before_source": before_source,
                    "after_source": after_source,
                    "was_correction": True,
                },
            )
            signals.append(signal)

        await self._publish_signals(context.session_id, signals)
        return signals

    async def on_mapping_accept(
        self,
        context: TriggerContext,
        mapping_row: dict[str, Any],
    ) -> list[Signal]:
        """Trigger when user accepts an AI-suggested mapping.

        Generates signals for:
        - Acceptance confirmation
        - Pattern learning notification
        """
        signals: list[Signal] = []

        target_column = mapping_row.get("target_column", "")
        confidence = mapping_row.get("confidence", 0)

        if confidence >= 0.9:
            signal = create_signal(
                signal_type="pattern_learned",
                title="Pattern Learned",
                message=f"High-confidence mapping accepted for '{target_column}'. This pattern will improve future suggestions.",
                priority=SignalPriority.LOW,
                layer=SignalLayer.TOAST,
                metadata={
                    "trigger": "mapping_accept",
                    "target_column": target_column,
                    "confidence": confidence,
                },
            )
            signals.append(signal)

        await self._publish_signals(context.session_id, signals)
        return signals

    async def on_derived_source_created(
        self,
        context: TriggerContext,
        derived_source: dict[str, Any],
    ) -> list[Signal]:
        """Trigger when user saves a derived source.

        Generates signals for:
        - Semantic enrichment suggestions
        - Relationship propagation hints
        """
        signals: list[Signal] = []

        source_name = derived_source.get("derived_source_name", "")
        source_tables = derived_source.get("source_tables", [])

        signal = create_signal(
            signal_type="derived_source_ready",
            title="Derived Source Created",
            message=f"'{source_name}' is ready. Semantic context from {len(source_tables)} base tables has been propagated.",
            priority=SignalPriority.MEDIUM,
            layer=SignalLayer.NOTIFICATION,
            metadata={
                "trigger": "derived_source_created",
                "derived_source_id": derived_source.get("derived_source_id"),
                "source_table_count": len(source_tables),
            },
        )
        signals.append(signal)

        await self._publish_signals(context.session_id, signals)
        return signals

    async def on_validation_complete(
        self,
        context: TriggerContext,
        validation_result: dict[str, Any],
    ) -> list[Signal]:
        """Trigger when validation finishes.

        Generates signals for:
        - Validation errors with fix suggestions
        - Validation success confirmation
        """
        signals: list[Signal] = []

        status = validation_result.get("status", "unknown")
        errors = validation_result.get("errors", [])
        warnings = validation_result.get("warnings", [])

        if status == "failed" and errors:
            error_summary = "; ".join(e.get("message", str(e))[:50] for e in errors[:3])
            signal = create_signal(
                signal_type="validation_error",
                title="Validation Failed",
                message=f"Found {len(errors)} error(s): {error_summary}",
                priority=SignalPriority.HIGH,
                layer=SignalLayer.NOTIFICATION,
                options=[
                    {"id": "view_errors", "label": "View All Errors", "action": "show_validation_details"},
                    {"id": "auto_fix", "label": "Suggest Fixes", "action": "suggest_fixes"},
                ],
                metadata={
                    "trigger": "validation_complete",
                    "status": status,
                    "error_count": len(errors),
                    "errors": errors[:5],
                },
            )
            signals.append(signal)
        elif status == "passed":
            if warnings:
                signal = create_signal(
                    signal_type="validation_warning",
                    title="Validation Passed with Warnings",
                    message=f"Validation passed, but found {len(warnings)} warning(s).",
                    priority=SignalPriority.MEDIUM,
                    layer=SignalLayer.NOTIFICATION,
                    metadata={
                        "trigger": "validation_complete",
                        "status": status,
                        "warning_count": len(warnings),
                    },
                )
            else:
                signal = create_signal(
                    signal_type="validation_success",
                    title="Validation Passed",
                    message="All mappings validated successfully.",
                    priority=SignalPriority.LOW,
                    layer=SignalLayer.TOAST,
                    metadata={
                        "trigger": "validation_complete",
                        "status": status,
                    },
                )
            signals.append(signal)

        await self._publish_signals(context.session_id, signals)
        return signals

    async def on_sttm_save(
        self,
        context: TriggerContext,
        sttm_data: dict[str, Any],
    ) -> list[Signal]:
        """Trigger when user saves an STTM.

        Generates signals for:
        - Save confirmation
        - Completeness hints
        """
        signals: list[Signal] = []

        mapping_count = len(sttm_data.get("mapping_rows", []))
        unmapped_count = sum(
            1 for row in sttm_data.get("mapping_rows", [])
            if not row.get("source_columns")
        )

        if unmapped_count > 0:
            signal = create_signal(
                signal_type="completeness_hint",
                title="Mappings Incomplete",
                message=f"Saved with {unmapped_count} unmapped column(s) out of {mapping_count}. Would you like suggestions?",
                priority=SignalPriority.MEDIUM,
                layer=SignalLayer.NOTIFICATION,
                options=[
                    {"id": "suggest", "label": "Get Suggestions", "action": "auto_map_remaining"},
                    {"id": "later", "label": "I'll complete later", "action": "dismiss"},
                ],
                metadata={
                    "trigger": "sttm_save",
                    "mapping_count": mapping_count,
                    "unmapped_count": unmapped_count,
                },
            )
            signals.append(signal)

        await self._publish_signals(context.session_id, signals)
        return signals

    async def on_feedback_submitted(
        self,
        context: TriggerContext,
        feedback: dict[str, Any],
    ) -> list[Signal]:
        """Trigger when user submits feedback.

        Generates signals for:
        - Feedback acknowledgment
        - Learning notification
        """
        signals: list[Signal] = []

        rating = feedback.get("rating", 0)
        category = feedback.get("category", "")

        if rating <= 2:
            signal = create_signal(
                signal_type="feedback_acknowledged",
                title="Feedback Received",
                message="Thanks for your feedback. We'll use this to improve our suggestions.",
                priority=SignalPriority.LOW,
                layer=SignalLayer.TOAST,
                metadata={
                    "trigger": "feedback_submitted",
                    "rating": rating,
                    "category": category,
                },
            )
            signals.append(signal)

        await self._publish_signals(context.session_id, signals)
        return signals

    async def _publish_signals(
        self,
        session_id: str,
        signals: list[Signal],
    ) -> None:
        """Publish signals to the signal bus."""
        if not signals:
            return

        try:
            await self._signal_bus.publish_batch(session_id, signals)
        except Exception as exc:
            logger.warning("Failed to publish signals: %s", exc)


_global_trigger_service: FIRTriggerService | None = None


def get_trigger_service(memory_service: Any = None) -> FIRTriggerService:
    """Get the global trigger service instance."""
    global _global_trigger_service
    if _global_trigger_service is None:
        _global_trigger_service = FIRTriggerService(memory_service)
    return _global_trigger_service
