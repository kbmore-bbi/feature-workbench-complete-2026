from fastapi import APIRouter

from app.routers import agents, auto_mapping, table_selection, user

router = APIRouter(prefix="/api/sttm-builder/v1")
router.include_router(table_selection.router)
router.include_router(auto_mapping.router)
router.include_router(agents.router)
router.include_router(user.router)
