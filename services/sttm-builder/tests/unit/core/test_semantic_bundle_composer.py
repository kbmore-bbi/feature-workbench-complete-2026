import json
import yaml
from types import SimpleNamespace

from app.core.semantic_context import SemanticContextService
from app.schema.common import TableRef
from app.schema.derived_source import DerivedSourcePreviewColumn
from app.schema.semantic_context import SemanticLevel


class _SemanticModels:
    def __init__(self, records):  # type: ignore[no-untyped-def]
        self.records = records

    def get_table_records(self, session, tables):  # type: ignore[no-untyped-def]
        return self.records


class _CapturedQuery:
    def __init__(self) -> None:
        self.collected = False

    def collect(self):  # type: ignore[no-untyped-def]
        self.collected = True
        return []


class _CapturedSession:
    def __init__(self) -> None:
        self.query = ""
        self.params = None
        self.result = _CapturedQuery()

    def sql(self, query, params=None):  # type: ignore[no-untyped-def]
        self.query = query
        self.params = params
        return self.result


def test_bundle_artifact_persistence_binds_unicode_json_and_bundle_id() -> None:
    session = _CapturedSession()
    service = SemanticContextService.__new__(SemanticContextService)
    service._session = session
    service._bundle_table = "DB.META.TBL_SEMANTIC_BUNDLES"
    artifact = {
        "description": "Client range –3209 with curly quote “Focus”",
        "path": r"folder\mapping.sql",
    }

    service._persist_bundle_artifact(
        bundle_id="sem_'quoted",
        bundle_artifact=artifact,
    )

    assert "BUNDLE_ARTIFACT = PARSE_JSON(?)" in session.query
    assert "SEMANTIC_BUNDLE_ID = ?" in session.query
    assert "3209" not in session.query
    assert session.params is not None
    assert json.loads(session.params[0]) == artifact
    assert session.params[1] == "sem_'quoted"
    assert session.result.collected is True


def _record(table: TableRef, *, primary_key: str, relationship=None):  # type: ignore[no-untyped-def]
    logical_name = f"{table.schema}_{table.table}".lower()
    saved = {
        "name": f"SV_{table.table}",
        "description": table.table,
        "tables": [
            {
                "name": logical_name,
                "base_table": {
                    "database": table.database,
                    "schema": table.schema,
                    "table": table.table,
                },
                "primary_key": {"columns": [primary_key]},
                "dimensions": [
                    {
                        "name": primary_key,
                        "expr": primary_key,
                        "data_type": "NUMBER",
                        "unique": True,
                    }
                ],
                "facts": [
                    {
                        "name": "AMOUNT",
                        "expr": "AMOUNT",
                        "data_type": "NUMBER",
                    }
                ],
                "metrics": [{"name": "sum_amount", "expr": "SUM(AMOUNT)"}],
            }
        ],
        "verified_queries": [
            {"name": f"sample_{table.table.lower()}", "question": "sample", "sql": "SELECT 1"}
        ],
    }
    return {
        "database": table.database,
        "schema_name": table.schema,
        "table_name": table.table,
        "semantic_model": {
            "attributes": [
                {
                    "name": primary_key,
                    "data_type": "NUMBER",
                    "semantic_role": "primary_key",
                    "constraints": ["PRIMARY_KEY"],
                },
                {
                    "name": "AMOUNT",
                    "data_type": "NUMBER",
                    "semantic_role": "metric",
                    "default_aggregation": "sum",
                    "synonyms": ["revenue", "value"],
                    "sample_values": [10, 25],
                    "business_meaning": "Booked transaction amount",
                },
            ],
            "relationships": relationship or {"outgoing": [], "incoming": []},
            "semantic_view": {
                "yaml": yaml.safe_dump(saved),
                "yaml_hash": table.table,
                "source": "SEM_NATIVE_VIEWS",
            },
        },
        "updated_at": "2026-06-23",
    }


