from typing import Optional

from pydantic import BaseModel

from app.schema.contracts import CONTRACT_VERSION, ApiError


class ErrorDetail(BaseModel):
    field: Optional[str] = None
    message: str


class ErrorResponse(BaseModel):
    contract_version: str = CONTRACT_VERSION
    code: str
    message: str
    details: list[ErrorDetail] = []
    error: ApiError | None = None
