from fastapi import APIRouter

from app.routers import (
    agents,
    conversation,
    dbt_conversion,
    derived_source,
    export_workbook,
    mapping_sql,
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
router.include_router(mapping_sql.router)
router.include_router(dbt_conversion.router)
router.include_router(export_workbook.router)
router.include_router(agents.router)
router.include_router(user.router)
router.include_router(semantic_model.router)
router.include_router(semantic_context.router)