def test_composer_preserves_saved_tables_metrics_and_relationships() -> None:
    calculation = TableRef(database="DB", schema="SRC", table="CALCULATION")
    note = TableRef(database="DB", schema="SRC", table="NOTE")
    service = SemanticContextService.__new__(SemanticContextService)
    service._session = object()
    service._semantic_model_service = _SemanticModels(
        [
            _record(calculation, primary_key="INCOME_ID"),
            _record(note, primary_key="NOTE_ID"),
        ]
    )

    output = service._build_semantic_view_yaml(
        bundle_id="sem_test",
        semantic_view_name="INLINE_TEST",
        selected_source_tables=[calculation, note],
        derived_records=[],
        relationships=[
            {
                "left_table": note.model_dump(mode="json"),
                "right_table": calculation.model_dump(mode="json"),
                "conditions": [{"left_column": "INCOME_ID", "right_column": "INCOME_ID"}],
            }
        ],
        target_table=None,
        semantic_level=SemanticLevel.L2_ANALYST_READY,
    )

    composed = yaml.safe_load(output)
    assert len(composed["tables"]) == 2
    assert composed["tables"][0]["metrics"][0]["name"] == "sum_amount"
    amount_fact = next(item for item in composed["tables"][0]["facts"] if item["name"] == "AMOUNT")
    assert "sample_values" not in amount_fact
    assert "synonyms" not in amount_fact
    assert "description" not in amount_fact
    sum_metric = next(item for item in composed["tables"][0]["metrics"] if item["name"] == "sum_amount")
    assert sum_metric["expr"] == "SUM(AMOUNT)"
    assert composed["relationships"][0]["right_table"].endswith("calculation")
    assert len(composed["verified_queries"]) == 2


def test_composer_keeps_exact_raw_yaml_and_unknown_sections() -> None:
    table = TableRef(database="DB", schema="SRC", table="CALCULATION")
    record = _record(table, primary_key="INCOME_ID")
    original = yaml.safe_load(record["semantic_model"]["semantic_view"]["yaml"])
    original["aggregates"] = [{"name": "monthly_amount", "expr": "SUM(AMOUNT)"}]
    original["future_cortex_option"] = {"enabled": True, "mode": "strict"}
    raw_yaml = yaml.safe_dump(original, sort_keys=False)
    record["semantic_model"]["semantic_view"]["yaml"] = raw_yaml
    service = SemanticContextService.__new__(SemanticContextService)
    service._session = object()
    service._semantic_model_service = _SemanticModels([record])
    raw_assets: list[dict] = []

    output = service._build_semantic_view_yaml(
        bundle_id="sem_lossless",
        semantic_view_name="INLINE_LOSSLESS",
        selected_source_tables=[table],
        derived_records=[],
        relationships=[],
        target_table=None,
        semantic_level=SemanticLevel.L0_RELATIONSHIP,
        raw_assets=raw_assets,
    )

    assert raw_assets[0]["yaml"] == raw_yaml
    composed = yaml.safe_load(output)
    assert composed["aggregates"] == original["aggregates"]
    assert composed["future_cortex_option"] == original["future_cortex_option"]


def test_analyst_unsafe_relationship_is_excluded_without_losing_structured_evidence() -> None:
    calculation = TableRef(database="DB", schema="SRC", table="CALCULATION")
    note = TableRef(database="DB", schema="SRC", table="NOTE")
    service = SemanticContextService.__new__(SemanticContextService)
    service._session = object()
    service._semantic_model_service = _SemanticModels(
        [
            _record(calculation, primary_key="INCOME_ID"),
            _record(note, primary_key="NOTE_ID"),
        ]
    )
    relationship = {
        "left_table": note.model_dump(mode="json"),
        "right_table": calculation.model_dump(mode="json"),
        "conditions": [{"left_column": "AMOUNT", "right_column": "AMOUNT"}],
        "trust_state": "uniqueness_unproven",
        "evidence": {"source": "historical_mapping"},
    }
    excluded: list[dict] = []

    output = service._build_semantic_view_yaml(
        bundle_id="sem_unsafe",
        semantic_view_name="INLINE_UNSAFE",
        selected_source_tables=[calculation, note],
        derived_records=[],
        relationships=[relationship],
        target_table=None,
        semantic_level=SemanticLevel.L2_ANALYST_READY,
        excluded_relationships=excluded,
    )

    composed = yaml.safe_load(output)
    assert "relationships" not in composed
    assert len(excluded) == 1
    assert excluded[0]["relationship"] == relationship
    assert excluded[0]["trust_state"] == "uniqueness_unproven"
    assert excluded[0]["analyst_compatible"] is False



