#!/usr/bin/env python3
"""Run the EverNest V2 Auto-map acceptance flow through the backend ASGI API.

This is intentionally non-publishing. It uses the latest saved workspace snapshot,
the same semantic refresh and durable job endpoints as the browser, and never edits
derived SQL, prompts, semantics, or mapping rows.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = REPO_ROOT / "services" / "sttm-builder"
CANONICAL_SQL = REPO_ROOT / "docs" / "01-EverNest-HHs-reference.sql"
TARGET_FQN = "FFP_HDP_CRM_MIG_DB_DEV.SCH_REDTAIL_EVERNEST_TARGET.EVERNEST_HH"


def _configure_environment() -> None:
    env_file = APP_ROOT / ".env.local"
    if env_file.exists():
        for raw_line in env_file.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    os.environ["AUTH_MODE"] = "ingress_headers"
    os.environ["LOCAL_DEV_AUTH_ENABLED"] = "true"
    os.environ["LOCAL_DEV_BYPASS_METADATA"] = "false"
    os.environ["SPCS_EXECUTE_AS_CALLER_ENABLED"] = "false"
    os.environ["APP_ENV"] = "local"
    os.environ["AUTO_MAP_PIPELINE_V2"] = "true"
    # Exercise the same local V2 worker resolution used by the browser. SPCS
    # must continue to provide its explicit internal worker-service URL.
    os.environ.pop("AUTO_MAPPING_SERVICE_URL", None)
    if str(APP_ROOT) not in sys.path:
        sys.path.insert(0, str(APP_ROOT))


def _table_fqn(table: dict[str, Any] | None) -> str:
    if not table:
        return ""
    return ".".join(str(table.get(key) or "") for key in ("database", "schema", "table"))


def _semantic_descriptions(
    semantic_context: list[dict[str, Any]], target_fqn: str
) -> dict[str, str]:
    descriptions: dict[str, str] = {}

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            name = value.get("name") or value.get("column_name")
            description = (
                value.get("description")
                or value.get("business_description")
                or value.get("business_meaning")
                or value.get("synonyms")
            )
            if name and description:
                if isinstance(description, list):
                    description = ", ".join(str(item) for item in description)
                descriptions.setdefault(str(name).upper(), str(description))
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    for item in semantic_context:
        if _table_fqn(item.get("table")).upper() == target_fqn.upper():
            visit(item.get("semantic_model"))
    return descriptions


def _response_data(response) -> dict[str, Any]:
    payload = response.json()
    if not response.is_success:
        raise RuntimeError(
            json.dumps(
                payload.get("error") or payload.get("detail") or payload,
                sort_keys=True,
                default=str,
            )
        )
    if payload.get("error"):
        raise RuntimeError(json.dumps(payload["error"], sort_keys=True))
    return payload.get("data") or {}


def _mapping_result(job: dict[str, Any]) -> dict[str, dict[str, Any]]:
    response = job.get("response") or {}
    result = ((response.get("data") or {}).get("result") or response.get("result") or {})
    mappings = result.get("mappings") if isinstance(result, dict) else None
    if isinstance(mappings, dict):
        return mappings
    merged: dict[str, dict[str, Any]] = {}
    for partial in job.get("partial_responses") or []:
        partial_response = partial.get("response") or {}
        partial_result = (
            (partial_response.get("data") or {}).get("result")
            or partial_response.get("result")
            or {}
        )
        if isinstance(partial_result.get("mappings"), dict):
            merged.update(partial_result["mappings"])
    return merged


def _compile_items(
    target_columns: list[dict[str, Any]], mappings: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    by_target = {str(key).rsplit(".", 1)[-1].upper(): value for key, value in mappings.items()}
    items: list[dict[str, Any]] = []
    for column in target_columns:
        target = str(column["column_name"])
        mapping = by_target.get(target.upper()) or {}
        dependencies = mapping.get("source_dependencies") or mapping.get("source_attributes") or []
        mode = mapping.get("mapping_mode") or "source"
        rule_type = str(mapping.get("preprocessing_rule_type") or "").upper()
        expression = mapping.get("preprocessing_rule")
        if rule_type in {"DIRECT", "NONE"}:
            expression = None
        items.append(
            {
                "target_column": target,
                "target_type": column.get("data_type"),
                "source_columns": dependencies,
                "source_dependencies": dependencies,
                "mapping_mode": mode,
                "constant_value": mapping.get("constant_value"),
                "expression": expression,
                "rule": mapping.get("preprocessing_rule_type"),
                "nl_rule": mapping.get("preprocessing_nl_rule"),
                "description": mapping.get("description"),
                "value_binding_ids": mapping.get("value_binding_ids") or [],
                "precedent_decision": mapping.get("precedent_decision"),
                "precedent_mapping_id": mapping.get("precedent_mapping_id"),
                "status": "MAPPED" if (mode == "constant" or dependencies) else "UNRESOLVED",
            }
        )
    return items


def _canonical_value_bindings(sql: str) -> list[dict[str, Any]]:
    values: dict[str, str] = {}

    def literal(token: str) -> str | None:
        stripped = token.strip()
        if len(stripped) >= 2 and stripped[0] == "'" and stripped[-1] == "'":
            return stripped[1:-1].replace("''", "'")
        if stripped.startswith("$"):
            return values.get(stripped[1:])
        return None

    for match in re.finditer(
        r"(?im)^\s*SET\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?);\s*$",
        sql,
    ):
        name, expression = match.group(1), match.group(2).strip()
        value = literal(expression)
        concat = re.fullmatch(r"(?is)CONCAT\((.*)\)", expression)
        if value is None and concat:
            parts = [part.strip() for part in concat.group(1).split(",")]
            resolved_parts = [literal(part) for part in parts]
            if all(part is not None for part in resolved_parts):
                value = "".join(str(part) for part in resolved_parts)
        if value is not None:
            values[name] = value

    database = values.get("CoreMigrationDatabase")
    if database:
        for name, value in list(values.items()):
            if name.endswith("MasterTable") and value.count(".") == 1:
                values[name] = f"{database}.{value}"
    return [
        {
            "binding_id": f"canonical-{name}",
            "value": f"${name}",
            "resolved_value": value,
            "data_type": "VARCHAR",
            "is_placeholder": True,
            "allow_project_specific_value": True,
            "resolution_status": "resolved",
        }
        for name, value in values.items()
    ]


def _result_signature(session: Any, query: str) -> dict[str, Any]:
    normalized = query.strip().rstrip(";")
    rows = session.sql(
        "SELECT COUNT(*) AS ROW_COUNT, HASH_AGG(HASH(*)) AS MULTISET_HASH "
        f"FROM ({normalized}) comparison_rows"
    ).collect()
    row = rows[0].as_dict() if hasattr(rows[0], "as_dict") else dict(rows[0])
    return {
        "row_count": int(row.get("ROW_COUNT") or 0),
        "multiset_hash": str(row.get("MULTISET_HASH")),
    }


def run(
    *,
    shadow: bool,
    timeout_seconds: int,
    show_sql: bool,
    compare_results: bool,
    target_limit: int | None,
) -> dict[str, Any]:
    _configure_environment()
    from fastapi.testclient import TestClient

    from app.core.config import get_settings
    from app.main import app

    get_settings.cache_clear()
    headers = {
        "Sf-Context-Current-User": "ANKURS",
        "Sf-Context-Current-User-Email": "ankur@example.com",
    }
    started_at = time.perf_counter()
    with TestClient(app) as client:
        detail = _response_data(client.get("/api/v1/sttms/1401", headers=headers))
        snapshot = detail.get("latest_snapshot") or {}
        source_tables = snapshot.get("source_tables") or []
        target_table = snapshot.get("target_table")
        relation_graph = snapshot.get("relation_graph") or {}
        derived_ids = [
            item.get("id")
            for item in snapshot.get("derived_sources") or []
            if item.get("id")
        ]
        target_attributes = _response_data(
            client.get(
                "/api/v1/table-selection/attributes",
                headers=headers,
                params=[("tables", TARGET_FQN)],
            )
        )[0]["columns"]
        if target_limit is not None:
            target_attributes = target_attributes[: max(1, target_limit)]

        semantic = _response_data(
            client.post(
                "/api/v1/semantic-context/refresh",
                headers=headers,
                json={
                    "selected_source_tables": source_tables,
                    "selected_derived_sources": derived_ids,
                    "target_table": target_table,
                    "relationships": snapshot.get("relationships") or [],
                    "selected_columns_by_table": snapshot.get("selected_columns_by_table") or {},
                    "requested_level": "FULL_REGISTRY",
                    "force": False,
                },
            )
        )
        semantic_context = semantic.get("semantic_context") or []
        descriptions = _semantic_descriptions(semantic_context, TARGET_FQN)
        snapshot = {
            **snapshot,
            "action": "auto_map.requested",
            "surface": "MAPPING",
            "semantic": {
                **(snapshot.get("semantic") or {}),
                "bundle_id": semantic.get("bundle_id"),
                "bundle_hash": semantic.get("bundle_hash"),
                "bundle_label": semantic.get("bundle_label"),
                "view_name": semantic.get("semantic_view_name"),
                "level": semantic.get("achieved_level"),
                "status": semantic.get("status"),
            },
        }
        attributes = [
            {
                "target_table": target_table,
                "target_attribute": column["column_name"],
                "target_data_type": column.get("data_type"),
                "target_description": descriptions.get(str(column["column_name"]).upper()),
                "source_mappings": None,
            }
            for column in target_attributes
        ]
        request = {
            "contract_version": "1.0",
            "operation": "sttm.auto_map",
            "context": {
                "source_tables": source_tables,
                "driving_table": snapshot.get("driving_table"),
                "relationships": snapshot.get("relationships") or [],
                "semantic_context": semantic_context,
                "selected_columns_by_table": snapshot.get("selected_columns_by_table") or {},
                "surface": "MAPPING",
                "semantic_level_requested": "FULL_REGISTRY",
                "target_table": target_table,
                "selected_derived_sources": derived_ids,
                "semantic_bundle_id": semantic.get("bundle_id"),
                "semantic_bundle_label": semantic.get("bundle_label"),
                "semantic_view_name": semantic.get("semantic_view_name"),
                "derived_source_lineage": semantic.get("lineage") or [],
                "datahub_context": semantic.get("datahub_context"),
                "mapping_intent": snapshot.get("mapping_intent"),
                "project_id": "1101",
                "sttm_id": "1401",
                "workspace_context": snapshot,
                "relation_graph": relation_graph,
                "omit_linked_precedent": shadow,
                # Canonical replay is a separate diagnostic. The normal linked
                # run asks the source-mapping agent to evaluate the precedent.
                "replay_exact_precedent": False,
            },
            "data": {
                "intent": "AUTO_MAP",
                "attributes": attributes,
                "message": None,
            },
        }
        job = _response_data(
            client.post("/api/v1/workbench/auto-map-jobs", headers=headers, json=request)
        )
        deadline = time.monotonic() + timeout_seconds
        while job.get("status") in {"queued", "running"}:
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Auto-map job {job.get('job_id')} exceeded {timeout_seconds}s")
            time.sleep(2)
            job = _response_data(
                client.get(
                    f"/api/v1/workbench/auto-map-jobs/{job['job_id']}",
                    headers=headers,
                )
            )
        mappings = _mapping_result(job)

        compile_result: dict[str, Any] | None = None
        bound_compile_result: dict[str, Any] | None = None
        compile_error: str | None = None
        bound_compile_error: str | None = None
        result_comparison: dict[str, Any] | None = None
        accepted_precedent_id = (
            next(iter({
                str(item.get("precedent_mapping_id"))
                for item in mappings.values()
                if item.get("precedent_decision") == "accept_precedent"
                and item.get("precedent_mapping_id")
            }), None)
            if mappings
            and all(
                item.get("precedent_decision") == "accept_precedent"
                for item in mappings.values()
            )
            else None
        )
        compile_payload = {
            "relation_graph": relation_graph,
            "mappings": _compile_items(target_attributes, mappings),
            "target_table": target_table,
            "driving_relation_id": _table_fqn(snapshot.get("driving_table")),
            "self_contained_derived": True,
            "validate_with_explain": True,
            "allow_unresolved_placeholders": False,
            "accepted_precedent_sttm_id": accepted_precedent_id,
        }
        try:
            compile_result = _response_data(
                client.post(
                    "/api/v1/workbench/mapping-sql/compile",
                    headers=headers,
                    json=compile_payload,
                )
            )
        except Exception as exc:
            compile_error = str(exc)

        canonical_text = CANONICAL_SQL.read_text()
        if accepted_precedent_id and compile_result:
            bound_graph = {
                **relation_graph,
                "value_bindings": _canonical_value_bindings(canonical_text),
            }
            try:
                bound_compile_result = _response_data(
                    client.post(
                        "/api/v1/workbench/mapping-sql/compile",
                        headers=headers,
                        json={**compile_payload, "relation_graph": bound_graph},
                    )
                )
            except Exception as exc:
                bound_compile_error = str(exc)

            if compare_results and bound_compile_result and bound_compile_result.get("ready"):
                from app.core.config import get_settings
                from app.core.snowflake import SnowflakeClient

                snowflake = SnowflakeClient(get_settings())
                try:
                    for statement in re.findall(
                        r"(?im)^\s*(?:SET|USE\s+(?:DATABASE|SCHEMA))\s+.+?;\s*$",
                        canonical_text,
                    ):
                        snowflake.session.sql(statement.strip().rstrip(";")).collect()
                    query_match = re.search(
                        r"(?im)^WITH\s+[A-Za-z_][\w$]*\s+AS\s*\(",
                        canonical_text,
                    )
                    if query_match is None:
                        raise RuntimeError("Canonical query body was not found")
                    canonical_signature = _result_signature(
                        snowflake.session,
                        canonical_text[query_match.start():],
                    )
                    generated_signature = _result_signature(
                        snowflake.session,
                        bound_compile_result["preview_sql"],
                    )
                    result_comparison = {
                        "canonical": canonical_signature,
                        "generated": generated_signature,
                        "identical_multiset": canonical_signature == generated_signature,
                    }
                finally:
                    snowflake.close()

    canonical = CANONICAL_SQL.read_bytes()
    decisions: dict[str, int] = {}
    classifications: dict[str, int] = {}
    value_count = 0
    unresolved: list[str] = []
    overrides_without_evidence: list[str] = []
    for target, mapping in mappings.items():
        decision = str(mapping.get("precedent_decision") or "missing")
        decisions[decision] = decisions.get(decision, 0) + 1
        classification = str(mapping.get("transformation_classification") or "missing")
        classifications[classification] = classifications.get(classification, 0) + 1
        if mapping.get("mapping_mode") == "constant":
            value_count += 1
        if classification == "unresolved" or mapping.get("unmatched_reason"):
            unresolved.append(target)
        if decision == "override_precedent" and not mapping.get("override_evidence"):
            overrides_without_evidence.append(target)
    generated_sql = (compile_result or {}).get("generated_sql") or ""
    report = {
        "mode": "shadow_without_linked_precedent" if shadow else "linked_precedent",
        "job_id": job.get("job_id"),
        "job_status": job.get("status"),
        "job_stage": job.get("stage"),
        "attribute_count": job.get("attribute_count"),
        "mapping_count": len(mappings),
        "batch_count": job.get("batch_count"),
        "completed_batch_count": job.get("completed_batch_count"),
        "partial_result_order": [
            item.get("batch_index") for item in job.get("partial_responses") or []
        ],
        "pipeline_version": job.get("pipeline_version"),
        "context_hash": job.get("context_hash"),
        "semantic_bundle_id": job.get("semantic_bundle_id"),
        "agent_spec_hashes": job.get("agent_spec_hashes"),
        "retrieved_precedent_ids": job.get("retrieved_precedent_ids"),
        "timings_ms": job.get("timings_ms"),
        "elapsed_ms": round((time.perf_counter() - started_at) * 1000, 1),
        "semantic": {
            "status": semantic.get("status"),
            "achieved_level": semantic.get("achieved_level"),
            "item_count": len(semantic_context),
            "derived_output_count": sum(
                len(item.get("output_columns") or [])
                for item in snapshot.get("derived_sources") or []
            ),
            "warnings": semantic.get("warnings") or [],
        },
        "precedent_decisions": decisions,
        "transformation_classifications": classifications,
        "value_mapping_count": value_count,
        "unresolved_targets": unresolved,
        "overrides_without_evidence": overrides_without_evidence,
        "compile_ready": (compile_result or {}).get("ready"),
        "compile_valid": (compile_result or {}).get("valid"),
        "compile_error": compile_error,
        "compile_unresolved_placeholders": (
            compile_result or {}
        ).get("unresolved_placeholders"),
        "bound_compile_ready": (bound_compile_result or {}).get("ready"),
        "bound_compile_valid": (bound_compile_result or {}).get("valid"),
        "bound_compile_error": bound_compile_error,
        "bound_unresolved_placeholders": (
            bound_compile_result or {}
        ).get("unresolved_placeholders"),
        "result_comparison": result_comparison,
        "generated_sql_bytes": len(generated_sql.encode("utf-8")),
        "generated_sql_sha256": hashlib.sha256(generated_sql.encode("utf-8")).hexdigest()
        if generated_sql
        else None,
        "canonical_sql_bytes": len(canonical),
        "canonical_sql_sha256": hashlib.sha256(canonical).hexdigest(),
        "canonical_business_rules_restored": {
            "udf_pivots": all(
                token in generated_sql
                for token in ("Drinks AS", "PetName AS", "PrefContactMethod AS")
            ),
            "mapper_lookups": all(
                token in generated_sql
                for token in ("UserMaster AS", "HHMaster AS", "ReferralMaster AS")
            ),
            "household_exceptions": "FamilyHOH AS" in generated_sql
            and "included_in_household" in generated_sql,
            "deduplication": "QUALIFY ROW_NUMBER()" in generated_sql,
            "review_frequency": "review_frequency" in generated_sql,
        },
    }
    if show_sql:
        report["generated_sql"] = generated_sql
        report["mappings"] = mappings
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shadow", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=1200)
    parser.add_argument("--show-sql", action="store_true")
    parser.add_argument("--compare-results", action="store_true")
    parser.add_argument("--target-limit", type=int)
    args = parser.parse_args()
    print(
        json.dumps(
            run(
                shadow=args.shadow,
                timeout_seconds=args.timeout_seconds,
                show_sql=args.show_sql,
                compare_results=args.compare_results,
                target_limit=args.target_limit,
            ),
            indent=2,
            sort_keys=True,
            default=str,
        )
    )


if __name__ == "__main__":
    main()
