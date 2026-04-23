from snowflake.snowpark.functions import col

from app.core.exceptions import SnowflakeQueryError
from app.core.snowflake import SnowflakeClient
from app.schema.table_selection import ColumnItem, DatabaseItem, SchemaItem, TableItem


class TableSelectionService:
    def __init__(self, client: SnowflakeClient) -> None:
        self._session = client.session

    def list_databases(self) -> list[DatabaseItem]:
        try:
            rows = (
                self._session.table("SNOWFLAKE.INFORMATION_SCHEMA.DATABASES")
                .select("DATABASE_NAME", "CREATED")
                .sort("DATABASE_NAME")
                .collect()
            )
        except Exception as e:
            raise SnowflakeQueryError(f"Failed to list databases: {e}") from e
        return [
            DatabaseItem(database_name=r["DATABASE_NAME"], created=r["CREATED"])
            for r in rows
        ]

    def list_schemas(self, db_name: str) -> list[SchemaItem]:
        try:
            rows = (
                self._session.table(f"{db_name}.INFORMATION_SCHEMA.SCHEMATA")
                .select("SCHEMA_NAME", "CREATED")
                .sort("SCHEMA_NAME")
                .collect()
            )
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to list schemas in {db_name!r}: {e}"
            ) from e
        return [
            SchemaItem(schema_name=r["SCHEMA_NAME"], created=r["CREATED"])
            for r in rows
        ]

    def list_tables(self, db_name: str, schema_name: str) -> list[TableItem]:
        try:
            rows = (
                self._session.table(f"{db_name}.INFORMATION_SCHEMA.TABLES")
                .select("TABLE_NAME", "TABLE_TYPE", "ROW_COUNT")
                .filter(col("TABLE_SCHEMA") == schema_name.upper())
                .sort("TABLE_NAME")
                .collect()
            )
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to list tables in {db_name!r}.{schema_name!r}: {e}"
            ) from e
        return [
            TableItem(
                table_name=r["TABLE_NAME"],
                table_type=r["TABLE_TYPE"],
                row_count=r["ROW_COUNT"],
            )
            for r in rows
        ]

    def list_columns(
        self, db_name: str, schema_name: str, table_name: str
    ) -> list[ColumnItem]:
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
