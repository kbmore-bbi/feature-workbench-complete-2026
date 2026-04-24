from fastapi import APIRouter

from app.routers import agents, sttm_builder, table_selection, user

router = APIRouter(prefix="/v1")
router.include_router(table_selection.router)
router.include_router(sttm_builder.router)
router.include_router(agents.router)
router.include_router(user.router)
