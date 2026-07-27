from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import get_project_service
from app.auth.dependencies import get_current_principal
from app.core.exceptions import SnowflakeQueryError
from app.core.project_service import ProjectService
from app.schema.contracts import ApiActor, ApiRequestEnvelope, ApiResponseEnvelope, build_response_envelope
from app.schema.project import (
    MappingPrecedentLinkRecord,
    MappingPrecedentLinksUpdate,
    ProjectCreateRequest,
    ProjectRecord,
    ProjectPrecedentLinkRecord,
    ProjectPrecedentLinksUpdate,
    ProjectsSummaryResponse,
    STTMAutosaveRequest,
    STTMAutosaveResponse,
    STTMCreateRequest,
    STTMDetailResponse,
    STTMPublishRequest,
    STTMPublishResponse,
    STTMRecord,
)

router = APIRouter(tags=["Projects"])


def _actor_from_request(request: Request) -> ApiActor:
    principal = get_current_principal(request)
    return ApiActor(
        user_id=principal.snowflake_user or str(principal.user_id),
        role=principal.snowflake_role,
    )


def _user_id(request: Request) -> str:
    """Get the user identifier for database operations."""
    principal = get_current_principal(request)
    return principal.snowflake_user or str(principal.user_id)


def _project_creator_id(request: Request) -> str:
    """Return the stable numeric id required by legacy TBL_PROJECTS schemas."""
    return str(get_current_principal(request).user_id)


def _user_display_name(request: Request) -> str:
    """Get a human-readable display name for the user.

    Priority: display_name > snowflake_user > email prefix > 'User {id}'
    """
    principal = get_current_principal(request)
    if principal.display_name:
        return principal.display_name
    if principal.snowflake_user:
        return principal.snowflake_user
    if principal.email and "@" in principal.email:
        return principal.email.split("@")[0]
    return f"User {principal.user_id}"


def _require_edit(request: Request) -> None:
    principal = get_current_principal(request)
    if not principal.permissions.can_edit:
        raise HTTPException(status_code=403, detail="Project edit permission is required.")


def _require_publish(request: Request) -> None:
    principal = get_current_principal(request)
    if not principal.permissions.can_publish:
        raise HTTPException(status_code=403, detail="Project publish permission is required.")


def _unwrap(body, expected_type):
    if isinstance(body, expected_type):
        return body
    if isinstance(body, ApiRequestEnvelope):
        return body.data
    return expected_type.model_validate(body)


@router.get("/projects/summary", response_model=ApiResponseEnvelope[ProjectsSummaryResponse])
def get_projects_summary(
    request: Request,
    service: Annotated[ProjectService, Depends(get_project_service)],
) -> ApiResponseEnvelope[ProjectsSummaryResponse]:
    """Return all projects and all STTMs in a single response — avoids N+1 per-project fetches."""
    get_current_principal(request)
    projects, sttms = service.list_all_projects_summary()
    return build_response_envelope(
        operation="projects.summary",
        request=request,
        actor=_actor_from_request(request),
        data=ProjectsSummaryResponse(projects=projects, sttms=sttms),
    )


@router.get("/projects", response_model=ApiResponseEnvelope[list[ProjectRecord]])
def list_projects(
    request: Request,
    service: Annotated[ProjectService, Depends(get_project_service)],
) -> ApiResponseEnvelope[list[ProjectRecord]]:
    get_current_principal(request)
    return build_response_envelope(
        operation="projects.list",
        request=request,
        actor=_actor_from_request(request),
        data=service.list_projects(),
    )


@router.post("/projects", response_model=ApiResponseEnvelope[ProjectRecord])
def create_project(
    request: Request,
    body: ApiRequestEnvelope[ProjectCreateRequest] | ProjectCreateRequest,
    service: Annotated[ProjectService, Depends(get_project_service)],
) -> ApiResponseEnvelope[ProjectRecord]:
    _require_edit(request)
    payload = _unwrap(body, ProjectCreateRequest)
    try:
        data = service.create_project(
            payload,
            user_id=_project_creator_id(request),
            display_name=_user_display_name(request),
        )
    except SnowflakeQueryError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return build_response_envelope(
        operation="projects.create",
        request=request,
        request_id=getattr(body, "request_id", None),
        actor=_actor_from_request(request),
        data=data,
    )


@router.get("/projects/{project_id}/sttms", response_model=ApiResponseEnvelope[list[STTMRecord]])
def list_project_sttms(
    request: Request,
    project_id: str,
    service: Annotated[ProjectService, Depends(get_project_service)],
) -> ApiResponseEnvelope[list[STTMRecord]]:
    get_current_principal(request)
    return build_response_envelope(
        operation="projects.sttms.list",
        request=request,
        actor=_actor_from_request(request),
        context={"project_id": project_id},
        data=service.list_sttms(project_id),
    )


@router.post("/projects/{project_id}/sttms", response_model=ApiResponseEnvelope[STTMRecord])
def create_project_sttm(
    request: Request,
    project_id: str,
    body: ApiRequestEnvelope[STTMCreateRequest] | STTMCreateRequest,
    service: Annotated[ProjectService, Depends(get_project_service)],
) -> ApiResponseEnvelope[STTMRecord]:
    _require_edit(request)
    payload = _unwrap(body, STTMCreateRequest)
    try:
        data = service.create_sttm(
            project_id,
            payload,
            user_id=_user_id(request),
            session_id=getattr(body, "context", {}).get("session_id") if hasattr(body, "context") else None,
            thread_id=getattr(body, "context", {}).get("thread_id") if hasattr(body, "context") else None,
        )
    except SnowflakeQueryError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return build_response_envelope(
        operation="projects.sttms.create",
        request=request,
        request_id=getattr(body, "request_id", None),
        actor=_actor_from_request(request),
        context={"project_id": project_id},
        data=data,
    )


