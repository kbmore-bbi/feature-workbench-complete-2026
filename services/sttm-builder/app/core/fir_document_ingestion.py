"""Shared document persistence helpers for API and offline FIR ingestion."""

from __future__ import annotations

import json
from typing import Any

from app.core.excel_parser import ParsedExcelMapping
from app.core.sql_parser import ParsedSqlDocument


def merge_table_hints(detected: list[str], hints: str) -> list[str]:
    hint_values = split_table_values([hints])
    # Explicit physical selections are authoritative. Detected identifiers are
    # still retained in the parsed document as evidence.
    values = hint_values or split_table_values(detected)
    seen: set[str] = set()
    merged: list[str] = []
    for normalized in values:
        key = normalized.upper()
        if key in seen:
            continue
        seen.add(key)
        merged.append(normalized)
    return merged


def split_table_values(raw_values: list[str]) -> list[str]:
    values: list[str] = []
    for raw_value in raw_values:
        values.extend(
            part.strip()
            for part in str(raw_value or "")
            .replace("\r", "\n")
            .replace("\n", ",")
            .split(",")
        )
    normalized_values: list[str] = []
    for value in values:
        normalized = str(value or "").strip()
        key = normalized.upper()
        if not normalized or key in {"/", "SELF"}:
            continue
        normalized_values.append(normalized)
    return normalized_values


def store_sql_asset(
    session: Any,
    asset_id: str,
    filename: str,
    sql_text: str,
    project_id: str,
    parsed: ParsedSqlDocument,
    workspace_context: dict[str, Any] | None = None,
) -> None:
    """Store uploaded SQL as authoritative historical FIR evidence."""
    attributes_payload = parsed.to_dict()
    if workspace_context:
        attributes_payload["workspace_context"] = workspace_context
    attributes_payload["fir_evidence"] = {
        "evidence_class": "authored_historical_mapping",
        "authoritative_mapping": True,
        "base_confidence": 0.96,
        "provenance": "client_provided_sql",
        "meaning": (
            "A previously created mapping implementation. Treat its source/target mappings, "
            "CTE structure, joins, filters, transformations, and comments as authoritative "
            "historical evidence unless table resolution is ambiguous or stronger evidence "
            "explicitly contradicts it."
        ),
    }
    attributes = json.dumps(attributes_payload)
    session.sql(
        """
        MERGE INTO TBL_WORKBENCH_CLIENT_SQL_ASSETS target
        USING (SELECT ? AS SQL_ASSET_ID) source
        ON target.SQL_ASSET_ID = source.SQL_ASSET_ID
        WHEN NOT MATCHED THEN INSERT (
            SQL_ASSET_ID, TITLE, SQL_TEXT, SQL_KIND, DIALECT,
            DESCRIPTION, TAGS, ATTRIBUTES, PROJECT_ID,
            STATUS, CREATED_AT, UPDATED_AT
        ) VALUES (?, ?, ?, 'historical_mapping', 'snowflake',
                  ?, PARSE_JSON('[]'), PARSE_JSON(?), ?,
                  'active', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        [
            asset_id,
            asset_id,
            filename,
            sql_text,
            f"Uploaded SQL: {filename}",
            attributes,
            project_id,
        ],
    ).collect()


def store_excel_asset(
    session: Any,
    asset_id: str,
    filename: str,
    parsed: ParsedExcelMapping,
    project_id: str,
) -> None:
    """Store an Excel or CSV mapping as authoritative historical FIR evidence."""
    attributes_payload = parsed.to_dict()
    is_csv = filename.lower().endswith(".csv")
    attributes_payload["fir_evidence"] = {
        "evidence_class": (
            "authored_csv_mapping_specification"
            if is_csv
            else "authored_mapping_workbook"
        ),
        "authoritative_mapping": True,
        "base_confidence": 0.97 if is_csv else 0.99,
        "provenance": (
            "client_provided_mapping_csv"
            if is_csv
            else "client_provided_mapping_workbook"
        ),
        "meaning": (
            "A previously created source-to-target mapping specification. Treat its column "
            "mappings, definitions, processing rules, dependencies, and ordering as "
            "authoritative historical evidence unless table resolution is ambiguous or "
            "stronger evidence explicitly contradicts it."
        ),
    }
    attributes = json.dumps(attributes_payload)
    session.sql(
        """
        MERGE INTO TBL_WORKBENCH_CLIENT_SQL_ASSETS target
        USING (SELECT ? AS SQL_ASSET_ID) source
        ON target.SQL_ASSET_ID = source.SQL_ASSET_ID
        WHEN NOT MATCHED THEN INSERT (
            SQL_ASSET_ID, TITLE, SQL_TEXT, SQL_KIND, DIALECT,
            DESCRIPTION, TAGS, ATTRIBUTES, PROJECT_ID,
            STATUS, CREATED_AT, UPDATED_AT
        ) VALUES (?, ?, ?, 'MAPPING', 'excel',
                  ?, PARSE_JSON('["excel_mapping"]'), PARSE_JSON(?), ?,
                  'active', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        [
            asset_id,
            asset_id,
            filename,
            json.dumps(parsed.to_dict()),
            f"Uploaded mapping: {filename}",
            attributes,
            project_id,
        ],
    ).collect()


def enqueue_fir_document_event(
    session: Any,
    asset_id: str,
    project_id: str,
    references: list[dict[str, Any]],
    *,
    event_type: str = "document.uploaded",
    priority: bool = False,
    workspace_context: dict[str, Any] | None = None,
) -> None:
    """Queue an uploaded document for the offline FIR pipeline."""
    unresolved = [
        item for item in references if item.get("resolution_status") != "resolved"
    ]
    payload = {
        "asset_id": asset_id,
        "project_id": project_id,
        "priority": priority,
        "table_references": references,
        "workspace_context": workspace_context or {},
        "inference_status": (
            "deferred_for_resolution" if unresolved else "ready_for_enrichment"
        ),
    }
    session.sql(
        """
        INSERT INTO TBL_WORKBENCH_FIR_EVENTS (
            EVENT_ID, EVENT_TYPE, PAGE, SURFACE, ENTITY_TYPE, ENTITY_IDS,
            EVENT_PAYLOAD, MILESTONE
        ) SELECT UUID_STRING(), ?, 'upload', 'DOCUMENT', 'sql_asset',
                 PARSE_JSON(?), PARSE_JSON(?), 'document_resolved'
        """,
        [
            event_type,
            json.dumps([asset_id]),
            json.dumps(payload),
        ],
    ).collect()
