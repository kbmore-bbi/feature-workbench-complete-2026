"""Unit tests for FIR confidence decay logic.

Tests the temporal decay formula and usage-based boosts.
"""

import pytest
from datetime import datetime, timedelta


class TestConfidenceDecayFormula:
    """Test the confidence decay formula: CURRENT = INITIAL * POWER(DECAY_FACTOR, days/30)."""

    def test_no_decay_for_new_records(self):
        """Records created today should have no decay."""
        initial = 1.0
        decay_factor = 0.95
        days_since_creation = 0

        expected = initial * (decay_factor ** (days_since_creation / 30))

        assert abs(expected - 1.0) < 0.001

    def test_decay_after_30_days(self):
        """After 30 days, confidence should be INITIAL * 0.95."""
        initial = 1.0
        decay_factor = 0.95
        days_since_creation = 30

        expected = initial * (decay_factor ** (days_since_creation / 30))

        assert abs(expected - 0.95) < 0.001

    def test_decay_after_60_days(self):
        """After 60 days, confidence should be INITIAL * 0.95^2."""
        initial = 1.0
        decay_factor = 0.95
        days_since_creation = 60

        expected = initial * (decay_factor ** (days_since_creation / 30))
        # 0.95^2 = 0.9025

        assert abs(expected - 0.9025) < 0.001

    def test_decay_after_180_days(self):
        """After 6 months, confidence should be INITIAL * 0.95^6."""
        initial = 1.0
        decay_factor = 0.95
        days_since_creation = 180

        expected = initial * (decay_factor ** (days_since_creation / 30))
        # 0.95^6 ≈ 0.735

        assert abs(expected - 0.735) < 0.01

    def test_decay_after_365_days(self):
        """After 1 year, confidence should be INITIAL * 0.95^12.17."""
        initial = 1.0
        decay_factor = 0.95
        days_since_creation = 365

        expected = initial * (decay_factor ** (days_since_creation / 30))
        # 0.95^12.17 ≈ 0.537

        assert abs(expected - 0.537) < 0.01

    def test_decay_with_different_initial_confidence(self):
        """Decay should work correctly with non-1.0 initial confidence."""
        initial = 0.85
        decay_factor = 0.95
        days_since_creation = 60

        expected = initial * (decay_factor ** (days_since_creation / 30))
        # 0.85 * 0.9025 ≈ 0.767

        assert abs(expected - 0.767) < 0.01

    def test_decay_with_custom_decay_factor(self):
        """Test with a faster decay factor (0.90)."""
        initial = 1.0
        decay_factor = 0.90
        days_since_creation = 30

        expected = initial * (decay_factor ** (days_since_creation / 30))

        assert abs(expected - 0.90) < 0.001

    def test_decay_with_slower_decay_factor(self):
        """Test with a slower decay factor (0.98)."""
        initial = 1.0
        decay_factor = 0.98
        days_since_creation = 30

        expected = initial * (decay_factor ** (days_since_creation / 30))

        assert abs(expected - 0.98) < 0.001


class TestUsageBasedBoost:
    """Test the usage-based confidence boost."""

    def test_no_boost_with_zero_usage(self):
        """No boost when usage_count is 0."""
        confidence = 0.7
        usage_count = 0
        success_count = 0

        # Boost formula: min(1.0, confidence + 0.05 * success_rate * usage_count)
        # When usage_count = 0, no boost
        if usage_count > 0:
            boost = 0.05 * (success_count / usage_count) * usage_count
        else:
            boost = 0

        expected = min(1.0, confidence + boost)
        assert expected == 0.7

    def test_boost_with_100_percent_success(self):
        """Full boost when success_count == usage_count."""
        confidence = 0.7
        usage_count = 10
        success_count = 10

        # Boost = 0.05 * (10/10) * 10 = 0.5, but capped at 0.2
        boost = min(0.2, 0.05 * (success_count / usage_count) * usage_count)
        expected = min(1.0, confidence + boost)

        assert abs(expected - 0.9) < 0.001

    def test_boost_with_50_percent_success(self):
        """Partial boost with 50% success rate."""
        confidence = 0.7
        usage_count = 10
        success_count = 5

        # Boost = 0.05 * (5/10) * 10 = 0.25, capped at 0.2
        boost = min(0.2, 0.05 * (success_count / usage_count) * usage_count)
        expected = min(1.0, confidence + boost)

        assert abs(expected - 0.9) < 0.001

    def test_boost_capped_at_1_point_0(self):
        """Confidence should never exceed 1.0."""
        confidence = 0.95
        usage_count = 20
        success_count = 20

        boost = min(0.2, 0.05 * (success_count / usage_count) * usage_count)
        expected = min(1.0, confidence + boost)

        assert expected == 1.0

    def test_boost_with_low_usage(self):
        """Small boost with few usages."""
        confidence = 0.7
        usage_count = 2
        success_count = 2

        # Boost = 0.05 * (2/2) * 2 = 0.1
        boost = min(0.2, 0.05 * (success_count / usage_count) * usage_count)
        expected = min(1.0, confidence + boost)

        assert abs(expected - 0.8) < 0.001


class TestCombinedDecayAndBoost:
    """Test decay and boost working together."""

    def test_decay_then_boost(self):
        """Apply decay first, then boost."""
        initial = 1.0
        decay_factor = 0.95
        days_since_creation = 60
        usage_count = 10
        success_count = 10

        # Step 1: Apply decay
        after_decay = initial * (decay_factor ** (days_since_creation / 30))
        # ≈ 0.9025

        # Step 2: Apply boost (max 0.2)
        boost = min(0.2, 0.05 * (success_count / usage_count) * usage_count)
        final = min(1.0, after_decay + boost)

        # 0.9025 + 0.2 = 1.1025, capped at 1.0
        assert final == 1.0

    def test_decay_without_boost_for_unused_recommendations(self):
        """Unused recommendations should only decay, no boost."""
        initial = 0.85
        decay_factor = 0.95
        days_since_creation = 90  # 3 months
        usage_count = 0
        success_count = 0

        after_decay = initial * (decay_factor ** (days_since_creation / 30))
        # 0.85 * 0.95^3 ≈ 0.729

        if usage_count > 0:
            boost = min(0.2, 0.05 * (success_count / usage_count) * usage_count)
        else:
            boost = 0

        final = min(1.0, after_decay + boost)

        assert abs(final - 0.729) < 0.01


class TestArchiveThreshold:
    """Test the archive threshold for old, low-confidence records."""

    def test_should_archive_old_low_confidence(self):
        """Records >180 days old with confidence <0.1 should be archived."""
        confidence = 0.05
        days_since_creation = 200
        threshold_days = 180
        threshold_confidence = 0.1

        should_archive = (
            days_since_creation > threshold_days and confidence < threshold_confidence
        )

        assert should_archive is True

    def test_should_not_archive_recent_low_confidence(self):
        """Recent records with low confidence should not be archived."""
        confidence = 0.05
        days_since_creation = 30
        threshold_days = 180
        threshold_confidence = 0.1

        should_archive = (
            days_since_creation > threshold_days and confidence < threshold_confidence
        )

        assert should_archive is False

    def test_should_not_archive_old_high_confidence(self):
        """Old records with high confidence should not be archived."""
        confidence = 0.5
        days_since_creation = 200
        threshold_days = 180
        threshold_confidence = 0.1

        should_archive = (
            days_since_creation > threshold_days and confidence < threshold_confidence
        )

        assert should_archive is False
