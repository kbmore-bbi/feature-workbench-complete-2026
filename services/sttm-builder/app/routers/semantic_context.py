from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.api.deps import get_semantic_context_service, get_snowflake_agent_client
from app.core.semantic_context import SemanticContextService
from app.core.snowflake_agent import SnowflakeAgentClient
from app.schema.contracts import ApiRequestEnvelope, ApiResponseEnvelope, build_response_envelope
from app.schema.semantic_context import SemanticContextBundleResponse, SemanticContextRefreshRequest

router = APIRouter(prefix="/semantic-context", tags=["Semantic Context"])


@router.post(
    "/refresh",
    response_model=ApiResponseEnvelope[SemanticContextBundleResponse],
    summary="Refresh or create a semantic bundle for the current source working set",
)
def refresh_semantic_context(
    body: ApiRequestEnvelope[SemanticContextRefreshRequest] | SemanticContextRefreshRequest,
    request: Request,
    service: Annotated[SemanticContextService, Depends(get_semantic_context_service)],
    agent_client: Annotated[SnowflakeAgentClient, Depends(get_snowflake_agent_client)],
) -> ApiResponseEnvelope[SemanticContextBundleResponse]:
    if isinstance(body, SemanticContextRefreshRequest):
        payload = body
        request_id = None
        actor = None
        context: dict[str, object] = {}
        warnings = []
        meta: dict[str, object] = {}
    else:
        payload = body.data
        request_id = body.request_id
        actor = body.actor
        context = body.context
        warnings = body.warnings
        meta = body.meta

    result = service.refresh_bundle(
        payload,
        agent_client=agent_client,
        allow_agent_refresh=False,
    )
    return build_response_envelope(
        operation="semantic_context.refresh",
        request=request,
        request_id=request_id,
        actor=actor,
        context=context,
        warnings=warnings,
        meta=meta,
        data=result,
    )


@router.get(
    "",
    response_model=ApiResponseEnvelope[SemanticContextBundleResponse],
    summary="Fetch semantic bundle state and promotion metadata",
)
def get_semantic_context(
    request: Request,
    bundle_id: Annotated[str | None, Query()] = None,
    bundle_hash: Annotated[str | None, Query()] = None,
    *,
    service: Annotated[SemanticContextService, Depends(get_semantic_context_service)],
) -> ApiResponseEnvelope[SemanticContextBundleResponse]:
    record = service.get_bundle(bundle_id=bundle_id, bundle_hash=bundle_hash)
    if not record:
        empty = SemanticContextBundleResponse(
            bundle_id=bundle_id or "",
            bundle_hash=bundle_hash or "",
            bundle_label=None,
            requested_level="L1_CONTEXT",
            achieved_level="L1_CONTEXT",
            status="failed",
            summary={
                "bundle_id": bundle_id or "",
                "bundle_hash": bundle_hash or "",
                "bundle_label": None,
                "source_table_count": 0,
                "derived_source_count": 0,
                "relationship_count": 0,
                "semantic_level": "L1_CONTEXT",
                "notes": ["bundle not found"],
            },
        )
        return build_response_envelope(
            operation="semantic_context.get",
            request=request,
            context={"bundle_id": bundle_id, "bundle_hash": bundle_hash},
            data=empty,
        )

    response = SemanticContextBundleResponse(
        bundle_id=record["bundle_id"],
        bundle_hash=record["bundle_hash"],
        bundle_label=record.get("bundle_label"),
        requested_level=record["semantic_level"],
        achieved_level=record["semantic_level"],
        semantic_view_name=record["semantic_view_name"],
        status=record["status"],
        promoted=bool(record["semantic_view_name"]),
        summary={
            "bundle_id": record["bundle_id"],
            "bundle_hash": record["bundle_hash"],
            "bundle_label": record.get("bundle_label"),
            "source_table_count": len(record["source_tables"]),
            "derived_source_count": len(record["derived_source_ids"]),
            "relationship_count": len(record["relationships"]),
            "semantic_level": record["semantic_level"],
            "semantic_view_name": record["semantic_view_name"],
            "promoted": bool(record["semantic_view_name"]),
            "tables": [
                ".".join([table["database"], table["schema"], table["table"]])
                for table in record["source_tables"]
                if isinstance(table, dict)
            ],
            "derived_sources": list(record["derived_source_ids"]),
            "notes": [record["stale_reason"]] if record["stale_reason"] else [],
        },
    )
    return build_response_envelope(
        operation="semantic_context.get",
        request=request,
        context={"bundle_id": bundle_id, "bundle_hash": bundle_hash},
        data=response,
    )
