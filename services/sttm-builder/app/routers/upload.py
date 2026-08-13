"""Upload router for builder hydration and offline FIR evidence capture."""
from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Annotated

import sqlglot
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)

from app.api.deps import get_semantic_context_service, get_snowflake_client
from app.core.config import Settings, get_settings
from app.core.bundle_curation import BundleCurationService
from app.core.cortex_completion import CortexCompletionUnavailable, complete_text
from app.core.fir_document_ingestion import (
    enqueue_fir_document_event,
    merge_table_hints,
    store_excel_asset,
    store_sql_asset,
)
from app.core.snowflake import SnowflakeClient
from app.core.semantic_context import SemanticContextService
from app.core.target_mapping_patterns import TargetMappingPatternService
from app.schema.common import TableRef
from app.schema.semantic_context import SemanticContextRefreshRequest

from ..core.sql_parser import bind_sql_document_context, parse_sql_document
from ..core.excel_parser import parse_excel_mapping
from ..core.fir_asset_resolver import FIRAssetTableResolver
from ..schema.workspace_context import WorkbenchContextSnapshotV2

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/upload", tags=["Upload"])

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB


def _json_object(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _parse_llm_json(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        # Cortex COMPLETE may return either the requested object directly or a
        # chat-completion envelope, depending on model/runtime version.
        if any(key in value for key in ("overview", "relationships", "ctes")):
            return value
        for key in ("response", "content", "message", "messages", "text", "choices"):
            if key in value:
                parsed = _parse_llm_json(value[key])
                if parsed:
                    return parsed
        return {}
    if isinstance(value, list):
        for item in value:
            parsed = _parse_llm_json(item)
            if parsed:
                return parsed
        return {}
    text = str(value or "").strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and any(
            key in parsed for key in ("overview", "relationships", "ctes")
        ):
            return parsed
        nested = _parse_llm_json(parsed)
        if nested:
            return nested
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(text[start : end + 1])
                return parsed if isinstance(parsed, dict) else {}
            except json.JSONDecodeError:
                pass
    # Some Cortex runtimes serialize the completion envelope as JSON whose
    # useful content is itself a JSON string. Recurse once it is decoded.
    try:
        decoded = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return _parse_llm_json(decoded) if decoded != value else {}


def _build_variable_approval(
    attributes: dict[str, object],
    requested_names: list[object],
) -> dict[str, object]:
    bindings = [
        item for item in attributes.get("variable_bindings") or []
        if isinstance(item, dict) and bool(item.get("project_value_candidate"))
    ]
    canonical_names = {
        str(item.get("name") or "").upper(): str(item.get("name") or "")
        for item in bindings
        if str(item.get("name") or "")
    }
    unknown = sorted(
        str(name) for name in requested_names
        if str(name).upper() not in canonical_names
    )
    if unknown:
        raise ValueError("Unknown or ineligible SQL project values: " + ", ".join(unknown))
    approved = sorted({canonical_names[str(name).upper()] for name in requested_names})
    approved_keys = {name.upper() for name in approved}
    rejected = sorted(
        name for name in canonical_names.values() if name.upper() not in approved_keys
    )
    return {
        "status": "reviewed",
        "approved_names": approved,
        "rejected_names": rejected,
        "source": "sql_upload_ui",
        "scope": "project",
    }


def _pretty_snowflake_sql(value: str | None) -> str | None:
    if not value:
        return value
    try:
        return sqlglot.parse_one(value, read="snowflake").sql(
            dialect="snowflake",
            pretty=True,
        )
    except Exception:
        return value


def _fallback_upload_explanations(
    attributes: dict[str, object],
) -> dict[str, object]:
    relationships = []
    for index, item in enumerate(attributes.get("join_patterns") or []):
        if not isinstance(item, dict):
            continue
        join_type = str(item.get("join_type") or "INNER").replace(" JOIN", "")
        left = str(item.get("left_table") or "the left input")
        right = str(item.get("right_table") or "the right input")
        condition = str(item.get("condition") or "the stated key condition")
        relationships.append(
            {
                "index": index,
                "title": f"{left} to {right}",
                "explanation": (
                    f"A {join_type.lower()} join connects {left} with {right} using "
                    f"{condition}. Review key uniqueness before publishing to avoid duplicate rows."
                ),
                "risk": "Check key uniqueness and expected fan-out.",
            }
        )
    ctes = []
    for item in attributes.get("ctes") or []:
        if not isinstance(item, dict):
            continue
        candidate = bool(item.get("derived_source_candidate"))
        name = str(item.get("name") or "CTE")
        ctes.append(
            {
                "name": name,
                "summary": str(item.get("purpose") or f"{name} prepares data for downstream SQL."),
                "classification_explanation": (
                    "This is a reusable derived-source candidate because it contains a "
                    "meaningful reusable or grain-changing step."
                    if candidate
                    else "This remains inline: it is retained in lineage, but is used only "
                    "inside this mapping and is not saved as a reusable derived source."
                ),
            }
        )
    return {
        "source": "deterministic_fallback",
        "overview": (
            "This explanation is based on deterministic SQL structure. FIR performs the "
            "deeper semantic and historical-evidence review asynchronously."
        ),
        "relationships": relationships,
        "ctes": ctes,
    }


def _drain_fir_learning_job(
    *,
    pattern_service: TargetMappingPatternService,
    learning_job_id: str,
    worker_id: str,
    settings: Settings,
) -> None:
    """Drain bounded durable batches without depending on a scheduled task."""
    prior_progress = -1.0
    for _ in range(12):
        job = pattern_service.process_learning_job(
            learning_job_id,
            worker_id=worker_id,
            max_items=settings.fir_agent_max_patterns_per_batch,
        )
        if job.status in {"completed", "failed", "paused"}:
            break
        if job.progress <= prior_progress:
            break
        prior_progress = job.progress


def _table_ref_from_fqn(value: str | None) -> TableRef | None:
    parts = [part.strip().strip('"') for part in str(value or "").split(".")]
    if len(parts) != 3 or not all(parts):
        return None
    return TableRef(database=parts[0], schema=parts[1], table=parts[2])


def _finish_sql_upload_enrichment(
    *,
    asset_id: str,
    project_id: str,
    references: list[dict[str, object]],
    workspace_context: dict[str, object],
    bundle_version_id: str | None,
    semantic_service: SemanticContextService,
    curation_service: BundleCurationService,
    session: object,
    settings: Settings,
    pattern_service: TargetMappingPatternService | None,
    learning_job_id: str | None,
    priority: bool,
) -> None:
    """Resolve/create the semantic-view bundle, then release FIR work."""
    enriched_workspace = dict(workspace_context)
    semantic = dict(enriched_workspace.get("semantic") or {})
    try:
        if not semantic.get("bundle_id"):
            source_refs = [
                table
                for item in references
                if str(item.get("reference_role") or "") == "source"
                and str(item.get("resolution_status") or "") == "resolved"
                for table in [_table_ref_from_fqn(str(item.get("resolved_fqn") or ""))]
                if table is not None
            ]
            target_ref = next(
                (
                    table
                    for item in references
                    if str(item.get("reference_role") or "") == "target"
                    and str(item.get("resolution_status") or "") == "resolved"
                    for table in [
                        _table_ref_from_fqn(str(item.get("resolved_fqn") or ""))
                    ]
                    if table is not None
                ),
                None,
            )
            if source_refs and target_ref:
                bundle = semantic_service.refresh_bundle(
                    SemanticContextRefreshRequest(
                        selected_source_tables=list(
                            {
                                table.qualified_name.upper(): table
                                for table in source_refs
                            }.values()
                        ),
                        target_table=target_ref,
                        requested_level="FULL_REGISTRY",
                    ),
                    allow_agent_refresh=False,
                )
                semantic.update(
                    {
                        "bundle_id": bundle.bundle_id,
                        "bundle_hash": bundle.bundle_hash,
                        "bundle_label": bundle.bundle_label,
                        "level": str(bundle.achieved_level),
                        "status": str(bundle.status),
                        "view_name": bundle.semantic_view_name,
                        "composed_model_hash": bundle.summary.composed_model_hash,
                    }
                )
                enriched_workspace["semantic"] = semantic
        if bundle_version_id and semantic.get("bundle_id"):
            curation_service.bind_semantic_bundle(
                bundle_version_id=bundle_version_id,
                semantic_bundle_id=str(semantic["bundle_id"]),
                base_bundle_hash=str(semantic.get("bundle_hash") or "") or None,
            )
        if semantic.get("bundle_id"):
            session.sql(
                """
                UPDATE TBL_WORKBENCH_CLIENT_SQL_ASSETS
                SET ATTRIBUTES = OBJECT_INSERT(
                        COALESCE(ATTRIBUTES, OBJECT_CONSTRUCT()),
                        'workspace_context',
                        PARSE_JSON(?),
                        TRUE
                    ),
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE SQL_ASSET_ID = ?
                """,
                [json.dumps(enriched_workspace, default=str), asset_id],
            ).collect()
    except Exception:
        logger.exception(
            "Semantic bundle preparation failed for SQL asset %s",
            asset_id,
        )
    finally:
        try:
            enqueue_fir_document_event(
                session,
                asset_id,
                project_id,
                references,
                event_type="document.sql_upload",
                priority=priority,
                workspace_context=enriched_workspace,
            )
        except Exception:
            logger.exception(
                "FIR event enqueue failed for SQL asset %s",
                asset_id,
            )
    if (
        pattern_service is not None
        and learning_job_id
        and settings.fir_process_uploads_immediately
    ):
        try:
            _drain_fir_learning_job(
                pattern_service=pattern_service,
                learning_job_id=learning_job_id,
                worker_id=f"upload:{asset_id}",
                settings=settings,
            )
        except Exception:
            logger.exception(
                "Immediate asynchronous FIR processing failed for SQL asset %s",
                asset_id,
            )


@router.post("/sql")
async def upload_sql(
    background_tasks: BackgroundTasks,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    semantic_service: Annotated[
        SemanticContextService,
        Depends(get_semantic_context_service),
    ],
    file: UploadFile = File(...),
    project_id: str = Form(...),
    mode: str = Form("auto_populate"),
    source_table_hints: str = Form(""),
    target_table_hint: str = Form(""),
    workspace_context: str = Form(""),
    import_behavior: str = Form("preview"),
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

    active_workspace: WorkbenchContextSnapshotV2 | None = None
    if workspace_context.strip():
        try:
            active_workspace = WorkbenchContextSnapshotV2.model_validate(
                json.loads(workspace_context)
            )
        except Exception as exc:
            raise HTTPException(
                400, "workspace_context is not a valid Workbench context snapshot"
            ) from exc
    workspace_target = (
        active_workspace.target_table.qualified_name
        if active_workspace and active_workspace.target_table
        else None
    )
    parsed = bind_sql_document_context(
        parse_sql_document(sql_text),
        workspace_target=workspace_target,
        target_hint=target_table_hint,
    )

    session = client.session
    learning_job_id: str | None = None
    pattern_service: TargetMappingPatternService | None = None
    extracted_pattern_count = 0
    learning_warnings: list[str] = []
    curation_service = BundleCurationService(session, settings)
    bundle_version_id = (
        curation_service.document_version_id(
            asset_id=asset_id,
            project_id=project_id,
            context_key=active_workspace.context_key if active_workspace else None,
            target_table=parsed.target_table,
        )
        if settings.fir_document_lineage_v3
        else None
    )
    stored_workspace_context = (
        active_workspace.model_dump(mode="json")
        if active_workspace
        else {}
    )
    if bundle_version_id:
        stored_workspace_context["bundle_curation"] = {
            "bundle_version_id": bundle_version_id,
            "status": "draft",
        }
    try:
        workspace_sources = (
            [
                table.qualified_name
                for table in active_workspace.source_tables
            ]
            if active_workspace
            else []
        )
        explicit_sources = merge_table_hints([], source_table_hints)
        source_candidates = list(
            dict.fromkeys(
                [
                    *workspace_sources,
                    *explicit_sources,
                    *parsed.source_tables,
                ]
            )
        )
        target_candidates = [parsed.target_table] if parsed.target_table else []
        store_sql_asset(
            session,
            asset_id,
            file.filename,
            sql_text,
            project_id,
            parsed,
            workspace_context=stored_workspace_context,
        )
        references = FIRAssetTableResolver(session, settings).resolve_and_store(
            asset_id=asset_id,
            project_id=project_id,
            references=[
                *[(table, "source") for table in source_candidates],
                *[(table, "target") for table in target_candidates],
            ],
        )
        if bundle_version_id:
            try:
                curation_service.upsert_document_draft(
                    bundle_version_id=bundle_version_id,
                    asset_id=asset_id,
                    project_id=project_id,
                    workspace_context=stored_workspace_context,
                    parsed=parsed,
                )
            except Exception:
                logger.exception(
                    "Bundle curation draft persistence failed for SQL asset %s",
                    asset_id,
                )
                learning_warnings.append(
                    "The deterministic preview is available, but bundle curation persistence is pending."
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

    background_tasks.add_task(
        _finish_sql_upload_enrichment,
        asset_id=asset_id,
        project_id=project_id,
        references=references,
        workspace_context=stored_workspace_context,
        bundle_version_id=bundle_version_id,
        semantic_service=semantic_service,
        curation_service=curation_service,
        session=session,
        settings=settings,
        pattern_service=pattern_service,
        learning_job_id=learning_job_id,
        priority=mode == "learn_from_it",
    )

    selected_source_fqns = {
        table.qualified_name.upper()
        for table in (active_workspace.source_tables if active_workspace else [])
    }
    classified_references: list[dict[str, object]] = []
    for reference in references:
        item = dict(reference)
        status = str(item.get("resolution_status") or "")
        resolved_fqn = str(item.get("resolved_fqn") or "").upper()
        role = str(item.get("reference_role") or "")
        if status != "resolved":
            classification = status or "unresolved"
        elif str(item.get("semantic_status") or "") != "active":
            classification = "semantic_missing"
        elif role == "target":
            classification = "selected_target" if workspace_target else "document_target"
        elif resolved_fqn in selected_source_fqns:
            classification = "selected"
        else:
            classification = "additional"
        item["classification"] = classification
        classified_references.append(item)
    source_backed = [
        mapping
        for mapping in parsed.column_mappings
        if mapping.source_columns
    ]
    import_preview = {
        "sql": sql_text,
        "behavior": (
            import_behavior
            if import_behavior in {"preview", "recommendations_only", "auto_populate_draft"}
            else "preview"
        ),
        "target_binding": parsed.target_binding,
        "table_references": classified_references,
        "coverage": {
            "target_columns": len(parsed.column_mappings),
            "source_backed_columns": len(source_backed),
            "physical_lineage_resolved": sum(
                bool(mapping.physical_source_columns)
                for mapping in source_backed
            ),
            "structurally_resolved": sum(
                not mapping.unresolved_references for mapping in source_backed
            ),
            "constants": sum(
                mapping.constant_value is not None
                for mapping in parsed.column_mappings
            ),
            "ctes": len(parsed.ctes),
            "derived_source_candidates": sum(
                cte.derived_source_candidate for cte in parsed.ctes
            ),
            "variables": len(parsed.variable_bindings),
            "project_value_candidates": sum(
                item.project_value_candidate for item in parsed.variable_bindings
            ),
        },
        "project_value_candidates": [
            item.to_dict() for item in parsed.variable_bindings
        ],
        "mapping_rows": [
            mapping.to_dict() for mapping in parsed.column_mappings
        ],
        "cte_summary": [
            {
                "name": cte.name,
                "purpose": cte.purpose,
                "candidate": cte.derived_source_candidate,
                "reasons": cte.derived_source_reasons,
                "grain_evidence": cte.grain_evidence,
                "downstream_consumers": cte.downstream_consumers,
                "sql_text": _pretty_snowflake_sql(cte.sql_text),
                "output_columns": cte.output_columns,
                "tables_referenced": cte.tables_referenced,
                "dependencies": cte.dependencies,
            }
            for cte in parsed.ctes
        ],
        "knowledge_graph": parsed.knowledge_graph,
        "diagnostics": [
            *parsed.lineage_diagnostics,
            *[
                {"status": "warning", "message": warning}
                for warning in parsed.parse_warnings
            ],
        ],
    }
    has_resolved_source = any(
        str(item.get("reference_role") or "") == "source"
        and str(item.get("resolution_status") or "") == "resolved"
        for item in classified_references
    )
    has_resolved_target = any(
        str(item.get("reference_role") or "") == "target"
        and str(item.get("resolution_status") or "") == "resolved"
        for item in classified_references
    )
    semantic_bundle_resolution = (
        "existing"
        if active_workspace and active_workspace.semantic.bundle_id
        else "preparing"
        if has_resolved_source and has_resolved_target
        else "target_required"
        if not parsed.target_table
        else "table_resolution_required"
    )
    return {
        "status": "success",
        "asset_id": asset_id,
        "filename": file.filename,
        "mode": mode,
        "parsed_summary": parsed.to_dict(),
        "table_references": classified_references,
        "learning_job_id": learning_job_id,
        "extracted_pattern_count": extracted_pattern_count,
        "import_preview": import_preview,
        "bundle_context": {
            "bundle_version_id": bundle_version_id,
            "project_id": project_id,
            "sttm_id": active_workspace.sttm_id if active_workspace else None,
            "context_key": active_workspace.context_key if active_workspace else None,
            "context_hash": active_workspace.context_hash if active_workspace else None,
            "semantic_bundle_id": (
                active_workspace.semantic.bundle_id if active_workspace else None
            ),
            "semantic_bundle_hash": (
                active_workspace.semantic.bundle_hash if active_workspace else None
            ),
            "semantic_bundle_resolution": semantic_bundle_resolution,
        },
        "warnings": learning_warnings,
    }


@router.post("/sql/{asset_id}/explanations")
def explain_sql_upload(
    asset_id: str,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    """Add a small-model plain-language layer over deterministic SQL evidence."""
    rows = client.session.sql(
        """
        SELECT ATTRIBUTES
        FROM TBL_WORKBENCH_CLIENT_SQL_ASSETS
        WHERE SQL_ASSET_ID = ?
          AND STATUS = 'active'
        LIMIT 1
        """,
        [asset_id],
    ).collect()
    if not rows:
        raise HTTPException(404, "Uploaded SQL asset was not found")
    row = rows[0]
    raw_attributes = (
        row.as_dict(recursive=True).get("ATTRIBUTES")
        if hasattr(row, "as_dict")
        else row[0]
    )
    attributes = _json_object(raw_attributes)
    fallback = _fallback_upload_explanations(attributes)
    if not settings.fir_upload_explanations_enabled:
        return fallback

    compact_evidence = {
        "target_table": attributes.get("target_table"),
        "source_tables": attributes.get("source_tables"),
        "joins": attributes.get("join_patterns"),
        "ctes": [
            {
                "name": item.get("name"),
                "purpose": item.get("purpose"),
                "candidate": item.get("derived_source_candidate"),
                "reasons": item.get("derived_source_reasons"),
                "grain_evidence": item.get("grain_evidence"),
                "downstream_consumers": item.get("downstream_consumers"),
            }
            for item in attributes.get("ctes") or []
            if isinstance(item, dict)
        ],
    }
    prompt = (
        "You explain deterministic SQL lineage to a business data-mapping reviewer. "
        "Do not invent table purpose, cardinality, business meaning, or keys. Use only "
        "the supplied evidence. Return JSON only with keys: overview (string), "
        "relationships (array of {index,title,explanation,risk}), and ctes (array of "
        "{name,summary,classification_explanation}). Explain 'inline' as retained in "
        "lineage but not saved as a reusable derived source. Keep each explanation to "
        "two short sentences.\nEVIDENCE:\n"
        + json.dumps(compact_evidence, default=str)
    )
    try:
        response = complete_text(
            client.session,
            model=settings.fir_upload_explanation_model,
            prompt=prompt,
        )
        parsed = _parse_llm_json(response)
        if parsed:
            relationships = parsed.get("relationships")
            if isinstance(relationships, list):
                # Models occasionally return one-based numbering despite the
                # requested contract. Array order is the authoritative match
                # to deterministic join evidence.
                for index, relationship in enumerate(relationships):
                    if isinstance(relationship, dict):
                        relationship["index"] = index
            parsed["source"] = "small_model"
            parsed["model"] = settings.fir_upload_explanation_model
            return parsed
    except CortexCompletionUnavailable as exc:
        logger.warning(
            "Small-model SQL explanation unavailable for asset %s: %s",
            asset_id,
            exc,
        )
    except Exception:
        logger.exception("Small-model SQL explanation failed for asset %s", asset_id)
    fallback["warning"] = (
        "The fast explanation model was unavailable, so structure-based wording is shown."
    )
    return fallback


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
            if (
                settings.fir_process_uploads_immediately
                and job.status not in {"completed", "failed"}
            ):
                job = pattern_service.process_learning_job(
                    job.learning_job_id,
                    worker_id=f"upload:{asset_id}",
                    max_items=settings.fir_agent_max_patterns_per_batch,
                )
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
    background_tasks: BackgroundTasks,
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    asset_id: str = Form(...),
    project_id: str = Form(...),
    approved_project_values: str = Form(""),
):
    """Prioritize a previously uploaded document for an offline FIR cycle."""
    session = client.session

    rows = session.sql(
        "SELECT SQL_ASSET_ID, ATTRIBUTES FROM TBL_WORKBENCH_CLIENT_SQL_ASSETS WHERE SQL_ASSET_ID = ?",
        [asset_id],
    ).collect()
    if not rows:
        raise HTTPException(404, "Asset not found. Please re-upload the file.")

    variable_approval: dict[str, object] | None = None
    if approved_project_values.strip():
        try:
            requested_names = json.loads(approved_project_values)
        except json.JSONDecodeError as exc:
            raise HTTPException(400, "approved_project_values must be a JSON array") from exc
        if not isinstance(requested_names, list):
            raise HTTPException(400, "approved_project_values must be a JSON array")
        row_payload = rows[0].as_dict(recursive=True) if hasattr(rows[0], "as_dict") else rows[0]
        attributes = _json_object(row_payload.get("ATTRIBUTES"))
        try:
            variable_approval = _build_variable_approval(attributes, requested_names)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        session.sql(
            """
            UPDATE TBL_WORKBENCH_CLIENT_SQL_ASSETS
            SET ATTRIBUTES = OBJECT_INSERT(
                    COALESCE(ATTRIBUTES, OBJECT_CONSTRUCT()),
                    'variable_approval',
                    PARSE_JSON(?),
                    TRUE
                ),
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE SQL_ASSET_ID = ?
            """,
            [json.dumps(variable_approval), asset_id],
        ).collect()

    enqueue_fir_document_event(session, asset_id, project_id, [], priority=True)

    learning_job = None
    if settings.fir_durable_jobs_v2:
        pattern_service = TargetMappingPatternService(session, settings)
        learning_job = pattern_service.get_latest_job_for_asset(asset_id)
        if learning_job and learning_job.status not in {"completed", "failed"}:
            background_tasks.add_task(
                _drain_fir_learning_job,
                pattern_service=pattern_service,
                learning_job_id=learning_job.learning_job_id,
                worker_id="upload-priority",
                settings=settings,
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
        "variable_approval": variable_approval,
        "details": {"processing": "offline", "latency_added_to_request": False},
    }
