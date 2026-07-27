import json

from app.core.excel_parser import ParsedExcelMapping
from app.core.sql_parser import parse_sql_document
from app.core.fir_document_ingestion import store_excel_asset, store_sql_asset


class _Collectable:
    def collect(self):
        return []


class _RecordingSession:
    def __init__(self) -> None:
        self.calls: list[tuple[str, list[object]]] = []

    def sql(self, statement: str, params: list[object]):
        self.calls.append((statement, params))
        return _Collectable()


def test_sql_mapping_is_stored_as_authoritative_historical_evidence() -> None:
    session = _RecordingSession()
    parsed = parse_sql_document("SELECT CUSTOMER_ID FROM RAW.CUSTOMERS")

    store_sql_asset(
        session,
        "asset_sql",
        "customers.sql",
        "SELECT CUSTOMER_ID FROM RAW.CUSTOMERS",
        "project_1",
        parsed,
    )

    statement, params = session.calls[0]
    attributes = json.loads(str(params[5]))
    assert "'historical_mapping'" in statement
    assert attributes["fir_evidence"]["authoritative_mapping"] is True
    assert attributes["fir_evidence"]["base_confidence"] == 0.96
    assert attributes["source_tables"] == ["RAW.CUSTOMERS"]


def test_excel_mapping_is_stored_as_highest_confidence_mapping_contract() -> None:
    session = _RecordingSession()

    store_excel_asset(
        session,
        "asset_excel",
        "customers.xlsx",
        ParsedExcelMapping(),
        "project_1",
    )

    _, params = session.calls[0]
    attributes = json.loads(str(params[5]))
    assert attributes["fir_evidence"]["authoritative_mapping"] is True
    assert attributes["fir_evidence"]["base_confidence"] == 0.99
    assert (
        attributes["fir_evidence"]["provenance"]
        == "client_provided_mapping_workbook"
    )
