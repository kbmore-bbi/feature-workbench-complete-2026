import json
from unittest.mock import MagicMock

from app.core.table_selection import TableSelectionService
from app.schema.common import TableRef


def _service() -> tuple[TableSelectionService, MagicMock]:
    session = MagicMock()
    client = MagicMock(session=session)
    settings = MagicMock()
    settings.resolved_semantic_views_table = "REGISTRY.DB.LATEST_TABLES"
    settings.resolved_relationships_procedure = ""
    return TableSelectionService(client, settings), session


def test_attributes_are_loaded_with_two_set_based_queries_per_database() -> None:
    service, session = _service()
    column_query = MagicMock()
    column_query.collect.return_value = [
        {
            "TABLE_SCHEMA": "SRC",
            "TABLE_NAME": "CUSTOMER",
            "COLUMN_NAME": "ID",
            "DATA_TYPE": "NUMBER",
            "IS_NULLABLE": "NO",
            "ORDINAL_POSITION": 1,
            "COMMENT": None,
        },
        {
            "TABLE_SCHEMA": "SRC",
            "TABLE_NAME": "NOTE",
            "COLUMN_NAME": "CUSTOMER_ID",
            "DATA_TYPE": "NUMBER",
            "IS_NULLABLE": "YES",
            "ORDINAL_POSITION": 1,
            "COMMENT": None,
        },
    ]
    key_query = MagicMock()
    key_query.collect.return_value = [
        {
            "TABLE_SCHEMA": "SRC",
            "TABLE_NAME": "CUSTOMER",
            "COLUMN_NAME": "ID",
            "CONSTRAINT_TYPE": "PRIMARY KEY",
        }
    ]
    session.sql.side_effect = [column_query, key_query]

    result = service._list_attributes_for_tables_uncached(
        ["DB.SRC.CUSTOMER", "DB.SRC.NOTE"]
    )

    assert session.sql.call_count == 2
    assert [item.table.table for item in result] == ["CUSTOMER", "NOTE"]
    assert result[0].columns[0].is_primary_key is True
    assert result[1].columns[0].column_name == "CUSTOMER_ID"


def test_table_browsing_does_not_scan_all_schema_columns() -> None:
    service, session = _service()
    table_query = MagicMock()
    table_query.collect.return_value = [
        {
            "name": "CUSTOMER",
            "rows": 42,
            "comment": "Customer master",
        }
    ]
    session.sql.return_value = table_query

    result = service._list_tables_uncached("DB", "SRC")

    assert session.sql.call_count == 1
    assert "SHOW TABLES" in session.sql.call_args.args[0]
    assert result[0].table_name == "CUSTOMER"
    assert result[0].column_count == 0


def test_relationships_use_one_semantic_query_for_large_selection() -> None:
    service, session = _service()
    semantic_query = MagicMock()
    semantic_query.collect.return_value = [
        {
            "FQN": "DB.SRC.NOTE",
            "RELATIONSHIPS": json.dumps(
                {
                    "outgoing": [
                        {
                            "schema": "SRC",
                            "table": "CUSTOMER",
                            "constraint_name": "FK_NOTE_CUSTOMER",
                            "confidence": "HIGH",
                            "column_mappings": [
                                {"fk_column": "CUSTOMER_ID", "pk_column": "ID"}
                            ],
                        }
                    ],
                    "incoming": [],
                }
            ),
            "ATTRIBUTES": None,
        }
    ]
    session.sql.return_value = semantic_query
    tables = [
        TableRef(database="DB", schema="SRC", table=name)
        for name in ("NOTE", "CUSTOMER", "ADDRESS", "STATUS")
    ]

    result = service._list_relationships_for_tables_uncached(tables)

    assert session.sql.call_count == 1
    assert len(result) == 1
    assert result[0].left_table.table == "NOTE"
    assert result[0].right_table.table == "CUSTOMER"
    assert result[0].conditions[0].left_column == "CUSTOMER_ID"


def test_single_table_column_lookup_used_by_derived_validation() -> None:
    service, session = _service()
    service._primary_key_columns = MagicMock(return_value={"ID"})
    service._foreign_key_columns = MagicMock(return_value=set())
    dataframe = session.table.return_value
    dataframe.select.return_value = dataframe
    dataframe.filter.return_value = dataframe
    dataframe.sort.return_value = dataframe
    dataframe.collect.return_value = [
        {
            "COLUMN_NAME": "ID",
            "DATA_TYPE": "NUMBER",
            "IS_NULLABLE": "NO",
            "ORDINAL_POSITION": 1,
            "COMMENT": "Contact identifier",
        }
    ]

    result = service._list_columns("DB", "SRC", "CONTACTS")

    assert len(result) == 1
    assert result[0].column_name == "ID"
    assert result[0].is_primary_key is True
    dataframe.filter.assert_called_once()
