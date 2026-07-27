"""Upload router for builder hydration and offline FIR evidence capture."""
from __future__ import annotations

import hashlib
import logging
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile, HTTPException, Depends

from app.api.deps import get_snowflake_client
from app.core.config import Settings, get_settings
from app.core.fir_document_ingestion import (
    enqueue_fir_document_event,
    merge_table_hints,
    store_excel_asset,
    store_sql_asset,
)
from app.core.snowflake import SnowflakeClient
from app.core.target_mapping_patterns import TargetMappingPatternService

from ..core.sql_parser import parse_sql_document
from ..core.excel_parser import parse_excel_mapping
from ..core.fir_asset_resolver import FIRAssetTableResolver

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/upload", tags=["Upload"])

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB


@router.post("/sql")
async def upload_sql(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    file: UploadFile = File(...),
    project_id: str = Form(...),
    mode: str = Form("auto_populate"),
    source_table_hints: str = Form(""),
    target_table_hint: str = Form(""),
):
    """Upload a SQL file for parsing and FIR learning.

    Args:
        file: The SQL file (.sql)
        project_id: Project context
        mode: 'auto_populate' (fill builder) or 'learn_from_it' (background learning)

    Returns:
        Parsed summary with tables, columns, joins, transformations
    """
    if not file.filename or not file.filename.lower().endswith(".sql"):
        raise HTTPException(400, "Only .sql files are accepted")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, f"File exceeds {MAX_FILE_SIZE // (1024*1024)}MB limit")

    sql_text = content.decode("utf-8", errors="replace")
    asset_id = hashlib.sha256(content).hexdigest()[:32]

    parsed = parse_sql_document(sql_text)

    session = client.session
    learning_job_id: str | None = None
    extracted_pattern_count = 0
    learning_warnings: list[str] = []
    try:
        store_sql_asset(session, asset_id, file.filename, sql_text, project_id, parsed)
        source_candidates = merge_table_hints(parsed.source_tables, source_table_hints)
        target_candidates = merge_table_hints(
            [parsed.target_table] if parsed.target_table else [], target_table_hint
        )
        references = FIRAssetTableResolver(session, settings).resolve_and_store(
            asset_id=asset_id,
            project_id=project_id,
            references=[
                *[(table, "source") for table in source_candidates],
                *[(table, "target") for table in target_candidates],
            ],
        )
        enqueue_fir_document_event(
            session,
            asset_id,
            project_id,
            references,
            event_type="document.sql_upload",
            priority=mode == "learn_from_it",
        )
    except Exception as exc:
        logger.exception("Failed to store or queue SQL asset")
        raise HTTPException(500, "The SQL asset could not be stored for FIR processing") from exc
    if settings.fir_target_mapping_patterns_v2:
        try:
            pattern_service = TargetMappingPatternService(session, settings)
            patterns = pattern_service.extract_document_patterns(
                asset_id=asset_id,
                project_id=project_id,
                parsed_document=parsed.to_dict(),
                evidence_class="unvalidated_authored_sql",
                base_confidence=0.72,
            )
            extracted_pattern_count = pattern_service.upsert_patterns(patterns)
            job = pattern_service.create_learning_job(
                asset_id=asset_id,
                project_id=project_id,
                patterns=patterns,
            )
            learning_job_id = job.learning_job_id
        except Exception as exc:
            # Deterministic upload remains available during a rolling deployment
            # where the V2 FIR tables may not have been bootstrapped yet.
            logger.exception("Per-target FIR extraction failed for SQL asset %s", asset_id)
            learning_warnings.append(
                "The document was stored, but target-column enrichment is pending."
            )

    return {
        "status": "success",
        "asset_id": asset_id,
        "filename": file.filename,
        "mode": mode,
        "parsed_summary": parsed.to_dict(),
        "table_references": references,
        "learning_job_id": learning_job_id,
        "extracted_pattern_count": extracted_pattern_count,
        "warnings": learning_warnings,
    }


