import os

from fastapi import FastAPI
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.staticfiles import StaticFiles
from swagger_ui_bundle import swagger_ui_path


def setup_docs(app: FastAPI) -> None:
    # swagger-ui-bundle ships swagger-ui 4.x which only supports OpenAPI 3.0.x
    def _openapi():
        if app.openapi_schema:
            return app.openapi_schema
        app.openapi_schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
        app.openapi_schema["openapi"] = "3.0.0"
        # Override the server URL when running behind a reverse proxy (e.g. local dev).
        # Not set in SPCS where the service is accessed directly via public ingress.
        server_url = os.getenv("SWAGGER_SERVER_URL")
        if server_url:
            app.openapi_schema["servers"] = [{"url": server_url}]
        return app.openapi_schema

    app.openapi = _openapi
    app.mount("/static/swagger-ui", StaticFiles(directory=swagger_ui_path), name="swagger-ui")

    @app.get("/docs", include_in_schema=False)
    async def docs():
        return get_swagger_ui_html(
            openapi_url="openapi.json",
            title=app.title,
            swagger_js_url="static/swagger-ui/swagger-ui-bundle.js",
            swagger_css_url="static/swagger-ui/swagger-ui.css",
        )
