from app.core.sql_parser import bind_sql_document_context, parse_sql_document


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
    assert parsed.variables["SOURCEDB"] == "RAW_DB"
    assert parsed.variable_bindings[0].name == "SourceDb"
    assert parsed.variable_bindings[-1].classification == "environment_identifier"
    assert parsed.variable_bindings[-1].project_value_candidate is False


def test_set_variables_become_typed_reviewable_project_value_candidates() -> None:
    parsed = parse_sql_document(
        """
        SET TransactionFirmID = 1101;
        SET IsActive = TRUE;
        SET EffectiveDate = DATE '2026-08-01';
        SELECT
          $TransactionFirmID AS TRANSACTION_FIRM_ID,
          $IsActive AS IS_ACTIVE,
          $EffectiveDate AS EFFECTIVE_DATE
        FROM RAW.PUBLIC.CONTACTS;
        """
    )

    bindings = {item.name: item for item in parsed.variable_bindings}
    assert parsed.variables["TRANSACTIONFIRMID"] == "1101"
    assert bindings["TransactionFirmID"].inferred_type == "INT"
    assert bindings["IsActive"].inferred_type == "BOOLEAN"
    assert bindings["EffectiveDate"].inferred_type == "DATE"
    assert all(item.project_value_candidate for item in bindings.values())
    assert all(item.approval_status == "draft" for item in bindings.values())
    assert any(
        node["kind"] == "project_value_candidate"
        and node["attributes"]["name"] == "TransactionFirmID"
        for node in parsed.knowledge_graph["nodes"]
    )


def test_identifier_only_variable_is_not_promoted_to_project_value() -> None:
    parsed = parse_sql_document(
        """
        SET SourceTable = 'RAW.PUBLIC.CONTACTS';
        SELECT * FROM IDENTIFIER($SourceTable);
        """
    )

    binding = parsed.variable_bindings[0]
    assert binding.classification == "environment_identifier"
    assert binding.usage_roles == ["physical_identifier"]
    assert binding.project_value_candidate is False


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


def test_workspace_target_wins_without_discarding_conflicting_sql_target() -> None:
    parsed = bind_sql_document_context(
        parse_sql_document(
            "INSERT INTO OLD_DB.PUBLIC.TARGET SELECT ID FROM RAW.PUBLIC.SOURCE"
        ),
        workspace_target="NEW_DB.PUBLIC.TARGET",
        target_hint="HINT_DB.PUBLIC.TARGET",
    )

    assert parsed.target_table == "NEW_DB.PUBLIC.TARGET"
    assert parsed.target_binding["sql_declared_target"] == "OLD_DB.PUBLIC.TARGET"
    assert {item["kind"] for item in parsed.target_binding["conflicts"]} == {
        "target_conflict",
        "target_hint_conflict",
    }


def test_nested_cte_lineage_preserves_intermediate_and_physical_paths() -> None:
    parsed = bind_sql_document_context(
        parse_sql_document(
            """
            WITH normalized AS (
              SELECT c.ID, UPPER(c.NAME) AS NORMALIZED_NAME
              FROM RAW.PUBLIC.CUSTOMERS c
            ),
            final_source AS (
              SELECT n.ID, COALESCE(n.NORMALIZED_NAME, 'UNKNOWN') AS CUSTOMER_NAME
              FROM normalized n
            )
            SELECT ID AS CUSTOMER_ID, CUSTOMER_NAME
            FROM final_source
            """
        ),
        workspace_target="CURATED.PUBLIC.CUSTOMER",
    )

    mappings = {item.target_alias: item for item in parsed.column_mappings}
    assert mappings["CUSTOMER_ID"].physical_source_columns == [
        "RAW.PUBLIC.CUSTOMERS.ID"
    ]
    assert mappings["CUSTOMER_NAME"].physical_source_columns == [
        "RAW.PUBLIC.CUSTOMERS.NAME"
    ]
    assert any(
        step["kind"] == "cte_output"
        for step in mappings["CUSTOMER_NAME"].lineage_path
    )
