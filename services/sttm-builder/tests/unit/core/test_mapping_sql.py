from app.core.mapping_sql import MappingSqlService
from app.core.snowflake_analyst import SnowflakeAnalystResponse
from app.schema.common import TableRef
from app.schema.mapping_sql import (
    MappingSqlCompileRequest,
    MappingSqlMappingItem,
    MappingSqlParseRequest,
    MappingSqlReviewRequest,
)
from app.schema.sttm_builder import (
    RelationEdge,
    RelationGraphContext,
    RelationNode,
    RelationNodeKind,
    RelationshipConditionItem,
    ValueBinding,
)


class _Query:
    def collect(self):
        return []


class _Session:
    def sql(self, _query):
        return _Query()


class _FailingQuery:
    def collect(self):
        raise RuntimeError(
            "SQL compilation error: Session variable '$TransactionFirmID' does not exist"
        )


class _FailingSession:
    def sql(self, _query):
        return _FailingQuery()


class _Analyst:
    def __init__(self):
        self.calls = []

    def ask(self, **kwargs):
        self.calls.append(kwargs)
        return SnowflakeAnalystResponse(
            request_id="analyst-request",
            text="The SQL is valid.",
            sql="SELECT SRC.ID AS ID FROM DB.SCHEMA.SRC",
        )


def test_compile_uses_current_graph_even_when_all_rows_accept_precedent() -> None:
    class Session:
        def sql(self, *_args, **_kwargs):
            raise AssertionError("Compilation must not retrieve prior RAW_MAPPING_SQL")

    service = MappingSqlService(
        session=Session(),
        analyst_client=_Analyst(),
    )

    response = service.compile(
        MappingSqlCompileRequest(
            relation_graph=RelationGraphContext(
                nodes=[
                    RelationNode(
                        relation_id="DB.CRM.CONTACTS",
                        kind=RelationNodeKind.PHYSICAL_TABLE,
                        alias="contacts_1",
                        table=TableRef(database="DB", schema="CRM", table="CONTACTS"),
                    )
                ],
            ),
            mappings=[
                MappingSqlMappingItem(
                    target_column="LEGACY_ID__C",
                    source_column="contacts_1.ID",
                    source_columns=["contacts_1.ID"],
                    source_dependencies=["contacts_1.ID"],
                    expression="'HH-' || CAST(contacts_1.ID AS TEXT)",
                    status="MAPPED",
                    precedent_decision="accept_precedent",
                    precedent_mapping_id="1101",
                )
            ],
            target_table=TableRef(database="DB", schema="TGT", table="EVERNEST_HH"),
            accepted_precedent_sttm_id="1101",
            validate_with_explain=False,
        )
    )

    assert response.valid is True
    assert response.ready is True
    assert "'HH-' || CAST(contacts_1.ID AS TEXT) AS LEGACY_ID__C" in response.preview_sql
    assert "FROM DB.CRM.CONTACTS AS contacts_1" in response.preview_sql
    assert "UserMaster" not in response.preview_sql


def test_review_uses_inline_semantic_yaml_when_view_is_not_promoted() -> None:
    analyst = _Analyst()
    service = MappingSqlService(session=_Session(), analyst_client=analyst)
    request = MappingSqlReviewRequest(
        source_query_sql="SELECT * FROM DB.SCHEMA.SRC",
        preview_sql="SELECT SRC.ID AS ID FROM DB.SCHEMA.SRC",
        generated_sql="INSERT INTO DB.SCHEMA.TGT (ID) SELECT SRC.ID FROM DB.SCHEMA.SRC",
        semantic_model_yaml="name: INLINE_TEST\ntables: []\n",
    )

    response = service.review(request)

    assert response.review_agent == "CORTEX_ANALYST"
    assert analyst.calls[0]["semantic_view"] is None
    assert analyst.calls[0]["semantic_model_yaml"] == request.semantic_model_yaml


