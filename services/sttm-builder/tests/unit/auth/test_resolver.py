import pytest
from fastapi import HTTPException

from app.auth.models import AppPersona
from app.auth.persona.resolver import resolve_and_upsert, resolve_persona
from app.core.config import Settings


def test_resolve_persona_prefers_highest_privilege() -> None:
    persona = resolve_persona(
        {
            "IS_ADMIN": True,
            "IS_PUBLISHER": True,
            "IS_VIEWER": True,
        }
    )

    assert persona == AppPersona.ADMIN


def test_resolve_persona_rejects_missing_role_flags() -> None:
    with pytest.raises(HTTPException) as exc_info:
        resolve_persona(
            {
                "IS_ADMIN": False,
                "IS_PUBLISHER": False,
                "IS_VIEWER": False,
            }
        )

    assert exc_info.value.status_code == 403


class _Cursor:
    def execute(self, *_: object) -> None:
        return None

    def fetchone(self) -> dict[str, object]:
        return {
            "CURRENT_USER": "DEV_USER",
            "CURRENT_ROLE": "WORKBENCH_PUBLISHER",
            "IS_ADMIN": False,
            "IS_PUBLISHER": True,
            "IS_VIEWER": True,
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


def test_resolve_and_upsert_skips_metadata_in_local_dev(monkeypatch) -> None:
    monkeypatch.setattr("app.auth.persona.resolver.get_user_connection", lambda *_: _Connection())

    def _unexpected_service_connection(*_: object) -> None:
        raise AssertionError("service connection should not be used in local bypass mode")

    monkeypatch.setattr(
        "app.auth.persona.resolver.get_service_connection",
        _unexpected_service_connection,
    )

    principal = resolve_and_upsert(
        {
            "snowflake_user": "DEV_USER",
            "email": "dev@example.com",
            "snowflake_user_token": "",
        },
        Settings(
            _env_file=None,
            local_dev_auth_enabled=True,
            local_dev_bypass_metadata=True,
            snowflake_user="DEV_USER",
            snowflake_password="secret",
            snowflake_role="WORKBENCH_PUBLISHER",
            app_role_admin="WORKBENCH_ADMIN",
            app_role_publisher="WORKBENCH_PUBLISHER",
            app_role_viewer="WORKBENCH_VIEWER",
        ),
    )

    assert principal.snowflake_user == "DEV_USER"
    assert principal.email == "dev@example.com"
    assert principal.app_persona == AppPersona.PUBLISHER
    assert principal.snowflake_user_token == ""
