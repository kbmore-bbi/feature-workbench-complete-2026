from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import FileResponse

from app.api import router
from app.api.error_handlers import (
    app_error_handler,
    request_validation_error_handler,
    unhandled_error_handler,
)
from app.core.exceptions import AppError

_SWAGGER_DIR = "/app/static/swagger-ui"

app = FastAPI(title="STTM Builder", version="0.1.0", root_path="/api/sttm-builder", docs_url=None)


@app.get("/docs", include_in_schema=False)
async def swagger_ui_html(req: Request):
    root = req.scope.get("root_path", "").rstrip("/")
    return get_swagger_ui_html(
        openapi_url=f"{root}/openapi.json",
        title="STTM Builder",
        swagger_js_url=f"{root}/static/swagger-ui/swagger-ui-bundle.js",
        swagger_css_url=f"{root}/static/swagger-ui/swagger-ui.css",
    )


@app.get("/static/swagger-ui/swagger-ui-bundle.js", include_in_schema=False)
async def swagger_js():
    return FileResponse(f"{_SWAGGER_DIR}/swagger-ui-bundle.js", media_type="application/javascript")


@app.get("/static/swagger-ui/swagger-ui.css", include_in_schema=False)
async def swagger_css():
    return FileResponse(f"{_SWAGGER_DIR}/swagger-ui.css", media_type="text/css")

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(RequestValidationError, request_validation_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