def test_review_prompt_includes_derived_output_contract_and_saved_sql() -> None:
    analyst = _Analyst()
    service = MappingSqlService(session=_Session(), analyst_client=analyst)
    request = MappingSqlReviewRequest(
        source_query_sql="SELECT * FROM DB.SCHEMA.SRC",
        preview_sql="SELECT household_1.HOUSEHOLD_ID AS ID FROM household_1",
        generated_sql="SELECT household_1.HOUSEHOLD_ID AS ID FROM household_1",
        semantic_model_yaml="name: INLINE_TEST\ntables: []\n",
        relation_graph=RelationGraphContext(
            nodes=[
                RelationNode(
                    relation_id="household",
                    kind=RelationNodeKind.DERIVED_SOURCE,
                    alias="household_1",
                    sql_text="SELECT CONTACT_ID, HOUSEHOLD_ID FROM DB.CRM.FAMILIES",
                    output_columns=[
                        {"name": "CONTACT_ID", "data_type": "NUMBER"},
                        {"name": "HOUSEHOLD_ID", "data_type": "NUMBER"},
                    ],
                )
            ]
        ),
    )

    service.review(request)

    question = analyst.calls[0]["question"]
    assert "outputs=['CONTACT_ID', 'HOUSEHOLD_ID']" in question
    assert "Saved SQL for derived relation household" in question
    assert "Never reference a derived column" in question


def test_review_returns_actionable_value_binding_fix_when_validation_fails() -> None:
    service = MappingSqlService(session=_FailingSession(), analyst_client=_Analyst())
    request = MappingSqlReviewRequest(
        source_query_sql="SELECT * FROM DB.SCHEMA.SRC",
        preview_sql="SELECT '$TransactionFirmID' AS TRANSACTION_FIRM__C FROM DB.SCHEMA.SRC",
        generated_sql=(
            "INSERT INTO DB.SCHEMA.TGT (TRANSACTION_FIRM__C) "
            "SELECT '$TransactionFirmID' FROM DB.SCHEMA.SRC"
        ),
    )

    response = service.review(request)

    assert response.execution_ready is False
    assert response.requires_approval is False
    assert [item.code for item in response.repair_options] == [
        "resolve_value_binding",
        "edit_sql",
    ]
    assert response.repair_options[0].identifier == "$TransactionFirmID"
    assert response.repair_options[0].action == "open_mapping"


def test_parse_blocks_ambiguous_unqualified_table_references() -> None:
    service = MappingSqlService(session=_Session(), analyst_client=_Analyst())

    response = service.parse(
        MappingSqlParseRequest(
            sql="INSERT INTO TARGET_TABLE (ID) SELECT ID FROM CONTACT",
            known_tables=[
                TableRef(database="DB_A", schema="CRM", table="CONTACT"),
                TableRef(database="DB_B", schema="CRM", table="CONTACT"),
                TableRef(database="DB_A", schema="CRM", table="TARGET_TABLE"),
            ],
        )
    )

    assert response.valid is False
    assert response.ambiguous_references["CONTACT"] == [
        "DB_A.CRM.CONTACT",
        "DB_B.CRM.CONTACT",
    ]


def test_parse_select_preview_preserves_current_target() -> None:
    service = MappingSqlService(session=_Session(), analyst_client=_Analyst())

    response = service.parse(
        MappingSqlParseRequest(
            sql="SELECT SRC.ID AS ID FROM DB_A.CRM.CONTACT AS SRC",
            known_tables=[
                TableRef(database="DB_A", schema="CRM", table="CONTACT"),
                TableRef(database="DB_A", schema="CRM", table="TARGET_TABLE"),
            ],
            current_workspace={"target_table": "DB_A.CRM.TARGET_TABLE"},
        )
    )

    assert response.valid is True
    assert response.parsed_workspace["target_table"] == "DB_A.CRM.TARGET_TABLE"
    assert "target_table_changed" not in response.diff


