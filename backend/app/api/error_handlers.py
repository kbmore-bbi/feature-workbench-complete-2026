from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.exceptions import WorkbenchError


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(WorkbenchError)
    async def handle_workbench_error(_: Request, exc: WorkbenchError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                }
            },
        )

