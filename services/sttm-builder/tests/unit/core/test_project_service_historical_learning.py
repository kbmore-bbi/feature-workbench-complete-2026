from app.core.project_service import ProjectService


class _LearningRecorder:
    def __init__(self) -> None:
        self.acceptances: list[dict] = []

    def record_mapping_acceptance(self, **kwargs):
        self.acceptances.append(kwargs)
        return "learning_1"


def test_published_historical_mapping_uses_canonical_target_column() -> None:
    service = ProjectService.__new__(ProjectService)
    service._agent_learning = _LearningRecorder()

    count = service._record_agent_learnings(
        project_id="project_1",
        sttm_id="sttm_1",
        user_id="client_import",
        snapshot={
            "source_tables": [
                {"database": "RAW", "schema": "PUBLIC", "table": "CUSTOMERS"}
            ],
            "target_table": {
                "database": "CURATED",
                "schema": "PUBLIC",
                "table": "CUSTOMER_DIM",
            },
            "mapping_rows": [
                {
                    "target_column": "CUSTOMER_ID",
                    "source_columns": ["RAW.CUSTOMERS.ID"],
                    "rule": "Direct mapping",
                    "status": "mapped",
                    "confidence": 0.99,
                    "provenance": "historical_import",
                    "ai_suggested": False,
                    "accepted": True,
                }
            ]
        },
    )

    assert count == 1
    assert service._agent_learning.acceptances == [
        {
            "target_column": "CUSTOMER_ID",
            "source_columns": ["RAW.CUSTOMERS.ID"],
            "preprocessing_rule": "Direct mapping",
            "preprocessing_rule_type": "Historical",
            "confidence_score": 0.99,
            "project_id": "project_1",
            "sttm_id": "sttm_1",
            "user_id": "client_import",
            "target_table": "CURATED.PUBLIC.CUSTOMER_DIM",
            "source_tables": ["RAW.PUBLIC.CUSTOMERS"],
            "provenance": "historical_import",
        }
    ]