def test_compile_unifies_physical_and_derived_relations() -> None:
    service = MappingSqlService(session=_Session(), analyst_client=_Analyst())
    graph = RelationGraphContext(
        nodes=[
            RelationNode(
                relation_id="DB.CRM.CONTACTS",
                kind=RelationNodeKind.PHYSICAL_TABLE,
                alias="contacts_1",
                table=TableRef(database="DB", schema="CRM", table="CONTACTS"),
            ),
            RelationNode(
                relation_id="household_rollup",
                kind=RelationNodeKind.DERIVED_SOURCE,
                alias="household_rollup_2",
                sql_text="SELECT CONTACT_ID, HOUSEHOLD_ID FROM DB.CRM.FAMILIES",
            ),
        ],
        edges=[
            RelationEdge(
                edge_id="contacts-household",
                left_relation_id="DB.CRM.CONTACTS",
                right_relation_id="household_rollup",
                join_type="LEFT",
                conditions=[
                    RelationshipConditionItem(
                        left_column="ID", right_column="CONTACT_ID", operator="="
                    )
                ],
            )
        ],
    )

    response = service.compile(
        MappingSqlCompileRequest(
            relation_graph=graph,
            target_table=TableRef(database="DB", schema="CRM", table="TARGET"),
            driving_relation_id="DB.CRM.CONTACTS",
            validate_with_explain=False,
            mappings=[
                MappingSqlMappingItem(
                    target_column="LEGACY_ID",
                    source_columns=["DB.CRM.CONTACTS.ID", "household_rollup_2.HOUSEHOLD_ID"],
                    source_dependencies=["DB.CRM.CONTACTS.ID", "household_rollup_2.HOUSEHOLD_ID"],
                    expression="COALESCE(household_rollup_2.HOUSEHOLD_ID, DB.CRM.CONTACTS.ID)",
                    status="MAPPED",
                )
            ],
        )
    )

    assert response.ready is True
    assert "WITH\nhousehold_rollup_2 AS (" in response.preview_sql
    assert "FROM DB.CRM.CONTACTS AS contacts_1" in response.preview_sql
    assert "LEFT JOIN household_rollup_2" in response.preview_sql
    assert "COALESCE(household_rollup_2.HOUSEHOLD_ID, contacts_1.ID)" in response.preview_sql
    assert response.preview_sql.count("FROM DB.CRM.CONTACTS") == 1


def test_compile_rejects_query_level_mapping_expression() -> None:
    service = MappingSqlService(session=_Session(), analyst_client=_Analyst())
    graph = RelationGraphContext(
        nodes=[
            RelationNode(
                relation_id="DB.CRM.CONTACTS",
                kind=RelationNodeKind.PHYSICAL_TABLE,
                alias="contacts_1",
                table=TableRef(database="DB", schema="CRM", table="CONTACTS"),
            )
        ]
    )

    try:
        service.compile(
            MappingSqlCompileRequest(
                relation_graph=graph,
                validate_with_explain=False,
                mappings=[
                    MappingSqlMappingItem(
                        target_column="ID",
                        source_dependencies=["contacts_1.ID"],
                        expression="contacts_1.ID FROM DB.CRM.CONTACTS",
                        status="MAPPED",
                    )
                ],
            )
        )
    except ValueError as exc:
        assert "Query-level SQL" in str(exc)
    else:
        raise AssertionError("Expected query-level SQL to be rejected")


def test_compile_preserves_but_blocks_unresolved_value_placeholder() -> None:
    service = MappingSqlService(session=_Session(), analyst_client=_Analyst())
    graph = RelationGraphContext(
        nodes=[
            RelationNode(
                relation_id="DB.CRM.CONTACTS",
                kind=RelationNodeKind.PHYSICAL_TABLE,
                alias="contacts_1",
                table=TableRef(database="DB", schema="CRM", table="CONTACTS"),
            )
        ],
        value_bindings=[
            ValueBinding(
                binding_id="parent-office",
                value="$ParentOfficeID",
                is_placeholder=True,
                resolution_status="placeholder_contract",
            )
        ],
    )

    response = service.compile(
        MappingSqlCompileRequest(
            relation_graph=graph,
            validate_with_explain=False,
            mappings=[
                MappingSqlMappingItem(
                    target_column="PARENT_ID",
                    mapping_mode="constant",
                    constant_value="$ParentOfficeID",
                    value_binding_ids=["parent-office"],
                    status="MAPPED",
                )
            ],
        )
    )

    assert response.ready is False
    assert response.unresolved_placeholders == ["$ParentOfficeID"]
    assert "$ParentOfficeID AS PARENT_ID" in response.preview_sql


def test_compile_substitutes_only_explicitly_resolved_value_placeholder() -> None:
    service = MappingSqlService(session=_Session(), analyst_client=_Analyst())
    graph = RelationGraphContext(
        nodes=[
            RelationNode(
                relation_id="DB.CRM.CONTACTS",
                kind=RelationNodeKind.PHYSICAL_TABLE,
                alias="contacts_1",
                table=TableRef(database="DB", schema="CRM", table="CONTACTS"),
            )
        ],
        value_bindings=[
            ValueBinding(
                binding_id="parent-office",
                value="$ParentOfficeID",
                resolved_value="001-office",
                data_type="VARCHAR",
                is_placeholder=True,
                resolution_status="resolved",
            )
        ],
    )

    response = service.compile(
        MappingSqlCompileRequest(
            relation_graph=graph,
            driving_relation_id="DB.CRM.CONTACTS",
            validate_with_explain=False,
            mappings=[
                MappingSqlMappingItem(
                    target_column="PARENT_ID",
                    mapping_mode="constant",
                    constant_value="$ParentOfficeID",
                    value_binding_ids=["parent-office"],
                    status="MAPPED",
                )
            ],
        )
    )

    assert response.ready is True
    assert response.unresolved_placeholders == []
    assert "'001-office' AS PARENT_ID" in response.preview_sql


