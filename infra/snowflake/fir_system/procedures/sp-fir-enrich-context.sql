-- Deterministically assembles all evidence before AGT_FIR_SYSTEM is invoked.
CREATE OR REPLACE PROCEDURE __STTM_METADATA_NAMESPACE__.SP_FIR_ENRICH_CONTEXT(
    "BATCH_SIZE" INTEGER DEFAULT 100
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'enrich_context'
EXECUTE AS OWNER
AS
$$
import json
import hashlib
import uuid
from datetime import datetime


NS = "__STTM_METADATA_NAMESPACE__"
SEM_NS = "__SEMANTIC_REGISTRY_NAMESPACE__"
SEM_TABLE_OBJECT = "__SEMANTIC_TABLE_VIEWS_OBJECT__"
SEM_COLUMN_OBJECT = "__SEMANTIC_COLUMN_VIEWS_OBJECT__"
SEM_NATIVE_OBJECT = "__SEMANTIC_NATIVE_VIEWS_OBJECT__"


def _semantic_object(name):
    normalized = str(name or "").strip()
    return normalized if normalized.count(".") == 2 else f"{SEM_NS}.{normalized}"


SEM_TABLE_SOURCE = _semantic_object(SEM_TABLE_OBJECT)
SEM_COLUMN_SOURCE = _semantic_object(SEM_COLUMN_OBJECT)
SEM_NATIVE_SOURCE = _semantic_object(SEM_NATIVE_OBJECT)


def _json(value, default):
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _fqn(value):
    if isinstance(value, str):
        return value.strip().upper()
    if not isinstance(value, dict):
        return ""
    parts = [value.get("database"), value.get("schema"), value.get("table") or value.get("name")]
    return ".".join(str(part).strip() for part in parts if part).upper()


def _rows(session, query, params=None):
    try:
        return [row.as_dict() for row in session.sql(query, params or []).collect()]
    except Exception:
        return []


def _store_evidence_item(
    session,
    *,
    source_type,
    source_table,
    source_record_id,
    title,
    summary,
    excerpt,
    payload,
    project_id,
    sttm_id,
    snapshot_id,
    context_key,
    polarity='supporting',
    weight=0.5,
):
    source_hash = hashlib.sha256(
        json.dumps(
            {
                'source_type': source_type,
                'source_table': source_table,
                'source_record_id': source_record_id,
                'title': title,
                'summary': summary,
                'context_key': context_key,
            },
            sort_keys=True,
            default=str,
        ).encode()
    ).hexdigest()
    evidence_id = f"evidence_{source_hash[:32]}"
    session.sql(f"""
        MERGE INTO {NS}.TBL_FIR_EVIDENCE_ITEMS target
        USING (
            SELECT ? AS EVIDENCE_ID, ? AS SOURCE_TYPE, ? AS SOURCE_TABLE,
                   ? AS SOURCE_RECORD_ID, ? AS TITLE, ? AS SUMMARY,
                   ? AS REDACTED_EXCERPT, PARSE_JSON(?) AS STRUCTURED_PAYLOAD,
                   ? AS PROJECT_ID, ? AS STTM_ID, ? AS SNAPSHOT_ID,
                   ? AS CONTEXT_KEY, ? AS POLARITY, ? AS EVIDENCE_WEIGHT,
                   ? AS SOURCE_HASH
        ) source
        ON target.SOURCE_HASH = source.SOURCE_HASH
        WHEN MATCHED THEN UPDATE SET
            TITLE = source.TITLE,
            SUMMARY = source.SUMMARY,
            REDACTED_EXCERPT = source.REDACTED_EXCERPT,
            STRUCTURED_PAYLOAD = source.STRUCTURED_PAYLOAD,
            POLARITY = source.POLARITY,
            EVIDENCE_WEIGHT = source.EVIDENCE_WEIGHT,
            UPDATED_AT = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT (
            EVIDENCE_ID, SOURCE_TYPE, SOURCE_TABLE, SOURCE_RECORD_ID,
            TITLE, SUMMARY, REDACTED_EXCERPT, STRUCTURED_PAYLOAD,
            PROJECT_ID, STTM_ID, SNAPSHOT_ID, CONTEXT_KEY,
            POLARITY, EVIDENCE_WEIGHT, SOURCE_HASH
        ) VALUES (
            source.EVIDENCE_ID, source.SOURCE_TYPE, source.SOURCE_TABLE,
            source.SOURCE_RECORD_ID, source.TITLE, source.SUMMARY,
            source.REDACTED_EXCERPT, source.STRUCTURED_PAYLOAD,
            source.PROJECT_ID, source.STTM_ID, source.SNAPSHOT_ID,
            source.CONTEXT_KEY, source.POLARITY, source.EVIDENCE_WEIGHT,
            source.SOURCE_HASH
        )
    """, [
        evidence_id, source_type, source_table, source_record_id,
        str(title or source_type)[:500], str(summary or title or source_type)[:5000],
        str(excerpt or '')[:4000], json.dumps(payload or {}, default=str),
        project_id, sttm_id, snapshot_id, context_key, polarity, weight, source_hash,
    ]).collect()
    return evidence_id


def _readable_evidence(
    session,
    *,
    record,
    payload,
    semantic,
    derived,
    document_asset,
    prior_inferences,
    context_key,
    snapshot_id,
):
    evidence_ids = []
    project_id = record.get("PROJECT_ID")
    sttm_id = record.get("STTM_ID")
    event_summary = (
        payload.get("business_goal")
        or payload.get("description")
        or payload.get("comment")
        or payload.get("message")
        or f"{record.get('SOURCE_EVENT_TYPE')} captured from {record.get('SOURCE_TYPE')}"
    )
    evidence_ids.append(_store_evidence_item(
        session,
        source_type=str(record.get("SOURCE_TYPE") or "event"),
        source_table="TBL_AGENT_FIR_360",
        source_record_id=str(record.get("FIR_RECORD_ID") or ""),
        title=f"Workbench evidence: {record.get('SOURCE_EVENT_TYPE')}",
        summary=event_summary,
        excerpt=json.dumps(payload, default=str)[:1200],
        payload=payload,
        project_id=project_id,
        sttm_id=sttm_id,
        snapshot_id=snapshot_id,
        context_key=context_key,
        weight=0.75,
    ))

    for item in semantic:
        table_fqn = item.get("table_fqn")
        table_semantic = item.get("table_semantic") or {}
        embedded_semantic = table_semantic.get("SEMANTIC_VIEW")
        embedded_description = (
            embedded_semantic.get("description")
            if isinstance(embedded_semantic, dict)
            else None
        )
        description = (
            table_semantic.get("DESCRIPTION")
            or table_semantic.get("BUSINESS_DESCRIPTION")
            or embedded_description
        )
        summary = description or f"Semantic registry context for {table_fqn}"
        evidence_ids.append(_store_evidence_item(
            session,
            source_type="semantic_registry",
            source_table=str(table_fqn or ""),
            source_record_id=str(table_semantic.get("TABLE_VIEW_ID") or table_fqn or ""),
            title=f"Semantic definition: {table_fqn}",
            summary=summary,
            excerpt=json.dumps(table_semantic, default=str)[:1800],
            payload=item,
            project_id=project_id,
            sttm_id=sttm_id,
            snapshot_id=snapshot_id,
            context_key=context_key,
            weight=0.8,
        ))

    if document_asset:
        evidence_ids.append(_store_evidence_item(
            session,
            source_type="document",
            source_table="TBL_WORKBENCH_CLIENT_SQL_ASSETS",
            source_record_id=str(document_asset.get("SQL_ASSET_ID") or ""),
            title=str(document_asset.get("TITLE") or "Uploaded mapping document"),
            summary=str(
                document_asset.get("DESCRIPTION")
                or f"{document_asset.get('SQL_KIND') or 'document'} evidence"
            ),
            excerpt=str(document_asset.get("DOCUMENT_TEXT") or "")[:3000],
            payload={key: value for key, value in document_asset.items() if key != "DOCUMENT_TEXT"},
            project_id=project_id,
            sttm_id=sttm_id,
            snapshot_id=snapshot_id,
            context_key=context_key,
            weight=0.9,
        ))

    for item in derived:
        derived_id = str(item.get("DERIVED_SOURCE_ID") or "")
        evidence_ids.append(_store_evidence_item(
            session,
            source_type="derived_source",
            source_table="TBL_DERIVED_SOURCES",
            source_record_id=derived_id,
            title=f"Derived source: {item.get('DERIVED_SOURCE_NAME') or derived_id}",
            summary=str(
                item.get("BUSINESS_DESCRIPTION")
                or item.get("PURPOSE")
                or "Validated derived-source lineage"
            ),
            excerpt=str(item.get("SQL_TEXT") or "")[:2500],
            payload=item,
            project_id=project_id,
            sttm_id=sttm_id,
            snapshot_id=snapshot_id,
            context_key=context_key,
            weight=0.85,
        ))

    for item in prior_inferences[:20]:
        evidence_ids.append(_store_evidence_item(
            session,
            source_type="prior_inference",
            source_table="TBL_WORKBENCH_INFERENCES",
            source_record_id=str(item.get("INFERENCE_ID") or ""),
            title=f"{item.get('INFERENCE_GOAL_ID') or 'FIR'} precedent: {item.get('SUBJECT_KEY') or 'context'}",
            summary=str(item.get("STRUCTURED_ANSWER") or item.get("SUBJECT_KEY") or "Prior FIR inference"),
            excerpt=json.dumps(item.get("STRUCTURED_ANSWER") or {}, default=str)[:1800],
            payload=item,
            project_id=project_id,
            sttm_id=sttm_id,
            snapshot_id=snapshot_id,
            context_key=context_key,
            weight=float(item.get("CONFIDENCE") or 0.6),
        ))
    return list(dict.fromkeys(evidence_ids))


def _semantic_evidence(session, table_fqns):
    evidence = []
    for table_fqn in sorted(set(value for value in table_fqns if value)):
        table_rows = _rows(session, f"""
            SELECT * FROM {SEM_TABLE_SOURCE}
            WHERE UPPER(COALESCE(FQN, CONCAT_WS('.', DATABASE_NAME, SCHEMA_NAME, TABLE_NAME))) = ?
        """, [table_fqn])
        column_rows = _rows(session, f"""
            SELECT * FROM {SEM_COLUMN_SOURCE}
            WHERE UPPER(CONCAT_WS('.', DATABASE_NAME, SCHEMA_NAME, TABLE_NAME)) = ?
        """, [table_fqn])
        native_rows = _rows(session, f"""
            SELECT * FROM {SEM_NATIVE_SOURCE}
            WHERE UPPER(COALESCE(SOURCE_FQN, CONCAT_WS('.', DATABASE_NAME, SCHEMA_NAME, TABLE_NAME))) = ?
        """, [table_fqn])
        curated_rows = _rows(session, f"""
            SELECT VERSION_ID, VERSION_NUMBER, VERSION_LABEL, BUSINESS_GLOSSARY,
                   RELATIONSHIP_RULES, TRANSFORMATION_PATTERNS, COLUMN_SEMANTICS,
                   DERIVED_SOURCE_PATTERNS, QA_PAIRS, CONFIDENCE, VALIDATION_STATUS,
                   LEARNING_SOURCES
            FROM {NS}.TBL_SEMANTIC_VIEW_VERSIONS
            WHERE UPPER(SEMANTIC_VIEW_FQN) = ?
              AND STATUS = 'active'
              AND VALIDATION_STATUS = 'validated'
            ORDER BY VERSION_NUMBER DESC, UPDATED_AT DESC
            LIMIT 1
        """, [table_fqn])
        evidence.append({
            "table_fqn": table_fqn,
            "table_semantic": table_rows[0] if table_rows else None,
            "column_semantics": column_rows,
            "native_semantic_view": native_rows[0] if native_rows else None,
            "curated_semantic": curated_rows[0] if curated_rows else None,
            "semantic_ready": bool(table_rows),
        })
    return evidence


def enrich_context(session, batch_size=100):
    pending = _rows(session, f"""
        SELECT f.FIR_RECORD_ID, f.FIR_RECORD_KEY, f.PROJECT_ID, f.STTM_ID, f.CONTEXT_KEY,
               f.SNAPSHOT_ID, f.MILESTONE, f.FEEDBACK_PAYLOAD, f.SOURCE_TYPE,
               f.SOURCE_EVENT_TYPE, f.EVIDENCE_CONTEXT_ID
        FROM {NS}.TBL_AGENT_FIR_360 f
        LEFT JOIN {NS}.TBL_FIR_CONTEXT_EVIDENCE e
          ON e.EVIDENCE_CONTEXT_ID = f.EVIDENCE_CONTEXT_ID
        WHERE (
                f.EVIDENCE_CONTEXT_ID IS NULL
                AND f.PROCESSING_STAGE IN ('pending', 'completed')
              )
           OR (
                f.EVIDENCE_CONTEXT_ID IS NOT NULL
                AND (
                    e.EVIDENCE_CONTEXT_ID IS NULL
                    OR COALESCE(
                        ARRAY_SIZE(e.EVIDENCE_PAYLOAD:readable_evidence_ids),
                        0
                    ) = 0
                )
              )
           OR EXISTS (
                SELECT 1
                FROM {NS}.TBL_FIR_AGENT_RECOMMENDATIONS r
                WHERE r.FIR_RECORD_ID = f.FIR_RECORD_ID
                  AND r.STATUS = 'active'
                  AND COALESCE(ARRAY_SIZE(r.EVIDENCE_IDS), 0) = 0
              )
           OR (
                e.EVIDENCE_CONTEXT_ID IS NOT NULL
                AND COALESCE(e.EVIDENCE_PAYLOAD:inference_ready::BOOLEAN, FALSE) = FALSE
                AND e.UPDATED_AT < DATEADD('minute', -5, CURRENT_TIMESTAMP())
              )
        ORDER BY f.CREATED_AT
        LIMIT ?
    """, [batch_size])
    enriched = 0
    failures = []
    for record in pending:
        try:
            payload = _json(record.get("FEEDBACK_PAYLOAD"), {})
            context_key = str(record.get("CONTEXT_KEY") or payload.get("context_key") or record["FIR_RECORD_KEY"])
            snapshot_id = str(record.get("SNAPSHOT_ID") or payload.get("snapshot_id") or "")
            snapshots = _rows(session, f"""
                SELECT SNAPSHOT_ID, SNAPSHOT_PAYLOAD, CONTEXT_HASH, SEMANTIC_BUNDLE_ID
                FROM {NS}.TBL_WORKSPACE_SNAPSHOTS
                WHERE (? <> '' AND SNAPSHOT_ID = ?)
                   OR (? <> '' AND CONTEXT_KEY = ?)
                ORDER BY CREATED_AT DESC
                LIMIT 1
            """, [snapshot_id, snapshot_id, context_key, context_key])
            snapshot_row = snapshots[0] if snapshots else {}
            snapshot = _json(snapshot_row.get("SNAPSHOT_PAYLOAD"), {})
            if snapshot_row.get("SNAPSHOT_ID"):
                snapshot_id = str(snapshot_row["SNAPSHOT_ID"])

            source_tables = [_fqn(value) for value in snapshot.get("source_tables") or []]
            target_table = _fqn(snapshot.get("target_table"))
            derived_ids = [str(item.get("id")) for item in snapshot.get("derived_sources") or [] if isinstance(item, dict) and item.get("id")]
            asset_id = str(payload.get("sql_asset_id") or payload.get("asset_id") or "")
            asset_references = _rows(session, f"""
                SELECT * FROM {NS}.TBL_FIR_ASSET_TABLE_REFERENCES
                WHERE ? <> '' AND SQL_ASSET_ID = ?
            """, [asset_id, asset_id])
            asset_rows = _rows(session, f"""
                SELECT SQL_ASSET_ID, PROJECT_ID, TITLE, SQL_KIND, DIALECT,
                       DESCRIPTION, TAGS, ATTRIBUTES,
                       LEFT(SQL_TEXT, 50000) AS DOCUMENT_TEXT
                FROM {NS}.TBL_WORKBENCH_CLIENT_SQL_ASSETS
                WHERE ? <> '' AND SQL_ASSET_ID = ? AND STATUS = 'active'
                LIMIT 1
            """, [asset_id, asset_id])
            document_asset = asset_rows[0] if asset_rows else None
            document_sources = [
                str(item.get("RESOLVED_FQN") or "").upper()
                for item in asset_references
                if item.get("RESOLUTION_STATUS") == "resolved"
                and str(item.get("REFERENCE_ROLE") or "").lower() == "source"
                and item.get("RESOLVED_FQN")
            ]
            document_targets = [
                str(item.get("RESOLVED_FQN") or "").upper()
                for item in asset_references
                if item.get("RESOLUTION_STATUS") == "resolved"
                and str(item.get("REFERENCE_ROLE") or "").lower() == "target"
                and item.get("RESOLVED_FQN")
            ]
            source_tables = list(dict.fromkeys(value for value in [*source_tables, *document_sources] if value))
            if not target_table and document_targets:
                target_table = document_targets[0]
            all_tables = list(dict.fromkeys(value for value in [*source_tables, target_table] if value))
            semantic = _semantic_evidence(session, all_tables)
            derived = []
            for derived_id in derived_ids:
                derived.extend(_rows(session, f"""
                    SELECT * FROM {NS}.TBL_DERIVED_SOURCES WHERE DERIVED_SOURCE_ID = ?
                """, [derived_id]))

            freshness = []
            profiles = []
            for table_fqn in all_tables:
                if not table_fqn:
                    continue
                freshness.extend(_rows(session, f"SELECT * FROM {NS}.TBL_FIR_FRESHNESS_FEATURES WHERE TABLE_FQN = ?", [table_fqn]))
                profiles.extend(_rows(session, f"SELECT * FROM {NS}.TBL_FIR_PROFILE_FEATURES WHERE TABLE_FQN = ?", [table_fqn]))
            prior_candidates = _rows(session, f"""
                SELECT INFERENCE_ID, INFERENCE_GOAL_ID, SUBJECT_KEY, STRUCTURED_ANSWER,
                       CONFIDENCE, CONFIDENCE_BAND, VALIDATION_STATUS, EVIDENCE_IDS,
                       CONTEXT_KEY, PROJECT_ID, STTM_ID
                FROM {NS}.TBL_WORKBENCH_INFERENCES
                WHERE STATUS = 'active'
                  AND COALESCE(CONFIDENCE, 0) >= 0.55
                ORDER BY UPDATED_AT DESC LIMIT 500
            """)
            project_id = str(record.get("PROJECT_ID") or "")
            sttm_id = str(record.get("STTM_ID") or "")
            subject_prefixes = [value.upper() for value in all_tables if value]
            prior_inferences = []
            for candidate in prior_candidates:
                subject_key = str(candidate.get("SUBJECT_KEY") or "").upper()
                is_relevant = (
                    candidate.get("CONTEXT_KEY") == context_key
                    or (project_id and str(candidate.get("PROJECT_ID") or "") == project_id)
                    or (sttm_id and str(candidate.get("STTM_ID") or "") == sttm_id)
                    or any(
                        subject_key == prefix
                        or subject_key.startswith(f"{prefix}.")
                        or subject_key.startswith(f"{prefix}|")
                        for prefix in subject_prefixes
                    )
                )
                if is_relevant:
                    prior_inferences.append(candidate)
                if len(prior_inferences) >= 100:
                    break
            outcomes = _rows(session, f"""
                SELECT AGENT_RECOMMENDATION_ID, OUTCOME_TYPE, OUTCOME_PAYLOAD, CREATED_AT
                FROM {NS}.TBL_FIR_RECOMMENDATION_OUTCOMES
                WHERE CONTEXT_KEY = ? ORDER BY CREATED_AT DESC LIMIT 100
            """, [context_key])
            goals = _rows(session, f"""
                SELECT INFERENCE_GOAL_ID, NAME, SUBJECT_TYPE, TRIGGER_MILESTONES,
                       GOAL_OWNER, CATEGORY, RESPONSE_STORAGE, OUTPUT_TARGETS,
                       VERSION
                FROM {NS}.TBL_FIR_INFERENCE_GOALS
                WHERE STATUS = 'active' AND VERSION = '2.1'
            """)
            requires_semantics = bool(all_tables) or bool(asset_id) or record.get("SOURCE_TYPE") == "document_upload"
            semantics_ready = (not requires_semantics) or (
                bool(semantic) and all(item.get("semantic_ready") for item in semantic)
            )
            references_ready = (not asset_id) or (
                bool(asset_references)
                and all(item.get("RESOLUTION_STATUS") == "resolved" for item in asset_references)
            )
            missing_semantic_tables = [
                item.get("table_fqn") for item in semantic if not item.get("semantic_ready")
            ]
            evidence_id = str(
                record.get("EVIDENCE_CONTEXT_ID")
                or f"evidence_context_{uuid.uuid4().hex[:20]}"
            )
            milestone = str(record.get("MILESTONE") or payload.get("milestone") or snapshot.get("milestone") or record.get("SOURCE_EVENT_TYPE") or "")
            readable_evidence_ids = _readable_evidence(
                session,
                record=record,
                payload=payload,
                semantic=semantic,
                derived=derived,
                document_asset=document_asset,
                prior_inferences=prior_inferences,
                context_key=context_key,
                snapshot_id=snapshot_id,
            )
            evidence_payload = {
                "fir_record_id": record["FIR_RECORD_ID"],
                "feedback": payload,
                "snapshot": snapshot,
                "semantic_registry": semantic,
                "derived_sources": derived,
                "asset_references": asset_references,
                "document_asset": document_asset,
                "freshness_features": freshness,
                "profile_features": profiles,
                "prior_inferences": prior_inferences,
                "recommendation_outcomes": outcomes,
                "active_inference_goals": goals,
                "readable_evidence_ids": readable_evidence_ids,
                "missing_semantic_tables": missing_semantic_tables,
                "inference_ready": semantics_ready and references_ready,
            }
            if not references_ready:
                evidence_status = "needs_resolution"
            elif not semantics_ready:
                evidence_status = "needs_semantic_context"
            else:
                evidence_status = "ready"
            session.sql(f"""
                MERGE INTO {NS}.TBL_FIR_CONTEXT_EVIDENCE target
                USING (
                    SELECT ? AS EVIDENCE_CONTEXT_ID, ? AS CONTEXT_KEY,
                           ? AS PROJECT_ID, ? AS STTM_ID, ? AS SNAPSHOT_ID,
                           PARSE_JSON(?) AS SOURCE_TABLES, ? AS TARGET_TABLE,
                           PARSE_JSON(?) AS DERIVED_SOURCE_IDS,
                           PARSE_JSON(?) AS SELECTED_COLUMNS, ? AS MILESTONE,
                           ? AS SEMANTIC_BUNDLE_ID, ? AS SEMANTIC_HASH,
                           PARSE_JSON(?) AS EVIDENCE_PAYLOAD, ? AS EVIDENCE_STATUS
                ) source
                ON target.EVIDENCE_CONTEXT_ID = source.EVIDENCE_CONTEXT_ID
                WHEN MATCHED THEN UPDATE SET
                    CONTEXT_KEY = source.CONTEXT_KEY,
                    PROJECT_ID = source.PROJECT_ID,
                    STTM_ID = source.STTM_ID,
                    SNAPSHOT_ID = source.SNAPSHOT_ID,
                    SOURCE_TABLES = source.SOURCE_TABLES,
                    TARGET_TABLE = source.TARGET_TABLE,
                    DERIVED_SOURCE_IDS = source.DERIVED_SOURCE_IDS,
                    SELECTED_COLUMNS = source.SELECTED_COLUMNS,
                    MILESTONE = source.MILESTONE,
                    SEMANTIC_BUNDLE_ID = source.SEMANTIC_BUNDLE_ID,
                    SEMANTIC_HASH = source.SEMANTIC_HASH,
                    EVIDENCE_PAYLOAD = source.EVIDENCE_PAYLOAD,
                    EVIDENCE_STATUS = source.EVIDENCE_STATUS,
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT (
                    EVIDENCE_CONTEXT_ID, CONTEXT_KEY, PROJECT_ID, STTM_ID, SNAPSHOT_ID,
                    SOURCE_TABLES, TARGET_TABLE, DERIVED_SOURCE_IDS, SELECTED_COLUMNS,
                    MILESTONE, SEMANTIC_BUNDLE_ID, SEMANTIC_HASH,
                    EVIDENCE_PAYLOAD, EVIDENCE_STATUS
                ) VALUES (
                    source.EVIDENCE_CONTEXT_ID, source.CONTEXT_KEY, source.PROJECT_ID,
                    source.STTM_ID, source.SNAPSHOT_ID, source.SOURCE_TABLES,
                    source.TARGET_TABLE, source.DERIVED_SOURCE_IDS,
                    source.SELECTED_COLUMNS, source.MILESTONE,
                    source.SEMANTIC_BUNDLE_ID, source.SEMANTIC_HASH,
                    source.EVIDENCE_PAYLOAD, source.EVIDENCE_STATUS
                )
            """, [
                evidence_id, context_key, record.get("PROJECT_ID"), record.get("STTM_ID"), snapshot_id,
                json.dumps(source_tables), target_table, json.dumps(derived_ids),
                json.dumps(snapshot.get("selected_columns_by_table") or {}), milestone,
                snapshot_row.get("SEMANTIC_BUNDLE_ID") or snapshot.get("semantic", {}).get("bundle_id"),
                snapshot_row.get("CONTEXT_HASH"), json.dumps(evidence_payload, default=str),
                evidence_status,
            ]).collect()
            session.sql(f"""
                UPDATE {NS}.TBL_AGENT_FIR_360
                SET CONTEXT_KEY = ?, SNAPSHOT_ID = ?, MILESTONE = ?, EVIDENCE_CONTEXT_ID = ?,
                    PROCESSING_VERSION = '2.0',
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE FIR_RECORD_ID = ?
            """, [context_key, snapshot_id, milestone, evidence_id, record["FIR_RECORD_ID"]]).collect()
            recommendation_evidence_summary = (
                payload.get("business_goal")
                or payload.get("description")
                or payload.get("comment")
                or payload.get("message")
                or f"{record.get('SOURCE_EVENT_TYPE')} captured from {record.get('SOURCE_TYPE')}"
            )
            session.sql(f"""
                UPDATE {NS}.TBL_FIR_AGENT_RECOMMENDATIONS
                SET EVIDENCE_IDS = PARSE_JSON(?),
                    EVIDENCE_SUMMARY = COALESCE(
                        EVIDENCE_SUMMARY,
                        ?
                    ),
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHERE FIR_RECORD_ID = ?
                  AND STATUS = 'active'
            """, [
                json.dumps(readable_evidence_ids),
                str(recommendation_evidence_summary)[:5000],
                record["FIR_RECORD_ID"],
            ]).collect()
            enriched += 1
        except Exception as exc:
            failures.append({"fir_record_id": record.get("FIR_RECORD_ID"), "error": str(exc)})
    return {
        "status": "success" if not failures else "partial",
        "pending_count": len(pending),
        "enriched_count": enriched,
        "failures": failures,
        "processed_at": datetime.utcnow().isoformat(),
    }
$$;
