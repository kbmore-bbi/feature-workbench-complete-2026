from fastapi import APIRouter

from app.config import get_settings
from app.core.workbench import get_workbench_info
from app.schemas.workbench import WorkbenchInfoResponse


router = APIRouter()


@router.get("/info", response_model=WorkbenchInfoResponse)
def workbench_info() -> WorkbenchInfoResponse:
    return get_workbench_info(get_settings())

