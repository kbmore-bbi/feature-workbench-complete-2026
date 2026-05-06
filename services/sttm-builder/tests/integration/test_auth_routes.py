from fastapi.testclient import TestClient

from app.auth.dependencies import get_current_principal
from app.auth.models import AppPersona, CurrentPrincipal, PermissionSet
from app.core.config import Settings
from app.main import app


def _principal() -> CurrentPrincipal:
    return CurrentPrincipal(
        user_id=7,
        snowflake_user="PUBLISHER_USER",
        email="publisher@example.com",
        display_name="publisher",
        app_persona=AppPersona.PUBLISHER,
        permissions=PermissionSet(
            can_read=True,
            can_edit=True,
            can_publish=True,
        ),
        snowflake_user_token="snowflake-user-token",
    )


def test_auth_session_route_returns_current_principal() -> None:
    client = TestClient(app)
    app.dependency_overrides[get_current_principal] = _principal

    try:
        response = client.get("/api/v1/auth/session")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {
        "user_id": 7,
        "email": "publisher@example.com",
        "display_name": "publisher",
        "app_persona": "PUBLISHER",
        "ui_permissions": {
            "can_read": True,
            "can_edit": True,
            "can_publish": True,
            "can_manage_users": False,
            "can_view_audit": False,
        },
    }


def test_auth_permissions_route_returns_permission_set() -> None:
    client = TestClient(app)
    app.dependency_overrides[get_current_principal] = _principal

    try:
        response = client.get("/api/v1/auth/permissions")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["can_publish"] is True


class _Cursor:
    def execute(self, _: str) -> None:
        return None

    def fetchone(self) -> dict[str, str]:
        return {
            "CURRENT_USER": "PUBLISHER@EXAMPLE.COM",
            "CURRENT_ROLE": "WORKBENCH_PUBLISHER",
            "CURRENT_WAREHOUSE": "WORKBENCH_WH",
            "CURRENT_DATABASE": "AI_WORKBENCH_DEV",
            "CURRENT_SCHEMA": "APP_RUNTIME",
        }

    def close(self) -> None:
        return None


class _Connection:
    def __enter__(self) -> "_Connection":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def cursor(self, *_: object) -> _Cursor:
        return _Cursor()


def test_snowflake_context_route_uses_connection_factory(monkeypatch) -> None:
    client = TestClient(app)
    app.dependency_overrides[get_current_principal] = _principal
    monkeypatch.setattr("app.auth.router.get_user_connection", lambda *_: _Connection())

    try:
        response = client.get("/api/v1/auth/snowflake-context")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["current_role"] == "WORKBENCH_PUBLISHER"


def test_auth_session_requires_proxy_headers_by_default() -> None:
    client = TestClient(app)
    response = client.get("/api/v1/auth/session")
    assert response.status_code == 401


def test_auth_session_allows_local_dev_auth_without_proxy_headers(monkeypatch) -> None:
    client = TestClient(app)
    settings = Settings(
        _env_file=None,
        local_dev_auth_enabled=True,
        snowflake_user="DEV_USER",
        snowflake_password="secret",
        local_dev_user_email="dev@example.com",
    )

    monkeypatch.setattr("app.auth.dependencies.get_settings", lambda: settings)

    def _resolve(context: dict[str, str], _: Settings) -> CurrentPrincipal:
        assert context == {
            "snowflake_user": "DEV_USER",
            "email": "dev@example.com",
            "snowflake_user_token": "",
        }
        return CurrentPrincipal(
            user_id=99,
            snowflake_user="DEV_USER",
            email="dev@example.com",
            display_name="DEV_USER",
            app_persona=AppPersona.VIEWER,
            permissions=PermissionSet(can_read=True),
            snowflake_user_token="",
        )

    monkeypatch.setattr("app.auth.dependencies.resolve_and_upsert", _resolve)

    response = client.get("/api/v1/auth/session")

    assert response.status_code == 200
    assert response.json()["email"] == "dev@example.com"
    assert response.json()["app_persona"] == "VIEWER"
