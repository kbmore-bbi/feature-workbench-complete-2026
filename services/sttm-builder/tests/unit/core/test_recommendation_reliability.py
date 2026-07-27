from app.routers.notifications import _format_recommendations


def test_recommendation_title_comes_from_subject_not_question_code() -> None:
    items = _format_recommendations(
        [
            {
                "recommendation_id": "rec-1",
                "question_id": "Q6",
                "recommendation_type": "feedback_question",
                "recommendation_category": "relationship",
                "display_message": "Please confirm the relationship.",
                "agent_payload": {
                    "subject": "Contact family membership may create duplicate households",
                    "current_understanding": "Membership can fan out to multiple household rows.",
                },
                "content_version": 2,
            }
        ],
        {},
    )

    assert items[0]["title"] == "Contact family membership may create duplicate households"
    assert items[0]["question_id"] == "Q6"


def test_recommendation_dedupe_includes_content_version() -> None:
    base = {
        "recommendation_id": "rec-1",
        "group_key": "household-rule",
        "display_message": "Billing address selection uses the primary address.",
        "agent_payload": {},
    }
    items = _format_recommendations(
        [
            {**base, "content_version": 1, "confidence": 0.8},
            {**base, "content_version": 2, "confidence": 0.9},
        ],
        {},
    )

    assert [item["content_version"] for item in items] == [2, 1]
