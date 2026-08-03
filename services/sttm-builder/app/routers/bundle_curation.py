from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import get_bundle_curation_service
from app.auth.dependencies import get_current_principal
from app.core.bundle_curation import (
    BundleCurationError,
    BundleCurationService,
    BundleCurationStaleError,
)
from app.schema.bundle_curation import (
    BundleCurationPreview,
    BundleCurationPromotionRequest,
    BundleCurationPromotionResponse,
    BundleCurationRecord,
)


router = APIRouter(
    prefix="/workbench/bundle-curations",
    tags=["Bundle Curations"],
)


@router.get("/{bundle_version_id}", response_model=BundleCurationRecord)
def get_bundle_curation(
    bundle_version_id: str,
    service: Annotated[BundleCurationService, Depends(get_bundle_curation_service)],
) -> BundleCurationRecord:
    result = service.get(bundle_version_id)
    if result is None:
        raise HTTPException(404, "Bundle curation draft was not found.")
    return result


@router.post("/{bundle_version_id}/preview", response_model=BundleCurationPreview)
def preview_bundle_curation(
    bundle_version_id: str,
    body: BundleCurationPromotionRequest,
    service: Annotated[BundleCurationService, Depends(get_bundle_curation_service)],
) -> BundleCurationPreview:
    try:
        return service.preview(bundle_version_id, body)
    except BundleCurationStaleError as exc:
        raise HTTPException(409, str(exc)) from exc
    except BundleCurationError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post(
    "/{bundle_version_id}/promote",
    response_model=BundleCurationPromotionResponse,
)
def promote_bundle_curation(
    bundle_version_id: str,
    body: BundleCurationPromotionRequest,
    request: Request,
    service: Annotated[BundleCurationService, Depends(get_bundle_curation_service)],
) -> BundleCurationPromotionResponse:
    principal = get_current_principal(request)
    if not principal.permissions.can_edit:
        raise HTTPException(403, "Bundle promotion permission is required.")
    actor_id = principal.snowflake_user or str(principal.user_id)
    try:
        return service.promote(
            bundle_version_id,
            body,
            actor_id=actor_id,
        )
    except BundleCurationStaleError as exc:
        raise HTTPException(409, str(exc)) from exc
    except BundleCurationError as exc:
        raise HTTPException(422, str(exc)) from exc
