"""Unit tests for FIR inference type determination.

Tests the logic that determines which inference type to generate from feedback.
"""

import pytest


class TestInferenceTypeDetermination:
    """Test inference type determination based on source and event."""

    def test_semantic_evolution_from_semantic_view_update(self):
        """Semantic view updates should create semantic_evolution inferences."""
        source_type = "implicit"
        event_type = "semantic_view.update"
        feedback_payload = {"view_fqn": "DB.SCHEMA.TABLE", "change_reason": "Updated"}

        inference_type = _determine_inference_type(
            source_type, event_type, feedback_payload
        )

        assert inference_type == "semantic_evolution"

    def test_mapping_correction_from_edit(self):
        """Mapping edits should create mapping_correction inferences."""
        source_type = "mapping_feedback"
        event_type = "mapping.edit"
        feedback_payload = {"source_column": "COL_A", "target_column": "COL_B"}

        inference_type = _determine_inference_type(
            source_type, event_type, feedback_payload
        )

        assert inference_type == "mapping_correction"

    def test_mapping_pattern_from_accept(self):
        """Mapping accepts should create mapping_pattern inferences."""
        source_type = "mapping_feedback"
        event_type = "mapping.accept"
        feedback_payload = {"source_column": "COL_A", "target_column": "COL_B"}

        inference_type = _determine_inference_type(
            source_type, event_type, feedback_payload
        )

        assert inference_type == "mapping_pattern"

    def test_mapping_pattern_from_publish(self):
        """STTM publishes should create mapping_pattern inferences."""
        source_type = "mapping_feedback"
        event_type = "sttm.publish"
        feedback_payload = {"sttm_id": "123", "version_number": 1}

        inference_type = _determine_inference_type(
            source_type, event_type, feedback_payload
        )

        assert inference_type == "mapping_pattern"

    def test_derived_source_pattern_from_create(self):
        """Derived source creation should create derived_source_pattern inferences."""
        source_type = "implicit"
        event_type = "derived_source.create"
        feedback_payload = {"derived_source_name": "VW_TEST", "purpose": "Testing"}

        inference_type = _determine_inference_type(
            source_type, event_type, feedback_payload
        )

        assert inference_type == "derived_source_pattern"

    def test_conversation_pattern_from_turn(self):
        """Conversation turns should create conversation_pattern inferences."""
        source_type = "conversation"
        event_type = "conversation.turn"
        feedback_payload = {"agent_name": "AGT_STTM_BUILDER"}

        inference_type = _determine_inference_type(
            source_type, event_type, feedback_payload
        )

        assert inference_type == "conversation_pattern"

    def test_explicit_feedback_from_thumbs(self):
        """Explicit feedback should create explicit_feedback inferences."""
        source_type = "explicit"
        event_type = "conversation.feedback"
        feedback_payload = {"rating": 5, "category": "agent_quality"}

        inference_type = _determine_inference_type(
            source_type, event_type, feedback_payload
        )

        assert inference_type == "explicit_feedback"

    def test_general_pattern_for_unknown(self):
        """Unknown combinations should fall back to general_pattern."""
        source_type = "unknown"
        event_type = "unknown.event"
        feedback_payload = {}

        inference_type = _determine_inference_type(
            source_type, event_type, feedback_payload
        )

        assert inference_type == "general_pattern"


class TestInferenceSummaryGeneration:
    """Test inference summary generation."""

    def test_semantic_evolution_summary(self):
        """Semantic evolution summary should include FQN and change reason."""
        inference_type = "semantic_evolution"
        feedback_payload = {"fqn": "DB.SCHEMA.TABLE", "change_reason": "Column added"}

        summary = _generate_inference_summary(
            inference_type, feedback_payload, "implicit"
        )

        assert "DB.SCHEMA.TABLE" in summary
        assert "Column added" in summary

    def test_mapping_pattern_summary(self):
        """Mapping pattern summary should include source → target."""
        inference_type = "mapping_pattern"
        feedback_payload = {
            "source_column": "CUST_KEY",
            "target_column": "CUSTOMER_ID",
            "processing_rule": "CAST",
        }

        summary = _generate_inference_summary(
            inference_type, feedback_payload, "mapping_feedback"
        )

        assert "CUST_KEY" in summary
        assert "CUSTOMER_ID" in summary
        assert "CAST" in summary

    def test_derived_source_summary(self):
        """Derived source summary should include name and purpose."""
        inference_type = "derived_source_pattern"
        feedback_payload = {
            "derived_source_name": "VW_CUSTOMER_360",
            "purpose": "Unified customer view",
        }

        summary = _generate_inference_summary(
            inference_type, feedback_payload, "implicit"
        )

        assert "VW_CUSTOMER_360" in summary
        assert "Unified customer view" in summary


