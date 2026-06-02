from fastapi import APIRouter

from app.routers import (
    agents,
    conversation,
    derived_source,
    semantic_context,
    semantic_model,
    sttm_builder,
    table_selection,
    user,
)

router = APIRouter(prefix="/api/v1")
router.include_router(table_selection.router)
router.include_router(derived_source.router)
router.include_router(sttm_builder.router)
router.include_router(conversation.router)
router.include_router(agents.router)
router.include_router(user.router)
router.include_router(semantic_model.router)
router.include_router(semantic_context.router)
