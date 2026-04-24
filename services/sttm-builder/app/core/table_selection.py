from snowflake.snowpark.functions import col

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

    def list_databases_with_schemas(self) -> list[DatabaseItem]:
        try:
            db_rows = (
                self._session.table("SNOWFLAKE.INFORMATION_SCHEMA.DATABASES")
                .select("DATABASE_NAME", "CREATED")
                .sort("DATABASE_NAME")
                .collect()
            )
        except Exception as e:
            raise SnowflakeQueryError(f"Failed to list databases: {e}") from e

        result = []
        for row in db_rows:
            db_name = row["DATABASE_NAME"]
            try:
                schema_rows = (
                    self._session.table(f"{db_name}.INFORMATION_SCHEMA.SCHEMATA")
                    .select("SCHEMA_NAME", "CREATED")
                    .sort("SCHEMA_NAME")
                    .collect()
                )
                schemas = [
                    SchemaItem(schema_name=r["SCHEMA_NAME"], created=r["CREATED"])
                    for r in schema_rows
                ]
            except Exception:
                schemas = []

            result.append(
                DatabaseItem(
                    database_name=db_name,
                    created=row["CREATED"],
                    schemas=schemas,
                )
            )
        return result

    def list_tables(self, db_name: str, schema_name: str) -> list[TableItem]:
        try:
            rows = (
                self._session.table(f"{db_name}.INFORMATION_SCHEMA.TABLES")
                .select("TABLE_NAME")
                .filter(col("TABLE_SCHEMA") == schema_name.upper())
                .sort("TABLE_NAME")
                .collect()
            )
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to list tables in {db_name!r}.{schema_name!r}: {e}"
            ) from e
        return [TableItem(table_name=r["TABLE_NAME"]) for r in rows]

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
