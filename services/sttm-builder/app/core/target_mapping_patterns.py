from __future__ import annotations

import hashlib
import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from snowflake.snowpark import Session

from app.core.config import Settings
from app.schema.fir_patterns import (
    FIRLearningJobResponse,
    TargetMappingPatternCandidate,
    TargetMappingPatternV2,
)

_PLACEHOLDER = re.compile(r"^\$[A-Za-z_][A-Za-z0-9_]*$")
_LITERAL = re.compile(
    r"^\s*(?:'[^']*'|\"[^\"]*\"|-?\d+(?:\.\d+)?|TRUE|FALSE|NULL)\s*$",
    re.IGNORECASE,
)
logger = logging.getLogger(__name__)


class _FIRWorkDeferred(RuntimeError):
    """Work remains queued because a feature or daily budget gate is closed."""


def _stable_hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    ).hexdigest()


def _semantic_role(name: str) -> str:
    raw = str(name or "").split(".")[-1].upper()
    if raw.endswith("__C"):
        raw = raw[:-3]
    normalized = re.sub(r"[^A-Z0-9]+", "_", raw).strip("_")
    for suffix in ("_ID", "_CODE", "_DATE", "_NAME", "_STATUS"):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)]
    return normalized


def _split_sources(value: Any) -> list[str]:
    if isinstance(value, list):
        raw = value
    elif value in (None, ""):
        raw = []
    else:
        raw = re.split(r"\s*,\s*|\s*;\s*", str(value))
    return sorted({str(item).strip() for item in raw if str(item).strip()})


def _vendor_family_from_sources(source_tables: Iterable[str]) -> str | None:
    joined = " ".join(str(item).upper() for item in source_tables)
    known_families = {
        "REDTAIL": ("REDTAIL",),
        "EVERNEST": ("EVERNEST",),
        "SALESFORCE": ("SALESFORCE", "SFDC"),
        "WEALTHBOX": ("WEALTHBOX",),
        "ADDEPAR": ("ADDEPAR",),
        "ORION": ("ORION",),
        "TAMARAC": ("TAMARAC",),
    }
    for family, markers in known_families.items():
        if any(marker in joined for marker in markers):
            return family
    return None


def _type_family(value: Any) -> str:
    normalized = str(value or "").upper()
    if any(marker in normalized for marker in ("CHAR", "TEXT", "STRING")):
        return "string"
    if any(marker in normalized for marker in ("NUMBER", "DECIMAL", "INT", "FLOAT", "DOUBLE")):
        return "number"
    if "TIMESTAMP" in normalized:
        return "timestamp"
    if "DATE" in normalized:
        return "date"
    if "BOOL" in normalized:
        return "boolean"
    return normalized


