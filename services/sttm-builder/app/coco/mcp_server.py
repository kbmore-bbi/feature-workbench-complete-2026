from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("workbench")


def _read_json(path: str) -> dict[str, Any]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else {}


def _headers() -> dict[str, str]:
    token_path = os.environ.get("COCO_TOKEN_FILE", "")
    token = Path(token_path).read_text(encoding="utf-8").strip() if token_path else ""
    return {
        "Content-Type": "application/json",
        "X-Workbench-OAuth-Access-Token": token,
        "X-Workbench-OAuth-User": os.environ.get("COCO_REQUEST_USER", ""),
        "X-Workbench-OAuth-Email": os.environ.get("COCO_REQUEST_USER", ""),
        "X-Workbench-OAuth-Role": os.environ.get("COCO_REQUEST_ROLE", ""),
    }


@mcp.tool()
def get_workspace_snapshot() -> dict[str, Any]:
    """Return the exact WorkbenchContextSnapshotV1 attached to this CoCo session."""
    return _read_json(os.environ["COCO_CONTEXT_FILE"])


@mcp.tool()
def read_product_knowledge() -> str:
    """Read the versioned STTM Workbench product and architecture knowledge."""
    knowledge = Path(os.environ.get("COCO_KNOWLEDGE_DIR", "/app/knowledge"))
    return (knowledge / "STTM_WORKBENCH.md").read_text(encoding="utf-8")


@mcp.tool()
def inspect_service_health() -> dict[str, Any]:
    """Read sanitized health for the main Workbench API."""
    base = os.environ.get("COCO_WORKBENCH_API_URL", "http://127.0.0.1:8000").rstrip("/")
    response = httpx.get(f"{base}/health", timeout=10)
    response.raise_for_status()
    return response.json()


