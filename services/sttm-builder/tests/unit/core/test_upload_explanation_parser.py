import pytest

from app.routers.upload import _build_variable_approval, _parse_llm_json


def test_parse_upload_explanation_from_chat_completion_envelope() -> None:
    payload = {
        "choices": [
            {
                "messages": [
                    {
                        "content": [
                            {
                                "type": "text",
                                "text": (
                                    '```json\n{"overview":"Household lineage",'
                                    '"relationships":[],"ctes":[]}\n```'
                                ),
                            }
                        ]
                    }
                ]
            }
        ]
    }

    parsed = _parse_llm_json(payload)

    assert parsed["overview"] == "Household lineage"
    assert parsed["relationships"] == []


def test_parse_upload_explanation_from_json_string() -> None:
    parsed = _parse_llm_json(
        '{"overview":"Mapped SQL","relationships":[],"ctes":[]}'
    )

    assert parsed["overview"] == "Mapped SQL"


def test_variable_approval_accepts_only_project_value_candidates() -> None:
    attributes = {
        "variable_bindings": [
            {"name": "FirmId", "project_value_candidate": True},
            {"name": "SourceDb", "project_value_candidate": False},
            {"name": "RunDate", "project_value_candidate": True},
        ]
    }

    approval = _build_variable_approval(attributes, ["firmid"])

    assert approval["approved_names"] == ["FirmId"]
    assert approval["rejected_names"] == ["RunDate"]
    with pytest.raises(ValueError, match="SourceDb"):
        _build_variable_approval(attributes, ["SourceDb"])
