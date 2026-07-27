"""Unit tests for FIR confidence scoring logic.

Tests initial confidence assignment based on source type and event type.
"""

import pytest


class TestInitialConfidenceScoring:
    """Test initial confidence assignment by source and event type."""

    def test_explicit_feedback_confidence(self):
        """Explicit feedback (thumbs up/down) should have high confidence."""
        source_type = "explicit"
        event_type = "conversation.feedback"
        expected_confidence = 0.9

        confidence = _get_initial_confidence(source_type, event_type)

        assert confidence == expected_confidence

    def test_mapping_acceptance_confidence(self):
        """Mapping acceptance should have moderately high confidence."""
        source_type = "mapping_feedback"
        event_type = "mapping.accept"
        expected_confidence = 0.85

        confidence = _get_initial_confidence(source_type, event_type)

        assert confidence == expected_confidence

    def test_mapping_edit_confidence(self):
        """Mapping edit (correction) should have slightly lower confidence."""
        source_type = "mapping_feedback"
        event_type = "mapping.edit"
        expected_confidence = 0.8

        confidence = _get_initial_confidence(source_type, event_type)

        assert confidence == expected_confidence

    def test_sttm_publish_confidence(self):
        """STTM publish should have the highest confidence."""
        source_type = "mapping_feedback"
        event_type = "sttm.publish"
        expected_confidence = 0.95

        confidence = _get_initial_confidence(source_type, event_type)

        assert confidence == expected_confidence

    def test_derived_source_create_confidence(self):
        """Derived source creation should have medium confidence."""
        source_type = "implicit"
        event_type = "derived_source.create"
        expected_confidence = 0.6

        confidence = _get_initial_confidence(source_type, event_type)

        assert confidence == expected_confidence

    def test_conversation_turn_confidence(self):
        """Conversation turns should have lower confidence."""
        source_type = "conversation"
        event_type = "conversation.turn"
        expected_confidence = 0.5

        confidence = _get_initial_confidence(source_type, event_type)

        assert confidence == expected_confidence

    def test_unknown_event_default_confidence(self):
        """Unknown events should default to 0.5."""
        source_type = "unknown"
        event_type = "unknown.event"
        expected_confidence = 0.5

        confidence = _get_initial_confidence(source_type, event_type)

        assert confidence == expected_confidence


class TestInferenceConfidenceCalculation:
    """Test confidence calculation for generated inferences."""

    def test_inference_confidence_with_ai_match(self):
        """When AI suggestion was accepted, average AI confidence with initial."""
        initial_confidence = 0.85
        ai_confidence = 0.90
        inference_type = "mapping_pattern"

        # Formula: (initial + ai_confidence) / 2
        expected = (initial_confidence + ai_confidence) / 2  # 0.875

        confidence = _calculate_inference_confidence(
            initial_confidence,
            {"ai_suggestion_accepted": True, "ai_confidence": ai_confidence},
            inference_type,
        )

        assert abs(confidence - expected) < 0.001

    def test_inference_confidence_with_high_rating(self):
        """High rating (4-5) should boost confidence."""
        initial_confidence = 0.7
        inference_type = "explicit_feedback"
        rating = 5

        # Formula: confidence + 0.1 if rating >= 4
        expected = min(1.0, initial_confidence + 0.1)  # 0.8

        confidence = _calculate_inference_confidence(
            initial_confidence, {"rating": rating}, inference_type
        )

        assert abs(confidence - expected) < 0.001

    def test_inference_confidence_with_low_rating(self):
        """Low rating (1-2) should reduce confidence."""
        initial_confidence = 0.7
        inference_type = "explicit_feedback"
        rating = 1

        # Formula: confidence - 0.1 if rating <= 2
        expected = max(0.1, initial_confidence - 0.1)  # 0.6

        confidence = _calculate_inference_confidence(
            initial_confidence, {"rating": rating}, inference_type
        )

        assert abs(confidence - expected) < 0.001

    def test_inference_confidence_no_modifiers(self):
        """Without special conditions, confidence should remain unchanged."""
        initial_confidence = 0.75
        inference_type = "mapping_pattern"

        confidence = _calculate_inference_confidence(
            initial_confidence, {}, inference_type
        )

        assert confidence == initial_confidence