@router.post("/excel")
async def upload_excel(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    file: UploadFile = File(...),
    project_id: str = Form(...),
    mode: str = Form("auto_populate"),
    source_table_hints: str = Form(""),
    target_table_hint: str = Form(""),
):
    """Upload an Excel/CSV mapping file for parsing and FIR learning.

    Args:
        file: The Excel file (.xlsx, .xls, .csv)
        project_id: Project context
        mode: 'auto_populate' or 'learn_from_it'

    Returns:
        Parsed mapping summary with source/target columns and rules
    """
    valid_exts = (".xlsx", ".xls", ".csv")
    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in valid_exts):
        raise HTTPException(400, f"Accepted formats: {', '.join(valid_exts)}")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, f"File exceeds {MAX_FILE_SIZE // (1024*1024)}MB limit")

    parsed = parse_excel_mapping(content, file.filename)
    asset_id = hashlib.sha256(content).hexdigest()[:32]

    session = client.session
    learning_job_id: str | None = None
    extracted_pattern_count = 0
    learning_warnings: list[str] = []
    try:
        store_excel_asset(session, asset_id, file.filename, parsed, project_id)
        source_candidates = merge_table_hints(parsed.source_datasets, source_table_hints)
        target_candidates = merge_table_hints(parsed.target_tables, target_table_hint)
        references = FIRAssetTableResolver(session, settings).resolve_and_store(
            asset_id=asset_id,
            project_id=project_id,
            references=[
                *[(table, "source") for table in source_candidates],
                *[(table, "target") for table in target_candidates],
            ],
        )
        enqueue_fir_document_event(
            session,
            asset_id,
            project_id,
            references,
            event_type=(
                "document.csv_upload"
                if file.filename.lower().endswith(".csv")
                else "document.excel_upload"
            ),
            priority=mode == "learn_from_it",
        )
    except Exception as exc:
        logger.exception("Failed to store or queue Excel asset")
        raise HTTPException(500, "The mapping asset could not be stored for FIR processing") from exc
    if settings.fir_target_mapping_patterns_v2:
        try:
            pattern_service = TargetMappingPatternService(session, settings)
            patterns = pattern_service.extract_document_patterns(
                asset_id=asset_id,
                project_id=project_id,
                parsed_document=parsed.to_dict(),
                evidence_class="unvalidated_authored_mapping_workbook",
                base_confidence=0.68,
            )
            extracted_pattern_count = pattern_service.upsert_patterns(patterns)
            job = pattern_service.create_learning_job(
                asset_id=asset_id,
                project_id=project_id,
                patterns=patterns,
            )
            learning_job_id = job.learning_job_id
        except Exception:
            logger.exception("Per-target FIR extraction failed for mapping asset %s", asset_id)
            learning_warnings.append(
                "The document was stored, but target-column enrichment is pending."
            )

    return {
        "status": "success",
        "asset_id": asset_id,
        "filename": file.filename,
        "mode": mode,
        "parsed_summary": parsed.to_dict(),
        "table_references": references,
        "learning_job_id": learning_job_id,
        "extracted_pattern_count": extracted_pattern_count,
        "warnings": learning_warnings,
    }


@router.post("/trigger-learning")
async def trigger_learning(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    asset_id: str = Form(...),
    project_id: str = Form(...),
):
    """Prioritize a previously uploaded document for an offline FIR cycle."""
    session = client.session

    rows = session.sql(
        "SELECT SQL_ASSET_ID FROM TBL_WORKBENCH_CLIENT_SQL_ASSETS WHERE SQL_ASSET_ID = ?",
        [asset_id],
    ).collect()
    if not rows:
        raise HTTPException(404, "Asset not found. Please re-upload the file.")

    enqueue_fir_document_event(session, asset_id, project_id, [], priority=True)

    learning_job = None
    if settings.fir_durable_jobs_v2:
        pattern_service = TargetMappingPatternService(session, settings)
        learning_job = pattern_service.get_latest_job_for_asset(asset_id)
        if learning_job and learning_job.status not in {"completed", "failed"}:
            learning_job = pattern_service.process_learning_job(
                learning_job.learning_job_id,
                worker_id="upload-priority",
                max_items=settings.fir_agent_max_patterns_per_batch,
            )

    return {
        "status": "queued",
        "asset_id": asset_id,
        "recommendations_generated": 0,
        "learning_job_id": (
            learning_job.learning_job_id if learning_job else None
        ),
        "learning_job": (
            learning_job.model_dump(mode="json") if learning_job else None
        ),
        "details": {"processing": "offline", "latency_added_to_request": False},
    }
