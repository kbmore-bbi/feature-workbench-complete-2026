import logging

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
from app.guardrails.config.loader import load_config
from app.guardrails.integrations.fastapi import GuardrailsMiddleware
from app.routers.debug import router as debug_router

_settings = get_settings()
logger = logging.getLogger(__name__)

app = FastAPI(
    title=_settings.app_name,
    version=_settings.app_version,
    docs_url=None,
)
setup_docs(app)
app.add_middleware(GuardrailsMiddleware, config=load_config(settings=_settings))

if _settings.cors_allowed_origins:
    wildcard_requested = _settings.cors_allowed_origins.strip() == "*"
    if wildcard_requested and _settings.non_local_env and not _settings.local_dev_auth_enabled:
        logger.warning(
            "Skipping wildcard CORS configuration in non-local environment: app_env=%s",
            _settings.app_env,
        )
        _origins: list[str] = []
    else:
        _origins = (
            ["*"]
            if wildcard_requested
            else [o.strip() for o in _settings.cors_allowed_origins.split(",") if o.strip()]
        )
    if _settings.local_dev_auth_enabled:
        for origin in ("http://localhost:3000", "http://127.0.0.1:3000"):
            if origin not in _origins:
                _origins.append(origin)
    if _origins:
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
                "X-Request-Id",
                "X-Trace-Id",
            ],
        )

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(RequestValidationError, request_validation_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

app.include_router(router)
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin_router, prefix="/api/v1/admin", tags=["admin"])
if _settings.debug_routes_enabled:
    app.include_router(debug_router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
