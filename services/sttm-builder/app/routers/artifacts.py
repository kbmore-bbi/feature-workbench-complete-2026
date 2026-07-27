"""Authorized, partial hydration for content-addressed agent artifacts."""

from __future__ import annotations

import hashlib
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.api.deps import get_conversation_memory_service
from app.auth.dependencies import get_current_principal
from app.core.conversation_memory import ConversationMemoryService
from app.schema.contracts import ApiResponseEnvelope, build_response_envelope

router = APIRouter(prefix="/workbench/artifacts", tags=["Agent Artifacts"])


@router.get("/{artifact_id}")
def get_artifact(
    request: Request,
    artifact_id: str,
    memory: Annotated[
        ConversationMemoryService,
        Depends(get_conversation_memory_service),
    ],
    section: str | None = Query(default=None),
    start: int | None = Query(default=None, ge=0),
    end: int | None = Query(default=None, ge=0),
) -> ApiResponseEnvelope[dict]:
    """Hydrate only an authorized artifact or a requested bounded section."""

    principal = get_current_principal(request)
    fingerprint = hashlib.sha256(str(principal.user_id).encode("utf-8")).hexdigest()
    artifact = memory.get_agent_artifact(
        artifact_id,
        access_fingerprint=fingerprint,
        section=section,
        start=start,
        end=end,
    )
    return build_response_envelope(
        operation="workbench.artifact.get",
        request=request,
        data=artifact,
    )
