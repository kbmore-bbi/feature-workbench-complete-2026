from app.routers.notifications import _apply_checkpoint_policy, _format_recommendations


def test_q6_source_set_warning_is_canonicalized_as_relationship() -> None:
    items, questions = _apply_checkpoint_policy(
        [
            {
                "recommendation_id": "rec-q6",
                "milestone": "source_set_completed",
                "recommendation_category": "validation",
                "recommendation_type": "correction_warning",
                "question_id": "Q6",
            }
        ],
        {
            "eligible_goals": ["Q6", "Q9"],
            "recommendation_categories": ["relationship", "query_shaping"],
            "max_inline_items": 8,
            "max_interruptive_questions": 1,
            "display_surfaces": ["inline", "inbox", "assistant"],
        },
        8,
    )

    assert [item["recommendation_id"] for item in items] == ["rec-q6"]
    assert items[0]["recommendation_category"] == "relationship"
    assert [item["recommendation_id"] for item in questions] == ["rec-q6"]


def test_schema_candidate_guidance_is_visible_but_not_interruptive() -> None:
    items, questions = _apply_checkpoint_policy(
        [
            {
                "recommendation_id": "rec-table",
                "milestone": "schema_browsed",
                "recommendation_category": "source_discovery",
                "recommendation_type": "context_enrichment",
                "question_id": "Q1",
            }
        ],
        {
            "eligible_goals": ["Q1", "Q6"],
            "recommendation_categories": ["source_discovery", "relationship"],
            "max_inline_items": 8,
            "max_interruptive_questions": 1,
            "display_surfaces": ["inline", "inbox"],
        },
        8,
    )

    assert [item["recommendation_id"] for item in items] == ["rec-table"]
    assert questions == []


def test_persistent_inbox_can_return_more_than_inline_limit() -> None:
    items, questions = _apply_checkpoint_policy(
        [
            {
                "recommendation_id": f"rec-{index}",
                "milestone": "source_set_completed",
                "recommendation_category": "relationship",
                "recommendation_type": "relationship_hint",
            }
            for index in range(6)
        ],
        {
            "eligible_goals": ["Q6", "Q9"],
            "recommendation_categories": ["relationship", "query_shaping"],
            "max_inline_items": 2,
            "max_interruptive_questions": 1,
            "display_surfaces": ["inline", "inbox", "assistant"],
        },
        10,
        respect_inline_limit=False,
    )

    assert len(items) == 6
    assert questions == []


def test_compatible_validation_warning_is_not_relabelled_as_source_discovery() -> None:
    items, questions = _apply_checkpoint_policy(
        [
            {
                "recommendation_id": "rec-validation",
                "milestone": "selection_changed",
                "recommendation_type": "correction_warning",
                "question_id": None,
            }
        ],
        {
            "eligible_goals": ["Q1"],
            "recommendation_categories": ["source_discovery", "relationship"],
            "max_inline_items": 8,
            "max_interruptive_questions": 1,
            "display_surfaces": ["inline", "inbox"],
        },
        8,
    )

    assert items == []
    assert questions == []


def test_notifications_use_content_title_and_demote_q_code_to_metadata() -> None:
    items = _format_recommendations(
        [
            {
                "recommendation_id": "rec-q1",
                "question_id": "Q1",
                "milestone": "schema_browsed",
                "display_message": "CONTACTS represents the client household anchor.",
                "agent_payload": {
                    "subject": "Confirm the CONTACTS household role",
                    "entity_label": "CONTACTS",
                },
                "content_version": 1,
            }
        ],
        {},
    )

    assert items[0]["title"] == "Confirm the CONTACTS household role"
    assert items[0]["current_understanding"] == "CONTACTS represents the client household anchor."
    assert items[0]["topic"] == "source_entity_meaning"
    assert "Q1" not in items[0]["title"]


def test_notification_queue_is_workflow_ordered_and_deduplicated() -> None:
    raw = [
        {
            "recommendation_id": "transform",
            "recommendation_category": "transformation",
            "display_message": "Review the CASE expression.",
            "agent_payload": {"entity_label": "HOUSEHOLD_TYPE"},
            "content_version": 1,
        },
        {
            "recommendation_id": "relationship-low",
            "recommendation_category": "relationship",
            "display_message": "Join CONTACTS to ADDRESSES.",
            "confidence": 0.5,
            "agent_payload": {"entity_label": "CONTACTS → ADDRESSES"},
            "content_version": 1,
        },
        {
            "recommendation_id": "relationship-high",
            "recommendation_category": "relationship",
            "display_message": "Use the primary-address relationship.",
            "confidence": 0.9,
            "agent_payload": {"entity_label": "CONTACTS → ADDRESSES"},
            "content_version": 1,
        },
    ]
    formatted = _format_recommendations(raw, {})
    items, _ = _apply_checkpoint_policy(
        formatted,
        {
            "eligible_goals": [],
            "recommendation_categories": [],
            "max_inline_items": 5,
            "max_interruptive_questions": 1,
            "display_surfaces": ["assistant"],
        },
        5,
    )

    assert [item["recommendation_id"] for item in items] == [
        "relationship-high",
        "transform",
    ]
    assert [item["display_rank"] for item in items] == [30, 80]
