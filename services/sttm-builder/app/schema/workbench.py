from pydantic import BaseModel


class WorkbenchInfoResponse(BaseModel):
    name: str
    environment: str
    version: str
    api_base_path: str
    health_path: str
