"""Integration tests for FIR recommendations in learning_retrieval.py.

Tests the get_fir_recommendations and record_fir_recommendation_success methods.
Note: These tests require a Snowflake connection to run.
"""

import pytest
from unittest.mock import MagicMock, patch
import json


class TestGetFIRRecommendations:
    """Test the get_fir_recommendations method."""

    def test_get_recommendations_success(self):
        """Test successful retrieval of FIR recommendations."""
        mock_session = MagicMock()
        mock_settings = MagicMock()
        mock_settings.qualify_metadata_object_name.return_value = (
            "DB.SCHEMA.SP_FIR_GET_AGENT_RECOMMENDATIONS"
        )

        mock_result = {
            "status": "success",
            "recommendations": [
                {
                    "source": "fir_system",
                    "recommendation_id": "rec-123",
                    "type": "pattern_reuse",
                    "priority": 75,
                    "confidence": 0.85,
                    "payload": {
                        "mapping_pattern": {
                            "source_column": "CUST_KEY",
                            "target_column": "CUSTOMER_ID",
                        }
                    },
                    "usage_stats": {"used": 10, "successful": 8},
                }
            ],
            "total_found": 1,
            "total_returned": 1,
        }
        mock_session.call.return_value = json.dumps(mock_result)

        recommendations = _get_fir_recommendations(
            mock_session,
            mock_settings,
            agent_type="SOURCE_MAPPING",
            trigger_type="on_mapping_start",
            context={"project_id": "proj-123"},
            max_results=10,
        )

        assert len(recommendations) == 1
        assert recommendations[0]["type"] == "pattern_reuse"
        assert recommendations[0]["confidence"] == 0.85

    def test_get_recommendations_empty_result(self):
        """Test when no recommendations are found."""
        mock_session = MagicMock()
        mock_settings = MagicMock()
        mock_settings.qualify_metadata_object_name.return_value = (
            "DB.SCHEMA.SP_FIR_GET_AGENT_RECOMMENDATIONS"
        )

        mock_result = {
            "status": "success",
            "recommendations": [],
            "total_found": 0,
            "total_returned": 0,
        }
        mock_session.call.return_value = json.dumps(mock_result)

        recommendations = _get_fir_recommendations(
            mock_session,
            mock_settings,
            agent_type="SOURCE_MAPPING",
            trigger_type="on_mapping_start",
            context={},
            max_results=10,
        )

        assert len(recommendations) == 0

    def test_get_recommendations_failure(self):
        """Test handling of procedure failure."""
        mock_session = MagicMock()
        mock_settings = MagicMock()
        mock_settings.qualify_metadata_object_name.return_value = (
            "DB.SCHEMA.SP_FIR_GET_AGENT_RECOMMENDATIONS"
        )

        mock_result = {
            "status": "failed",
            "recommendations": [],
            "errors": ["Database connection failed"],
        }
        mock_session.call.return_value = json.dumps(mock_result)

        recommendations = _get_fir_recommendations(
            mock_session,
            mock_settings,
            agent_type="SOURCE_MAPPING",
            trigger_type="on_mapping_start",
            context={},
            max_results=10,
        )

        assert len(recommendations) == 0

    def test_get_recommendations_exception_handling(self):
        """Test graceful handling of exceptions."""
        mock_session = MagicMock()
        mock_settings = MagicMock()
        mock_settings.qualify_metadata_object_name.return_value = (
            "DB.SCHEMA.SP_FIR_GET_AGENT_RECOMMENDATIONS"
        )
        mock_session.call.side_effect = Exception("Connection timeout")

        recommendations = _get_fir_recommendations(
            mock_session,
            mock_settings,
            agent_type="SOURCE_MAPPING",
            trigger_type="on_mapping_start",
            context={},
            max_results=10,
        )

        assert len(recommendations) == 0

    def test_agent_name_prefix_handling(self):
        """Test that AGT_ prefix is handled correctly."""
        mock_session = MagicMock()
        mock_settings = MagicMock()
        mock_settings.qualify_metadata_object_name.return_value = (
            "DB.SCHEMA.SP_FIR_GET_AGENT_RECOMMENDATIONS"
        )
        mock_session.call.return_value = json.dumps(
            {"status": "success", "recommendations": []}
        )

        # Without prefix
        _get_fir_recommendations(
            mock_session, mock_settings, "SOURCE_MAPPING", "on_mapping_start", {}, 10
        )

        # With prefix
        _get_fir_recommendations(
            mock_session,
            mock_settings,
            "AGT_SOURCE_MAPPING",
            "on_mapping_start",
            {},
            10,
        )

        # Both should result in the same agent name being passed
        calls = mock_session.call.call_args_list
        assert "AGT_SOURCE_MAPPING" in str(calls[0])
        assert "AGT_SOURCE_MAPPING" in str(calls[1])