@mcp.tool()
def get_semantic_bundle(bundle_id: str = "", bundle_hash: str = "") -> dict[str, Any]:
    """Read one saved semantic bundle by stable ID or hash."""
    base = os.environ.get("COCO_WORKBENCH_API_URL", "http://127.0.0.1:8000").rstrip("/")
    response = httpx.get(
        f"{base}/api/v1/semantic-context",
        params={"bundle_id": bundle_id or None, "bundle_hash": bundle_hash or None},
        headers=_headers(),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


@mcp.tool()
def invoke_sttm_builder(envelope: dict[str, Any]) -> dict[str, Any]:
    """Invoke the product STTM orchestrator using a standard envelope 1.0 request."""
    if envelope.get("contract_version") != "1.0":
        raise ValueError("invoke_sttm_builder requires contract_version 1.0")
    base = os.environ.get("COCO_WORKBENCH_API_URL", "http://127.0.0.1:8000").rstrip("/")
    response = httpx.post(
        f"{base}/api/v1/sttm-builder/invoke",
        json=envelope,
        headers=_headers(),
        timeout=300,
    )
    response.raise_for_status()
    return response.json()


@mcp.tool()
def invoke_source_mapping(envelope: dict[str, Any]) -> dict[str, Any]:
    """Invoke AGT_SOURCE_MAPPING through the governed Workbench STTM endpoint."""
    if envelope.get("contract_version") != "1.0":
        raise ValueError("invoke_source_mapping requires contract_version 1.0")
    payload = dict(envelope)
    data = dict(payload.get("data") or {})
    context = dict(payload.get("context") or {})
    data["intent"] = "AUTO_MAP"
    data["intent_route"] = "source_mapping"
    context["routing_hint"] = "source_mapping"
    payload["operation"] = "sttm.auto_map"
    payload["data"] = data
    payload["context"] = context
    return invoke_sttm_builder(payload)


@mcp.tool()
def invoke_transformation_rule(envelope: dict[str, Any]) -> dict[str, Any]:
    """Invoke AGT_TRANSFORMATION_RULE through the governed Workbench STTM endpoint."""
    if envelope.get("contract_version") != "1.0":
        raise ValueError("invoke_transformation_rule requires contract_version 1.0")
    payload = dict(envelope)
    data = dict(payload.get("data") or {})
    context = dict(payload.get("context") or {})
    data["intent"] = "TRANSFORM"
    data["intent_route"] = "transformation_rule"
    context["routing_hint"] = "transformation_rule"
    payload["operation"] = "sttm.transform"
    payload["data"] = data
    payload["context"] = context
    return invoke_sttm_builder(payload)


@mcp.tool()
def invoke_analyst(envelope: dict[str, Any]) -> dict[str, Any]:
    """Ask STTM Builder to route an Analyst-backed SQL or derived-source request."""
    if envelope.get("contract_version") != "1.0":
        raise ValueError("invoke_analyst requires contract_version 1.0")
    payload = dict(envelope)
    data = dict(payload.get("data") or {})
    context = dict(payload.get("context") or {})
    data["intent"] = data.get("intent") or "CHAT"
    data["intent_route"] = "analyst_sql_or_derived_source"
    context["routing_hint"] = "analyst_sql_or_derived_source"
    payload["operation"] = payload.get("operation") or "sttm.chat"
    payload["data"] = data
    payload["context"] = context
    return invoke_sttm_builder(payload)


@mcp.tool()
def validate_sql(envelope: dict[str, Any]) -> dict[str, Any]:
    """Review generated mapping SQL using the Workbench SQL validation endpoint."""
    if envelope.get("contract_version") != "1.0":
        raise ValueError("validate_sql requires contract_version 1.0")
    base = os.environ.get("COCO_WORKBENCH_API_URL", "http://127.0.0.1:8000").rstrip("/")
    response = httpx.post(
        f"{base}/api/v1/workbench/mapping-sql/review",
        json=envelope,
        headers=_headers(),
        timeout=300,
    )
    response.raise_for_status()
    return response.json()


@mcp.tool()
def run_preview(envelope: dict[str, Any]) -> dict[str, Any]:
    """Run a limited SQL preview using the Workbench preview endpoint."""
    if envelope.get("contract_version") != "1.0":
        raise ValueError("run_preview requires contract_version 1.0")
    base = os.environ.get("COCO_WORKBENCH_API_URL", "http://127.0.0.1:8000").rstrip("/")
    response = httpx.post(
        f"{base}/api/v1/workbench/mapping-sql/preview",
        json=envelope,
        headers=_headers(),
        timeout=300,
    )
    response.raise_for_status()
    return response.json()


@mcp.tool()
def get_mapping_rows() -> dict[str, Any]:
    """Return mapping rows from the current workspace snapshot attached to this session."""
    snapshot = get_workspace_snapshot()
    return {
        "mapping_rows": snapshot.get("mapping_rows") or [],
        "checked_mapping_row_ids": snapshot.get("checked_mapping_row_ids") or [],
        "active_mapping_row_id": snapshot.get("active_mapping_row_id"),
        "mapping_version": snapshot.get("mapping_version"),
    }


@mcp.tool()
def get_auto_map_job_status(job_id: str) -> dict[str, Any]:
    """Read an Auto-map job by ID through the Workbench API."""
    base = os.environ.get("COCO_WORKBENCH_API_URL", "http://127.0.0.1:8000").rstrip("/")
    response = httpx.get(
        f"{base}/api/v1/workbench/auto-map-jobs/{job_id}",
        headers=_headers(),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


@mcp.tool()
def apply_mapping_patch(patch: dict[str, Any]) -> dict[str, Any]:
    """Prepare a mapping patch for UI approval; direct commits must happen through the UI."""
    if not isinstance(patch, dict):
        raise ValueError("apply_mapping_patch requires an object patch")
    return {
        "contract_version": "1.0",
        "status": "approval_required",
        "message": "Mapping patches are prepared for UI review and are not committed directly by CoCo/MCP.",
        "patch": patch,
    }


if __name__ == "__main__":
    mcp.run()
