from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass
from typing import Any

from app.core.exceptions import AgentPayloadRequiredContextTooLargeError

class AgentPayloadBudgetError(AgentPayloadRequiredContextTooLargeError):
    """Raised when required request content cannot fit in the agent contract."""

    error_label = "AGENT_PAYLOAD_REQUIRED_CONTEXT_TOO_LARGE"


@dataclass(frozen=True)
class AgentPayloadBudgetResult:
    payload: dict[str, Any]
    text: str
    diagnostics: dict[str, Any]


def _json_text(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False, default=str)


def _fits(text: str, *, max_chars: int, max_bytes: int) -> bool:
    return len(text) <= max_chars and len(text.encode("utf-8")) <= max_bytes


def _trim(value: Any, limit: int) -> Any:
    if not isinstance(value, str) or len(value) <= limit:
        return value
    return value[: max(0, limit - 1)].rstrip() + "…"


def _target_names(payload: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    for item in ((payload.get("data") or {}).get("attributes") or []):
        if not isinstance(item, dict):
            continue
        value = item.get("target_attribute") or item.get("target_column")
        if value:
            names.add(str(value).rsplit(".", 1)[-1].upper())
    return names


def _mentions_target(item: Any, targets: set[str]) -> bool:
    if not targets:
        return True
    if isinstance(item, dict):
        for key in ("target_column", "target_attribute", "column", "target_entity"):
            value = item.get(key)
            if isinstance(value, str) and value.rsplit(".", 1)[-1].upper() in targets:
                return True
            if isinstance(value, dict) and _mentions_target(value, targets):
                return True
        return any(_mentions_target(value, targets) for value in item.values())
    if isinstance(item, list):
        return any(_mentions_target(value, targets) for value in item)
    return False


def _artifact_descriptor(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        artifact_id = value.get("artifact_id") or value.get("id")
        artifact_type = value.get("artifact_type") or value.get("type")
        raw = _json_text(value)
    else:
        artifact_id = None
        artifact_type = type(value).__name__
        raw = str(value)
    return {
        "artifact_id": artifact_id,
        "artifact_type": artifact_type,
        "content_hash": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        "content_omitted": True,
    }


def _remove_echoed_artifacts(payload: dict[str, Any]) -> int:
    """Remove prior response bodies while retaining attributable descriptors."""

    removed = 0
    data = payload.get("data")
    if isinstance(data, dict):
        for key in ("artifact", "response_artifact", "previous_response", "generated_artifact"):
            if key not in data:
                continue
            descriptor = _artifact_descriptor(data.pop(key))
            if descriptor:
                data.setdefault("artifact_refs", []).append(descriptor)
            removed += 1

    context = payload.get("context")
    if not isinstance(context, dict):
        return removed
    workspace = context.get("workspace_context")
    if isinstance(workspace, dict):
        artifacts = workspace.pop("mapping_artifacts", None)
        if artifacts:
            refs = context.setdefault("artifact_refs", [])
            for artifact in artifacts if isinstance(artifacts, list) else [artifacts]:
                descriptor = _artifact_descriptor(artifact)
                if descriptor:
                    refs.append(descriptor)
                    removed += 1
    execution = context.get("execution_context")
    if isinstance(execution, dict):
        for key in ("artifact", "artifacts", "generated_artifact", "response"):
            if key in execution:
                execution.pop(key, None)
                removed += 1
    return removed


def _compact_semantics(items: Any, targets: set[str], *, emergency: bool) -> list[dict[str, Any]] | None:
    if not isinstance(items, list):
        return None
    result: list[dict[str, Any]] = []
    max_tables = 12 if emergency else 24
    max_columns = 16 if emergency else 40
    for raw_item in items[:max_tables]:
        if not isinstance(raw_item, dict):
            continue
        item = copy.deepcopy(raw_item)
        model = item.get("semantic_model")
        if isinstance(model, dict):
            attributes = model.get("attributes")
            if isinstance(attributes, list):
                relevant = [
                    attribute
                    for attribute in attributes
                    if isinstance(attribute, dict)
                    and (
                        not targets
                        or str(attribute.get("name") or "").upper() in targets
                        or attribute.get("is_primary_key")
                        or attribute.get("is_foreign_key")
                    )
                ]
                model["attributes"] = (relevant or attributes[:8])[:max_columns]
            outputs = model.get("output_columns")
            if isinstance(outputs, list):
                relevant = [
                    output
                    for output in outputs
                    if isinstance(output, dict)
                    and (not targets or str(output.get("name") or output.get("column_name") or "").upper() in targets)
                ]
                model["output_columns"] = (relevant or outputs[:8])[:max_columns]
            if "sql_text" in model:
                model["sql_text"] = _trim(model.get("sql_text"), 1200 if emergency else 3000)
            for key in ("description", "domain_summary", "business_context", "purpose"):
                if key in model:
                    model[key] = _trim(model.get(key), 240 if emergency else 500)
        result.append(item)
    return result or None


def _compact_learning(learning: Any, targets: set[str], *, emergency: bool) -> dict[str, Any] | None:
    if not isinstance(learning, dict):
        return None
    compact = copy.deepcopy(learning)
    target_lists = {
        "similar_mappings": 1 if emergency else 3,
        "correction_history": 2 if emergency else 5,
        "fir_recommendations": 1 if emergency else 3,
        "target_mapping_patterns": 2 if emergency else 4,
    }
    for key, per_target in target_lists.items():
        values = compact.get(key)
        if not isinstance(values, list):
            continue
        relevant = [value for value in values if _mentions_target(value, targets)]
        limit = max(per_target, per_target * max(1, len(targets)))
        compact[key] = (relevant or values[:per_target])[:limit]

    precedents: list[dict[str, Any]] = []
    for precedent in compact.get("mapping_precedents") or []:
        if not isinstance(precedent, dict):
            continue
        mappings = [
            mapping
            for mapping in (precedent.get("mappings") or [])
            if isinstance(mapping, dict) and _mentions_target(mapping, targets)
        ]
        if targets and not mappings:
            continue
        item = {
            key: value
            for key, value in precedent.items()
            if key not in {"mappings", "ctes", "derived_sources", "business_rules"}
        }
        item["mappings"] = mappings[: max(1, len(targets) * (1 if emergency else 2))]
        item["ctes"] = (precedent.get("ctes") or [])[: (2 if emergency else 6)]
        item["derived_sources"] = (precedent.get("derived_sources") or [])[: (2 if emergency else 6)]
        item["business_rules"] = [
            rule for rule in (precedent.get("business_rules") or [])
            if not targets or _mentions_target(rule, targets)
        ][: (2 if emergency else 8)]
        precedents.append(item)
    compact["mapping_precedents"] = precedents[: (2 if emergency else 6)]

    for key, limit in {
        "fir_learnings": 4 if emergency else 10,
        "semantic_learnings": 4 if emergency else 10,
        "cross_project_patterns": 2 if emergency else 6,
        "semantic_version_learnings": 2 if emergency else 5,
        "linked_project_patterns": 2 if emergency else 5,
        "linked_mapping_precedents": 2 if emergency else 5,
        "retrieval_explanations": 4 if emergency else 10,
    }.items():
        if isinstance(compact.get(key), list):
            compact[key] = compact[key][:limit]

    if emergency:
        project = compact.get("project_context")
        if isinstance(project, dict):
            compact["project_context"] = {
                key: project.get(key)
                for key in ("project_id", "project_name", "sttm_id", "sttm_name", "domain")
                if project.get(key) is not None
            }
    return compact


def _compact_context(payload: dict[str, Any], *, emergency: bool) -> None:
    context = payload.get("context")
    if not isinstance(context, dict):
        return
    targets = _target_names(payload)
    context["semantic_context"] = _compact_semantics(
        context.get("semantic_context"), targets, emergency=emergency
    )
    context["learning_context"] = _compact_learning(
        context.get("learning_context"), targets, emergency=emergency
    )
    workspace = context.get("workspace_context")
    if isinstance(workspace, dict):
        workspace.pop("conversation_history", None)
        for key in (
            "raw_mapping_sql", "mapping_sql", "mapping_preview_sql",
            "compiled_mapping_sql", "compiled_mapping_preview_sql",
            "parsed_mapping_model", "validation_history",
        ):
            workspace.pop(key, None)
        rows = workspace.get("mapping_rows")
        if isinstance(rows, list):
            relevant = [row for row in rows if _mentions_target(row, targets)]
            workspace["mapping_rows"] = (relevant or rows[:4])[: (8 if emergency else 30)]
    execution = context.get("execution_context")
    if isinstance(execution, dict):
        # These are duplicates of learning_context. Keep exact IDs and summary only.
        for key in (
            "curated_inferences", "exact_fir_recommendations",
            "linked_project_patterns", "linked_mapping_precedents",
            "target_mapping_patterns", "retrieval_explanations",
        ):
            execution.pop(key, None)
    if emergency:
        context.pop("datahub_context", None)
        lineage = context.get("derived_source_lineage")
        if isinstance(lineage, list):
            context["derived_source_lineage"] = lineage[:6]


def budget_agent_payload(
    payload: dict[str, Any],
    *,
    max_chars: int,
    max_bytes: int,
    enabled: bool = True,
    emergency: bool = False,
) -> AgentPayloadBudgetResult:
    candidate = copy.deepcopy(payload)
    original_text = _json_text(candidate)
    removed_artifacts = _remove_echoed_artifacts(candidate)
    sanitized_text = _json_text(candidate)

    compacted = False
    emergency_applied = emergency
    if enabled and (emergency or not _fits(sanitized_text, max_chars=max_chars, max_bytes=max_bytes)):
        _compact_context(candidate, emergency=False)
        compacted = True
        sanitized_text = _json_text(candidate)
    if enabled and not _fits(sanitized_text, max_chars=max_chars, max_bytes=max_bytes):
        _compact_context(candidate, emergency=True)
        emergency_applied = True
        sanitized_text = _json_text(candidate)

    if enabled and not _fits(sanitized_text, max_chars=max_chars, max_bytes=max_bytes):
        required = {
            "contract_version": candidate.get("contract_version"),
            "request_id": candidate.get("request_id"),
            "operation": candidate.get("operation"),
            "data": candidate.get("data"),
            "context": {
                key: (candidate.get("context") or {}).get(key)
                for key in (
                    "source_tables", "driving_table", "target_table", "relationships",
                    "selected_columns_by_table", "relation_graph", "mapping_intent",
                    "semantic_bundle_id", "prepared_context_hash",
                )
                if (candidate.get("context") or {}).get(key) is not None
            },
        }
        required_text = _json_text(required)
        if not _fits(required_text, max_chars=max_chars, max_bytes=max_bytes):
            raise AgentPayloadBudgetError(
                f"{AgentPayloadBudgetError.error_label}: mandatory request content is "
                f"{len(required_text)} characters/{len(required_text.encode('utf-8'))} bytes"
            )
        candidate = required
        sanitized_text = required_text
        emergency_applied = True

    context = candidate.get("context") if isinstance(candidate.get("context"), dict) else {}
    section_sizes = {
        key: len(_json_text({key: value}))
        for key, value in sorted(context.items())
    }
    diagnostics = {
        "original_chars": len(original_text),
        "original_bytes": len(original_text.encode("utf-8")),
        "final_chars": len(sanitized_text),
        "final_bytes": len(sanitized_text.encode("utf-8")),
        "max_chars": max_chars,
        "max_bytes": max_bytes,
        "compacted": compacted,
        "emergency_compaction": emergency_applied,
        "artifact_bodies_removed": removed_artifacts,
        "largest_context_sections": sorted(
            section_sizes.items(), key=lambda item: (-item[1], item[0])
        )[:6],
    }
    return AgentPayloadBudgetResult(
        payload=candidate,
        text=sanitized_text,
        diagnostics=diagnostics,
    )
