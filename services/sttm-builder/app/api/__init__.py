from fastapi import APIRouter

from app.routers import agents, semantic_model, sttm_builder, table_selection, user

router = APIRouter(prefix="/api/v1")
router.include_router(table_selection.router)
router.include_router(sttm_builder.router)
router.include_router(agents.router)
router.include_router(user.router)
router.include_router(semantic_model.router)
