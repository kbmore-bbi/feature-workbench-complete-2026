import uuid
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field
from fastapi import Request


CONTRACT_VERSION = "1.0"
DataT = TypeVar("DataT")


class ApiActor(BaseModel):
    """Caller information that can travel with any workbench payload."""

    user_id: str | None = None
    role: str | None = None


class ApiWarning(BaseModel):
    """Non-fatal warning emitted while normalizing or processing a request."""

    code: str
    message: str
    field: str | None = None


class ApiError(BaseModel):
    """Machine-readable error shape for standardized workbench payloads."""

    type: str = Field(default="about:blank")
    title: str
    status: int | None = None
    detail: str | None = None
    code: str | None = None
    field: str | None = None


class OperationContext(BaseModel):
    """Cross-cutting context shared by APIs, agents, skills, and tools."""

    thread_id: str | None = None
    parent_message_id: int | None = None
    current_role: str | None = None
    current_database: str | None = None
    current_schema: str | None = None
    trace_id: str | None = None


class ApiRequest(BaseModel):
    """Base envelope accepted by new workbench operations."""

    contract_version: Literal["1.0"] = CONTRACT_VERSION
    request_id: str | None = None
    operation: str
    actor: ApiActor | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)
    warnings: list[ApiWarning] = Field(default_factory=list)
    error: ApiError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class ApiRequestEnvelope(BaseModel, Generic[DataT]):
    """Typed request envelope for body-based operations."""

    contract_version: Literal["1.0"] = CONTRACT_VERSION
    request_id: str | None = None
    operation: str
    actor: ApiActor | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    data: DataT
    warnings: list[ApiWarning] = Field(default_factory=list)
    error: ApiError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class ApiResponse(BaseModel):
    """Base envelope returned by standardized workbench operations."""

    contract_version: Literal["1.0"] = CONTRACT_VERSION
    request_id: str | None = None
    operation: str
    actor: ApiActor | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)
    warnings: list[ApiWarning] = Field(default_factory=list)
    error: ApiError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class ApiResponseEnvelope(BaseModel, Generic[DataT]):
    """Typed response envelope for backend routes."""

    contract_version: Literal["1.0"] = CONTRACT_VERSION
    request_id: str
    operation: str
    actor: ApiActor | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    data: DataT
    warnings: list[ApiWarning] = Field(default_factory=list)
    error: ApiError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


def resolve_request_id(
    request: Request | None = None,
    *,
    preferred: str | None = None,
) -> str:
    if preferred:
        return preferred

    if request is not None:
        for header_name in ("x-request-id", "x-correlation-id"):
            header_value = request.headers.get(header_name, "").strip()
            if header_value:
                return header_value

    return str(uuid.uuid4())


def build_response_envelope(
    *,
    operation: str,
    data: DataT,
    request: Request | None = None,
    request_id: str | None = None,
    actor: ApiActor | None = None,
    context: dict[str, Any] | None = None,
    warnings: list[ApiWarning] | None = None,
    error: ApiError | None = None,
    meta: dict[str, Any] | None = None,
) -> ApiResponseEnvelope[DataT]:
    return ApiResponseEnvelope[DataT](
        request_id=resolve_request_id(request, preferred=request_id),
        operation=operation,
        actor=actor,
        context=context or {},
        data=data,
        warnings=warnings or [],
        error=error,
        meta=meta or {},
    )