@router.get(
    "/projects/{project_id}/precedent-links",
    response_model=ApiResponseEnvelope[list[ProjectPrecedentLinkRecord]],
)
def list_project_precedent_links(
    request: Request,
    project_id: str,
    service: Annotated[ProjectService, Depends(get_project_service)],
) -> ApiResponseEnvelope[list[ProjectPrecedentLinkRecord]]:
    get_current_principal(request)
    return build_response_envelope(
        operation="projects.precedent_links.list",
        request=request,
        actor=_actor_from_request(request),
        context={"project_id": project_id},
        data=service.list_project_links(project_id),
    )


@router.put(
    "/projects/{project_id}/precedent-links",
    response_model=ApiResponseEnvelope[list[ProjectPrecedentLinkRecord]],
)
def replace_project_precedent_links(
    request: Request,
    project_id: str,
    body: ApiRequestEnvelope[ProjectPrecedentLinksUpdate] | ProjectPrecedentLinksUpdate,
    service: Annotated[ProjectService, Depends(get_project_service)],
) -> ApiResponseEnvelope[list[ProjectPrecedentLinkRecord]]:
    _require_edit(request)
    payload = _unwrap(body, ProjectPrecedentLinksUpdate)
    return build_response_envelope(
        operation="projects.precedent_links.replace",
        request=request,
        request_id=getattr(body, "request_id", None),
        actor=_actor_from_request(request),
        context={"project_id": project_id},
        data=service.replace_project_links(project_id, payload, user_id=_user_id(request)),
    )


@router.get(
    "/sttms/{sttm_id}/precedent-links",
    response_model=ApiResponseEnvelope[list[MappingPrecedentLinkRecord]],
)
def list_mapping_precedent_links(
    request: Request,
    sttm_id: str,
    service: Annotated[ProjectService, Depends(get_project_service)],
) -> ApiResponseEnvelope[list[MappingPrecedentLinkRecord]]:
    get_current_principal(request)
    return build_response_envelope(
        operation="sttms.precedent_links.list",
        request=request,
        actor=_actor_from_request(request),
        context={"sttm_id": sttm_id},
        data=service.list_mapping_links(sttm_id),
    )


@router.put(
    "/sttms/{sttm_id}/precedent-links",
    response_model=ApiResponseEnvelope[list[MappingPrecedentLinkRecord]],
)
def replace_mapping_precedent_links(
    request: Request,
    sttm_id: str,
    body: ApiRequestEnvelope[MappingPrecedentLinksUpdate] | MappingPrecedentLinksUpdate,
    service: Annotated[ProjectService, Depends(get_project_service)],
) -> ApiResponseEnvelope[list[MappingPrecedentLinkRecord]]:
    _require_edit(request)
    payload = _unwrap(body, MappingPrecedentLinksUpdate)
    return build_response_envelope(
        operation="sttms.precedent_links.replace",
        request=request,
        request_id=getattr(body, "request_id", None),
        actor=_actor_from_request(request),
        context={"sttm_id": sttm_id},
        data=service.replace_mapping_links(sttm_id, payload, user_id=_user_id(request)),
    )


@router.get("/sttms/{sttm_id}", response_model=ApiResponseEnvelope[STTMDetailResponse])
def get_sttm(
    request: Request,
    sttm_id: str,
    service: Annotated[ProjectService, Depends(get_project_service)],
) -> ApiResponseEnvelope[STTMDetailResponse]:
    get_current_principal(request)
    detail = service.get_sttm_detail(sttm_id)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"STTM {sttm_id} was not found.")
    return build_response_envelope(
        operation="sttms.get",
        request=request,
        actor=_actor_from_request(request),
        context={"sttm_id": sttm_id},
        data=detail,
    )


@router.post("/sttms/{sttm_id}/autosave", response_model=ApiResponseEnvelope[STTMAutosaveResponse])
def autosave_sttm(
    request: Request,
    sttm_id: str,
    body: ApiRequestEnvelope[STTMAutosaveRequest] | STTMAutosaveRequest,
    service: Annotated[ProjectService, Depends(get_project_service)],
) -> ApiResponseEnvelope[STTMAutosaveResponse]:
    _require_edit(request)
    payload = _unwrap(body, STTMAutosaveRequest)
    try:
        data = service.autosave_sttm(sttm_id, payload, user_id=_user_id(request))
    except SnowflakeQueryError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return build_response_envelope(
        operation="sttms.autosave",
        request=request,
        request_id=getattr(body, "request_id", None),
        actor=_actor_from_request(request),
        context={"sttm_id": sttm_id},
        data=data,
    )


@router.post("/sttms/{sttm_id}/publish", response_model=ApiResponseEnvelope[STTMPublishResponse])
def publish_sttm(
    request: Request,
    sttm_id: str,
    body: ApiRequestEnvelope[STTMPublishRequest] | STTMPublishRequest,
    service: Annotated[ProjectService, Depends(get_project_service)],
) -> ApiResponseEnvelope[STTMPublishResponse]:
    _require_publish(request)
    payload = _unwrap(body, STTMPublishRequest)
    try:
        data = service.publish_sttm(sttm_id, payload, user_id=_user_id(request))
    except SnowflakeQueryError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return build_response_envelope(
        operation="sttms.publish",
        request=request,
        request_id=getattr(body, "request_id", None),
        actor=_actor_from_request(request),
        context={"sttm_id": sttm_id},
        data=data,
    )
