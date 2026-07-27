from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import (
    get_auto_mapping_proxy_client,
    get_automap_snowflake_client,
    get_snowflake_client,
    get_sttm_builder_service,
)
from app.auth.dependencies import get_current_principal
from app.core.auto_mapping_proxy import AutoMappingProxyClient
from app.core.sttm_builder import STTMBuilderService
from app.core.snowflake import SnowflakeClient
from app.schema.contracts import ApiResponseEnvelope, build_response_envelope
from app.schema.sttm_builder import Interface, STTMBuilderEnvelopeRequest, STTMBuilderRequest

from app.routers import (
    agents,
    agent_gateway,
    artifacts,
    conversation,
    coco,
    dbt_conversion,
    derived_source,
    export_workbook,
    fir_admin,
    fir_learning,
    mapping_sql,
    prepared_context,
    projects,
    semantic_context,
    semantic_model,
    sttm_builder,
    table_selection,
    test_case_generation,
    user,
)

router = APIRouter(prefix="/api/v1")
router.include_router(table_selection.router)
router.include_router(derived_source.router)
router.include_router(sttm_builder.router)
router.include_router(agent_gateway.router)
router.include_router(artifacts.router)
router.include_router(conversation.router)
router.include_router(coco.router)
router.include_router(mapping_sql.router)
router.include_router(prepared_context.router)
router.include_router(projects.router)
router.include_router(dbt_conversion.router)
router.include_router(test_case_generation.router)
router.include_router(export_workbook.router)
router.include_router(agents.router)
router.include_router(user.router)
router.include_router(semantic_model.router)
router.include_router(semantic_context.router)
router.include_router(fir_admin.router)
router.include_router(fir_learning.router)


@router.post("/workbench/auto-map-jobs", status_code=202)
def start_auto_map_job(
    request: Request,
    body: STTMBuilderEnvelopeRequest | STTMBuilderRequest,
    service: Annotated[STTMBuilderService, Depends(get_sttm_builder_service)],
    proxy: Annotated[AutoMappingProxyClient, Depends(get_auto_mapping_proxy_client)],
    client: Annotated[SnowflakeClient, Depends(get_automap_snowflake_client)],
) -> ApiResponseEnvelope[dict]:
    normalized, _decision = sttm_builder._apply_sttm_preflight(request, body)
    if normalized.data.intent != Interface.AUTO_MAP:
        raise HTTPException(status_code=400, detail="The request is not an Auto-map operation")
    if not proxy.enabled:
        raise HTTPException(
            status_code=503,
            detail="The Auto-map worker service is not configured for this environment",
        )
    prepared = service.prepare_auto_map_request(normalized)
    job = proxy.start_job(request, prepared, session=client.session)
    return build_response_envelope(
        operation="sttm.auto_map.job.start",
        request=request,
        request_id=prepared.request_id,
        data=job,
    )


@router.get("/workbench/auto-map-jobs/{job_id}")
def get_auto_map_job(
    request: Request,
    job_id: str,
    proxy: Annotated[AutoMappingProxyClient, Depends(get_auto_mapping_proxy_client)],
    client: Annotated[SnowflakeClient, Depends(get_automap_snowflake_client)],
) -> ApiResponseEnvelope[dict]:
    get_current_principal(request)
    job = proxy.get_job(request, job_id, session=client.session)
    return build_response_envelope(
        operation="sttm.auto_map.job.get",
        request=request,
        request_id=str(job.get("request_id") or ""),
        data=job,
    )
