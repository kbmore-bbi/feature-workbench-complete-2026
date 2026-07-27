from app.core.mapping_knowledge_projector import MappingKnowledgeProjector


class _Recorder:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def record_learning(self, **kwargs):
        self.items.append(kwargs)
        return f"learning_{len(self.items)}"


def test_projector_captures_structural_mapping_shape() -> None:
    recorder = _Recorder()
    projector = MappingKnowledgeProjector(recorder)

    count = projector.project(
        project_id="project_1",
        sttm_id="mapping_1",
        user_id="user_1",
        outcome="published",
        snapshot={
            "provenance": "historical_import",
            "source_tables": [
                {"database": "RAW", "schema": "CRM", "table": "CONTACT"},
                {"database": "RAW", "schema": "CRM", "table": "ADDRESS"},
            ],
            "target_table": {
                "database": "CURATED",
                "schema": "CRM",
                "table": "CONTACT_DIM",
            },
            "mapping_rows": [
                {
                    "target_column": "CONTACT_ID",
                    "source_columns": ["RAW.CRM.CONTACT.ID"],
                },
                {
                    "target_column": "SOURCE_SYSTEM",
                    "constant_value": "CRM",
                },
                {
                    "target_column": "FULL_NAME",
                    "source_columns": ["RAW.CRM.CONTACT.FIRST_NAME", "RAW.CRM.CONTACT.LAST_NAME"],
                    "expression": "CONCAT(FIRST_NAME, ' ', LAST_NAME)",
                },
            ],
            "relationships": [
                {
                    "left_table": "RAW.CRM.CONTACT",
                    "right_table": "RAW.CRM.ADDRESS",
                    "join_type": "LEFT",
                    "condition": "CONTACT.ID = ADDRESS.CONTACT_ID",
                    "cardinality": "one_to_many",
                }
            ],
            "filters": [{"expression": "CONTACT.IS_ACTIVE = TRUE"}],
            "grouping": ["CONTACT.ID"],
            "sorting": [{"column": "CONTACT.UPDATED_AT", "direction": "DESC"}],
            "ctes": [
                {
                    "name": "latest_address",
                    "input_tables": ["RAW.CRM.ADDRESS"],
                    "grain": "one row per contact",
                    "purpose": "Select the latest address",
                }
            ],
            "validation": {"status": "passed"},
        },
    )

    assert count == len(recorder.items) == 10
    learning_types = [item["learning_type"] for item in recorder.items]
    assert learning_types.count("column_mapping") == 3
    assert "transformation_pattern" in learning_types
    assert "table_relationship" in learning_types
    assert "query_filter" in learning_types
    assert "query_grouping" in learning_types
    assert "query_sorting" in learning_types
    assert "cte_lineage" in learning_types
    assert "validation_outcome" in learning_types

    constant = next(
        item
        for item in recorder.items
        if item["learning_type"] == "column_mapping"
        and item["attributes"]["target_column"] == "SOURCE_SYSTEM"
    )
    assert constant["attributes"]["reusability"] == "project_specific"
    assert constant["attributes"]["constant_value"] == "CRM"
    assert constant["confidence"] == 1.0