def test_composer_models_materialized_derived_source_as_logical_table() -> None:
    service = SemanticContextService.__new__(SemanticContextService)
    service._session = object()
    service._semantic_model_service = _SemanticModels([])
    derived = SimpleNamespace(
        derived_source_id="derived_income_note",
        derived_source_name="Loan income with review notes",
        physical_view_name="META.REGISTRY.DSV_FIR_DERIVED_INCOME_NOTE",
        sql_text="SELECT VERIFIED_INCOME_ID, CALCULATED_AMOUNT FROM DB.SRC.INCOME",
        purpose="Combine verified income calculations with reviewer notes.",
        business_description="One row per verified income calculation with review context.",
        grain="one row per verified income calculation",
        keys=["VERIFIED_INCOME_ID"],
        source_tables=[TableRef(database="DB", schema="SRC", table="INCOME")],
        parent_derived_source_ids=[],
        upstream_hash="upstream-hash",
        source_dependency_hash="dependency-hash",
        semantic_quality="complete",
        preview_columns=[
            DerivedSourcePreviewColumn(
                name="VERIFIED_INCOME_ID",
                data_type="VARCHAR",
                is_primary_key=True,
            ),
            DerivedSourcePreviewColumn(
                name="CALCULATED_AMOUNT",
                data_type="NUMBER(18,2)",
                is_primary_key=False,
            ),
        ],
        output_columns=[
            {"name": "VERIFIED_INCOME_ID", "description": "Verified income calculation key"},
            {"name": "CALCULATED_AMOUNT", "description": "Normalized calculated income amount"},
        ],
        column_semantics=[
            {
                "name": "CALCULATED_AMOUNT",
                "business_meaning": "Normalized verified income amount",
                "semantic_role": "metric",
                "default_aggregation": "sum",
                "sample_values": [1200.0, 2450.5],
            }
        ],
        semantic_projection={
            "filters": [
                {"name": "verified_only", "expr": "VERIFIED_INCOME_ID IS NOT NULL"}
            ],
            "metrics": [{"name": "derived_row_count", "expr": "COUNT(*)"}],
            "verified_queries": [
                {
                    "name": "income_with_notes",
                    "question": "Show verified income calculations with notes",
                    "sql": "SELECT * FROM META.REGISTRY.DSV_FIR_DERIVED_INCOME_NOTE",
                }
            ],
        },
    )

    derived_semantics: list[dict] = []
    output = service._build_semantic_view_yaml(
        bundle_id="sem_derived",
        semantic_view_name="META.REGISTRY.SV_DERIVED",
        selected_source_tables=[],
        derived_records=[derived],
        relationships=[],
        target_table=None,
        semantic_level=SemanticLevel.L2_ANALYST_READY,
        derived_semantics=derived_semantics,
    )

    composed = yaml.safe_load(output)
    assert len(composed["tables"]) == 1
    table = composed["tables"][0]
    assert table["base_table"] == {
        "database": "META",
        "schema": "REGISTRY",
        "table": "DSV_FIR_DERIVED_INCOME_NOTE",
    }
    assert table["primary_key"] == {"columns": ["VERIFIED_INCOME_ID"]}
    assert table["filters"][0]["name"] == "verified_only"
    amount = next(item for item in table["facts"] if item["name"] == "CALCULATED_AMOUNT")
    assert amount["sample_values"] == ["1200.0", "2450.5"]
    assert any(item["name"] == "sum_calculated_amount" for item in table["metrics"])
    assert composed["metrics"][0]["name"] == "derived_row_count"
    assert composed["verified_queries"][0]["name"] == "income_with_notes"
    assert derived_semantics[0]["saved_sql"].startswith("SELECT VERIFIED_INCOME_ID")
    assert derived_semantics[0]["row_grain"] == "one row per verified income calculation"
    assert derived_semantics[0]["column_semantics"][0]["name"] == "CALCULATED_AMOUNT"
