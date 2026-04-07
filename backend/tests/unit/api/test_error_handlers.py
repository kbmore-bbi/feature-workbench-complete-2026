from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.error_handlers import register_error_handlers
from app.core.exceptions import WorkbenchError


def test_workbench_error_handler_returns_expected_shape() -> None:
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/boom")
    def boom() -> None:
        raise WorkbenchError(code="TEST", message="failed", status_code=418)

    client = TestClient(app)
    response = client.get("/boom")

    assert response.status_code == 418
    assert response.json() == {"error": {"code": "TEST", "message": "failed"}}

