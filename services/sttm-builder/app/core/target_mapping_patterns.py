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
    raw = str(name or "").upper()
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

    @staticmethod
    def _quote(value: Any) -> str:
        return "'" + str(value).replace("'", "''") + "'"

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
            source_columns = _split_sources(
                row.get("source_columns")
                or row.get("source_field")
                or row.get("source_column")
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
                "source_tables": source_tables,
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
            patterns.append(
                TargetMappingPatternV2(
                    pattern_id=f"tmp_{content_hash[:24]}",
                    scope=scope,
                    project_id=project_id,
                    target_contract=target_contract,
                    source_system_profile=source_profile,
                    source_compatibility_signature=signature,
                    mapping_recipe=recipe,
                    relationship_dependencies=joins,
                    derived_dependencies=ctes,
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
        job_id = f"firjob_{uuid.uuid4().hex}"
        self._session.sql(
            f"""
            INSERT INTO {self._jobs_table} (
                LEARNING_JOB_ID, ASSET_ID, PROJECT_ID, STATUS, STAGE,
                DISCOVERED_PATTERN_COUNT, COMPLETED_PATTERN_COUNT,
                FAILED_PATTERN_COUNT, CREATED_AT, UPDATED_AT
            ) VALUES (
                {self._quote(job_id)}, {self._quote(asset_id)},
                {self._quote(project_id)}, 'running', 'target_row_extraction',
                {len(patterns)}, 0, 0,
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
                    "version": "2",
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
                    WHEN 'pattern_conflict_analysis' THEN 2
                    WHEN 'recommendation_generation' THEN 3
                    WHEN 'search_index_promotion' THEN 4
                    ELSE 5
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
            except Exception as exc:
                retry = (attempts + 1) < int(
                    self._settings.fir_agent_retry_limit
                )
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
                        ERROR = PARSE_JSON({self._quote(json.dumps({'message': str(exc)}))}),
                        LEASE_OWNER = NULL,
                        LEASE_EXPIRES_AT = NULL,
                        UPDATED_AT = CURRENT_TIMESTAMP()
                    WHERE WORK_ITEM_ID = {self._quote(item_id)}
                      AND LEASE_OWNER = {self._quote(worker)}
                    """
                ).collect()
        return self._refresh_job(job_id)

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
            return {
                "asset_id": payload.get("asset_id"),
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
        )

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
                    WHEN VALIDATION_STATUS = 'published' THEN 2
                    WHEN VALIDATION_STATUS = 'validated' THEN 3
                    WHEN VALIDATION_STATUS = 'accepted' THEN 4
                    WHEN VALIDATION_STATUS = 'enriched' THEN 5
                    ELSE 6
                END,
                CONFIDENCE DESC,
                SUPPORT_COUNT DESC
            LIMIT {int(limit)}
            """
        ).collect()
        current_sources = {item.upper() for item in source_tables}
        current_vendor = _vendor_family_from_sources(source_tables)
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
            if exact:
                tier, score, decision = 1, 1.0, "accept_exact_precedent"
                reasons = ["The historical physical source set is available."]
            elif same_vendor:
                tier, score, decision = 2, 0.86, "adapt_pattern"
                reasons = ["The source-system family matches; physical names require validation."]
            elif pattern.mapping_recipe.get("source_dependencies"):
                tier, score, decision = 3, 0.72, "adapt_pattern"
                reasons = ["Transfer is based on semantic role, type, grain, and relationship compatibility."]
            else:
                tier, score, decision = 4, 0.4, "unresolved"
                reasons = ["The business rule is known but no compatible current source is resolved."]
            missing = [
                source
                for source in historical_sources
                if source not in current_sources
            ]
            result.append(
                TargetMappingPatternCandidate(
                    pattern=pattern,
                    compatibility_tier=tier,
                    compatibility_score=score,
                    decision=decision,
                    compatibility_reasons=reasons,
                    missing_dependencies=missing,
                )
            )
        return result
