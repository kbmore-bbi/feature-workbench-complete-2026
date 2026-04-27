from app.core.exceptions import SnowflakeQueryError
from app.core.snowflake import SnowflakeClient
from app.schema.common import TableRef
from app.schema.table_selection import (
    ColumnItem,
    DatabaseItem,
    SchemaItem,
    TableAttributes,
    TableItem,
)


class TableSelectionService:
    def __init__(self, client: SnowflakeClient) -> None:
        self._session = client.session

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    @staticmethod
    def _row_value(row, *names: str):
        values = row.as_dict() if hasattr(row, "as_dict") else dict(row)
        for name in names:
            for candidate in (name, name.upper(), name.lower()):
                if candidate in values:
                    return values[candidate]
        return None

    def list_databases_with_schemas(self) -> list[DatabaseItem]:
        try:
            db_rows = self._session.sql("SHOW DATABASES").collect()
        except Exception as e:
            raise SnowflakeQueryError(f"Failed to list databases: {e}") from e

        result = []
        for row in db_rows:
            db_name = self._row_value(row, "name", "database_name")
            if not db_name:
                continue
            try:
                schema_rows = self._session.sql(
                    f"SHOW SCHEMAS IN DATABASE {self._quote_identifier(str(db_name))}"
                ).collect()
                schemas = sorted(
                    [
                        SchemaItem(
                            schema_name=str(self._row_value(r, "name", "schema_name")),
                            created=self._row_value(r, "created_on", "created"),
                        )
                        for r in schema_rows
                        if self._row_value(r, "name", "schema_name")
                    ],
                    key=lambda item: item.schema_name,
                )
            except Exception:
                schemas = []

            result.append(
                DatabaseItem(
                    database_name=str(db_name),
                    created=self._row_value(row, "created_on", "created"),
                    schemas=schemas,
                )
            )
        return sorted(result, key=lambda item: item.database_name)

    def list_tables(self, db_name: str, schema_name: str) -> list[TableItem]:
        try:
            rows = self._session.sql(
                "SHOW TABLES IN SCHEMA "
                f"{self._quote_identifier(db_name)}.{self._quote_identifier(schema_name)}"
            ).collect()
            names = sorted(
                str(name)
                for row in rows
                if (name := self._row_value(row, "name", "table_name"))
            )
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to list tables in {db_name!r}.{schema_name!r}: {e}"
            ) from e
        return [TableItem(table_name=name) for name in names]

    def list_attributes_for_tables(self, qualified_names: list[str]) -> list[TableAttributes]:
        from app.core.exceptions import AppValidationError

        result = []
        for qn in qualified_names:
            parts = qn.split(".", 2)
            if len(parts) != 3:
                raise AppValidationError(
                    f"Invalid table reference {qn!r}. Expected format: DATABASE.SCHEMA.TABLE"
                )
            db, schema, table = parts
            columns = self._list_columns(db, schema, table)
            result.append(
                TableAttributes(
                    table=TableRef(database=db, schema=schema, table=table),
                    columns=columns,
                )
            )
        return result

    def _list_columns(self, db_name: str, schema_name: str, table_name: str) -> list[ColumnItem]:
        try:
            rows = (
                self._session.table(f"{db_name}.INFORMATION_SCHEMA.COLUMNS")
                .select(
                    "COLUMN_NAME",
                    "DATA_TYPE",
                    "IS_NULLABLE",
                    "ORDINAL_POSITION",
                    "COMMENT",
                )
                .filter(
                    (col("TABLE_SCHEMA") == schema_name.upper())
                    & (col("TABLE_NAME") == table_name.upper())
                )
                .sort("ORDINAL_POSITION")
                .collect()
            )
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to list columns in {db_name!r}.{schema_name!r}.{table_name!r}: {e}"
            ) from e
        return [
            ColumnItem(
                column_name=r["COLUMN_NAME"],
                data_type=r["DATA_TYPE"],
                is_nullable=r["IS_NULLABLE"],
                ordinal_position=r["ORDINAL_POSITION"],
                comment=r["COMMENT"],
            )
            for r in rows
        ]