class TargetMappingPatternService:
    """Content-addressed target-column learning with guarded transfer ranking."""

    def __init__(self, session: Session, settings: Settings) -> None:
        self._session = session
        self._settings = settings
        self._patterns_table = settings.qualify_table_name(
            settings.snowflake_target_mapping_patterns_table
        )
        self._jobs_table = settings.qualify_table_name(
            settings.snowflake_fir_learning_jobs_table
        )
        self._items_table = settings.qualify_table_name(
            settings.snowflake_fir_learning_work_items_table
        )
        qualify_metadata = getattr(
            settings,
            "qualify_metadata_object_name",
            settings.qualify_table_name,
        )
        self._observability_table = qualify_metadata(
            "TBL_FIR_RUN_OBSERVABILITY"
        )

    @staticmethod
    def _quote(value: Any) -> str:
        return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"

    def extract_document_patterns(
        self,
        *,
        asset_id: str,
        project_id: str,
        parsed_document: dict[str, Any],
        evidence_class: str,
        base_confidence: float,
    ) -> list[TargetMappingPatternV2]:
        source_tables = _split_sources(
            parsed_document.get("source_tables")
            or parsed_document.get("source_datasets")
        )
        default_target = str(
            parsed_document.get("target_table")
            or next(iter(parsed_document.get("target_tables") or []), "")
        )
        joins = [
            item
            for item in parsed_document.get("join_patterns") or []
            if isinstance(item, dict)
        ]
        ctes = [
            item
            for item in parsed_document.get("ctes") or []
            if isinstance(item, dict)
        ]
        query_shape = [
            item
            for item in parsed_document.get("business_rules") or []
            if isinstance(item, dict)
        ]
        patterns: list[TargetMappingPatternV2] = []
        for index, row in enumerate(parsed_document.get("column_mappings") or []):
            if not isinstance(row, dict):
                continue
            target_column = str(
                row.get("target_alias")
                or row.get("target_field")
                or row.get("target_column")
                or ""
            ).strip()
            target_table = str(row.get("target_table") or default_target).strip()
            if not target_column:
                continue
            logical_source_columns = _split_sources(
                row.get("source_columns")
                or row.get("source_field")
                or row.get("source_column")
            )
            physical_source_columns = _split_sources(
                row.get("physical_source_columns")
            )
            source_columns = physical_source_columns or logical_source_columns
            mapping_source_tables = sorted(
                {
                    column.rsplit(".", 1)[0]
                    for column in physical_source_columns
                    if "." in column
                }
            )
            source_dataset = str(
                row.get("source_dataset") or row.get("source_table") or ""
            ).strip()
            if source_dataset and source_dataset not in source_tables:
                source_tables = sorted({*source_tables, source_dataset})
            expression = str(
                row.get("transformation")
                or row.get("preprocessing_rule")
                or row.get("expression")
                or ""
            ).strip()
            constant = row.get("constant_value")
            mapping_mode = str(row.get("mapping_mode") or "").lower()
            if constant is not None or (
                expression and _PLACEHOLDER.match(expression)
            ):
                mapping_mode = "value"
            elif expression and any(
                marker in expression.upper()
                for marker in ("CASE ", "COALESCE(", "CONCAT", "||", "CAST(")
            ):
                mapping_mode = "complex"
            elif not mapping_mode:
                mapping_mode = "direct"

            # Client/project-specific literals may be evidence, but they are
            # never promoted as client-wide reusable values.
            placeholder = (
                str(constant)
                if constant is not None and _PLACEHOLDER.match(str(constant))
                else expression
                if _PLACEHOLDER.match(expression)
                else None
            )
            has_project_literal = bool(
                constant is not None
                and placeholder is None
                and _LITERAL.match(str(constant))
            )
            scope = "project" if has_project_literal else "client"
            recipe = {
                "mode": mapping_mode,
                "source_dependencies": source_columns,
                "logical_source_dependencies": logical_source_columns,
                "expression": expression if not has_project_literal else None,
                "expression_fingerprint": _stable_hash(expression) if expression else None,
                "placeholder": placeholder,
                "has_project_specific_literal": has_project_literal,
                "natural_language_rule": row.get("field_definition"),
                "target_type": row.get("target_data_type"),
                "processing_order": row.get("processing_order"),
                "depends_on": row.get("depends_on"),
            }
            target_contract = {
                "target_fqn": target_table,
                "target_column": target_column,
                "business_meaning": row.get("field_definition"),
                "semantic_role": _semantic_role(target_column),
                "type": row.get("target_data_type"),
                "grain": row.get("grain"),
                "nullability": row.get("nullability"),
                "synonyms": row.get("synonyms") or [],
                "domain": row.get("domain"),
            }
            source_profile = {
                "vendor_family": parsed_document.get("source_system")
                or parsed_document.get("crm_family"),
                "source_tables": mapping_source_tables or source_tables,
                "entity_meaning": parsed_document.get("entity_meaning"),
                "source_columns": [
                    {
                        "physical_name": column,
                        "semantic_role": _semantic_role(column),
                        "type": None,
                        "grain": None,
                    }
                    for column in source_columns
                ],
            }
            signature = _stable_hash(
                {
                    "target_role": target_contract["semantic_role"],
                    "source_roles": sorted(
                        item["semantic_role"]
                        for item in source_profile["source_columns"]
                    ),
                    "mode": mapping_mode,
                }
            )
            identity = {
                "asset_id": asset_id,
                "target_table": target_table.upper(),
                "target_column": target_column.upper(),
                "index": index,
                "recipe": recipe,
            }
            content_hash = _stable_hash(identity)
            lineage_text = json.dumps(
                row.get("lineage_path") or [],
                default=str,
            ).upper()
            mapping_ctes = [
                cte
                for cte in ctes
                if str(cte.get("name") or "").upper() in lineage_text
            ]
            dependency_tokens = {
                token.upper()
                for token in [
                    *source_columns,
                    *(mapping_source_tables or []),
                ]
                if token
            }
            mapping_joins = [
                join
                for join in joins
                if any(
                    token in json.dumps(join, default=str).upper()
                    for token in dependency_tokens
                )
            ]
            patterns.append(
                TargetMappingPatternV2(
                    pattern_id=f"tmp_{content_hash[:24]}",
                    scope=scope,
                    project_id=project_id,
                    target_contract=target_contract,
                    source_system_profile=source_profile,
                    source_compatibility_signature=signature,
                    mapping_recipe=recipe,
                    relationship_dependencies=mapping_joins,
                    derived_dependencies=mapping_ctes,
                    query_shaping_dependencies=query_shape,
                    business_rationale=row.get("field_definition"),
                    applicability_conditions=[],
                    exclusions=(
                        ["Do not reuse the project-specific literal."]
                        if has_project_literal
                        else []
                    ),
                    confidence=base_confidence,
                    validation_status="extracted",
                    provenance={
                        "asset_id": asset_id,
                        "evidence_class": evidence_class,
                        "source": "deterministic_document_extraction",
                        "row_index": index,
                    },
                    evidence_ids=[asset_id],
                    content_hash=content_hash,
                )
            )
        return patterns

    def upsert_patterns(
        self, patterns: Iterable[TargetMappingPatternV2]
    ) -> int:
        count = 0
        for pattern in patterns:
            payload = pattern.model_dump(mode="json")
            self._session.sql(
                f"""
                MERGE INTO {self._patterns_table} target
                USING (
                    SELECT
                        {self._quote(pattern.pattern_id)} AS PATTERN_ID,
                        {self._quote(pattern.content_hash)} AS CONTENT_HASH,
                        {self._quote(pattern.scope)} AS SCOPE,
                        {self._quote(pattern.project_id or '')} AS PROJECT_ID,
                        {self._quote(pattern.sttm_id or '')} AS STTM_ID,
                        {self._quote(str(pattern.target_contract.get('target_fqn') or ''))} AS TARGET_TABLE,
                        {self._quote(str(pattern.target_contract.get('target_column') or ''))} AS TARGET_COLUMN,
                        PARSE_JSON({self._quote(json.dumps(payload, default=str))}) AS PATTERN_PAYLOAD,
                        {float(pattern.confidence)} AS CONFIDENCE,
                        {self._quote(pattern.validation_status)} AS VALIDATION_STATUS
                ) source
                ON target.CONTENT_HASH = source.CONTENT_HASH
                WHEN MATCHED THEN UPDATE SET
                    CONFIDENCE = GREATEST(target.CONFIDENCE, source.CONFIDENCE),
                    SUPPORT_COUNT = target.SUPPORT_COUNT + 1,
                    VALIDATION_STATUS = CASE
                        WHEN source.PATTERN_PAYLOAD:provenance:evidence_class::STRING
                             = 'explicit_user_correction'
                            THEN 'validated'
                        WHEN source.VALIDATION_STATUS = 'published'
                            THEN 'published'
                        WHEN source.VALIDATION_STATUS = 'validated'
                             AND target.VALIDATION_STATUS NOT IN ('published')
                            THEN 'validated'
                        WHEN source.VALIDATION_STATUS = 'accepted'
                             AND target.VALIDATION_STATUS IN ('extracted', 'enriched')
                            THEN 'accepted'
                        ELSE target.VALIDATION_STATUS
                    END,
                    PATTERN_PAYLOAD = CASE
                        WHEN source.PATTERN_PAYLOAD:provenance:evidence_class::STRING
                             = 'explicit_user_correction'
                            THEN source.PATTERN_PAYLOAD
                        WHEN source.CONFIDENCE >= target.CONFIDENCE
                            THEN source.PATTERN_PAYLOAD
                        ELSE target.PATTERN_PAYLOAD
                    END,
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT (
                    PATTERN_ID, CONTENT_HASH, SCOPE, PROJECT_ID, STTM_ID,
                    TARGET_TABLE, TARGET_COLUMN, PATTERN_PAYLOAD, CONFIDENCE,
                    SUPPORT_COUNT, CONTRADICTION_COUNT, VALIDATION_STATUS,
                    STATUS, CREATED_AT, UPDATED_AT
                ) VALUES (
                    source.PATTERN_ID, source.CONTENT_HASH, source.SCOPE,
                    NULLIF(source.PROJECT_ID, ''), NULLIF(source.STTM_ID, ''),
                    source.TARGET_TABLE, source.TARGET_COLUMN,
                    source.PATTERN_PAYLOAD, source.CONFIDENCE,
                    1, 0, source.VALIDATION_STATUS,
                    'active', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
                )
                """
            ).collect()
            count += 1
        if count:
            # Same-replica readers must not retain an older target-column
            # pattern set. Cross-replica prepared contexts are versioned by the
            # durable FIR epoch resolved from this table.
            from app.core.learning_retrieval import invalidate_learning_context_cache
            from app.core.prepared_context import (
                invalidate_prepared_workspace_context_cache,
            )

            invalidate_learning_context_cache()
            invalidate_prepared_workspace_context_cache()
        return count

    def record_correction(
        self,
        *,
        original_pattern_id: str,
        corrected_pattern: dict[str, Any],
        actor: str,
        reason: str | None,
        evidence_ids: list[str],
    ) -> TargetMappingPatternV2:
        rows = self._session.sql(
            f"""
            SELECT PATTERN_PAYLOAD
            FROM {self._patterns_table}
            WHERE PATTERN_ID = {self._quote(original_pattern_id)}
            LIMIT 1
            """
        ).collect()
        if not rows:
            raise ValueError("Target mapping pattern not found")
        original = rows[0].as_dict().get("PATTERN_PAYLOAD")
        if isinstance(original, str):
            original = json.loads(original)
        if not isinstance(original, dict):
            raise ValueError("Target mapping pattern has invalid payload")
        merged = {**original, **corrected_pattern}
        merged["pattern_id"] = f"tmp_{uuid.uuid4().hex[:24]}"
        merged["validation_status"] = "validated"
        merged["confidence"] = max(float(merged.get("confidence") or 0.0), 0.99)
        merged["provenance"] = {
            **(
                merged.get("provenance")
                if isinstance(merged.get("provenance"), dict)
                else {}
            ),
            "evidence_class": "explicit_user_correction",
            "corrected_from": original_pattern_id,
            "actor": actor,
            "reason": reason,
        }
        merged["evidence_ids"] = sorted(
            {
                *(
                    str(item)
                    for item in merged.get("evidence_ids") or []
                    if item
                ),
                *(str(item) for item in evidence_ids if item),
                original_pattern_id,
            }
        )
        merged["superseded_by"] = None
        merged["content_hash"] = _stable_hash(
            {
                "corrected_from": original_pattern_id,
                "target_contract": merged.get("target_contract"),
                "source_system_profile": merged.get("source_system_profile"),
                "mapping_recipe": merged.get("mapping_recipe"),
                "relationship_dependencies": merged.get(
                    "relationship_dependencies"
                ),
                "derived_dependencies": merged.get("derived_dependencies"),
                "query_shaping_dependencies": merged.get(
                    "query_shaping_dependencies"
                ),
            }
        )
        corrected = TargetMappingPatternV2.model_validate(merged)
        self.upsert_patterns([corrected])
        self._session.sql(
            f"""
            UPDATE {self._patterns_table}
            SET STATUS = 'inactive',
                VALIDATION_STATUS = 'rejected',
                SUPERSEDED_BY = {self._quote(corrected.pattern_id)},
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE PATTERN_ID = {self._quote(original_pattern_id)}
            """
        ).collect()
        return corrected

    def create_learning_job(
        self,
        *,
        asset_id: str,
        project_id: str,
        patterns: list[TargetMappingPatternV2],
    ) -> FIRLearningJobResponse:
        # A re-upload of identical evidence must resume the same durable job,
        # not create another enrichment pass. Pattern content hashes include
        # target identity, source evidence, and extraction semantics.
        extraction_version = "2"
        job_hash = _stable_hash(
            {
                "asset_id": asset_id,
                "project_id": project_id,
                "extraction_version": extraction_version,
                "pattern_content_hashes": sorted(
                    pattern.content_hash for pattern in patterns
                ),
            }
        )
        job_id = f"firjob_{job_hash[:32]}"
        self._session.sql(
            f"""
            MERGE INTO {self._jobs_table} target
            USING (
                SELECT
                    {self._quote(job_id)} AS LEARNING_JOB_ID,
                    {self._quote(asset_id)} AS ASSET_ID,
                    {self._quote(project_id)} AS PROJECT_ID
            ) source
            ON target.LEARNING_JOB_ID = source.LEARNING_JOB_ID
            WHEN NOT MATCHED THEN INSERT (
                LEARNING_JOB_ID, ASSET_ID, PROJECT_ID, STATUS, STAGE,
                DISCOVERED_PATTERN_COUNT, COMPLETED_PATTERN_COUNT,
                FAILED_PATTERN_COUNT, CHECKPOINT, CREATED_AT, UPDATED_AT
            ) VALUES (
                source.LEARNING_JOB_ID, source.ASSET_ID, source.PROJECT_ID,
                'running', 'target_row_extraction', {len(patterns)}, 0, 0,
                OBJECT_CONSTRUCT(
                    'extraction_version', {self._quote(extraction_version)},
                    'asset_id', source.ASSET_ID
                ),
                CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
            )
            """
        ).collect()
        items: list[tuple[str, str, dict[str, Any]]] = [
            ("document_parse", asset_id, {"asset_id": asset_id}),
            *[
                (
                    "semantic_enrichment",
                    pattern.pattern_id,
                    {
                        "pattern_id": pattern.pattern_id,
                        "content_hash": pattern.content_hash,
                    },
                )
                for pattern in patterns
            ],
            (
                "agent_semantic_enrichment",
                asset_id,
                {"asset_id": asset_id, "pattern_count": len(patterns)},
            ),
            (
                "pattern_conflict_analysis",
                asset_id,
                {"asset_id": asset_id, "pattern_count": len(patterns)},
            ),
            (
                "recommendation_generation",
                asset_id,
                {"asset_id": asset_id, "pattern_count": len(patterns)},
            ),
            (
                "search_index_promotion",
                asset_id,
                {"asset_id": asset_id, "pattern_count": len(patterns)},
            ),
        ]
        for item_type, identity, payload in items:
            item_hash = _stable_hash(
                {
                    "job": job_id,
                    "type": item_type,
                    "identity": identity,
                    "version": extraction_version,
                }
            )
            initial_status = (
                "completed"
                if item_type in {"document_parse"}
                else "pending"
            )
            self._session.sql(
                f"""
                MERGE INTO {self._items_table} target
                USING (
                    SELECT
                        {self._quote(f'firitem_{item_hash[:24]}')} AS WORK_ITEM_ID,
                        {self._quote(job_id)} AS LEARNING_JOB_ID,
                        {self._quote(item_type)} AS WORK_ITEM_TYPE,
                        {self._quote(item_hash)} AS IDEMPOTENCY_KEY,
                        PARSE_JSON({self._quote(json.dumps(payload))}) AS PAYLOAD,
                        {self._quote(initial_status)} AS STATUS
                ) source
                ON target.IDEMPOTENCY_KEY = source.IDEMPOTENCY_KEY
                WHEN NOT MATCHED THEN INSERT (
                    WORK_ITEM_ID, LEARNING_JOB_ID, WORK_ITEM_TYPE,
                    IDEMPOTENCY_KEY, PAYLOAD, STATUS, ATTEMPT_COUNT,
                    CREATED_AT, UPDATED_AT
                ) VALUES (
                    source.WORK_ITEM_ID, source.LEARNING_JOB_ID,
                    source.WORK_ITEM_TYPE, source.IDEMPOTENCY_KEY,
                    source.PAYLOAD, source.STATUS, 0,
                    CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
                )
                """
            ).collect()
        existing = self.get_job(job_id)
        if existing is not None:
            return existing
        return FIRLearningJobResponse(
            learning_job_id=job_id,
            status="running",
            asset_id=asset_id,
            project_id=project_id,
            discovered_pattern_count=len(patterns),
            completed_pattern_count=0,
            stage="semantic_enrichment",
            progress=0.0 if patterns else 1.0,
        )

    def process_learning_job(
        self,
        job_id: str,
        *,
        worker_id: str | None = None,
        max_items: int | None = None,
    ) -> FIRLearningJobResponse:
        """Process a bounded, resumable FIR batch.

        Every work item is leased and idempotent. A replica or task may stop
        after any item; the next invocation resumes pending or expired leases.
        Deterministic target extraction has already been persisted before this
        method runs, so a Cortex timeout cannot lose per-column evidence.
        """
        worker = worker_id or f"fir-worker-{uuid.uuid4().hex[:12]}"
        limit = max(
            1,
            min(
                int(max_items or self._settings.fir_agent_max_patterns_per_batch),
                int(self._settings.fir_agent_max_patterns_per_batch),
            ),
        )
        started_at = time.monotonic()
        job = self.get_job(job_id)
        if job is None:
            raise ValueError(f"FIR learning job {job_id} was not found")
        if not self._settings.fir_pipeline_enabled:
            raise RuntimeError("The FIR pipeline is disabled.")
        if job.status == "paused":
            return job
        if job.status in {"completed", "failed"}:
            return job

        rows = self._session.sql(
            f"""
            SELECT WORK_ITEM_ID, WORK_ITEM_TYPE, PAYLOAD, ATTEMPT_COUNT
            FROM {self._items_table}
            WHERE LEARNING_JOB_ID = {self._quote(job_id)}
              AND (
                    STATUS = 'pending'
                    OR (
                        STATUS = 'running'
                        AND LEASE_EXPIRES_AT < CURRENT_TIMESTAMP()
                    )
                  )
            ORDER BY
                CASE WORK_ITEM_TYPE
                    WHEN 'semantic_enrichment' THEN 1
                    WHEN 'agent_semantic_enrichment' THEN 2
                    WHEN 'pattern_conflict_analysis' THEN 3
                    WHEN 'recommendation_generation' THEN 4
                    WHEN 'search_index_promotion' THEN 5
                    ELSE 6
                END,
                CREATED_AT
            LIMIT {limit}
            """
        ).collect()
        for row in rows:
            if time.monotonic() - started_at >= self._settings.fir_job_max_runtime_seconds:
                break
            data = row.as_dict()
            item_id = str(data.get("WORK_ITEM_ID") or "")
            item_type = str(data.get("WORK_ITEM_TYPE") or "")
            payload = data.get("PAYLOAD")
            if isinstance(payload, str):
                payload = json.loads(payload)
            if not isinstance(payload, dict):
                payload = {}
            attempts = int(data.get("ATTEMPT_COUNT") or 0)
            self._session.sql(
                f"""
                UPDATE {self._items_table}
                SET STATUS = 'running',
                    LEASE_OWNER = {self._quote(worker)},
                    LEASE_EXPIRES_AT = DATEADD(
                        second,
                        {int(self._settings.fir_agent_request_timeout_seconds) + 30},
                        CURRENT_TIMESTAMP()
                    ),
                    ATTEMPT_COUNT = ATTEMPT_COUNT + 1,
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE WORK_ITEM_ID = {self._quote(item_id)}
                  AND (
                        STATUS = 'pending'
                        OR (
                            STATUS = 'running'
                            AND LEASE_EXPIRES_AT < CURRENT_TIMESTAMP()
                        )
                      )
                """
            ).collect()
            lease_rows = self._session.sql(
                f"""
                SELECT LEASE_OWNER, STATUS
                FROM {self._items_table}
                WHERE WORK_ITEM_ID = {self._quote(item_id)}
                LIMIT 1
                """
            ).collect()
            if (
                not lease_rows
                or str(lease_rows[0].as_dict().get("LEASE_OWNER") or "") != worker
                or str(lease_rows[0].as_dict().get("STATUS") or "") != "running"
            ):
                continue
            try:
                result = self._process_work_item(item_type, payload)
                self._session.sql(
                    f"""
                    UPDATE {self._items_table}
                    SET STATUS = 'completed',
                        RESULT = PARSE_JSON({self._quote(json.dumps(result, default=str))}),
                        ERROR = NULL,
                        LEASE_OWNER = NULL,
                        LEASE_EXPIRES_AT = NULL,
                        COMPLETED_AT = CURRENT_TIMESTAMP(),
                        UPDATED_AT = CURRENT_TIMESTAMP()
                    WHERE WORK_ITEM_ID = {self._quote(item_id)}
                      AND LEASE_OWNER = {self._quote(worker)}
                    """
                ).collect()
            except _FIRWorkDeferred as exc:
                self._session.sql(
                    f"""
                    UPDATE {self._items_table}
                    SET STATUS = 'pending',
                        ATTEMPT_COUNT = GREATEST(ATTEMPT_COUNT - 1, 0),
                        ERROR = PARSE_JSON({self._quote(json.dumps({
                            'message': str(exc),
                            'category': 'deferred',
                            'action': 'The work remains queued for the next catch-up.'
                        }))}),
                        LEASE_OWNER = NULL,
                        LEASE_EXPIRES_AT = NULL,
                        UPDATED_AT = CURRENT_TIMESTAMP()
                    WHERE WORK_ITEM_ID = {self._quote(item_id)}
                      AND LEASE_OWNER = {self._quote(worker)}
                    """
                ).collect()
                break
            except Exception as exc:
                retry = self._is_transient_failure(exc) and (
                    (attempts + 1) < int(self._settings.fir_agent_retry_limit)
                )
                error_payload = {
                    "message": str(exc),
                    "category": "transient" if retry else "permanent",
                    "work_item_type": item_type,
                    "attempt_count": attempts + 1,
                    "action": (
                        "The item remains queued for a bounded retry."
                        if retry
                        else "Correct the payload or dependency, then use the admin retry action."
                    ),
                }
                logger.exception(
                    "FIR work item failed: job=%s item=%s type=%s retry=%s",
                    job_id,
                    item_id,
                    item_type,
                    retry,
                )
                self._session.sql(
                    f"""
                    UPDATE {self._items_table}
                    SET STATUS = {self._quote('pending' if retry else 'dead_letter')},
                        ERROR = PARSE_JSON({self._quote(json.dumps(error_payload))}),
                        LEASE_OWNER = NULL,
                        LEASE_EXPIRES_AT = NULL,
                        UPDATED_AT = CURRENT_TIMESTAMP()
                    WHERE WORK_ITEM_ID = {self._quote(item_id)}
                      AND LEASE_OWNER = {self._quote(worker)}
                    """
                ).collect()
        return self._refresh_job(job_id)

    @staticmethod
    def _is_transient_failure(exc: Exception) -> bool:
        if isinstance(exc, (TimeoutError, ConnectionError)):
            return True
        message = str(exc).lower()
        return any(
            marker in message
            for marker in (
                "timeout",
                "temporarily unavailable",
                "connection reset",
                "connection aborted",
                "rate limit",
                "too many requests",
                "warehouse is suspended",
                "lock timeout",
            )
        )

    def _process_work_item(
        self, item_type: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        if item_type == "semantic_enrichment":
            pattern_id = str(payload.get("pattern_id") or "")
            rows = self._session.sql(
                f"""
                SELECT PATTERN_PAYLOAD
                FROM {self._patterns_table}
                WHERE PATTERN_ID = {self._quote(pattern_id)}
                LIMIT 1
                """
            ).collect()
            if not rows:
                raise ValueError(f"Target mapping pattern {pattern_id} was not found")
            pattern_payload = rows[0].as_dict().get("PATTERN_PAYLOAD")
            if isinstance(pattern_payload, str):
                pattern_payload = json.loads(pattern_payload)
            if not isinstance(pattern_payload, dict):
                raise ValueError(f"Target mapping pattern {pattern_id} has invalid payload")
            target = pattern_payload.get("target_contract") or {}
            recipe = pattern_payload.get("mapping_recipe") or {}
            source_profile = pattern_payload.get("source_system_profile") or {}
            target_label = str(
                target.get("business_meaning")
                or target.get("semantic_role")
                or target.get("target_column")
                or "the target attribute"
            )
            source_roles = [
                str(item.get("semantic_role") or item.get("physical_name") or "")
                for item in source_profile.get("source_columns") or []
                if isinstance(item, dict)
            ]
            if not pattern_payload.get("business_rationale"):
                pattern_payload["business_rationale"] = (
                    f"Populate {target_label} using "
                    + (
                        ", ".join(role for role in source_roles if role)
                        if source_roles
                        else "the compatible current source role"
                    )
                    + f" with a {recipe.get('mode') or 'direct'} mapping."
                )
            pattern_payload["applicability_conditions"] = sorted(
                {
                    *(
                        pattern_payload.get("applicability_conditions")
                        if isinstance(pattern_payload.get("applicability_conditions"), list)
                        else []
                    ),
                    "All required source roles must exist in the current relation graph.",
                    "Source type and target type must be compatible.",
                    "The mapping must pass compilation and validation before application.",
                }
            )
            pattern_payload["validation_status"] = "enriched"
            self._session.sql(
                f"""
                UPDATE {self._patterns_table}
                SET PATTERN_PAYLOAD = PARSE_JSON(
                        {self._quote(json.dumps(pattern_payload, default=str))}
                    ),
                    VALIDATION_STATUS = IFF(
                        VALIDATION_STATUS = 'extracted',
                        'enriched',
                        VALIDATION_STATUS
                    ),
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE PATTERN_ID = {self._quote(pattern_id)}
                """
            ).collect()
            return {"pattern_id": pattern_id, "status": "enriched"}

        if item_type == "agent_semantic_enrichment":
            if not self._settings.fir_agent_processing_enabled:
                raise _FIRWorkDeferred("FIR agent processing is disabled.")
            procedure = self._settings.qualify_metadata_object_name(
                "SP_FIR_INVOKE_AGENT"
            )
            response = self._session.call(
                procedure,
                {
                    "task_type": "document_learning",
                    "batch_size": self._settings.fir_agent_max_patterns_per_batch,
                    "daily_request_limit": self._settings.fir_agent_daily_request_limit,
                    "daily_token_limit": self._settings.fir_agent_daily_token_limit,
                    "max_concurrency": self._settings.fir_agent_max_concurrency,
                    "processing_options": {
                        "priority_asset_id": payload.get("asset_id"),
                        "target_row_count": payload.get("pattern_count"),
                        "collect_feedback": False,
                        "generate_inferences": True,
                        "create_semantic_versions": True,
                        "generate_recommendations": True,
                        "apply_decay": False,
                        "parse_documents": True,
                    },
                },
            )
            if isinstance(response, str):
                try:
                    response = json.loads(response)
                except json.JSONDecodeError:
                    response = {"status": "unknown", "response": response}
            status = str((response or {}).get("status") or "").lower()
            if status in {
                "budget_exhausted",
                "budget_ledger_unavailable",
                "concurrency_limit",
            }:
                raise _FIRWorkDeferred(
                    f"FIR agent work deferred: {status.replace('_', ' ')}."
                )
            if status not in {"success", "no_work"}:
                raise RuntimeError(
                    f"FIR agent enrichment failed with status {status or 'unknown'}."
                )
            return {
                "asset_id": payload.get("asset_id"),
                "status": "agent_enriched",
                "agent_result": response,
            }

        if item_type == "pattern_conflict_analysis":
            asset_id = str(payload.get("asset_id") or "")
            self._session.sql(
                f"""
                UPDATE {self._patterns_table} target
                SET CONTRADICTION_COUNT = conflicts.CONTRADICTION_COUNT,
                    UPDATED_AT = CURRENT_TIMESTAMP()
                FROM (
                    SELECT TARGET_TABLE, TARGET_COLUMN,
                           GREATEST(COUNT(DISTINCT CONTENT_HASH) - 1, 0)
                               AS CONTRADICTION_COUNT
                    FROM {self._patterns_table}
                    WHERE STATUS = 'active'
                    GROUP BY TARGET_TABLE, TARGET_COLUMN
                ) conflicts
                WHERE target.TARGET_TABLE = conflicts.TARGET_TABLE
                  AND target.TARGET_COLUMN = conflicts.TARGET_COLUMN
                """
            ).collect()
            return {"asset_id": asset_id, "status": "conflicts_analyzed"}

        if item_type == "recommendation_generation":
            return {
                "asset_id": payload.get("asset_id"),
                "status": "patterns_available_for_ranked_retrieval",
            }
        if item_type == "search_index_promotion":
            asset_id = str(payload.get("asset_id") or "")
            try:
                self._session.sql(
                    f"""
                    UPDATE {self._observability_table}
                    SET PATTERNS_PROMOTED = {int(payload.get('pattern_count') or 0)},
                        RESULT_VALIDATION_STATUS = 'promoted',
                        UPDATED_AT = CURRENT_TIMESTAMP()
                    WHERE RUN_ID = (
                        SELECT RUN_ID
                        FROM {self._observability_table}
                        WHERE ASSET_ID = {self._quote(asset_id)}
                        ORDER BY STARTED_AT DESC
                        LIMIT 1
                    )
                    """
                ).collect()
            except Exception:
                # A rolling deployment may not have the telemetry table yet.
                pass
            return {
                "asset_id": asset_id,
                "status": "content_addressed_patterns_promoted",
            }
        if item_type == "document_parse":
            return {"asset_id": payload.get("asset_id"), "status": "parsed"}
        raise ValueError(f"Unsupported FIR work item type: {item_type}")

    def _refresh_job(self, job_id: str) -> FIRLearningJobResponse:
        counts = self._session.sql(
            f"""
            SELECT
                COUNT_IF(WORK_ITEM_TYPE = 'semantic_enrichment') AS DISCOVERED,
                COUNT_IF(
                    WORK_ITEM_TYPE = 'semantic_enrichment'
                    AND STATUS = 'completed'
                ) AS COMPLETED,
                COUNT_IF(
                    WORK_ITEM_TYPE = 'semantic_enrichment'
                    AND STATUS = 'dead_letter'
                ) AS FAILED,
                COUNT_IF(STATUS IN ('pending', 'running')) AS REMAINING,
                COUNT_IF(STATUS = 'dead_letter') AS DEAD_LETTER
            FROM {self._items_table}
            WHERE LEARNING_JOB_ID = {self._quote(job_id)}
            """
        ).collect()[0].as_dict()
        discovered = int(counts.get("DISCOVERED") or 0)
        completed = int(counts.get("COMPLETED") or 0)
        failed = int(counts.get("FAILED") or 0)
        remaining = int(counts.get("REMAINING") or 0)
        dead_letter = int(counts.get("DEAD_LETTER") or 0)
        status = "running" if remaining else ("failed" if dead_letter else "completed")
        stage = "semantic_enrichment" if completed + failed < discovered else (
            "failed" if status == "failed" else "completed"
        )
        checkpoint = {
            "completed_patterns": completed,
            "failed_patterns": failed,
            "remaining_work_items": remaining,
        }
        self._session.sql(
            f"""
            UPDATE {self._jobs_table}
            SET STATUS = {self._quote(status)},
                STAGE = {self._quote(stage)},
                DISCOVERED_PATTERN_COUNT = {discovered},
                COMPLETED_PATTERN_COUNT = {completed},
                FAILED_PATTERN_COUNT = {failed},
                CHECKPOINT = PARSE_JSON({self._quote(json.dumps(checkpoint))}),
                COMPLETED_AT = IFF(
                    {self._quote(status)} IN ('completed', 'failed'),
                    CURRENT_TIMESTAMP(),
                    NULL
                ),
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE LEARNING_JOB_ID = {self._quote(job_id)}
            """
        ).collect()
        refreshed = self.get_job(job_id)
        if refreshed is None:
            raise ValueError(f"FIR learning job {job_id} disappeared during refresh")
        return refreshed

    def get_job(self, job_id: str) -> FIRLearningJobResponse | None:
        rows = self._session.sql(
            f"""
            SELECT LEARNING_JOB_ID, ASSET_ID, PROJECT_ID, STATUS, STAGE,
                   DISCOVERED_PATTERN_COUNT, COMPLETED_PATTERN_COUNT,
                   FAILED_PATTERN_COUNT
            FROM {self._jobs_table}
            WHERE LEARNING_JOB_ID = {self._quote(job_id)}
            LIMIT 1
            """
        ).collect()
        if not rows:
            return None
        data = rows[0].as_dict()
        discovered = int(data.get("DISCOVERED_PATTERN_COUNT") or 0)
        completed = int(data.get("COMPLETED_PATTERN_COUNT") or 0)
        failed = int(data.get("FAILED_PATTERN_COUNT") or 0)
        progress_rows = self._session.sql(
            f"""
            SELECT WORK_ITEM_TYPE, STATUS, PAYLOAD, ATTEMPT_COUNT
            FROM {self._items_table}
            WHERE LEARNING_JOB_ID = {self._quote(job_id)}
            ORDER BY CREATED_AT
            """
        ).collect()
        by_status: dict[str, int] = {}
        by_type: dict[str, dict[str, int]] = {}
        target_progress: list[dict[str, Any]] = []
        for progress_row in progress_rows:
            item = progress_row.as_dict()
            item_type = str(item.get("WORK_ITEM_TYPE") or "unknown")
            item_status = str(item.get("STATUS") or "unknown")
            by_status[item_status] = by_status.get(item_status, 0) + 1
            type_counts = by_type.setdefault(item_type, {})
            type_counts[item_status] = type_counts.get(item_status, 0) + 1
            if item_type != "semantic_enrichment":
                continue
            payload = item.get("PAYLOAD")
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except json.JSONDecodeError:
                    payload = {}
            pattern_id = str((payload or {}).get("pattern_id") or "")
            target_progress.append(
                {
                    "pattern_id": pattern_id,
                    "status": item_status,
                    "attempt_count": int(item.get("ATTEMPT_COUNT") or 0),
                }
            )
        if target_progress:
            pattern_ids = ", ".join(
                self._quote(item["pattern_id"])
                for item in target_progress
                if item["pattern_id"]
            )
            if pattern_ids:
                pattern_rows = self._session.sql(
                    f"""
                    SELECT PATTERN_ID, TARGET_TABLE, TARGET_COLUMN
                    FROM {self._patterns_table}
                    WHERE PATTERN_ID IN ({pattern_ids})
                    """
                ).collect()
                identities = {
                    str(item.as_dict().get("PATTERN_ID") or ""): item.as_dict()
                    for item in pattern_rows
                }
                for item in target_progress:
                    identity = identities.get(item["pattern_id"], {})
                    item["target_table"] = identity.get("TARGET_TABLE")
                    item["target_column"] = identity.get("TARGET_COLUMN")
        return FIRLearningJobResponse(
            learning_job_id=str(data.get("LEARNING_JOB_ID")),
            status=str(data.get("STATUS") or "unknown"),
            asset_id=data.get("ASSET_ID"),
            project_id=data.get("PROJECT_ID"),
            discovered_pattern_count=discovered,
            completed_pattern_count=completed,
            failed_pattern_count=failed,
            stage=data.get("STAGE"),
            progress=(completed + failed) / max(discovered, 1),
            work_items_by_status=by_status,
            work_items_by_type=by_type,
            target_column_progress=target_progress,
        )

    def list_jobs(
        self,
        *,
        asset_id: str | None = None,
        project_id: str | None = None,
        statuses: list[str] | None = None,
        limit: int = 100,
    ) -> list[FIRLearningJobResponse]:
        predicates = ["1=1"]
        if asset_id:
            predicates.append(f"ASSET_ID = {self._quote(asset_id)}")
        if project_id:
            predicates.append(f"PROJECT_ID = {self._quote(project_id)}")
        if statuses:
            values = ", ".join(self._quote(value) for value in statuses)
            predicates.append(f"STATUS IN ({values})")
        rows = self._session.sql(
            f"""
            SELECT LEARNING_JOB_ID
            FROM {self._jobs_table}
            WHERE {' AND '.join(predicates)}
            ORDER BY CREATED_AT DESC
            LIMIT {max(1, min(int(limit), 500))}
            """
        ).collect()
        return [
            job
            for row in rows
            if (
                job := self.get_job(
                    str(row.as_dict().get("LEARNING_JOB_ID") or "")
                )
            )
            is not None
        ]

    def pause_job(self, job_id: str) -> FIRLearningJobResponse:
        if self.get_job(job_id) is None:
            raise ValueError(f"FIR learning job {job_id} was not found")
        self._session.sql(
            f"""
            UPDATE {self._jobs_table}
            SET STATUS = 'paused', STAGE = 'paused', UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE LEARNING_JOB_ID = {self._quote(job_id)}
              AND STATUS NOT IN ('completed', 'failed')
            """
        ).collect()
        job = self.get_job(job_id)
        if job is None:
            raise ValueError(f"FIR learning job {job_id} was not found")
        return job

    def resume_job(self, job_id: str) -> FIRLearningJobResponse:
        job = self.get_job(job_id)
        if job is None:
            raise ValueError(f"FIR learning job {job_id} was not found")
        if job.status == "paused":
            self._session.sql(
                f"""
                UPDATE {self._jobs_table}
                SET STATUS = 'running', STAGE = 'semantic_enrichment',
                    COMPLETED_AT = NULL, UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE LEARNING_JOB_ID = {self._quote(job_id)}
                  AND STATUS = 'paused'
                """
            ).collect()
        refreshed = self.get_job(job_id)
        if refreshed is None:
            raise ValueError(f"FIR learning job {job_id} was not found")
        return refreshed

    def retry_dead_letters(
        self,
        job_id: str,
        *,
        work_item_id: str | None = None,
    ) -> FIRLearningJobResponse:
        if self.get_job(job_id) is None:
            raise ValueError(f"FIR learning job {job_id} was not found")
        item_predicate = (
            f"AND WORK_ITEM_ID = {self._quote(work_item_id)}"
            if work_item_id
            else ""
        )
        self._session.sql(
            f"""
            UPDATE {self._items_table}
            SET STATUS = 'pending', ATTEMPT_COUNT = 0, ERROR = NULL,
                LEASE_OWNER = NULL, LEASE_EXPIRES_AT = NULL,
                COMPLETED_AT = NULL, UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE LEARNING_JOB_ID = {self._quote(job_id)}
              AND STATUS = 'dead_letter'
              {item_predicate}
            """
        ).collect()
        self._session.sql(
            f"""
            UPDATE {self._jobs_table}
            SET STATUS = 'running', STAGE = 'semantic_enrichment',
                ERROR = NULL, COMPLETED_AT = NULL, UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE LEARNING_JOB_ID = {self._quote(job_id)}
            """
        ).collect()
        return self._refresh_job(job_id)

    def process_queue(
        self,
        *,
        worker_id: str,
        asset_id: str | None = None,
        max_jobs: int = 1,
        max_items_per_job: int | None = None,
    ) -> list[FIRLearningJobResponse]:
        jobs = self.list_jobs(
            asset_id=asset_id,
            statuses=["running"],
            limit=max(1, min(max_jobs, self._settings.fir_agent_max_assets_per_run)),
        )
        return [
            self.process_learning_job(
                job.learning_job_id,
                worker_id=worker_id,
                max_items=max_items_per_job,
            )
            for job in jobs
        ]

    def get_latest_job_for_asset(
        self, asset_id: str
    ) -> FIRLearningJobResponse | None:
        rows = self._session.sql(
            f"""
            SELECT LEARNING_JOB_ID
            FROM {self._jobs_table}
            WHERE ASSET_ID = {self._quote(asset_id)}
            ORDER BY CREATED_AT DESC
            LIMIT 1
            """
        ).collect()
        if not rows:
            return None
        return self.get_job(
            str(rows[0].as_dict().get("LEARNING_JOB_ID") or "")
        )

    def retrieve_candidates(
        self,
        *,
        target_table: str,
        target_columns: list[str],
        source_tables: list[str],
        source_columns: list[str] | None = None,
        source_column_profiles: list[dict[str, Any]] | None = None,
        crm_family: str | None = None,
        relationship_paths: list[str] | None = None,
        derived_outputs: list[str] | None = None,
        workspace_context_id: str | None = None,
        project_id: str | None = None,
        limit: int = 100,
    ) -> list[TargetMappingPatternCandidate]:
        predicates = [
            f"UPPER(TARGET_TABLE) = UPPER({self._quote(target_table)})",
            "STATUS = 'active'",
        ]
        if target_columns:
            values = ", ".join(
                self._quote(str(item).upper()) for item in target_columns
            )
            predicates.append(f"UPPER(TARGET_COLUMN) IN ({values})")
        if project_id:
            predicates.append(
                f"(SCOPE = 'client' OR PROJECT_ID = {self._quote(project_id)})"
            )
        if workspace_context_id:
            predicates.append(
                "(STTM_ID IS NULL OR "
                f"STTM_ID = {self._quote(workspace_context_id)})"
            )
        rows = self._session.sql(
            f"""
            SELECT PATTERN_PAYLOAD, SUPPORT_COUNT, CONTRADICTION_COUNT,
                   VALIDATION_STATUS, CONFIDENCE
            FROM {self._patterns_table}
            WHERE {' AND '.join(predicates)}
            ORDER BY
                CASE
                    WHEN PATTERN_PAYLOAD:provenance:evidence_class::STRING
                         = 'explicit_user_correction' THEN 1
                    WHEN VALIDATION_STATUS = 'published'
                      OR PATTERN_PAYLOAD:provenance:evidence_class::STRING
                         = 'published_mapping' THEN 2
                    WHEN PATTERN_PAYLOAD:provenance:evidence_class::STRING IN (
                            'validated_mapping',
                            'validated_imported_sql',
                            'validated_imported_workbook',
                            'historical_import'
                         ) THEN 3
                    WHEN PATTERN_PAYLOAD:provenance:evidence_class::STRING
                         = 'accepted_mapping_row'
                      OR VALIDATION_STATUS = 'accepted' THEN 4
                    WHEN PATTERN_PAYLOAD:provenance:evidence_class::STRING IN (
                            'unvalidated_authored_sql',
                            'unvalidated_authored_mapping_workbook'
                         ) THEN 5
                    WHEN PATTERN_PAYLOAD:provenance:evidence_class::STRING
                         = 'fir_inference' THEN 6
                    WHEN PATTERN_PAYLOAD:provenance:evidence_class::STRING
                         = 'semantic_role_match' THEN 7
                    WHEN PATTERN_PAYLOAD:provenance:evidence_class::STRING
                         = 'name_similarity' THEN 8
                    ELSE 9
                END,
                CONFIDENCE DESC,
                SUPPORT_COUNT DESC
            LIMIT {int(limit)}
            """
        ).collect()
        current_sources = {item.upper() for item in source_tables}
        current_vendor = (
            str(crm_family or "").strip().upper()
            or _vendor_family_from_sources(source_tables)
        )
        current_columns = [str(item) for item in source_columns or [] if item]
        columns_by_role: dict[str, list[str]] = {}
        for column in current_columns:
            columns_by_role.setdefault(_semantic_role(column), []).append(column)
        profiles_by_role = {
            _semantic_role(
                str(
                    profile.get("physical_name")
                    or profile.get("source_column")
                    or profile.get("column")
                    or ""
                )
            ): profile
            for profile in source_column_profiles or []
            if isinstance(profile, dict)
        }
        current_relationships = {
            str(item).strip().upper() for item in relationship_paths or [] if item
        }
        current_derived = {
            str(item).strip().upper() for item in derived_outputs or [] if item
        }
        result: list[TargetMappingPatternCandidate] = []
        for row in rows:
            data = row.as_dict()
            payload = data.get("PATTERN_PAYLOAD")
            if isinstance(payload, str):
                payload = json.loads(payload)
            if not isinstance(payload, dict):
                continue
            payload["support_count"] = int(data.get("SUPPORT_COUNT") or 1)
            payload["contradiction_count"] = int(
                data.get("CONTRADICTION_COUNT") or 0
            )
            payload["validation_status"] = str(
                data.get("VALIDATION_STATUS") or payload.get("validation_status")
            )
            payload["confidence"] = float(
                data.get("CONFIDENCE") or payload.get("confidence") or 0.5
            )
            pattern = TargetMappingPatternV2.model_validate(payload)
            historical_sources = {
                str(item).upper()
                for item in pattern.source_system_profile.get("source_tables") or []
            }
            exact = bool(historical_sources and historical_sources <= current_sources)
            historical_vendor = str(
                pattern.source_system_profile.get("vendor_family") or ""
            ).strip().upper() or _vendor_family_from_sources(historical_sources)
            same_vendor = bool(
                current_vendor
                and historical_vendor
                and current_vendor == historical_vendor
            )
            dependency_columns = [
                str(value)
                for value in pattern.mapping_recipe.get("source_dependencies") or []
                if value
            ]
            adapted_columns: list[str] = []
            missing_roles: list[str] = []
            type_checks: list[bool] = []
            grain_checks: list[bool] = []
            historical_profiles = {
                _semantic_role(str(item.get("physical_name") or "")): item
                for item in pattern.source_system_profile.get("source_columns") or []
                if isinstance(item, dict)
            }
            for dependency in dependency_columns:
                role = _semantic_role(dependency)
                matches = columns_by_role.get(role, [])
                if matches:
                    adapted_columns.append(matches[0])
                    current_profile = profiles_by_role.get(role, {})
                    historical_profile = historical_profiles.get(role, {})
                    current_type = current_profile.get("type")
                    expected_type = (
                        historical_profile.get("type")
                        or pattern.target_contract.get("type")
                    )
                    type_checks.append(
                        bool(current_type and expected_type)
                        and _type_family(current_type) == _type_family(expected_type)
                    )
                    current_grain = current_profile.get("grain")
                    expected_grain = (
                        historical_profile.get("grain")
                        or pattern.target_contract.get("grain")
                    )
                    grain_checks.append(
                        bool(current_grain and expected_grain)
                        and str(current_grain).strip().upper()
                        == str(expected_grain).strip().upper()
                    )
                else:
                    missing_roles.append(role)
            required_relationships = {
                str(
                    item.get("path")
                    or item.get("condition")
                    or item.get("relationship")
                    or ""
                ).strip().upper()
                for item in pattern.relationship_dependencies
                if isinstance(item, dict)
            } - {""}
            required_derived = {
                str(
                    item.get("name")
                    or item.get("output")
                    or item.get("alias")
                    or ""
                ).strip().upper()
                for item in pattern.derived_dependencies
                if isinstance(item, dict)
            } - {""}
            relationship_ok = (
                required_relationships <= current_relationships
                if required_relationships
                else True
            )
            derived_ok = (
                required_derived <= current_derived if required_derived else True
            )
            roles_ok = not missing_roles if dependency_columns else False
            types_ok = bool(type_checks) and all(type_checks)
            grain_ok = bool(grain_checks) and all(grain_checks)
            if exact:
                tier, score = 1, 1.0
                decision = (
                    "accept_exact_precedent"
                    if types_ok and grain_ok and relationship_ok and derived_ok
                    else "unresolved"
                )
                reasons = ["The historical physical source set is available."]
            elif same_vendor:
                tier, score = 2, 0.86
                decision = (
                    "adapt_pattern"
                    if roles_ok and types_ok and grain_ok and relationship_ok and derived_ok
                    else "unresolved"
                )
                reasons = ["The source-system family matches; physical names require validation."]
            elif roles_ok and types_ok and grain_ok and relationship_ok and derived_ok:
                tier, score, decision = 3, 0.72, "adapt_pattern"
                reasons = [
                    "Historical physical names were replaced with compatible current semantic roles.",
                    "Required relationships and derived outputs are available.",
                ]
            else:
                tier, score, decision = 4, 0.4, "unresolved"
                reasons = ["The business rule is known but no compatible current source is resolved."]
            missing = [
                source
                for source in historical_sources
                if source not in current_sources
            ]
            missing.extend(
                f"semantic_role:{role}" for role in missing_roles
            )
            missing.extend(
                f"relationship:{value}"
                for value in sorted(required_relationships - current_relationships)
            )
            missing.extend(
                f"derived_output:{value}"
                for value in sorted(required_derived - current_derived)
            )
            if not types_ok:
                missing.append("compatible_source_types")
            if not grain_ok:
                missing.append("compatible_source_grain")
            prepare_action = None
            if decision == "unresolved":
                prepare_action = {
                    "action_kind": "open_source_preparation",
                    "missing_semantic_roles": missing_roles,
                    "candidate_source_tables": sorted(current_sources),
                    "required_relationships": sorted(required_relationships),
                    "required_derived_outputs": sorted(required_derived),
                    "historical_rationale": pattern.business_rationale,
                }
            result.append(
                TargetMappingPatternCandidate(
                    pattern=pattern,
                    compatibility_tier=tier,
                    compatibility_score=score,
                    decision=decision,
                    compatibility_reasons=reasons,
                    missing_dependencies=sorted(set(missing)),
                    adapted_source_columns=adapted_columns if tier == 3 else [],
                    compatibility_checks={
                        "columns_exist": roles_ok if dependency_columns else None,
                        "types_compatible": types_ok,
                        "grain_compatible": grain_ok,
                        "relationship_path_compatible": relationship_ok,
                        "derived_outputs_available": derived_ok,
                    },
                    prepare_source_action=prepare_action,
                )
            )
        return result

    def retrieve_knowledge_graph(
        self,
        *,
        target_table: str,
        target_columns: list[str],
        project_id: str | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        candidates = self.retrieve_candidates(
            target_table=target_table,
            target_columns=target_columns,
            source_tables=[],
            project_id=project_id,
            limit=limit,
        )
        nodes: dict[str, dict[str, Any]] = {}
        edges: dict[str, dict[str, Any]] = {}

        def add_node(node_id: str, kind: str, attributes: dict[str, Any]) -> None:
            if node_id:
                nodes.setdefault(
                    node_id,
                    {"id": node_id, "kind": kind, "attributes": attributes},
                )

        def add_edge(
            source: str,
            relation: str,
            target: str,
            attributes: dict[str, Any] | None = None,
        ) -> None:
            if not source or not target:
                return
            identity = _stable_hash([source, relation, target, attributes or {}])
            edges.setdefault(
                identity,
                {
                    "id": identity,
                    "source": source,
                    "relation": relation,
                    "target": target,
                    "attributes": attributes or {},
                },
            )

        for candidate in candidates:
            pattern = candidate.pattern
            target = pattern.target_contract
            target_table_id = f"target_table:{target.get('target_fqn') or target_table}"
            target_column_id = (
                f"target_column:{target.get('target_fqn') or target_table}."
                f"{target.get('target_column') or ''}"
            )
            add_node(target_table_id, "target_table", {"fqn": target.get("target_fqn")})
            add_node(target_column_id, "target_column", target)
            add_edge(target_table_id, "contains", target_column_id)
            pattern_id = f"mapping_pattern:{pattern.pattern_id}"
            add_node(
                pattern_id,
                "mapping_pattern",
                {
                    "recipe": pattern.mapping_recipe,
                    "confidence": pattern.confidence,
                    "validation_status": pattern.validation_status,
                    "provenance": pattern.provenance,
                },
            )
            add_edge(
                pattern_id,
                "maps_to",
                target_column_id,
                {"compatibility_tier": candidate.compatibility_tier},
            )
            for source_table in pattern.source_system_profile.get("source_tables") or []:
                source_table_id = f"source_table:{source_table}"
                add_node(source_table_id, "source_table", {"fqn": source_table})
                for source_column in pattern.source_system_profile.get("source_columns") or []:
                    if not isinstance(source_column, dict):
                        continue
                    physical = str(source_column.get("physical_name") or "")
                    source_column_id = f"source_column:{physical}"
                    add_node(source_column_id, "source_column", source_column)
                    add_edge(source_table_id, "contains", source_column_id)
                    add_edge(source_column_id, "maps_to", target_column_id)
            for relationship in pattern.relationship_dependencies:
                relationship_id = f"relationship:{_stable_hash(relationship)}"
                add_node(relationship_id, "relationship", relationship)
                add_edge(pattern_id, "validated_by", relationship_id)
                left = str(
                    relationship.get("left_table")
                    or relationship.get("source_table")
                    or ""
                )
                right = str(
                    relationship.get("right_table")
                    or relationship.get("target_table")
                    or ""
                )
                if left and right:
                    left_id = f"source_table:{left}"
                    right_id = f"source_table:{right}"
                    add_node(left_id, "source_table", {"fqn": left})
                    add_node(right_id, "source_table", {"fqn": right})
                    add_edge(left_id, "joins_to", right_id, relationship)
            for derived in pattern.derived_dependencies:
                derived_id = f"derived_source:{_stable_hash(derived)}"
                add_node(derived_id, "derived_source", derived)
                add_edge(pattern_id, "derives_from", derived_id)
            if pattern.mapping_recipe.get("expression"):
                transformation_id = (
                    "transformation:"
                    f"{pattern.mapping_recipe.get('expression_fingerprint') or _stable_hash(pattern.mapping_recipe.get('expression'))}"
                )
                add_node(
                    transformation_id,
                    "transformation",
                    {
                        "expression": pattern.mapping_recipe.get("expression"),
                        "fingerprint": pattern.mapping_recipe.get(
                            "expression_fingerprint"
                        ),
                    },
                )
                add_edge(pattern_id, "transformed_by", transformation_id)
            if pattern.mapping_recipe.get("placeholder"):
                binding_id = (
                    f"value_binding:{pattern.mapping_recipe.get('placeholder')}"
                )
                add_node(
                    binding_id,
                    "value_binding",
                    {
                        "placeholder": pattern.mapping_recipe.get("placeholder"),
                        "scope": pattern.scope,
                    },
                )
                add_edge(binding_id, "maps_to", target_column_id)
            corrected_from = str(
                pattern.provenance.get("corrected_from") or ""
            )
            if corrected_from:
                original_id = f"mapping_pattern:{corrected_from}"
                add_node(original_id, "mapping_pattern", {})
                add_edge(original_id, "corrected_by", pattern_id)
            validation_id = (
                f"validation:{pattern.pattern_id}:{pattern.validation_status}"
            )
            add_node(
                validation_id,
                "validation",
                {
                    "status": pattern.validation_status,
                    "confidence": pattern.confidence,
                    "support_count": pattern.support_count,
                    "contradiction_count": pattern.contradiction_count,
                },
            )
            add_edge(pattern_id, "validated_by", validation_id)
            for evidence_id in pattern.evidence_ids:
                evidence_node = f"evidence:{evidence_id}"
                add_node(
                    evidence_node,
                    "evidence",
                    {"id": evidence_id, "provenance": pattern.provenance},
                )
                add_edge(evidence_node, "maps_to", pattern_id)
            for query_rule in pattern.query_shaping_dependencies:
                kind = str(query_rule.get("kind") or query_rule.get("type") or "query_shape")
                relation = {
                    "filter": "filtered_by",
                    "grouping": "grouped_by",
                    "group_by": "grouped_by",
                }.get(kind.lower(), "transformed_by")
                rule_id = f"query_rule:{_stable_hash(query_rule)}"
                add_node(rule_id, kind, query_rule)
                add_edge(pattern_id, relation, rule_id)
        return {
            "nodes": list(nodes.values()),
            "edges": list(edges.values()),
            "candidate_count": len(candidates),
        }
