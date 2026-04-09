from fastapi.testclient import TestClient

from app.main import app


def test_workbench_info_route() -> None:
    client = TestClient(app)

    response = client.get("/api/v1/workbench/info")

    assert response.status_code == 200
    payload = response.json()
    assert payload["api_base_path"] == "/api/v1"
    assert payload["health_path"] == "/healthz"

