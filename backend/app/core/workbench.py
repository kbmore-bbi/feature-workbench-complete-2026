from app.config import Settings
from app.models.workbench import WorkbenchRecord
from app.schemas.workbench import WorkbenchInfoResponse


def get_workbench_info(settings: Settings) -> WorkbenchInfoResponse:
    snapshot = WorkbenchRecord(
        name=settings.app_name,
        environment=settings.app_env,
        version=settings.app_version,
        api_base_path="/api/v1",
        health_path="/healthz",
    )
    return WorkbenchInfoResponse.model_validate(snapshot.model_dump())
