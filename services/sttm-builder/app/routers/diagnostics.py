from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_conversation_memory_service
from app.auth.dependencies import get_current_principal
from app.core.conversation_memory import ConversationMemoryService
from app.core.performance import snapshot
from app.core.read_cache import cache_snapshot
from app.schema.contracts import ApiResponseEnvelope, build_response_envelope


router = APIRouter(prefix="/diagnostics", tags=["Diagnostics"])


@router.get("/readiness", response_model=ApiResponseEnvelope[dict])
def runtime_readiness(
    request: Request,
    memory: Annotated[
        ConversationMemoryService,
        Depends(get_conversation_memory_service),
    ],
):
    get_current_principal(request)
    data = {
        **memory.readiness(),
        "durable_context_caches": memory.prepared_cache_readiness(),
        "performance": snapshot(),
        "backend_read_cache": cache_snapshot(),
    }
    return build_response_envelope(
        operation="diagnostics.readiness",
        request=request,
        data=data,
    )
