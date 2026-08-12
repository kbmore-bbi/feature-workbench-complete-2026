import logging
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.api.error_handlers import (
    app_error_handler,
    http_exception_handler,
    request_validation_error_handler,
    unhandled_error_handler,
)
from app.auth.router import admin_router, auth_router
from app.core.config import get_settings
from app.core.docs import setup_docs
from app.core.exceptions import AppError
from app.core.performance import observe, snapshot
from app.guardrails.config.loader import load_config
from app.guardrails.integrations.fastapi import GuardrailsMiddleware
from app.routers.auto_mapping import router as auto_mapping_router
from app.routers.debug import router as debug_router
from app.routers.notifications import router as notifications_router
from app.routers.upload import router as upload_router

_settings = get_settings()
logger = logging.getLogger(__name__)

app = FastAPI(
    title=_settings.app_name,
    version=_settings.app_version,
    docs_url=None,
)
setup_docs(app)
app.add_middleware(GuardrailsMiddleware, config=load_config(settings=_settings))

_origins: list[str] = []
if _settings.cors_allowed_origins:
    wildcard_requested = _settings.cors_allowed_origins.strip() == "*"
    if wildcard_requested and _settings.non_local_env and not _settings.local_dev_auth_enabled:
        logger.warning(
            "Skipping wildcard CORS configuration in non-local environment: app_env=%s",
            _settings.app_env,
        )
    else:
        _origins.extend(
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
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "Accept",
            "Authorization",
            "Sf-Context-Current-User",
            "Sf-Context-Current-User-Email",
            "Sf-Context-Current-User-Token",
            "X-Workbench-OAuth-Access-Token",
            "X-Workbench-OAuth-User",
            "X-Workbench-OAuth-Email",
            "X-Workbench-OAuth-Role",
            "X-Request-Id",
            "X-Trace-Id",
        ],
        max_age=3600,
    )

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, request_validation_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

app.include_router(router)
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(admin_router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(auto_mapping_router, prefix="/api/v1", tags=["Auto Mapping"])
app.include_router(upload_router, prefix="/api/v1", tags=["Upload"])
app.include_router(notifications_router, prefix="/api/v1", tags=["Notifications"])
if _settings.debug_routes_enabled:
    app.include_router(debug_router)


@app.middleware("http")
async def workbench_timing_headers(request: Request, call_next):
    started = time.perf_counter()
    request.state.workbench_timings_ms = {}
    try:
        response = await call_next(request)
    finally:
        lease_pool = getattr(request.state, "snowflake_learning_lease_pool", None)
        if lease_pool is not None:
            lease_pool.close()
    timings = getattr(request.state, "workbench_timings_ms", {}) or {}
    total_ms = (time.perf_counter() - started) * 1000
    observe(f"http.{request.method.lower()}.{request.url.path}.total", total_ms)
    if not _settings.perf_diagnostics_v1:
        return response
    response.headers["x-workbench-timing-total-ms"] = f"{total_ms:.1f}"
    response.headers["x-workbench-timing-auth-ms"] = f"{float(timings.get('auth', 0.0)):.1f}"
    response.headers["x-workbench-timing-session-ms"] = f"{float(timings.get('session', 0.0)):.1f}"
    response.headers["x-workbench-timing-snowflake-ms"] = f"{float(timings.get('snowflake', 0.0)):.1f}"
    response.headers["x-workbench-timing-agent-ms"] = f"{float(timings.get('agent', 0.0)):.1f}"
    if cache_hit := timings.get("cache_hit"):
        response.headers["x-workbench-cache-hit"] = str(cache_hit).lower()
    server_timing = [f"total;dur={total_ms:.1f}"]
    for name in (
        "auth",
        "session",
        "snowflake",
        "semantic_refresh",
        "prepared_context",
        "fir",
        "agent",
    ):
        duration = float(timings.get(name, 0.0) or 0.0)
        if duration > 0:
            server_timing.append(f"{name};dur={duration:.1f}")
    response.headers["Server-Timing"] = ", ".join(server_timing)
    return response


@app.get("/health")
def health():
    return {
        "status": "ok",
        "auto_map_pipeline": "v2" if _settings.auto_map_pipeline_v2 else "legacy",
        "mapping_agent_spec_hashes": {
            "AGT_SOURCE_MAPPING": _settings.agent_spec_source_mapping_sha256 or None,
            "AGT_TRANSFORMATION_RULE": _settings.agent_spec_transformation_rule_sha256 or None,
        },
    }


@app.get("/health/performance")
def performance_health():
    if not _settings.perf_diagnostics_v1:
        raise HTTPException(status_code=404, detail="Performance diagnostics are disabled")
    return snapshot()


@app.get("/healthz")
def healthz():
    return health()