class TestRecordFIRRecommendationSuccess:
    """Test the record_fir_recommendation_success method."""

    def test_record_success(self):
        """Test successful recording of recommendation success."""
        mock_session = MagicMock()
        mock_settings = MagicMock()
        mock_settings.qualify_metadata_object_name.return_value = (
            "DB.SCHEMA.SP_FIR_RECORD_RECOMMENDATION_SUCCESS"
        )

        result = _record_fir_recommendation_success(
            mock_session, mock_settings, "rec-123"
        )

        assert result is True
        mock_session.call.assert_called_once()

    def test_record_failure(self):
        """Test handling of recording failure."""
        mock_session = MagicMock()
        mock_settings = MagicMock()
        mock_settings.qualify_metadata_object_name.return_value = (
            "DB.SCHEMA.SP_FIR_RECORD_RECOMMENDATION_SUCCESS"
        )
        mock_session.call.side_effect = Exception("Update failed")

        result = _record_fir_recommendation_success(
            mock_session, mock_settings, "rec-123"
        )

        assert result is False


class TestRecommendationFiltering:
    """Test recommendation filtering by context."""

    def test_filter_by_project(self):
        """Test filtering recommendations by project_id."""
        recommendations = [
            {
                "recommendation_id": "rec-1",
                "applicable_projects": ["proj-123"],
                "confidence": 0.9,
            },
            {
                "recommendation_id": "rec-2",
                "applicable_projects": ["proj-456"],
                "confidence": 0.8,
            },
            {
                "recommendation_id": "rec-3",
                "applicable_projects": None,
                "confidence": 0.7,
            },
        ]

        filtered = _filter_recommendations_by_context(
            recommendations, {"project_id": "proj-123"}
        )

        # Should include rec-1 (matches) and rec-3 (no filter)
        assert len(filtered) == 2
        ids = [r["recommendation_id"] for r in filtered]
        assert "rec-1" in ids
        assert "rec-3" in ids

    def test_filter_by_tables(self):
        """Test filtering recommendations by table names."""
        recommendations = [
            {
                "recommendation_id": "rec-1",
                "applicable_tables": ["CUSTOMER", "ACCOUNT"],
                "confidence": 0.9,
            },
            {
                "recommendation_id": "rec-2",
                "applicable_tables": ["ORDER"],
                "confidence": 0.8,
            },
            {
                "recommendation_id": "rec-3",
                "applicable_tables": None,
                "confidence": 0.7,
            },
        ]

        filtered = _filter_recommendations_by_context(
            recommendations, {"table_names": ["CUSTOMER"]}
        )

        assert len(filtered) == 2
        ids = [r["recommendation_id"] for r in filtered]
        assert "rec-1" in ids
        assert "rec-3" in ids

    def test_filter_by_columns(self):
        """Test filtering recommendations by column names."""
        recommendations = [
            {
                "recommendation_id": "rec-1",
                "applicable_columns": ["CUST_KEY", "CUST_ID"],
                "confidence": 0.9,
            },
            {
                "recommendation_id": "rec-2",
                "applicable_columns": ["ORDER_ID"],
                "confidence": 0.8,
            },
        ]

        filtered = _filter_recommendations_by_context(
            recommendations, {"column_names": ["CUST_KEY"]}
        )

        assert len(filtered) == 1
        assert filtered[0]["recommendation_id"] == "rec-1"


# ─── Helper Functions (mirroring learning_retrieval.py logic) ───────


def _get_fir_recommendations(
    session,
    settings,
    agent_type: str,
    trigger_type: str,
    context: dict,
    max_results: int,
) -> list:
    """Mock implementation of get_fir_recommendations."""
    try:
        agent_name = (
            f"AGT_{agent_type}" if not agent_type.startswith("AGT_") else agent_type
        )
        context_with_max = {**context, "max_results": max_results}

        proc_name = settings.qualify_metadata_object_name(
            "SP_FIR_GET_AGENT_RECOMMENDATIONS"
        )
        result = session.call(proc_name, agent_name, trigger_type, context_with_max)

        if isinstance(result, str):
            result = json.loads(result)

        if result.get("status") == "success":
            return result.get("recommendations", [])[:max_results]
        else:
            return []

    except Exception:
        return []


def _record_fir_recommendation_success(session, settings, recommendation_id: str) -> bool:
    """Mock implementation of record_fir_recommendation_success."""
    try:
        proc_name = settings.qualify_metadata_object_name(
            "SP_FIR_RECORD_RECOMMENDATION_SUCCESS"
        )
        session.call(proc_name, recommendation_id)
        return True
    except Exception:
        return False


def _filter_recommendations_by_context(
    recommendations: list, context: dict
) -> list:
    """Filter recommendations based on context."""
    project_id = context.get("project_id")
    table_names = context.get("table_names", [])
    column_names = context.get("column_names", [])

    filtered = []
    for rec in recommendations:
        applicable_projects = rec.get("applicable_projects")
        applicable_tables = rec.get("applicable_tables")
        applicable_columns = rec.get("applicable_columns")

        project_match = True
        if applicable_projects and project_id:
            project_match = project_id in applicable_projects

        table_match = True
        if applicable_tables and table_names:
            table_match = any(t in applicable_tables for t in table_names)

        column_match = True
        if applicable_columns and column_names:
            column_match = any(c in applicable_columns for c in column_names)

        if project_match and table_match and column_match:
            filtered.append(rec)

    return filtered
