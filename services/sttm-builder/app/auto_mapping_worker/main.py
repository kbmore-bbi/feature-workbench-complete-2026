from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError

from app.api.error_handlers import (
    app_error_handler,
    http_exception_handler,
    request_validation_error_handler,
    unhandled_error_handler,
)
from app.auto_mapping_worker.router import router as auto_mapping_router
from app.core.docs import setup_docs
from app.core.config import get_settings
from app.core.exceptions import AppError

_settings = get_settings()

app = FastAPI(
    title=f"{_settings.app_name} Auto Mapping Worker",
    version=_settings.app_version,
    docs_url=None,
)
setup_docs(app)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, request_validation_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

app.include_router(auto_mapping_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
