def test_health_route() -> None:
    from fastapi.testclient import TestClient
    from app.main import app

    response = TestClient(app).get("/healthz")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "BBI AI Migration Workbench API"
