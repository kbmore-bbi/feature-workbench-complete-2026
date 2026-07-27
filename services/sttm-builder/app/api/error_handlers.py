import logging

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.error_codes import ErrorCode
from app.core.exceptions import AppError
from app.schema.contracts import ApiError, build_response_envelope
from app.schema.errors import ErrorDetail

logger = logging.getLogger(__name__)


def _error_operation(request: Request) -> str:
    route = request.scope.get("route")
    route_name = getattr(route, "name", "")
    return str(route_name or "http.error")


def _error_content(
    request: Request,
    *,
    title: str,
    status: int,
    code: str,
    detail: str | None = None,
    details: list[ErrorDetail] | None = None,
) -> dict:
    return build_response_envelope(
        operation=_error_operation(request),
        request=request,
        data=None,
        error=ApiError(
            title=title,
            status=status,
            detail=detail or title,
            code=code,
        ),
        meta={
            "details": [item.model_dump(mode="json") for item in details or []],
        },
    ).model_dump(mode="json")


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """Handles all AppError subclasses — maps code, status, and details to JSON."""
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_content(
            request,
            title=exc.message,
            status=exc.status_code,
            detail=exc.message,
            code=exc.code.value,
            details=[ErrorDetail(**d) for d in exc.details],
        ),
    )


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    code = {
        400: ErrorCode.VALIDATION_ERROR.value,
        401: ErrorCode.UNAUTHENTICATED.value,
        403: ErrorCode.FORBIDDEN.value,
        404: ErrorCode.NOT_FOUND.value,
    }.get(exc.status_code, ErrorCode.INTERNAL_ERROR.value)
    return JSONResponse(
        status_code=exc.status_code,
        headers=exc.headers,
        content=_error_content(
            request,
            title=detail,
            status=exc.status_code,
            detail=detail,
            code=code,
        ),
    )


async def request_validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """
    Handles Pydantic / FastAPI request-parsing failures (422).
    Flattens each error's `loc` into a dot-path field name.
    """
    details = [
        ErrorDetail(
            field=".".join(str(loc) for loc in err["loc"]),
            message=err["msg"],
        )
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content=_error_content(
            request,
            title="Request validation failed",
            status=422,
            detail="One or more request fields failed validation.",
            code=ErrorCode.VALIDATION_ERROR.value,
            details=details,
        ),
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all for any exception that escapes the handler chain.
    Logs the full traceback server-side; returns a safe generic message to the caller.
    """
    logger.exception(
        "Unhandled exception [%s %s]", request.method, request.url.path
    )
    return JSONResponse(
        status_code=500,
        content=_error_content(
            request,
            title="An unexpected error occurred.",
            status=500,
            detail="An unexpected error occurred.",
            code=ErrorCode.INTERNAL_ERROR.value,
        ),
    )
