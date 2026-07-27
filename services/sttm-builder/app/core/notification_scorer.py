"""Notification Scorer — ranks AGT_FIR_SYSTEM notifications for display priority.

Rule-based scoring system that evaluates notifications on confidence, priority,
project relevance, recency, and response likelihood. Used to determine which
notifications surface to the user first.
"""
from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Weight configuration
# ---------------------------------------------------------------------------

WEIGHT_CONFIDENCE = 0.30
WEIGHT_PRIORITY = 0.20
WEIGHT_PROJECT_RELEVANCE = 0.25
WEIGHT_RECENCY = 0.15
WEIGHT_RESPONSE_LIKELIHOOD = 0.10

# Recency decay window in seconds (24 hours)
RECENCY_DECAY_WINDOW_SECONDS = 24 * 60 * 60

# Response likelihood scores by notification type (0-100 scale)
RESPONSE_LIKELIHOOD_BY_TYPE: dict[str, float] = {
    "feedback_question": 100.0,
    "mapping_insight": 70.0,
    "context_enrichment": 40.0,
}
DEFAULT_RESPONSE_LIKELIHOOD = 50.0

# Boost/penalty multipliers
PROJECT_MISMATCH_PENALTY = 0.50  # reduce score by 50%
TABLE_MATCH_BOOST = 1.20  # boost score by 20%


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------


def _score_confidence(notification: dict[str, Any]) -> float:
    """Extract and normalize confidence to 0-100 scale."""
    confidence = notification.get("confidence")
    if confidence is None:
        return 50.0  # neutral default
    # Clamp to 0-100
    return max(0.0, min(100.0, float(confidence)))


def _score_priority(notification: dict[str, Any]) -> float:
    """Normalize recommendation_priority to 0-100 scale.

    Expects priority as an integer 1-100 (from the FIR recommendations table).
    """
    priority = notification.get("recommendation_priority")
    if priority is None:
        return 50.0  # neutral default
    return max(0.0, min(100.0, float(priority)))


def _score_recency(notification: dict[str, Any]) -> float:
    """Score based on how recent the notification is.

    Uses `created_at` (epoch seconds). Newer notifications score higher,
    decaying linearly to 0 over RECENCY_DECAY_WINDOW_SECONDS.
    """
    created_at = notification.get("created_at")
    if created_at is None:
        return 50.0  # neutral default if no timestamp

    age_seconds = time.time() - float(created_at)
    if age_seconds <= 0:
        return 100.0
    if age_seconds >= RECENCY_DECAY_WINDOW_SECONDS:
        return 0.0

    # Linear decay from 100 to 0 over the window
    return (1.0 - (age_seconds / RECENCY_DECAY_WINDOW_SECONDS)) * 100.0


def _score_response_likelihood(notification: dict[str, Any]) -> float:
    """Score based on notification type and expected response likelihood."""
    notification_type = (
        notification.get("recommendation_type")
        or notification.get("notification_type")
        or ""
    )
    return RESPONSE_LIKELIHOOD_BY_TYPE.get(
        notification_type, DEFAULT_RESPONSE_LIKELIHOOD
    )


def _score_project_relevance(
    notification: dict[str, Any],
    active_project_id: str | None,
) -> float:
    """Score based on whether the notification applies to the active project.

    Returns 100 if applicable_projects is not set (global notification)
    or if the active project is in the list. Returns 50 otherwise
    (the penalty is applied separately as a multiplier).
    """
    applicable_projects = notification.get("applicable_projects")
    if not applicable_projects:
        # No restriction — globally relevant
        return 100.0
    if active_project_id and active_project_id in applicable_projects:
        return 100.0
    # Project not in applicable list — base relevance is low
    return 20.0


# ---------------------------------------------------------------------------
# Main scoring function
# ---------------------------------------------------------------------------


def _compute_base_score(
    notification: dict[str, Any],
    active_project_id: str | None,
) -> float:
    """Compute weighted base score for a single notification."""
    score = (
        WEIGHT_CONFIDENCE * _score_confidence(notification)
        + WEIGHT_PRIORITY * _score_priority(notification)
        + WEIGHT_PROJECT_RELEVANCE
        * _score_project_relevance(notification, active_project_id)
        + WEIGHT_RECENCY * _score_recency(notification)
        + WEIGHT_RESPONSE_LIKELIHOOD * _score_response_likelihood(notification)
    )
    return score


def _apply_adjustments(
    score: float,
    notification: dict[str, Any],
    active_project_id: str | None,
    mapped_tables: list[str] | None,
) -> float:
    """Apply project mismatch penalty and table match boost."""
    # Project mismatch penalty
    applicable_projects = notification.get("applicable_projects")
    if applicable_projects and active_project_id:
        if active_project_id not in applicable_projects:
            score *= PROJECT_MISMATCH_PENALTY

    # Table match boost
    if mapped_tables:
        applicable_tables = notification.get("applicable_tables")
        if applicable_tables:
            mapped_set = set(mapped_tables)
            applicable_set = set(applicable_tables)
            if mapped_set & applicable_set:
                score *= TABLE_MATCH_BOOST

    return score


def score_notifications(
    notifications: list[dict],
    active_project_id: str | None = None,
    mapped_tables: list[str] | None = None,
    max_notifications: int = 3,
) -> list[dict]:
    """Score and rank notifications for user display.

    Evaluates each notification against weighted criteria:
      - confidence (30%)
      - recommendation_priority (20%)
      - project_relevance (25%)
      - recency (15%)
      - response_likelihood (10%)

    Applies adjustments:
      - 50% penalty if notification's applicable_projects excludes active project
      - 20% boost if notification's applicable_tables overlap with mapped_tables

    Args:
        notifications: List of notification dicts from the FIR stream.
        active_project_id: The user's currently active project ID.
        mapped_tables: Tables the user has already mapped in their project.
        max_notifications: Maximum number of notifications to return.

    Returns:
        Sorted list (highest score first) of notification dicts, each with
        an added `_score` field (0-100, clamped). Limited to max_notifications.
    """
    if not notifications:
        return []

    scored: list[dict[str, Any]] = []

    for notification in notifications:
        base_score = _compute_base_score(notification, active_project_id)
        final_score = _apply_adjustments(
            base_score, notification, active_project_id, mapped_tables
        )
        # Clamp to 0-100
        final_score = max(0.0, min(100.0, final_score))

        scored_notification = {**notification, "_score": round(final_score, 2)}
        scored.append(scored_notification)

    # Sort by score descending, then by created_at descending as tiebreaker
    scored.sort(
        key=lambda n: (n["_score"], n.get("created_at", 0)),
        reverse=True,
    )

    result = scored[:max_notifications]

    logger.debug(
        "Scored %d notifications, returning top %d (scores: %s)",
        len(notifications),
        len(result),
        [n["_score"] for n in result],
    )

    return result