class TestBusinessUnderstandingExtraction:
    """Test business understanding extraction from feedback."""

    def test_extract_column_relationship(self):
        """Should extract column relationship from mapping feedback."""
        inference_type = "mapping_pattern"
        feedback_payload = {
            "source_column": "CUST_KEY",
            "target_column": "CUSTOMER_ID",
            "processing_rule": "CAST",
            "mapping_rationale": "Customer identifier mapping",
            "transformation_expression": "CAST(CUST_KEY AS VARCHAR)",
            "mapping_source": "ai",
            "ai_confidence": 0.85,
        }

        understanding = _extract_business_understanding(inference_type, feedback_payload)

        assert "column_relationship" in understanding
        rel = understanding["column_relationship"]
        assert rel["source"] == "CUST_KEY"
        assert rel["target"] == "CUSTOMER_ID"
        assert rel["rule"] == "CAST"
        assert understanding.get("ai_suggestion_accepted") is True

    def test_extract_derived_source_info(self):
        """Should extract derived source information."""
        inference_type = "derived_source_pattern"
        feedback_payload = {
            "derived_source_name": "VW_CUSTOMER_360",
            "purpose": "Unified customer view",
            "business_description": "Combines customer and account data",
            "source_tables": ["CUSTOMER", "ACCOUNT"],
            "relationships": [{"left_table": "CUSTOMER", "right_table": "ACCOUNT"}],
        }

        understanding = _extract_business_understanding(inference_type, feedback_payload)

        assert "derived_source" in understanding
        ds = understanding["derived_source"]
        assert ds["name"] == "VW_CUSTOMER_360"
        assert ds["purpose"] == "Unified customer view"
        assert len(ds["source_tables"]) == 2

    def test_extract_user_feedback(self):
        """Should extract explicit user feedback details."""
        inference_type = "explicit_feedback"
        feedback_payload = {
            "category": "agent_quality",
            "option_selected": "helpful",
            "rating": 5,
            "comment": "Great suggestion!",
        }

        understanding = _extract_business_understanding(inference_type, feedback_payload)

        assert "user_feedback" in understanding
        uf = understanding["user_feedback"]
        assert uf["category"] == "agent_quality"
        assert uf["rating"] == 5
        assert uf["comment"] == "Great suggestion!"


# ─── Helper Functions (mirroring procedure logic) ───────────────────


def _determine_inference_type(
    source_type: str, event_type: str, feedback_payload: dict
) -> str:
    """Determine the type of inference to generate based on feedback."""
    if source_type == "implicit" and "semantic_view" in event_type:
        return "semantic_evolution"
    elif source_type == "mapping_feedback":
        if event_type == "mapping.edit":
            return "mapping_correction"
        elif event_type in ("mapping.accept", "sttm.publish"):
            return "mapping_pattern"
        else:
            return "mapping_pattern"
    elif source_type == "implicit" and "derived_source" in event_type:
        return "derived_source_pattern"
    elif source_type == "conversation":
        return "conversation_pattern"
    elif source_type == "explicit":
        return "explicit_feedback"
    else:
        return "general_pattern"


def _generate_inference_summary(
    inference_type: str, feedback_payload: dict, source_type: str
) -> str:
    """Generate a human-readable summary for the inference."""
    summaries = {
        "semantic_evolution": f"Semantic view {feedback_payload.get('fqn', 'unknown')} evolved: {feedback_payload.get('change_reason', 'updated')}",
        "mapping_pattern": f"Mapping pattern: {feedback_payload.get('source_column', '?')} → {feedback_payload.get('target_column', '?')} with rule {feedback_payload.get('processing_rule', 'DIRECT')}",
        "mapping_correction": f"Mapping corrected: {feedback_payload.get('source_column', '?')} → {feedback_payload.get('target_column', '?')} (user modified)",
        "derived_source_pattern": f"Derived source '{feedback_payload.get('derived_source_name', 'unknown')}' created for: {feedback_payload.get('purpose', 'data preparation')}",
        "conversation_pattern": f"Conversation with {feedback_payload.get('agent_name', 'agent')} - {feedback_payload.get('content_length', 0)} chars",
        "explicit_feedback": f"User feedback: {feedback_payload.get('category', 'general')} - {feedback_payload.get('option_selected', feedback_payload.get('rating', 'N/A'))}",
        "general_pattern": f"Pattern from {source_type}",
    }
    return summaries.get(inference_type, f"Inference from {source_type}")


def _extract_business_understanding(
    inference_type: str, feedback_payload: dict
) -> dict:
    """Extract business understanding from the feedback for semantic enrichment."""
    from datetime import datetime

    understanding = {
        "extracted_at": datetime.utcnow().isoformat(),
        "inference_type": inference_type,
    }

    if inference_type == "mapping_pattern" or inference_type == "mapping_correction":
        understanding["column_relationship"] = {
            "source": feedback_payload.get("source_column"),
            "target": feedback_payload.get("target_column"),
            "rule": feedback_payload.get("processing_rule"),
            "rationale": feedback_payload.get("mapping_rationale"),
            "transformation": feedback_payload.get("transformation_expression"),
        }
        if feedback_payload.get("mapping_source") == "ai":
            understanding["ai_suggestion_accepted"] = True
            understanding["ai_confidence"] = feedback_payload.get("ai_confidence")

    elif inference_type == "derived_source_pattern":
        understanding["derived_source"] = {
            "name": feedback_payload.get("derived_source_name"),
            "purpose": feedback_payload.get("purpose"),
            "business_description": feedback_payload.get("business_description"),
            "source_tables": feedback_payload.get("source_tables"),
            "relationships": feedback_payload.get("relationships"),
        }

    elif inference_type == "explicit_feedback":
        understanding["user_feedback"] = {
            "category": feedback_payload.get("category"),
            "option_selected": feedback_payload.get("option_selected"),
            "rating": feedback_payload.get("rating"),
            "comment": feedback_payload.get("comment"),
        }

    return understanding
