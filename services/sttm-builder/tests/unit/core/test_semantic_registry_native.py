from scripts.semantic_registry_native import normalize_relationship_aliases


def test_duplicate_relationship_aliases_preserve_alternatives() -> None:
    payload = {
        "database": "DB",
        "semantic_model": {
            "relationships": {
                "incoming": [],
                "outgoing": [
                    {
                        "schema": "OPS",
                        "table": "WORKFLOW_SESSION",
                        "confidence": "LOW",
                        "column_mappings": [{"fk_column": "LOAN_ID", "pk_column": "LOAN_ID"}],
                    },
                    {
                        "schema": "OPS",
                        "table": "WORKFLOW_SESSION",
                        "confidence": "MEDIUM",
                        "column_mappings": [{"fk_column": "CUSTOMER_ID", "pk_column": "CUSTOMER_ID"}],
                    },
                    {
                        "schema": "OPS",
                        "table": "NOTE",
                        "confidence": "HIGH",
                        "column_mappings": [{"fk_column": "NOTE_ID", "pk_column": "NOTE_ID"}],
                    },
                ],
            }
        },
    }

    normalized, changed = normalize_relationship_aliases(payload)

    assert changed is True
    outgoing = normalized["semantic_model"]["relationships"]["outgoing"]
    assert [item["table"] for item in outgoing] == ["WORKFLOW_SESSION", "NOTE"]
    assert outgoing[0]["confidence"] == "MEDIUM"
    archived = normalized["semantic_model"]["native_view_alternative_relationships"]
    assert len(archived) == 1
    assert archived[0]["candidate"]["column_mappings"][0]["fk_column"] == "LOAN_ID"
    assert len(payload["semantic_model"]["relationships"]["outgoing"]) == 3


def test_unique_relationship_aliases_are_unchanged() -> None:
    payload = {
        "semantic_model": {
            "relationships": {
                "incoming": [],
                "outgoing": [
                    {"database": "DB", "schema": "OPS", "table": "NOTE", "confidence": "HIGH"}
                ],
            }
        }
    }

    normalized, changed = normalize_relationship_aliases(payload)

    assert changed is False
    assert normalized == payload
