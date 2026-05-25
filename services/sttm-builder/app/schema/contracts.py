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
    resolved_context = dict(context or {})
    resolved_warnings = list(warnings or [])
    resolved_meta = dict(meta or {})

    if request is not None:
        trace_id = getattr(request.state, "trace_id", None)
        if isinstance(trace_id, str) and trace_id and not resolved_context.get("trace_id"):
            resolved_context["trace_id"] = trace_id

        governance = getattr(request.state, "governance_decision", None)
        if governance is not None:
            for item in getattr(governance, "warnings", []):
                resolved_warnings.append(
                    ApiWarning(code=item.code, message=item.message, field=item.field)
                )
            guardrails_meta = dict(resolved_meta.get("guardrails") or {})
            guardrails_meta.update(
                {
                    "trace_id": getattr(governance, "trace_id", None),
                    "request_id": getattr(governance, "request_id", None),
                    "persona": getattr(governance, "persona", None),
                    "redaction_count": getattr(governance, "redaction_count", 0),
                    "approval_required": getattr(governance, "approval_required", False),
                }
            )
            resolved_meta["guardrails"] = guardrails_meta

    return ApiResponseEnvelope[DataT](
        request_id=resolve_request_id(request, preferred=request_id),
        operation=operation,
        actor=actor,
        context=resolved_context,
        data=data,
        warnings=resolved_warnings,
        error=error,
        meta=resolved_meta,
    )
