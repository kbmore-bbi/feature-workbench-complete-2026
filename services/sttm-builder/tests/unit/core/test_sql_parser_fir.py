from app.core.sql_parser import parse_sql_document


def test_insert_target_and_cte_alias_are_not_source_tables() -> None:
    parsed = parse_sql_document(
        """
        INSERT INTO CURATED.CUSTOMER_DIM (CUSTOMER_ID, CUSTOMER_NAME)
        WITH normalized AS (
          SELECT CUSTOMER_ID, UPPER(CUSTOMER_NAME) AS CUSTOMER_NAME
          FROM RAW.CUSTOMERS
        )
        SELECT CUSTOMER_ID, CUSTOMER_NAME FROM normalized
        """
    )

    assert parsed.target_table == "CURATED.CUSTOMER_DIM"
    assert "RAW.CUSTOMERS" in parsed.source_tables
    assert "CURATED.CUSTOMER_DIM" not in parsed.source_tables
    assert "normalized" not in {value.lower() for value in parsed.source_tables}


def test_create_view_target_is_not_a_source_table() -> None:
    parsed = parse_sql_document(
        "CREATE VIEW ANALYTICS.ACTIVE_CUSTOMERS AS SELECT * FROM RAW.CUSTOMERS WHERE ACTIVE = TRUE"
    )

    assert parsed.target_table == "ANALYTICS.ACTIVE_CUSTOMERS"
    assert parsed.source_tables == ["RAW.CUSTOMERS"]


def test_named_ctes_include_executable_queries_and_physical_sources() -> None:
    parsed = parse_sql_document(
        """
        WITH staged AS (
          SELECT CUSTOMER_ID FROM RAW.CUSTOMERS
        ),
        deduped AS (
          SELECT CUSTOMER_ID FROM staged
        )
        SELECT * FROM deduped
        """
    )

    assert parsed.source_tables == ["RAW.CUSTOMERS"]
    assert [cte.name for cte in parsed.ctes] == ["staged", "deduped"]
    assert parsed.ctes[0].sql_text == (
        "WITH staged AS (SELECT CUSTOMER_ID FROM RAW.CUSTOMERS) "
        "SELECT * FROM staged"
    )
    assert parsed.ctes[1].sql_text == (
        "WITH staged AS (SELECT CUSTOMER_ID FROM RAW.CUSTOMERS), "
        "deduped AS (SELECT CUSTOMER_ID FROM staged) SELECT * FROM deduped"
    )


def test_snowflake_identifier_variables_resolve_physical_sources_and_target() -> None:
    parsed = parse_sql_document(
        """
        SET SourceDb = 'RAW_DB';
        SET SourceSchema = 'CRM';
        SET ContactTable = CONTACTS;
        SET TargetTable = 'CURATED_DB.CRM.CUSTOMER_DIM';

        INSERT INTO IDENTIFIER($TargetTable) (CUSTOMER_ID)
        WITH contact_master AS (
          SELECT ID AS CUSTOMER_ID
          FROM IDENTIFIER($SourceDb || '.' || $SourceSchema || '.' || $ContactTable)
        )
        SELECT CUSTOMER_ID FROM contact_master;
        """
    )

    assert parsed.target_table == "CURATED_DB.CRM.CUSTOMER_DIM"
    assert parsed.source_tables == ["RAW_DB.CRM.CONTACTS"]
    assert [cte.name for cte in parsed.ctes] == ["contact_master"]


def test_snowflake_identifier_table_variable_can_resolve_against_known_tables() -> None:
    parsed = parse_sql_document(
        """
        SET ContactTable = CONTACTS;
        WITH contact_master AS (
          SELECT ID FROM IDENTIFIER($ContactTable)
        )
        SELECT ID FROM contact_master;
        """
    )

    assert parsed.source_tables == ["CONTACTS"]
