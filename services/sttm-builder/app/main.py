from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.api.error_handlers import (
    app_error_handler,
    request_validation_error_handler,
    unhandled_error_handler,
)
from app.auth.router import admin_router, auth_router
from app.core.config import get_settings
from app.core.docs import setup_docs
from app.core.exceptions import AppError
from app.routers.debug import router as debug_router

_settings = get_settings()

app = FastAPI(
    title=_settings.app_name,
    version=_settings.app_version,
    docs_url=None,
)
setup_docs(app)

if _settings.cors_allowed_origins:
    _origins = (
        ["*"]
        if _settings.cors_allowed_origins.strip() == "*"
        else [o.strip() for o in _settings.cors_allowed_origins.split(",") if o.strip()]
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "Accept",
            "Sf-Context-Current-User",
            "Sf-Context-Current-User-Email",
            "Sf-Context-Current-User-Token",
        ],
    )

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(RequestValidationError, request_validation_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

app.include_router(router)
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin_router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(debug_router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
