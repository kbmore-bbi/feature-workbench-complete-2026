import json
from unittest.mock import MagicMock

from app.core.semantic_knowledge_resolver import SemanticKnowledgeResolver
from app.schema.common import TableRef


def test_relationships_are_resolved_for_all_tables_in_one_query() -> None:
    settings = MagicMock()
    settings.resolved_semantic_views_table = "REGISTRY.DB.LATEST_TABLE_REGISTRY_V"
    settings.qualify_metadata_object_name.return_value = "APP.META.TBL_SEMANTIC_VIEW_VERSIONS"
    session = MagicMock()
    query = MagicMock()
    query.collect.return_value = [
        {
            "FQN": "DB.CRM.CONTACT",
            "RELATIONSHIPS": json.dumps(
                [
                    {
                        "left_table": "DB.CRM.CONTACT",
                        "right_table": "DB.CRM.ADDRESS",
                        "column_mappings": [
                            {"left_column": "ID", "right_column": "CONTACT_ID"}
                        ],
                        "business_purpose": "Attach contact addresses",
                    }
                ]
            ),
            "RELATIONSHIP_SOURCE": "VALIDATED_CURATED",
            "ATTRIBUTES": None,
        },
        {
            "FQN": "DB.CRM.ADDRESS",
            "RELATIONSHIPS": None,
            "RELATIONSHIP_SOURCE": "REGISTRY",
            "ATTRIBUTES": None,
        },
    ]
    session.sql.return_value = query
    resolver = SemanticKnowledgeResolver(settings)

    result = resolver.relationship_payloads(
        session,
        [
            TableRef(database="DB", schema="CRM", table="CONTACT"),
            TableRef(database="DB", schema="CRM", table="ADDRESS"),
        ],
    )

    assert session.sql.call_count == 1
    assert result["DB.CRM.CONTACT"]["outgoing"][0]["table"] == "ADDRESS"
    assert result["DB.CRM.ADDRESS"]["incoming"][0]["table"] == "CONTACT"
    assert (
        result["DB.CRM.CONTACT"]["outgoing"][0]["business_meaning"]
        == "Attach contact addresses"
    )


def test_unconfirmed_and_medium_registry_relationships_require_review() -> None:
    settings = MagicMock()
    settings.resolved_semantic_views_table = "REGISTRY.DB.LATEST_TABLE_REGISTRY_V"
    settings.qualify_metadata_object_name.return_value = "APP.META.TBL_SEMANTIC_VIEW_VERSIONS"
    session = MagicMock()
    session.sql.return_value.collect.return_value = [
        {
            "FQN": "DB.CRM.CONTACT",
            "RELATIONSHIP_SOURCE": "REGISTRY",
            "RELATIONSHIPS": [
                {
                    "left_table": "DB.CRM.CONTACT",
                    "right_table": "DB.CRM.ADDRESS",
                    "confidence": "MEDIUM",
                    "column_mappings": [
                        {"left_column": "ID", "right_column": "CONTACT_ID"}
                    ],
                },
                {
                    "left_table": "DB.CRM.CONTACT",
                    "right_table": "DB.CRM.STATUS",
                    "column_mappings": [
                        {"left_column": "STATUS_ID", "right_column": "ID"}
                    ],
                },
            ],
            "ATTRIBUTES": None,
        },
        {
            "FQN": "DB.CRM.ADDRESS",
            "RELATIONSHIP_SOURCE": "REGISTRY",
            "RELATIONSHIPS": None,
            "ATTRIBUTES": None,
        },
        {
            "FQN": "DB.CRM.STATUS",
            "RELATIONSHIP_SOURCE": "REGISTRY",
            "RELATIONSHIPS": None,
            "ATTRIBUTES": None,
        },
    ]
    resolver = SemanticKnowledgeResolver(settings)

    result = resolver.relationship_payloads(
        session,
        [
            TableRef(database="DB", schema="CRM", table="CONTACT"),
            TableRef(database="DB", schema="CRM", table="ADDRESS"),
            TableRef(database="DB", schema="CRM", table="STATUS"),
        ],
    )

    assert result["DB.CRM.CONTACT"]["outgoing"] == []
    candidates = result["DB.CRM.CONTACT"]["review_outgoing"]
    assert len(candidates) == 2
    assert all(item.get("review_reason") for item in candidates)


def test_high_confidence_registry_relationship_is_auto_applied() -> None:
    assert SemanticKnowledgeResolver._relationship_is_confirmed(
        {"confidence": "HIGH"},
        curated=False,
    )
    assert not SemanticKnowledgeResolver._relationship_is_confirmed(
        {"confidence": "MEDIUM"},
        curated=False,
    )


