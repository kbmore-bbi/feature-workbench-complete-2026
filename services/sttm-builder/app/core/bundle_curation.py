from __future__ import annotations

import hashlib
import json
import copy
from typing import Any

from app.core.config import Settings
from app.core.sql_parser import ParsedSqlDocument
from app.schema.bundle_curation import (
    BundleCurationPreview,
    BundleCurationPromotionRequest,
    BundleCurationPromotionResponse,
    BundleCurationRecord,
)


class BundleCurationError(ValueError):
    pass


class BundleCurationStaleError(BundleCurationError):
    pass


def _json(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


class BundleCurationService:
    _PROMOTABLE_VALIDATION = {
        "validated",
        "validated_precedent",
        "confirmed",
        "promoted",
        "accepted",
    }

    def __init__(self, session: Any, settings: Settings) -> None:
        self._session = session
        self._versions = settings.qualify_metadata_object_name(
            "TBL_SEMANTIC_BUNDLE_VERSIONS"
        )
        self._bundles = settings.qualify_metadata_object_name(
            settings.snowflake_semantic_bundles_table
        )
        self._recommendations = settings.qualify_metadata_object_name(
            "TBL_FIR_AGENT_RECOMMENDATIONS"
        )

    @staticmethod
    def document_version_id(
        *,
        asset_id: str,
        project_id: str,
        context_key: str | None,
        target_table: str | None,
    ) -> str:
        raw = json.dumps(
            {
                "asset_id": asset_id,
                "project_id": project_id,
                "context_key": context_key or "",
                "target_table": target_table or "",
                "contract": "sql_lineage_v3",
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return f"bundlever_{hashlib.sha256(raw.encode()).hexdigest()[:32]}"

    def upsert_document_draft(
        self,
        *,
        bundle_version_id: str,
        asset_id: str,
        project_id: str,
        workspace_context: dict[str, Any] | None,
        parsed: ParsedSqlDocument,
    ) -> None:
        workspace = workspace_context or {}
        semantic = workspace.get("semantic") or {}
        findings = [
            {
                "category": "derived_source",
                "subject_key": cte.name,
                "status": (
                    "structurally_validated"
                    if cte.derived_source_candidate
                    else "informational"
                ),
                "payload": {
                    "name": cte.name,
                    "purpose": cte.purpose,
                    "candidate": cte.derived_source_candidate,
                    "reasons": cte.derived_source_reasons,
                    "grain_evidence": cte.grain_evidence,
                    "downstream_consumers": cte.downstream_consumers,
                    "sql_text": cte.sql_text,
                    "output_columns": cte.output_columns,
                },
            }
            for cte in parsed.ctes
        ]
        mapping_semantics = [
            {
                "target_table": item.target_table,
                "target_column": item.target_alias,
                "source_columns": item.source_columns,
                "physical_source_columns": item.physical_source_columns,
                "expression": item.transformation,
                "constant_value": item.constant_value,
                "lineage_path": item.lineage_path,
                "unresolved_references": item.unresolved_references,
                "validation_status": (
                    "structurally_resolved"
                    if not item.unresolved_references
                    else "unresolved"
                ),
            }
            for item in parsed.column_mappings
        ]
        validation = {
            "document_version": parsed.document_version,
            "target_binding": parsed.target_binding,
            "target_column_count": len(parsed.column_mappings),
            "structurally_resolved_count": sum(
                not item.unresolved_references for item in parsed.column_mappings
            ),
            "unresolved_count": sum(
                bool(item.unresolved_references) for item in parsed.column_mappings
            ),
            "derived_source_candidate_count": sum(
                item.derived_source_candidate for item in parsed.ctes
            ),
            "parse_warnings": parsed.parse_warnings,
        }
        self._session.sql(
            f"""
            MERGE INTO {self._versions} target
            USING (
                SELECT ? AS BUNDLE_VERSION_ID, ? AS SQL_ASSET_ID,
                       ? AS PROJECT_ID, ? AS SEMANTIC_BUNDLE_ID,
                       ? AS BASE_BUNDLE_HASH, ? AS STTM_ID,
                       ? AS WORKSPACE_CONTEXT_KEY,
                       ? AS WORKSPACE_CONTEXT_HASH,
                       PARSE_JSON(?) AS KNOWLEDGE_GRAPH,
                       PARSE_JSON(?) AS MAPPING_SEMANTICS,
                       PARSE_JSON(?) AS FINDINGS,
                       PARSE_JSON(?) AS EVIDENCE_IDS,
                       PARSE_JSON(?) AS VALIDATION_SUMMARY
            ) source
            ON target.BUNDLE_VERSION_ID = source.BUNDLE_VERSION_ID
            WHEN MATCHED AND target.STATUS = 'draft' THEN UPDATE SET
                KNOWLEDGE_GRAPH = source.KNOWLEDGE_GRAPH,
                MAPPING_SEMANTICS = source.MAPPING_SEMANTICS,
                FINDINGS = source.FINDINGS,
                VALIDATION_SUMMARY = source.VALIDATION_SUMMARY,
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (
                BUNDLE_VERSION_ID, SEMANTIC_BUNDLE_ID, BASE_BUNDLE_HASH,
                VERSION_NUMBER, SQL_ASSET_ID, PROJECT_ID, STTM_ID,
                WORKSPACE_CONTEXT_KEY, WORKSPACE_CONTEXT_HASH,
                KNOWLEDGE_GRAPH, MAPPING_SEMANTICS, FINDINGS, EVIDENCE_IDS,
                VALIDATION_SUMMARY, STATUS, CREATED_AT, UPDATED_AT
            ) VALUES (
                source.BUNDLE_VERSION_ID, NULLIF(source.SEMANTIC_BUNDLE_ID, ''),
                NULLIF(source.BASE_BUNDLE_HASH, ''), 1, source.SQL_ASSET_ID,
                source.PROJECT_ID, NULLIF(source.STTM_ID, ''),
                NULLIF(source.WORKSPACE_CONTEXT_KEY, ''),
                NULLIF(source.WORKSPACE_CONTEXT_HASH, ''),
                source.KNOWLEDGE_GRAPH, source.MAPPING_SEMANTICS,
                source.FINDINGS, source.EVIDENCE_IDS,
                source.VALIDATION_SUMMARY, 'draft',
                CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
            )
            """,
            [
                bundle_version_id,
                asset_id,
                project_id,
                str(semantic.get("bundle_id") or ""),
                str(semantic.get("bundle_hash") or ""),
                str(workspace.get("sttm_id") or ""),
                str(workspace.get("context_key") or ""),
                str(workspace.get("context_hash") or ""),
                json.dumps(parsed.knowledge_graph, default=str),
                json.dumps(mapping_semantics, default=str),
                json.dumps(findings, default=str),
                json.dumps([asset_id]),
                json.dumps(validation, default=str),
            ],
        ).collect()

    def bind_semantic_bundle(
        self,
        *,
        bundle_version_id: str,
        semantic_bundle_id: str,
        base_bundle_hash: str | None,
    ) -> None:
        """Attach a provisional SQL curation to its composed semantic-view bundle."""
        self._session.sql(
            f"""
            UPDATE {self._versions}
            SET SEMANTIC_BUNDLE_ID = ?,
                BASE_BUNDLE_HASH = NULLIF(?, ''),
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE BUNDLE_VERSION_ID = ?
              AND STATUS = 'draft'
              AND (
                    SEMANTIC_BUNDLE_ID IS NULL
                    OR SEMANTIC_BUNDLE_ID = ?
                  )
            """,
            [
                semantic_bundle_id,
                base_bundle_hash or "",
                bundle_version_id,
                semantic_bundle_id,
            ],
        ).collect()

    def _recommendation_rows(self, bundle_version_id: str) -> list[dict[str, Any]]:
        try:
            rows = self._session.sql(
                f"""
                SELECT AGENT_RECOMMENDATION_ID, RECOMMENDATION_TYPE,
                       RECOMMENDATION_CATEGORY, AGENT_PAYLOAD, ACTION_CONTRACT,
                       DISPLAY_MESSAGE, CONFIDENCE, VALIDATION_STATUS, STATUS
                FROM {self._recommendations}
                WHERE BUNDLE_VERSION_ID = ?
                ORDER BY RECOMMENDATION_PRIORITY DESC, CREATED_AT
                """,
                [bundle_version_id],
            ).collect()
        except Exception:
            return []
        return [
            row.as_dict() if hasattr(row, "as_dict") else dict(row)
            for row in rows
        ]

    def get(self, bundle_version_id: str) -> BundleCurationRecord | None:
        rows = self._session.sql(
            f"SELECT * FROM {self._versions} WHERE BUNDLE_VERSION_ID = ? LIMIT 1",
            [bundle_version_id],
        ).collect()
        if not rows:
            return None
        row = rows[0].as_dict()
        recommendations = self._recommendation_rows(bundle_version_id)
        graph = copy.deepcopy(_json(row.get("KNOWLEDGE_GRAPH"), {}))
        nodes = graph.setdefault("nodes", [])
        edges = graph.setdefault("edges", [])
        existing_nodes = {
            str(item.get("id"))
            for item in nodes
            if isinstance(item, dict)
        }

        def add_node(node_id: str, kind: str, attributes: dict[str, Any]) -> None:
            if node_id not in existing_nodes:
                nodes.append(
                    {"id": node_id, "kind": kind, "attributes": attributes}
                )
                existing_nodes.add(node_id)

        asset_id = str(row.get("SQL_ASSET_ID") or "")
        asset_node = f"evidence:sql_asset:{asset_id}"
        if asset_id:
            add_node(
                asset_node,
                "evidence",
                {"asset_id": asset_id, "evidence_type": "uploaded_sql"},
            )
        semantic_bundle_id = str(row.get("SEMANTIC_BUNDLE_ID") or "")
        if semantic_bundle_id:
            add_node(
                f"semantic_asset:{semantic_bundle_id}",
                "semantic_asset",
                {"bundle_id": semantic_bundle_id},
            )
        validation_node = f"validation:{bundle_version_id}"
        add_node(
            validation_node,
            "validation",
            _json(row.get("VALIDATION_SUMMARY"), {}),
        )
        for recommendation in recommendations:
            recommendation_id = str(
                recommendation.get("AGENT_RECOMMENDATION_ID") or ""
            )
            if not recommendation_id:
                continue
            recommendation_node = f"recommendation:{recommendation_id}"
            add_node(
                recommendation_node,
                "recommendation",
                {
                    "recommendation_id": recommendation_id,
                    "recommendation_type": recommendation.get(
                        "RECOMMENDATION_TYPE"
                    ),
                    "validation_status": recommendation.get(
                        "VALIDATION_STATUS"
                    ),
                    "confidence": recommendation.get("CONFIDENCE"),
                },
            )
            if asset_id:
                edge_id = hashlib.sha256(
                    f"{asset_node}|supports|{recommendation_node}".encode()
                ).hexdigest()[:24]
                edges.append(
                    {
                        "id": f"edge:{edge_id}",
                        "source": asset_node,
                        "relation": "supports",
                        "target": recommendation_node,
                        "attributes": {"provenance": "fir"},
                    }
                )
            validation_edge_id = hashlib.sha256(
                f"{recommendation_node}|evaluated_by|{validation_node}".encode()
            ).hexdigest()[:24]
            edges.append(
                {
                    "id": f"edge:{validation_edge_id}",
                    "source": recommendation_node,
                    "relation": "evaluated_by",
                    "target": validation_node,
                    "attributes": {},
                }
            )
        return BundleCurationRecord(
            bundle_version_id=str(row["BUNDLE_VERSION_ID"]),
            semantic_bundle_id=row.get("SEMANTIC_BUNDLE_ID"),
            base_bundle_hash=row.get("BASE_BUNDLE_HASH"),
            version_number=int(row.get("VERSION_NUMBER") or 1),
            sql_asset_id=row.get("SQL_ASSET_ID"),
            project_id=row.get("PROJECT_ID"),
            sttm_id=row.get("STTM_ID"),
            workspace_context_key=row.get("WORKSPACE_CONTEXT_KEY"),
            workspace_context_hash=row.get("WORKSPACE_CONTEXT_HASH"),
            knowledge_graph=graph,
            mapping_semantics=_json(row.get("MAPPING_SEMANTICS"), []),
            findings=_json(row.get("FINDINGS"), []),
            evidence_ids=_json(row.get("EVIDENCE_IDS"), []),
            validation_summary=_json(row.get("VALIDATION_SUMMARY"), {}),
            status=str(row.get("STATUS") or "draft"),
            recommendations=recommendations,
        )

    def preview(
        self,
        bundle_version_id: str,
        request: BundleCurationPromotionRequest,
    ) -> BundleCurationPreview:
        record = self.get(bundle_version_id)
        if record is None:
            raise BundleCurationError("Bundle curation draft was not found.")
        if record.status != "draft":
            raise BundleCurationError("Only draft bundle curation can be promoted.")
        if (
            record.workspace_context_hash
            and request.expected_workspace_hash != record.workspace_context_hash
        ):
            raise BundleCurationStaleError(
                "The workspace changed after this bundle draft was created."
            )
        if record.base_bundle_hash and request.expected_bundle_hash != record.base_bundle_hash:
            raise BundleCurationStaleError(
                "The semantic bundle changed after this draft was created."
            )
        requested = set(request.approved_recommendation_ids)
        if (
            record.recommendations
            and not requested
            and not request.approve_all_validated
        ):
            raise BundleCurationError(
                "Select recommendations or choose Approve all validated."
            )
        eligible: list[str] = []
        blocked: list[dict[str, Any]] = []
        for recommendation in record.recommendations:
            recommendation_id = str(
                recommendation.get("AGENT_RECOMMENDATION_ID") or ""
            )
            if requested and recommendation_id not in requested:
                continue
            validation = str(
                recommendation.get("VALIDATION_STATUS") or ""
            ).lower()
            reviewable = str(
                recommendation.get("STATUS") or ""
            ).lower() in {"draft", "active"}
            if reviewable and validation in self._PROMOTABLE_VALIDATION:
                eligible.append(recommendation_id)
            else:
                blocked.append(
                    {
                        "recommendation_id": recommendation_id,
                        "reason": (
                            "Recommendation is unresolved, conflicting, inactive, "
                            "or lacks validated semantic evidence."
                        ),
                    }
                )
        deterministic_ready = (
            int(record.validation_summary.get("unresolved_count") or 0) == 0
            and bool(
                (record.validation_summary.get("target_binding") or {}).get(
                    "target_table"
                )
            )
        )
        return BundleCurationPreview(
            curation=record,
            eligible_recommendation_ids=eligible,
            blocked_recommendations=blocked,
            can_promote=bool(eligible)
            or (
                not record.recommendations
                and request.approve_all_validated
                and deterministic_ready
            ),
        )

    def promote(
        self,
        bundle_version_id: str,
        request: BundleCurationPromotionRequest,
        *,
        actor_id: str,
    ) -> BundleCurationPromotionResponse:
        if not request.confirmed:
            raise BundleCurationError("Bundle promotion requires confirmation.")
        preview = self.preview(bundle_version_id, request)
        if not preview.can_promote:
            raise BundleCurationError("No validated bundle findings are eligible.")
        record = preview.curation
        if record.semantic_bundle_id and record.base_bundle_hash:
            rows = self._session.sql(
                f"""
                SELECT BUNDLE_HASH FROM {self._bundles}
                WHERE SEMANTIC_BUNDLE_ID = ? LIMIT 1
                """,
                [record.semantic_bundle_id],
            ).collect()
            current_hash = str(rows[0]["BUNDLE_HASH"] or "") if rows else ""
            if current_hash and current_hash != record.base_bundle_hash:
                raise BundleCurationStaleError(
                    "The semantic bundle changed while promotion was being reviewed."
                )
        scope_predicate = (
            "SEMANTIC_BUNDLE_ID = ?"
            if record.semantic_bundle_id
            else "PROJECT_ID = ? AND COALESCE(STTM_ID, '') = ?"
        )
        scope_params = (
            [record.semantic_bundle_id]
            if record.semantic_bundle_id
            else [record.project_id, record.sttm_id or ""]
        )
        self._session.sql(
            f"""
            UPDATE {self._versions}
            SET STATUS = 'superseded', UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE {scope_predicate}
              AND STATUS = 'active'
              AND BUNDLE_VERSION_ID <> ?
            """,
            [*scope_params, bundle_version_id],
        ).collect()
        self._session.sql(
            f"""
            UPDATE {self._versions}
            SET STATUS = 'active', CREATED_BY = ?, PROMOTED_AT = CURRENT_TIMESTAMP(),
                UPDATED_AT = CURRENT_TIMESTAMP()
            WHERE BUNDLE_VERSION_ID = ? AND STATUS = 'draft'
            """,
            [actor_id, bundle_version_id],
        ).collect()
        if preview.eligible_recommendation_ids:
            self._session.sql(
                f"""
                UPDATE {self._recommendations}
                SET STATUS = 'active',
                    VALIDATION_STATUS = 'promoted',
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE BUNDLE_VERSION_ID = ?
                  AND AGENT_RECOMMENDATION_ID IN (
                      SELECT value::STRING
                      FROM TABLE(FLATTEN(INPUT => PARSE_JSON(?)))
                  )
                """,
                [
                    bundle_version_id,
                    json.dumps(preview.eligible_recommendation_ids),
                ],
            ).collect()
        if record.semantic_bundle_id:
            self._session.sql(
                f"""
                UPDATE {self._bundles}
                SET BUNDLE_ARTIFACT = OBJECT_INSERT(
                        OBJECT_INSERT(
                            COALESCE(BUNDLE_ARTIFACT, OBJECT_CONSTRUCT()),
                            'curated_mapping_overlay',
                            PARSE_JSON(?),
                            TRUE
                        ),
                        'curated_knowledge_graph',
                        PARSE_JSON(?),
                        TRUE
                    ),
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE SEMANTIC_BUNDLE_ID = ?
                """,
                [
                    json.dumps(record.mapping_semantics, default=str),
                    json.dumps(record.knowledge_graph, default=str),
                    record.semantic_bundle_id,
                ],
            ).collect()
        derived_ids = [
            str(item.get("AGENT_RECOMMENDATION_ID") or "")
            for item in record.recommendations
            if str(item.get("RECOMMENDATION_TYPE") or "")
            == "derived_source_suggestion"
            and str(item.get("AGENT_RECOMMENDATION_ID") or "")
            in preview.eligible_recommendation_ids
        ]
        return BundleCurationPromotionResponse(
            status="promoted",
            bundle_version_id=bundle_version_id,
            semantic_bundle_id=record.semantic_bundle_id,
            promoted_recommendation_ids=preview.eligible_recommendation_ids,
            derived_source_recommendation_ids=derived_ids,
        )
