#!/usr/bin/env python3
"""Upload, run, inspect, and approve durable FIR learning in a client account."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "services" / "sttm-builder"
DEFAULT_ENV = ROOT / "infra" / "snowflake" / "env" / "client.env"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from app.core.bundle_curation import BundleCurationError, BundleCurationService
from app.core.config import Settings
from app.core.derived_source import DerivedSourceService
from app.core.fir_asset_resolver import FIRAssetTableResolver
from app.core.fir_document_ingestion import enqueue_fir_document_event, store_sql_asset
from app.core.semantic_context import SemanticContextService
from app.core.semantic_model import SemanticModelService
from app.core.snowflake import get_local_cached_client
from app.core.sql_parser import bind_sql_document_context, parse_sql_document
from app.core.table_selection import TableSelectionService
from app.core.target_mapping_patterns import TargetMappingPatternService
from app.schema.bundle_curation import BundleCurationPromotionRequest
from app.schema.common import TableRef
from app.schema.semantic_context import SemanticContextRefreshRequest


TERMINAL = {"completed", "failed", "paused"}


def row_dict(row: Any) -> dict[str, Any]:
    return row.as_dict() if hasattr(row, "as_dict") else dict(row)


def table_ref(fqn: str) -> TableRef:
    parts = [part.strip().strip('"') for part in fqn.split(".")]
    if len(parts) != 3 or not all(parts):
        raise ValueError(f"Expected DATABASE.SCHEMA.TABLE, received: {fqn}")
    return TableRef(database=parts[0], schema=parts[1], table=parts[2])


def settings_and_client(env_file: str):
    path = Path(env_file).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Client environment file not found: {path}")
    settings = Settings(
        _env_file=str(path),
        app_env="local",
        local_dev_auth_enabled=True,
        spcs_execute_as_caller_enabled=False,
        datahub_enabled=False,
    )
    missing = [
        name
        for name, value in (
            ("SNOWFLAKE_ACCOUNT", settings.snowflake_account),
            ("SNOWFLAKE_USER", settings.snowflake_user),
            ("SNOWFLAKE_DATABASE", settings.snowflake_database),
            ("SNOWFLAKE_SCHEMA", settings.snowflake_schema),
        )
        if not str(value or "").strip()
    ]
    if missing:
        raise ValueError(f"Missing values in {path}: {', '.join(missing)}")
    if not settings.local_dev_uses_externalbrowser and not settings.snowflake_password:
        raise ValueError(
            "Set SNOWFLAKE_AUTHENTICATOR=externalbrowser or SNOWFLAKE_PASSWORD."
        )
    client = get_local_cached_client(settings)
    client.session.sql("SELECT 1").collect()
    return settings, client


def semantic_service(settings: Settings, client: Any) -> SemanticContextService:
    return SemanticContextService(
        session=client.session,
        settings=settings,
        semantic_model_service=SemanticModelService(settings),
        table_selection_service=TableSelectionService(client, settings),
        derived_source_service=DerivedSourceService(client.session, settings),
    )


def upload(
    *,
    settings: Settings,
    client: Any,
    sql_file: str,
    project_id: str,
    target: str,
    sources: list[str],
) -> dict[str, Any]:
    path = Path(sql_file).expanduser().resolve()
    if not path.is_file() or path.suffix.lower() != ".sql":
        raise ValueError(f"SQL file not found or not a .sql file: {path}")
    content = path.read_bytes()
    sql_text = content.decode("utf-8", errors="replace")
    asset_id = hashlib.sha256(content).hexdigest()[:32]
    parsed = bind_sql_document_context(
        parse_sql_document(sql_text),
        workspace_target=None,
        target_hint=target,
    )
    source_fqns = list(dict.fromkeys([*sources, *parsed.source_tables]))
    target_fqn = parsed.target_table or target
    if not target_fqn:
        raise ValueError(
            "A SELECT-only learning upload requires --target-table DATABASE.SCHEMA.TABLE."
        )

    session = client.session
    workspace_context: dict[str, Any] = {
        "project_id": project_id,
        "source_tables": source_fqns,
        "target_table": target_fqn,
        "origin": "manage_client_fir_learning",
    }
    curation = BundleCurationService(session, settings)
    bundle_version_id = curation.document_version_id(
        asset_id=asset_id,
        project_id=project_id,
        context_key=None,
        target_table=target_fqn,
    )
    workspace_context["bundle_curation"] = {
        "bundle_version_id": bundle_version_id,
        "status": "draft",
    }
    store_sql_asset(
        session,
        asset_id,
        path.name,
        sql_text,
        project_id,
        parsed,
        workspace_context=workspace_context,
    )
    references = FIRAssetTableResolver(session, settings).resolve_and_store(
        asset_id=asset_id,
        project_id=project_id,
        references=[
            *[(source, "source") for source in source_fqns],
            (target_fqn, "target"),
        ],
    )
    curation.upsert_document_draft(
        bundle_version_id=bundle_version_id,
        asset_id=asset_id,
        project_id=project_id,
        workspace_context=workspace_context,
        parsed=parsed,
    )

    resolved_sources = [
        table_ref(str(item["resolved_fqn"]))
        for item in references
        if str(item.get("reference_role")) == "source"
        and str(item.get("resolution_status")) == "resolved"
        and item.get("resolved_fqn")
    ]
    resolved_target = next(
        (
            table_ref(str(item["resolved_fqn"]))
            for item in references
            if str(item.get("reference_role")) == "target"
            and str(item.get("resolution_status")) == "resolved"
            and item.get("resolved_fqn")
        ),
        None,
    )
    bundle: dict[str, Any] = {"status": "not_prepared"}
    if resolved_sources and resolved_target:
        response = semantic_service(settings, client).refresh_bundle(
            SemanticContextRefreshRequest(
                selected_source_tables=list(
                    {
                        item.qualified_name.upper(): item
                        for item in resolved_sources
                    }.values()
                ),
                target_table=resolved_target,
                requested_level="FULL_REGISTRY",
            ),
            allow_agent_refresh=False,
        )
        bundle = {
            "status": str(response.status),
            "bundle_id": response.bundle_id,
            "bundle_hash": response.bundle_hash,
            "bundle_label": response.bundle_label,
        }
        curation.bind_semantic_bundle(
            bundle_version_id=bundle_version_id,
            semantic_bundle_id=response.bundle_id,
            base_bundle_hash=response.bundle_hash,
        )
        workspace_context["semantic"] = bundle

    enqueue_fir_document_event(
        session,
        asset_id,
        project_id,
        references,
        event_type="document.sql_upload",
        priority=True,
        workspace_context=workspace_context,
    )
    patterns = TargetMappingPatternService(session, settings)
    extracted = patterns.extract_document_patterns(
        asset_id=asset_id,
        project_id=project_id,
        parsed_document=parsed.to_dict(),
        evidence_class="unvalidated_authored_sql",
        base_confidence=0.72,
    )
    extracted_count = patterns.upsert_patterns(extracted)
    job = patterns.create_learning_job(
        asset_id=asset_id,
        project_id=project_id,
        patterns=extracted,
    )
    return {
        "asset_id": asset_id,
        "learning_job_id": job.learning_job_id,
        "job_status": job.status,
        "extracted_pattern_count": extracted_count,
        "source_tables": source_fqns,
        "target_table": target_fqn,
        "table_references": references,
        "semantic_bundle": bundle,
        "bundle_version_id": bundle_version_id,
    }


def job_details(session: Any, settings: Settings, job_id: str) -> dict[str, Any]:
    service = TargetMappingPatternService(session, settings)
    job = service.get_job(job_id)
    if job is None:
        raise ValueError(f"Learning job not found: {job_id}")
    work_table = settings.qualify_metadata_object_name("TBL_FIR_LEARNING_WORK_ITEMS")
    quote = TargetMappingPatternService._quote
    rows = session.sql(
        f"""
        SELECT WORK_ITEM_ID, WORK_ITEM_TYPE, STATUS, ATTEMPT_COUNT,
               ERROR, RESULT, UPDATED_AT, COMPLETED_AT
        FROM {work_table}
        WHERE LEARNING_JOB_ID = {quote(job_id)}
        ORDER BY CREATED_AT, WORK_ITEM_TYPE
        """
    ).collect()
    return {
        "job": job.model_dump(mode="json"),
        "work_items": [row_dict(row) for row in rows],
    }


def process_job(
    *,
    session: Any,
    settings: Settings,
    job_id: str,
    max_rounds: int,
) -> dict[str, Any]:
    service = TargetMappingPatternService(session, settings)
    last_progress = -1.0
    for round_number in range(1, max_rounds + 1):
        job = service.process_learning_job(
            job_id,
            worker_id="client-fir-learning-cli",
            max_items=settings.fir_agent_max_patterns_per_batch,
        )
        print(
            f"round={round_number} status={job.status} stage={job.stage} "
            f"progress={job.progress:.1f}%",
            file=sys.stderr,
        )
        if job.status in TERMINAL:
            break
        if job.progress <= last_progress:
            print(
                "No forward progress in this round; inspect work-item errors before retrying.",
                file=sys.stderr,
            )
            break
        last_progress = job.progress
    return job_details(session, settings, job_id)


def approve_job(
    *,
    session: Any,
    settings: Settings,
    job_id: str,
    actor: str,
) -> dict[str, Any]:
    details = job_details(session, settings, job_id)
    job = details["job"]
    if str(job.get("status") or "").lower() != "completed":
        raise ValueError("Only a completed learning job can be approved.")
    asset_id = str(job.get("asset_id") or "")
    q = TargetMappingPatternService._quote
    patterns = settings.qualify_metadata_object_name("TBL_FIR_TARGET_MAPPING_PATTERNS")
    items = settings.qualify_metadata_object_name("TBL_FIR_LEARNING_WORK_ITEMS")
    inferences = settings.qualify_metadata_object_name("TBL_WORKBENCH_INFERENCES")
    fir = settings.qualify_metadata_object_name("TBL_AGENT_FIR_360")
    recommendations = settings.qualify_metadata_object_name(
        "TBL_FIR_AGENT_RECOMMENDATIONS"
    )
    versions = settings.qualify_metadata_object_name("TBL_SEMANTIC_BUNDLE_VERSIONS")

    session.sql(
        f"""
        UPDATE {patterns}
        SET VALIDATION_STATUS='validated', UPDATED_AT=CURRENT_TIMESTAMP()
        WHERE PATTERN_ID IN (
          SELECT PAYLOAD:pattern_id::STRING FROM {items}
          WHERE LEARNING_JOB_ID={q(job_id)}
        )
          AND STATUS='active'
          AND VALIDATION_STATUS IN ('extracted','enriched','accepted')
          AND COALESCE(CONTRADICTION_COUNT,0)=0
          AND COALESCE(CONFIDENCE,0)>=0.55
        """
    ).collect()
    session.sql(
        f"""
        UPDATE {inferences} i
        SET VALIDATION_STATUS='validated', UPDATED_AT=CURRENT_TIMESTAMP()
        FROM {fir} f
        WHERE i.INFERENCE_ID=f.INFERENCE_ID
          AND f.FEEDBACK_PAYLOAD:sql_asset_id::STRING={q(asset_id)}
          AND i.STATUS='active'
          AND COALESCE(LOWER(i.VALIDATION_STATUS),'unvalidated')
              IN ('unvalidated','extracted','enriched')
          AND COALESCE(i.CONFIDENCE,0)>=0.55
          AND COALESCE(ARRAY_SIZE(i.EVIDENCE_IDS),0)>0
          AND COALESCE(ARRAY_SIZE(i.CONTRADICTIONS),0)=0
        """
    ).collect()
    session.sql(
        f"""
        UPDATE {recommendations} r
        SET VALIDATION_STATUS='validated', UPDATED_AT=CURRENT_TIMESTAMP()
        FROM {fir} f
        WHERE r.FIR_RECORD_ID=f.FIR_RECORD_ID
          AND f.FEEDBACK_PAYLOAD:sql_asset_id::STRING={q(asset_id)}
          AND r.STATUS IN ('draft','active')
          AND COALESCE(LOWER(r.VALIDATION_STATUS),'unvalidated')
              IN ('unvalidated','extracted','enriched')
          AND COALESCE(r.CONFIDENCE,0)>=0.55
          AND COALESCE(ARRAY_SIZE(r.EVIDENCE_IDS),0)>0
          AND COALESCE(ARRAY_SIZE(r.ACTION_CONTRACT),0)>0
        """
    ).collect()

    promoted: list[str] = []
    curation = BundleCurationService(session, settings)
    version_rows = session.sql(
        f"""
        SELECT BUNDLE_VERSION_ID, WORKSPACE_CONTEXT_HASH, BASE_BUNDLE_HASH
        FROM {versions}
        WHERE SQL_ASSET_ID={q(asset_id)} AND STATUS='draft'
        """
    ).collect()
    for row in version_rows:
        data = row_dict(row)
        version_id = str(data["BUNDLE_VERSION_ID"])
        try:
            curation.promote(
                version_id,
                BundleCurationPromotionRequest(
                    expected_workspace_hash=str(
                        data.get("WORKSPACE_CONTEXT_HASH") or ""
                    ),
                    expected_bundle_hash=str(data.get("BASE_BUNDLE_HASH") or ""),
                    approve_all_validated=True,
                    confirmed=True,
                ),
                actor_id=actor,
            )
            promoted.append(version_id)
        except BundleCurationError as exc:
            print(f"Bundle {version_id} remains draft: {exc}", file=sys.stderr)

    counts = row_dict(
        session.sql(
            f"""
            SELECT
              (SELECT COUNT(*) FROM {patterns}
               WHERE PATTERN_ID IN (
                 SELECT PAYLOAD:pattern_id::STRING FROM {items}
                 WHERE LEARNING_JOB_ID={q(job_id)}
               ) AND VALIDATION_STATUS='validated') AS APPROVED_PATTERNS,
              (SELECT COUNT(*) FROM {inferences} i JOIN {fir} f
                 ON i.INFERENCE_ID=f.INFERENCE_ID
               WHERE f.FEEDBACK_PAYLOAD:sql_asset_id::STRING={q(asset_id)}
                 AND i.VALIDATION_STATUS='validated') AS APPROVED_INFERENCES,
              (SELECT COUNT(*) FROM {recommendations} r JOIN {fir} f
                 ON r.FIR_RECORD_ID=f.FIR_RECORD_ID
               WHERE f.FEEDBACK_PAYLOAD:sql_asset_id::STRING={q(asset_id)}
                 AND r.VALIDATION_STATUS IN ('validated','promoted'))
                 AS APPROVED_RECOMMENDATIONS
            """
        ).collect()[0]
    )
    return {
        "job_id": job_id,
        "asset_id": asset_id,
        **{key.lower(): int(value or 0) for key, value in counts.items()},
        "promoted_bundle_version_ids": promoted,
    }


def print_json(value: Any) -> None:
    print(json.dumps(value, indent=2, default=str))


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        description=(
            "Manage durable FIR SQL learning directly through Snowflake. "
            "Scheduled tasks are optional when process/workflow is used."
        )
    )
    root.add_argument("--env-file", default=str(DEFAULT_ENV))
    commands = root.add_subparsers(dest="command", required=True)

    upload_cmd = commands.add_parser("upload", help="Store SQL and create a learning job.")
    upload_cmd.add_argument("--file", required=True)
    upload_cmd.add_argument("--project-id", required=True)
    upload_cmd.add_argument("--target-table", required=True)
    upload_cmd.add_argument("--source-table", action="append", default=[])

    status_cmd = commands.add_parser("status", help="Show job and work-item details.")
    status_cmd.add_argument("--job-id", required=True)

    list_cmd = commands.add_parser("list", help="List recent learning jobs.")
    list_cmd.add_argument("--project-id")
    list_cmd.add_argument("--asset-id")
    list_cmd.add_argument("--limit", type=int, default=20)

    process_cmd = commands.add_parser(
        "process", help="Drive a job without scheduled Snowflake tasks."
    )
    process_cmd.add_argument("--job-id", required=True)
    process_cmd.add_argument("--max-rounds", type=int, default=20)

    watch_cmd = commands.add_parser("watch", help="Monitor a job until terminal.")
    watch_cmd.add_argument("--job-id", required=True)
    watch_cmd.add_argument("--interval", type=int, default=15)
    watch_cmd.add_argument("--timeout", type=int, default=3600)
    watch_cmd.add_argument(
        "--drive", action="store_true", help="Process one batch each interval."
    )

    approve_cmd = commands.add_parser(
        "approve", help="Approve supported output from a completed job."
    )
    approve_cmd.add_argument("--job-id", required=True)
    approve_cmd.add_argument("--yes", action="store_true")
    approve_cmd.add_argument("--actor", default="client_fir_learning_cli")

    workflow_cmd = commands.add_parser(
        "workflow", help="Upload, process to completion, and optionally approve."
    )
    workflow_cmd.add_argument("--file", required=True)
    workflow_cmd.add_argument("--project-id", required=True)
    workflow_cmd.add_argument("--target-table", required=True)
    workflow_cmd.add_argument("--source-table", action="append", default=[])
    workflow_cmd.add_argument("--max-rounds", type=int, default=20)
    workflow_cmd.add_argument("--approve", action="store_true")
    workflow_cmd.add_argument("--actor", default="client_fir_learning_cli")
    return root


def main() -> int:
    args = parser().parse_args()
    settings, client = settings_and_client(args.env_file)
    session = client.session
    service = TargetMappingPatternService(session, settings)

    if args.command in {"upload", "workflow"}:
        result = upload(
            settings=settings,
            client=client,
            sql_file=args.file,
            project_id=args.project_id,
            target=args.target_table,
            sources=args.source_table,
        )
        print_json(result)
        if args.command == "upload":
            return 0
        details = process_job(
            session=session,
            settings=settings,
            job_id=result["learning_job_id"],
            max_rounds=args.max_rounds,
        )
        print_json(details)
        if args.approve:
            print_json(
                approve_job(
                    session=session,
                    settings=settings,
                    job_id=result["learning_job_id"],
                    actor=args.actor,
                )
            )
        return 0
    if args.command == "status":
        print_json(job_details(session, settings, args.job_id))
        return 0
    if args.command == "list":
        jobs = service.list_jobs(
            asset_id=args.asset_id,
            project_id=args.project_id,
            statuses=[],
            limit=args.limit,
        )
        print_json([job.model_dump(mode="json") for job in jobs])
        return 0
    if args.command == "process":
        print_json(
            process_job(
                session=session,
                settings=settings,
                job_id=args.job_id,
                max_rounds=args.max_rounds,
            )
        )
        return 0
    if args.command == "watch":
        started = time.monotonic()
        while True:
            if args.drive:
                service.process_learning_job(
                    args.job_id,
                    worker_id="client-fir-learning-watch",
                    max_items=settings.fir_agent_max_patterns_per_batch,
                )
            details = job_details(session, settings, args.job_id)
            job = details["job"]
            print(
                f"{job.get('status')} | {job.get('stage')} | "
                f"{job.get('progress', 0):.1f}%"
            )
            if str(job.get("status") or "").lower() in TERMINAL:
                print_json(details)
                return 0 if str(job.get("status")).lower() == "completed" else 2
            if time.monotonic() - started >= args.timeout:
                print_json(details)
                return 3
            time.sleep(max(1, args.interval))
    if args.command == "approve":
        if not args.yes:
            raise ValueError("Approval is a write operation; repeat with --yes.")
        print_json(
            approve_job(
                session=session,
                settings=settings,
                job_id=args.job_id,
                actor=args.actor,
            )
        )
        return 0
    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
