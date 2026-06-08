import logging

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.error_codes import ErrorCode
from app.core.exceptions import AppError
from app.schema.contracts import ApiError
from app.schema.errors import ErrorDetail, ErrorResponse

logger = logging.getLogger(__name__)


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """Handles all AppError subclasses — maps code, status, and details to JSON."""
    trace_id = getattr(request.state, "trace_id", None)
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            code=exc.code,
            message=f"{exc.message} [trace_id={trace_id}]" if trace_id else exc.message,
            details=[ErrorDetail(**d) for d in exc.details],
            error=ApiError(
                title=exc.message,
                status=exc.status_code,
                detail=exc.message,
                code=exc.code.value,
            ),
        ).model_dump(),
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
        content=ErrorResponse(
            code=ErrorCode.VALIDATION_ERROR,
            message="Request validation failed",
            details=details,
            error=ApiError(
                title="Request validation failed",
                status=422,
                detail="One or more request fields failed validation.",
                code=ErrorCode.VALIDATION_ERROR.value,
            ),
        ).model_dump(),
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
        content=ErrorResponse(
            code=ErrorCode.INTERNAL_ERROR,
            message=(
                f"An unexpected error occurred. [trace_id={getattr(request.state, 'trace_id', '')}]"
                if getattr(request.state, "trace_id", None)
                else "An unexpected error occurred."
            ),
            error=ApiError(
                title="An unexpected error occurred.",
                status=500,
                detail="An unexpected error occurred.",
                code=ErrorCode.INTERNAL_ERROR.value,
            ),
        ).model_dump(),
    )
