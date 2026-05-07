import json

from snowflake.snowpark.functions import col

from app.core.config import Settings
from app.core.exceptions import SnowflakeQueryError
from app.core.snowflake import SnowflakeClient
from app.schema.common import TableRef
from app.schema.table_selection import (
    ColumnItem,
    DatabaseItem,
    RelationshipColumnMapping,
    RelationshipItem,
    SchemaItem,
    TableAttributes,
    TableItem,
)


class TableSelectionService:
    def __init__(self, client: SnowflakeClient, settings: Settings) -> None:
        self._session = client.session
        self._settings = settings

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    @staticmethod
    def _quote_literal(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    @staticmethod
    def _row_value(row, *names: str):
        values = row.as_dict() if hasattr(row, "as_dict") else dict(row)
        for name in names:
            for candidate in (name, name.upper(), name.lower()):
                if candidate in values:
                    return values[candidate]
        return None

    def list_databases(self) -> list[DatabaseItem]:
        try:
            db_rows = self._session.sql("SHOW TERSE DATABASES").collect()
        except Exception as e:
            raise SnowflakeQueryError(f"Failed to list databases: {e}") from e

        result = []
        for row in db_rows:
            db_name = self._row_value(row, "name", "database_name")
            if not db_name:
                continue
            result.append(
                DatabaseItem(
                    database_name=str(db_name),
                    created=self._row_value(row, "created_on", "created"),
                    schemas=[],
                )
            )
        return sorted(result, key=lambda item: item.database_name)

    def list_schemas(self, db_name: str) -> list[SchemaItem]:
        try:
            rows = self._session.sql(
                "SHOW TERSE SCHEMAS IN DATABASE "
                f"{self._quote_identifier(db_name)}"
            ).collect()
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to list schemas in {db_name!r}: {e}"
            ) from e

        schemas = []
        for row in rows:
            schema_name = self._row_value(row, "name", "schema_name")
            if not schema_name:
                continue
            schemas.append(
                SchemaItem(
                    schema_name=str(schema_name),
                    created=self._row_value(row, "created_on", "created"),
                )
            )
        return sorted(schemas, key=lambda item: item.schema_name)

    def list_tables(self, db_name: str, schema_name: str) -> list[TableItem]:
        try:
            table_rows = self._session.sql(
                "SHOW TABLES IN SCHEMA "
                f"{self._quote_identifier(db_name)}.{self._quote_identifier(schema_name)}"
            ).collect()
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to list tables in {db_name!r}.{schema_name!r}: {e}"
            ) from e

        try:
            column_rows = (
                self._session.table(f"{db_name}.INFORMATION_SCHEMA.COLUMNS")
                .select("TABLE_NAME")
                .filter(col("TABLE_SCHEMA") == schema_name.upper())
                .collect()
            )
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to list columns for tables in {db_name!r}.{schema_name!r}: {e}"
            ) from e

        column_count_by_table: dict[str, int] = {}
        for row in column_rows:
            table_name = self._row_value(row, "TABLE_NAME", "table_name")
            if not table_name:
                continue
            key = str(table_name)
            column_count_by_table[key] = column_count_by_table.get(key, 0) + 1

        result: list[TableItem] = []
        for row in table_rows:
            table_name = self._row_value(row, "name", "table_name")
            if not table_name:
                continue
            name = str(table_name)
            row_count = self._row_value(row, "rows", "row_count")
            result.append(
                TableItem(
                    table_name=name,
                    row_count=int(row_count) if row_count is not None else None,
                    column_count=column_count_by_table.get(name, 0),
                )
            )

        return sorted(result, key=lambda item: item.table_name)

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

    def list_relationships_for_tables(self, tables: list[TableRef]) -> list[RelationshipItem]:
        selected = {table.qualified_name.upper(): table for table in tables}
        relationships: dict[str, RelationshipItem] = {}

        for table in tables:
            payload = self._get_relationship_payload(table)
            if str(payload.get("status", "")).upper() != "OK":
                continue

            for item in payload.get("outgoing", []) or []:
                target = TableRef(
                    database=table.database,
                    schema=str(item.get("schema", "")),
                    table=str(item.get("table", "")),
                )
                if target.qualified_name.upper() not in selected:
                    continue

                conditions = [
                    RelationshipColumnMapping(
                        left_column=str(mapping.get("fk_column", "")),
                        right_column=str(mapping.get("pk_column", "")),
                    )
                    for mapping in item.get("column_mappings", []) or []
                    if mapping.get("fk_column") and mapping.get("pk_column")
                ]
                if not conditions:
                    continue

                constraint_name = (
                    str(item.get("constraint_name"))
                    if item.get("constraint_name") is not None
                    else None
                )
                edge_id = constraint_name or f"{table.qualified_name}->{target.qualified_name}"
                relationships[edge_id] = RelationshipItem(
                    id=edge_id,
                    left_table=table,
                    right_table=target,
                    constraint_name=constraint_name,
                    conditions=conditions,
                )

        return list(relationships.values())

    def _list_columns(self, db_name: str, schema_name: str, table_name: str) -> list[ColumnItem]:
        primary_key_columns = self._primary_key_columns(db_name, schema_name, table_name)
        foreign_key_columns = self._foreign_key_columns(db_name, schema_name, table_name)
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
                is_primary_key=r["COLUMN_NAME"] in primary_key_columns,
                is_foreign_key=r["COLUMN_NAME"] in foreign_key_columns,
            )
            for r in rows
        ]

    def _primary_key_columns(
        self,
        db_name: str,
        schema_name: str,
        table_name: str,
    ) -> set[str]:
        try:
            rows = self._session.sql(
                "SHOW PRIMARY KEYS IN TABLE "
                f"{self._quote_identifier(db_name)}."
                f"{self._quote_identifier(schema_name)}."
                f"{self._quote_identifier(table_name)}"
            ).collect()
        except Exception:
            return set()

        return {
            str(column_name)
            for row in rows
            if (column_name := self._row_value(row, "column_name", "COLUMN_NAME"))
        }

    def _foreign_key_columns(
        self,
        db_name: str,
        schema_name: str,
        table_name: str,
    ) -> set[str]:
        try:
            rows = self._session.sql(
                "SHOW IMPORTED KEYS IN TABLE "
                f"{self._quote_identifier(db_name)}."
                f"{self._quote_identifier(schema_name)}."
                f"{self._quote_identifier(table_name)}"
            ).collect()
        except Exception:
            return set()

        return {
            str(column_name)
            for row in rows
            if (
                column_name := self._row_value(
                    row,
                    "fk_column_name",
                    "FK_COLUMN_NAME",
                    "column_name",
                    "COLUMN_NAME",
                )
            )
        }

    def _get_relationship_payload(self, table: TableRef) -> dict:
        proc_name = (
            f"{self._quote_identifier(self._settings.snowflake_database)}."
            f"{self._quote_identifier(self._settings.snowflake_schema)}."
            '"SP_GET_TABLE_RELATIONSHIPS"'
        )
        try:
            rows = self._session.sql(
                "CALL "
                f"{proc_name}("
                f"{self._quote_literal(table.database)}, "
                f"{self._quote_literal(table.schema)}, "
                f"{self._quote_literal(table.table)})"
            ).collect()
        except Exception as e:
            raise SnowflakeQueryError(
                f"Failed to fetch table relationships for {table.qualified_name!r}: {e}"
            ) from e

        if not rows:
            return {}

        raw_result = list(rows[0].as_dict().values())[0]
        if isinstance(raw_result, dict):
            return raw_result
        if isinstance(raw_result, str):
            try:
                return json.loads(raw_result)
            except json.JSONDecodeError:
                return {}
        return raw_result or {}
