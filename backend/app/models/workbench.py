from sqlmodel import SQLModel


class WorkbenchRecord(SQLModel, table=False):
    name: str
    environment: str
    version: str
    api_base_path: str
    health_path: str