def test_compile_accepts_unique_placeholder_value_as_binding_reference() -> None:
    service = MappingSqlService(session=_Session(), analyst_client=_Analyst())
    graph = RelationGraphContext(
        nodes=[
            RelationNode(
                relation_id="DB.CRM.CONTACTS",
                kind=RelationNodeKind.PHYSICAL_TABLE,
                alias="contacts_1",
                table=TableRef(database="DB", schema="CRM", table="CONTACTS"),
            )
        ],
        value_bindings=[
            ValueBinding(
                binding_id="canonical-TransactionFirmID",
                value="$TransactionFirmID",
                is_placeholder=True,
                resolution_status="placeholder_contract",
            )
        ],
    )

    response = service.compile(
        MappingSqlCompileRequest(
            relation_graph=graph,
            validate_with_explain=False,
            mappings=[
                MappingSqlMappingItem(
                    target_column="TRANSACTION_FIRM__C",
                    mapping_mode="constant",
                    constant_value="$TransactionFirmID",
                    value_binding_ids=["$TransactionFirmID"],
                    status="MAPPED",
                )
            ],
        )
    )

    assert response.ready is False
    assert response.unresolved_placeholders == ["$TransactionFirmID"]


def test_compile_rejects_circular_derived_dependencies() -> None:
    service = MappingSqlService(session=_Session(), analyst_client=_Analyst())
    graph = RelationGraphContext(
        nodes=[
            RelationNode(
                relation_id="derived_a",
                kind=RelationNodeKind.DERIVED_SOURCE,
                alias="derived_a",
                sql_text="SELECT ID FROM derived_b",
                parent_relation_ids=["derived_b"],
            ),
            RelationNode(
                relation_id="derived_b",
                kind=RelationNodeKind.CTE,
                alias="derived_b",
                sql_text="SELECT ID FROM derived_a",
                parent_relation_ids=["derived_a"],
            ),
        ]
    )

    try:
        service.compile(
            MappingSqlCompileRequest(
                relation_graph=graph,
                driving_relation_id="derived_a",
                validate_with_explain=False,
                mappings=[
                    MappingSqlMappingItem(
                        target_column="ID",
                        source_dependencies=["derived_a.ID"],
                        status="MAPPED",
                    )
                ],
            )
        )
    except ValueError as exc:
        assert "Circular derived-source dependency" in str(exc)
    else:
        raise AssertionError("Expected circular derived dependencies to be rejected")


def test_compile_rejects_column_missing_from_derived_output_contract() -> None:
    service = MappingSqlService(session=_Session(), analyst_client=_Analyst())
    graph = RelationGraphContext(
        nodes=[
            RelationNode(
                relation_id="household_rollup",
                kind=RelationNodeKind.DERIVED_SOURCE,
                alias="household_rollup_1",
                sql_text="SELECT CONTACT_ID, HOUSEHOLD_ID FROM DB.CRM.FAMILIES",
                output_columns=[
                    {"name": "CONTACT_ID", "data_type": "NUMBER"},
                    {"name": "HOUSEHOLD_ID", "data_type": "NUMBER"},
                ],
            )
        ]
    )

    try:
        service.compile(
            MappingSqlCompileRequest(
                relation_graph=graph,
                validate_with_explain=False,
                mappings=[
                    MappingSqlMappingItem(
                        target_column="LEGACY_FIRM_INFO__C",
                        source_columns=["household_rollup.MISSING_LEGACY_INFO"],
                        source_dependencies=["household_rollup.MISSING_LEGACY_INFO"],
                        status="MAPPED",
                    )
                ],
            )
        )
    except ValueError as exc:
        assert "is not produced by relation household_rollup" in str(exc)
    else:
        raise AssertionError("Expected missing derived output to be rejected")
