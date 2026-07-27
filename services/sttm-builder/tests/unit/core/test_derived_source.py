import base64
import json

from app.core.derived_source import DerivedSourceService
from app.schema.common import TableRef
from app.schema.derived_source import DerivedSourceDefinition


def test_qualifies_unique_selected_short_table_names_and_preserves_ctes() -> None:
    sql = """
    WITH eligible_families AS (
      SELECT ID FROM CONTACT_FAMILIES
    )
    SELECT cf.ID, c.ID AS CONTACT_ID
    FROM eligible_families cf
    JOIN CONTACTS c ON c.ID = cf.ID
    """
    sources = [
        TableRef(database="CLIENT_DB", schema="EVERNEST", table="CONTACT_FAMILIES"),
        TableRef(database="CLIENT_DB", schema="EVERNEST", table="CONTACTS"),
    ]

    normalized = DerivedSourceService._qualify_selected_source_tables(sql, sources)

    # The CTE reference remains logical, while its physical source and the
    # physical CONTACTS relation are made execution-safe.
    assert 'FROM eligible_families AS cf' in normalized
    assert 'FROM CLIENT_DB.EVERNEST.CONTACT_FAMILIES' in normalized
    assert 'JOIN CLIENT_DB.EVERNEST.CONTACTS AS c' in normalized


def test_json_literal_round_trips_multiline_agent_metadata() -> None:
    value = {
        "summary": "One household per family.\nOwner's preferred label.",
        "conditions": [{"left_column": "ID", "operator": "=", "right_column": "FAMILY_ID"}],
    }

    expression = DerivedSourceService._json_literal(value)

    assert expression.startswith("BASE64_DECODE_STRING('")
    encoded = expression.removeprefix("BASE64_DECODE_STRING('").removesuffix("')")
    assert json.loads(base64.b64decode(encoded).decode("utf-8")) == value


def test_derived_outputs_receive_type_lineage_and_semantic_coverage() -> None:
    semantics = DerivedSourceService._derive_column_semantics(
        sql_text=(
            "SELECT c.ID AS HOUSEHOLD_ID, "
            "COALESCE(c.FIRST_NAME, '') || ' ' || COALESCE(c.LAST_NAME, '') AS HOUSEHOLD_NAME "
            "FROM DB.CRM.CONTACTS c"
        ),
        output_columns=[
            {"name": "HOUSEHOLD_ID", "data_type": "NUMBER"},
            {"name": "HOUSEHOLD_NAME", "data_type": "VARCHAR"},
        ],
        supplied=[
            {
                "name": "HOUSEHOLD_ID",
                "business_meaning": "Stable legacy household identifier",
            }
        ],
    )

    assert len(semantics) == 2
    assert all(item["data_type"] for item in semantics)
    assert all(item["business_meaning"] for item in semantics)
    by_name = {item["name"]: item for item in semantics}
    assert by_name["HOUSEHOLD_ID"]["semantic_source"] == "agent_declared"
    assert by_name["HOUSEHOLD_ID"]["source_columns"] == ["c.ID"]
    assert set(by_name["HOUSEHOLD_NAME"]["source_columns"]) == {
        "c.FIRST_NAME",
        "c.LAST_NAME",
    }
    assert by_name["HOUSEHOLD_ID"]["business_meaning_status"] == "declared"
    assert by_name["HOUSEHOLD_NAME"]["business_meaning_status"] == "fallback"


def test_fallback_labels_do_not_satisfy_derived_semantic_contract() -> None:
    body = DerivedSourceDefinition(
        derived_source_name="households",
        sql_text="SELECT c.ID AS HOUSEHOLD_ID FROM DB.CRM.CONTACTS c",
        source_tables=[TableRef(database="DB", schema="CRM", table="CONTACTS")],
        purpose="Prepare household migration data",
        business_description="One reusable household-level migration source.",
    )
    outputs = [{"name": "HOUSEHOLD_ID", "data_type": "NUMBER"}]
    semantics = DerivedSourceService._derive_column_semantics(
        sql_text=body.sql_text,
        output_columns=outputs,
        supplied=[],
    )

    quality, issues = DerivedSourceService._semantic_quality(
        body=body,
        output_columns=outputs,
        column_semantics=semantics,
    )

    assert quality == "incomplete"
    assert "row grain is missing" in issues
    assert "business keys are missing" in issues
    assert "1 output column(s) lack agent-declared business meaning" in issues


def test_declared_grain_keys_and_meanings_complete_derived_contract() -> None:
    body = DerivedSourceDefinition(
        derived_source_name="households",
        sql_text="SELECT c.ID AS HOUSEHOLD_ID FROM DB.CRM.CONTACTS c",
        source_tables=[TableRef(database="DB", schema="CRM", table="CONTACTS")],
        purpose="Prepare household migration data",
        business_description="One reusable household-level migration source.",
        grain="One row per household",
        keys=["HOUSEHOLD_ID"],
        column_semantics=[
            {"name": "HOUSEHOLD_ID", "business_meaning": "Stable household identifier"}
        ],
    )
    outputs = [{"name": "HOUSEHOLD_ID", "data_type": "NUMBER"}]
    semantics = DerivedSourceService._derive_column_semantics(
        sql_text=body.sql_text,
        output_columns=outputs,
        supplied=body.column_semantics,
    )

    quality, issues = DerivedSourceService._semantic_quality(
        body=body,
        output_columns=outputs,
        column_semantics=semantics,
    )

    assert quality == "complete"
    assert issues == []


def test_reconciliation_does_not_promote_persisted_fallback_label() -> None:
    semantics = DerivedSourceService._derive_column_semantics(
        sql_text="SELECT c.ID AS HOUSEHOLD_ID FROM DB.CRM.CONTACTS c",
        output_columns=[{"name": "HOUSEHOLD_ID", "data_type": "NUMBER"}],
        supplied=[
            {
                "name": "HOUSEHOLD_ID",
                "business_meaning": "Household Id",
                "semantic_source": "deterministic_sql_lineage",
                "business_meaning_status": "fallback",
            }
        ],
    )

    assert semantics[0]["semantic_source"] == "deterministic_sql_lineage"
    assert semantics[0]["business_meaning_status"] == "fallback"
