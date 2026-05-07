import json
import uuid
from typing import Any

from snowflake.snowpark import Session
from snowflake.snowpark.types import StructField

from app.core.config import Settings
from app.core.exceptions import AppValidationError, SnowflakeQueryError
from app.core.table_selection import TableSelectionService
from app.schema.common import TableRef
from app.schema.derived_source import (
    DerivedSourceDefinition,
    DerivedSourcePreviewColumn,
    DerivedSourcePreviewRow,
    DerivedSourceRecord,
    DerivedSourceValidateResponse,
)


class DerivedSourceService:
    def __init__(self, session: Session, settings: Settings) -> None:
        self._session = session
        self._settings = settings
        self._table_selection = TableSelectionService(type("Client", (), {"session": session})(), settings)

    @staticmethod
    def _quote_identifier(identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    @staticmethod
    def _quote_literal(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    @staticmethod
    def _json_literal(value: Any) -> str:
        return "'" + json.dumps(value, default=str).replace("'", "''") + "'"

    @staticmethod
    def _build_preview_column_names(fields: list[StructField]) -> list[str]:
        seen: dict[str, int] = {}
        normalized: list[str] = []

        for index, field in enumerate(fields, start=1):
            base_name = str(field.name or f"COLUMN_{index}")
            count = seen.get(base_name, 0) + 1
            seen[base_name] = count
            normalized.append(base_name if count == 1 else f"{base_name}_{count}")

        return normalized

    @property
    def _table_name(self) -> str:
        parts = self._settings.snowflake_derived_sources_table.split(".")
        if len(parts) != 3:
            raise AppValidationError(
                "SNOWFLAKE_DERIVED_SOURCES_TABLE must be a fully-qualified DATABASE.SCHEMA.TABLE name."
            )
        database, schema, table = parts
        return (
            f"{self._quote_identifier(database)}."
            f"{self._quote_identifier(schema)}."
            f"{self._quote_identifier(table)}"
        )

    def ensure_table_exists(self) -> None:
        ddl = f"""
        CREATE TABLE IF NOT EXISTS {self._table_name} (
            DERIVED_SOURCE_ID STRING,
            DERIVED_SOURCE_NAME STRING,
            SQL_TEXT STRING,
            DRIVING_TABLE STRING,
            SOURCE_TABLES VARIANT,
            RELATIONSHIPS VARIANT,
            FILTERS VARIANT,
            SELECTED_COLUMNS_BY_TABLE VARIANT,
            PREVIEW_COLUMNS VARIANT,
            CREATED_BY STRING,
            CREATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
            UPDATED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
            IS_ACTIVE BOOLEAN DEFAULT TRUE
        )
        """
        try:
            self._session.sql(ddl).collect()
        except Exception as exc:
            raise SnowflakeQueryError(
                f"Failed to ensure derived sources table exists: {exc}"
            ) from exc

    @staticmethod
    def _storage_unavailable(exc: Exception) -> bool:
        message = str(exc).lower()
        return (
            "insufficient privileges" in message
            or "does not exist" in message
            or "object does not exist" in message
            or "not authorized" in message
        )

    def validate_sql(self, body: DerivedSourceDefinition) -> DerivedSourceValidateResponse:
        normalized_sql = body.sql_text.strip().rstrip(";")
        if not normalized_sql:
            raise AppValidationError("Derived SQL cannot be empty.")

        preview_query = f"SELECT * FROM ({normalized_sql}) AS DERIVED_SOURCE_PREVIEW LIMIT 5"
        try:
            dataframe = self._session.sql(preview_query)
            rows = dataframe.collect()
            fields = list(dataframe.schema.fields)
        except Exception as exc:
            raise SnowflakeQueryError(f"Failed to validate derived SQL: {exc}") from exc

        preview_column_names = self._build_preview_column_names(fields)
        primary_key_names = self._resolve_primary_key_names(body)
        preview_columns = [
            DerivedSourcePreviewColumn(
                name=preview_name,
                data_type=str(field.datatype),
                is_primary_key=field.name.upper() in primary_key_names,
            )
            for field, preview_name in zip(fields, preview_column_names)
        ]
        preview_rows = [
            DerivedSourcePreviewRow(
                values=json.loads(
                    json.dumps(
                        {
                            column_name: value
                            for column_name, value in zip(preview_column_names, tuple(row))
                        },
                        default=str,
                    )
                )
            )
            for row in rows
        ]

        return DerivedSourceValidateResponse(
            message="SQL validated successfully.",
            preview_columns=preview_columns,
            preview_rows=preview_rows,
        )

    def list_sources(self) -> list[DerivedSourceRecord]:
        try:
            rows = self._session.sql(
                f"SELECT * FROM {self._table_name} WHERE IS_ACTIVE = TRUE ORDER BY UPDATED_AT DESC"
            ).collect()
        except Exception as exc:
            if self._storage_unavailable(exc):
                return []
            raise SnowflakeQueryError(f"Failed to list derived sources: {exc}") from exc

        return [self._row_to_record(row.as_dict()) for row in rows]

    def save_source(self, body: DerivedSourceDefinition) -> DerivedSourceRecord:
        validation = self.validate_sql(body)

        source_id = body.derived_source_id or f"derived_{uuid.uuid4().hex[:12]}"
        current_user = self._current_user()

        merge_sql = f"""
        MERGE INTO {self._table_name} AS target
        USING (
            SELECT
                {self._quote_literal(source_id)} AS DERIVED_SOURCE_ID,
                {self._quote_literal(body.derived_source_name)} AS DERIVED_SOURCE_NAME,
                {self._quote_literal(body.sql_text)} AS SQL_TEXT,
                {self._quote_literal(body.driving_table.qualified_name if body.driving_table else "")} AS DRIVING_TABLE,
                PARSE_JSON({self._json_literal([table.model_dump() for table in body.source_tables])}) AS SOURCE_TABLES,
                PARSE_JSON({self._json_literal([item.model_dump() for item in body.relationships])}) AS RELATIONSHIPS,
                PARSE_JSON({self._json_literal(body.filters)}) AS FILTERS,
                PARSE_JSON({self._json_literal(body.selected_columns_by_table)}) AS SELECTED_COLUMNS_BY_TABLE,
                PARSE_JSON({self._json_literal([column.model_dump() for column in validation.preview_columns])}) AS PREVIEW_COLUMNS,
                {self._quote_literal(current_user)} AS CREATED_BY
        ) AS source
        ON target.DERIVED_SOURCE_ID = source.DERIVED_SOURCE_ID
        WHEN MATCHED THEN UPDATE SET
            DERIVED_SOURCE_NAME = source.DERIVED_SOURCE_NAME,
            SQL_TEXT = source.SQL_TEXT,
            DRIVING_TABLE = source.DRIVING_TABLE,
            SOURCE_TABLES = source.SOURCE_TABLES,
            RELATIONSHIPS = source.RELATIONSHIPS,
            FILTERS = source.FILTERS,
            SELECTED_COLUMNS_BY_TABLE = source.SELECTED_COLUMNS_BY_TABLE,
            PREVIEW_COLUMNS = source.PREVIEW_COLUMNS,
            UPDATED_AT = CURRENT_TIMESTAMP(),
            IS_ACTIVE = TRUE
        WHEN NOT MATCHED THEN INSERT (
            DERIVED_SOURCE_ID,
            DERIVED_SOURCE_NAME,
            SQL_TEXT,
            DRIVING_TABLE,
            SOURCE_TABLES,
            RELATIONSHIPS,
            FILTERS,
            SELECTED_COLUMNS_BY_TABLE,
            PREVIEW_COLUMNS,
            CREATED_BY,
            CREATED_AT,
            UPDATED_AT,
            IS_ACTIVE
        ) VALUES (
            source.DERIVED_SOURCE_ID,
            source.DERIVED_SOURCE_NAME,
            source.SQL_TEXT,
            source.DRIVING_TABLE,
            source.SOURCE_TABLES,
            source.RELATIONSHIPS,
            source.FILTERS,
            source.SELECTED_COLUMNS_BY_TABLE,
            source.PREVIEW_COLUMNS,
            source.CREATED_BY,
            CURRENT_TIMESTAMP(),
            CURRENT_TIMESTAMP(),
            TRUE
        )
        """
        try:
            self._session.sql(merge_sql).collect()
        except Exception as exc:
            if self._storage_unavailable(exc):
                raise SnowflakeQueryError(
                    "Derived source persistence is not available for the current role. "
                    "Please create/grant access to TBL_DERIVED_SOURCES using the deployment setup script."
                ) from exc
            raise SnowflakeQueryError(f"Failed to save derived source: {exc}") from exc

        return DerivedSourceRecord(
            derived_source_id=source_id,
            derived_source_name=body.derived_source_name,
            sql_text=body.sql_text,
            source_tables=body.source_tables,
            driving_table=body.driving_table,
            relationships=body.relationships,
            filters=body.filters,
            selected_columns_by_table=body.selected_columns_by_table,
            preview_columns=validation.preview_columns,
            created_by=current_user,
            is_active=True,
        )

    def _current_user(self) -> str:
        try:
            row = self._session.sql("SELECT CURRENT_USER() AS CURRENT_USER").collect()[0]
            return str(row.as_dict().get("CURRENT_USER") or row.as_dict().get("current_user") or "")
        except Exception:
            return ""

    def _resolve_primary_key_names(self, body: DerivedSourceDefinition) -> set[str]:
        pk_names: set[str] = set()
        for table in body.source_tables:
            columns = self._table_selection._list_columns(table.database, table.schema, table.table)
            selected_names = {
                name.upper()
                for name in body.selected_columns_by_table.get(table.qualified_name, [])
            }
            for column in columns:
                if column.is_primary_key and column.column_name.upper() in selected_names:
                    pk_names.add(column.column_name.upper())
        return pk_names

    def _row_to_record(self, row: dict[str, Any]) -> DerivedSourceRecord:
        def _coerce_json(value: Any, fallback: Any) -> Any:
            if value is None:
                return fallback
            if isinstance(value, str):
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    return fallback
            return value

        def _value(name: str) -> Any:
            for candidate in (name, name.upper(), name.lower()):
                if candidate in row:
                    return row[candidate]
            return None

        source_tables = _coerce_json(_value("SOURCE_TABLES"), [])
        relationships = _coerce_json(_value("RELATIONSHIPS"), [])
        filters = _coerce_json(_value("FILTERS"), [])
        selected_columns = _coerce_json(_value("SELECTED_COLUMNS_BY_TABLE"), {})
        preview_columns = _coerce_json(_value("PREVIEW_COLUMNS"), [])
        driving_table = _value("DRIVING_TABLE") or ""

        driving_ref = None
        if driving_table:
            parts = str(driving_table).split(".", 2)
            if len(parts) == 3:
                driving_ref = TableRef(database=parts[0], schema=parts[1], table=parts[2])

        return DerivedSourceRecord(
            derived_source_id=str(_value("DERIVED_SOURCE_ID")),
            derived_source_name=str(_value("DERIVED_SOURCE_NAME")),
            sql_text=str(_value("SQL_TEXT")),
            source_tables=source_tables,
            driving_table=driving_ref,
            relationships=relationships,
            filters=filters,
            selected_columns_by_table=selected_columns,
            preview_columns=preview_columns,
            created_by=_value("CREATED_BY"),
            created_at=str(_value("CREATED_AT")) if _value("CREATED_AT") else None,
            updated_at=str(_value("UPDATED_AT")) if _value("UPDATED_AT") else None,
            is_active=bool(_value("IS_ACTIVE")),
        )
