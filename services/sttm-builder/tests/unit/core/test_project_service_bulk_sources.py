import json
from types import SimpleNamespace

from app.core.project_service import ProjectService


class _Query:
    def collect(self):
        return []


class _Session:
    def __init__(self):
        self.calls = []

    def sql(self, query, params=None):
        self.calls.append((query, params))
        return _Query()


def test_source_replacement_uses_one_delete_and_one_bound_bulk_insert() -> None:
    session = _Session()
    settings = SimpleNamespace(
        sttm_source_bulk_write_v1=True,
        snowflake_sttm_sources_table="DB.META.TBL_STTM_SOURCES",
        qualify_metadata_object_name=lambda value: value,
    )
    service = ProjectService.__new__(ProjectService)
    service._session = session
    service._settings = settings
    columns = {
        "STTM_ID",
        "SOURCE_NAME",
        "DATABASE_NAME",
        "SCHEMA_NAME",
        "TABLE_NAME",
        "DESCRIPTION",
        "IS_DRAFT",
        "LAST_MODIFIED_BY",
        "CREATED_DATETIME",
        "LAST_MODIFIED_DATETIME",
    }
    service._table_columns = lambda _table: columns
    service._column_type = lambda _table, _column: "VARCHAR"

    count = service._replace_sources(
        "42",
        {
            "source_tables": [
                {
                    "database": "DB",
                    "schema": "SRC",
                    "table": "CONTACTS",
                    "alias": "contacts",
                }
            ],
            "derived_sources": [{"id": "ds-1", "name": "Households"}],
        },
        user_id="USER_A",
    )

    assert count == 2
    assert len(session.calls) == 2
    delete_sql, delete_params = session.calls[0]
    insert_sql, insert_params = session.calls[1]
    assert "DELETE FROM" in delete_sql
    assert delete_params == ["42"]
    assert "FLATTEN(INPUT => PARSE_JSON(?))" in insert_sql
    assert len(insert_params) == 1
    persisted = json.loads(insert_params[0])
    assert [item["source_name"] for item in persisted] == ["contacts", "Households"]
    assert persisted[1]["description"] == "DERIVED_SOURCE:ds-1"
    assert "CONTACTS" not in insert_sql
    assert "Households" not in insert_sql