class TestRecommendationPriority:
    """Test recommendation priority calculation."""

    def test_high_priority_for_correction_warning(self):
        """Correction warnings should have high priority."""
        confidence = 0.8
        recommendation_type = "correction_warning"
        source_type = "mapping_feedback"

        # Base: confidence * 50 + type_boost + source_boost
        base = int(confidence * 50)  # 40
        type_boost = 30  # correction_warning
        source_boost = 10  # mapping_feedback
        expected = min(100, max(1, base + type_boost + source_boost))  # 80

        priority = _calculate_priority(confidence, recommendation_type, source_type)

        assert priority == expected

    def test_medium_priority_for_pattern_reuse(self):
        """Pattern reuse should have medium-high priority."""
        confidence = 0.7
        recommendation_type = "pattern_reuse"
        source_type = "mapping_feedback"

        base = int(confidence * 50)  # 35
        type_boost = 20  # pattern_reuse
        source_boost = 10  # mapping_feedback
        expected = min(100, max(1, base + type_boost + source_boost))  # 65

        priority = _calculate_priority(confidence, recommendation_type, source_type)

        assert priority == expected

    def test_priority_capped_at_100(self):
        """Priority should not exceed 100."""
        confidence = 1.0
        recommendation_type = "correction_warning"
        source_type = "collaborative"

        # Base: 50 + 30 + 20 = 100
        base = int(confidence * 50)
        type_boost = 30
        source_boost = 20
        expected = min(100, max(1, base + type_boost + source_boost))

        priority = _calculate_priority(confidence, recommendation_type, source_type)

        assert priority == 100

    def test_priority_minimum_is_1(self):
        """Priority should not go below 1."""
        confidence = 0.0
        recommendation_type = "column_mapping_hint"
        source_type = "conversation"

        priority = _calculate_priority(confidence, recommendation_type, source_type)

        assert priority >= 1


# ─── Helper Functions (mirroring procedure logic) ───────────────────


def _get_initial_confidence(source_type: str, event_type: str) -> float:
    """Determine initial confidence based on source and event type."""
    confidence_map = {
        ("explicit", "conversation.feedback"): 0.9,
        ("mapping_feedback", "mapping.accept"): 0.85,
        ("mapping_feedback", "mapping.edit"): 0.8,
        ("mapping_feedback", "mapping.reject"): 0.75,
        ("mapping_feedback", "sttm.publish"): 0.95,
        ("mapping_feedback", "sttm.save"): 0.7,
        ("implicit", "derived_source.create"): 0.6,
        ("implicit", "derived_source.update"): 0.6,
        ("implicit", "semantic_view.update"): 0.55,
        ("conversation", "conversation.turn"): 0.5,
        ("collaborative", "collaborative.edit"): 0.7,
    }
    return confidence_map.get((source_type, event_type), 0.5)


def _calculate_inference_confidence(
    initial_confidence: float, feedback_payload: dict, inference_type: str
) -> float:
    """Calculate confidence for the generated inference."""
    confidence = initial_confidence or 0.5

    if inference_type == "mapping_pattern" and feedback_payload.get(
        "ai_suggestion_accepted"
    ):
        ai_confidence = feedback_payload.get("ai_confidence", 0.5)
        confidence = (confidence + ai_confidence) / 2

    if inference_type == "explicit_feedback":
        rating = feedback_payload.get("rating")
        if rating is not None:
            if rating >= 4:
                confidence = min(1.0, confidence + 0.1)
            elif rating <= 2:
                confidence = max(0.1, confidence - 0.1)

    return round(confidence, 3)


def _calculate_priority(
    confidence: float, recommendation_type: str, source_type: str
) -> int:
    """Calculate recommendation priority (1-100)."""
    base_priority = int(confidence * 50)

    type_boost = {
        "correction_warning": 30,
        "pattern_reuse": 20,
        "similar_mapping": 15,
        "derived_source_suggestion": 10,
        "relationship_hint": 10,
        "business_rule": 25,
        "column_mapping_hint": 5,
    }

    source_boost = {
        "mapping_feedback": 10,
        "explicit": 15,
        "implicit": 5,
        "conversation": 5,
        "collaborative": 20,
    }

    priority = (
        base_priority
        + type_boost.get(recommendation_type, 0)
        + source_boost.get(source_type, 0)
    )
    return max(1, min(100, priority))