def test_confirmed_native_yaml_relationships_are_resolved_to_physical_tables() -> None:
    settings = MagicMock()
    settings.resolved_semantic_views_table = "REGISTRY.DB.LATEST_TABLE_REGISTRY_V"
    settings.resolved_semantic_native_views_table = "APP.META.SEM_NATIVE_VIEWS"
    settings.qualify_metadata_object_name.return_value = "APP.META.TBL_SEMANTIC_VIEW_VERSIONS"
    session = MagicMock()
    session.sql.return_value.collect.return_value = [
        {
            "FQN": "DB.CRM.CONTACT",
            "RELATIONSHIPS": None,
            "RELATIONSHIP_SOURCE": "REGISTRY",
            "ATTRIBUTES": None,
            "HAS_LOW_CONFIDENCE_JOINS": False,
            "HAS_FLAGGED_EXCLUDED": False,
            "CA_YAML_MODEL": """
tables:
  - name: contacts
    base_table:
      database: DB
      schema: CRM
      table: CONTACT
  - name: addresses
    base_table:
      database: DB
      schema: CRM
      table: ADDRESS
relationships:
  - name: contact_to_address
    left_table: contacts
    right_table: addresses
    relationship_columns:
      - left_column: ID
        right_column: CONTACT_ID
""",
        },
        {
            "FQN": "DB.CRM.ADDRESS",
            "RELATIONSHIPS": None,
            "RELATIONSHIP_SOURCE": "REGISTRY",
            "ATTRIBUTES": None,
            "CA_YAML_MODEL": None,
            "HAS_LOW_CONFIDENCE_JOINS": None,
            "HAS_FLAGGED_EXCLUDED": None,
        },
    ]
    resolver = SemanticKnowledgeResolver(settings)

    result = resolver.relationship_payloads(
        session,
        [
            TableRef(database="DB", schema="CRM", table="CONTACT"),
            TableRef(database="DB", schema="CRM", table="ADDRESS"),
        ],
    )

    outgoing = result["DB.CRM.CONTACT"]["outgoing"][0]
    incoming = result["DB.CRM.ADDRESS"]["incoming"][0]
    assert outgoing["table"] == "ADDRESS"
    assert outgoing["column_mappings"] == [{"fk_column": "ID", "pk_column": "CONTACT_ID"}]
    assert outgoing["source"] == "SEM_NATIVE_VIEWS.CA_YAML_MODEL"
    assert incoming["table"] == "CONTACT"


def test_flagged_native_yaml_relationships_require_review() -> None:
    settings = MagicMock()
    settings.resolved_semantic_views_table = "REGISTRY.DB.LATEST_TABLE_REGISTRY_V"
    settings.resolved_semantic_native_views_table = "APP.META.SEM_NATIVE_VIEWS"
    settings.qualify_metadata_object_name.return_value = "APP.META.TBL_SEMANTIC_VIEW_VERSIONS"
    session = MagicMock()
    session.sql.return_value.collect.return_value = [
        {
            "FQN": "DB.CRM.CONTACT",
            "RELATIONSHIPS": None,
            "RELATIONSHIP_SOURCE": "REGISTRY",
            "ATTRIBUTES": None,
            "HAS_LOW_CONFIDENCE_JOINS": True,
            "HAS_FLAGGED_EXCLUDED": False,
            "CA_YAML_MODEL": """
tables:
  - name: contacts
    base_table: {database: DB, schema: CRM, table: CONTACT}
  - name: addresses
    base_table: {database: DB, schema: CRM, table: ADDRESS}
relationships:
  - left_table: contacts
    right_table: addresses
    relationship_columns:
      - {left_column: ID, right_column: CONTACT_ID}
""",
        },
        {
            "FQN": "DB.CRM.ADDRESS",
            "RELATIONSHIPS": None,
            "RELATIONSHIP_SOURCE": "REGISTRY",
            "ATTRIBUTES": None,
            "CA_YAML_MODEL": None,
            "HAS_LOW_CONFIDENCE_JOINS": None,
            "HAS_FLAGGED_EXCLUDED": None,
        },
    ]
    resolver = SemanticKnowledgeResolver(settings)

    result = resolver.relationship_payloads(
        session,
        [
            TableRef(database="DB", schema="CRM", table="CONTACT"),
            TableRef(database="DB", schema="CRM", table="ADDRESS"),
        ],
    )

    assert result["DB.CRM.CONTACT"]["outgoing"] == []
    candidates = result["DB.CRM.CONTACT"]["review_outgoing"]
    assert len(candidates) == 1
    assert candidates[0]["review_reason"]
