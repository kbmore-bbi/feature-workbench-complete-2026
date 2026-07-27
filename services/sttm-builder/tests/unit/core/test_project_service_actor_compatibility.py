from app.core.project_service import ProjectService


def _service_with_columns(column_types: dict[str, str]) -> ProjectService:
    service = object.__new__(ProjectService)
    table_name = '"DB"."SCHEMA"."TBL_STTM"'
    service._table_column_cache = {table_name: set(column_types)}
    service._table_column_type_cache = {table_name: column_types}
    return service


def test_string_actor_uses_canonical_column_for_legacy_numeric_schema() -> None:
    table_name = '"DB"."SCHEMA"."TBL_STTM"'
    service = _service_with_columns(
        {"LAST_MODIFIED_BY": "NUMBER(38,0)", "ACTOR_USER_ID": "VARCHAR(128)"}
    )

    values = service._actor_column_values(table_name, "ANKURS")

    assert values == {"LAST_MODIFIED_BY": "NULL", "ACTOR_USER_ID": "'ANKURS'"}


def test_string_actor_remains_in_last_modified_by_for_current_schema() -> None:
    table_name = '"DB"."SCHEMA"."TBL_STTM"'
    service = _service_with_columns({"LAST_MODIFIED_BY": "VARCHAR(128)"})

    values = service._actor_column_values(table_name, "ANKURS")

    assert values == {"LAST_MODIFIED_BY": "'ANKURS'"}


def test_legacy_display_text_is_fitted_to_column_width() -> None:
    table_name = '"DB"."SCHEMA"."TBL_STTM"'
    service = _service_with_columns({"SOURCE_COLUMN": "VARCHAR(12)"})

    value = service._quote_text_for_column(table_name, "SOURCE_COLUMN", "DB.SCHEMA.TABLE.COLUMN")

    assert value == "'DB.SCHEMA.TA'"
