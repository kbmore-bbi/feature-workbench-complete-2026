from app.auth.dependencies import _resolve_cached_principal, clear_principal_cache
from app.auth.models import AppPersona, CurrentPrincipal, PermissionSet
from app.core.config import Settings


def test_principal_resolution_is_single_flight_cached_and_refreshes_token(monkeypatch) -> None:
    clear_principal_cache()
    calls = 0

    def resolve(context, _settings):
        nonlocal calls
        calls += 1
        return CurrentPrincipal(
            user_id=42,
            snowflake_user="CACHE_TEST_USER",
            email="cache@example.com",
            display_name="Cache Test",
            app_persona=AppPersona.PUBLISHER,
            permissions=PermissionSet(can_read=True, can_edit=True),
            snowflake_user_token=str(context.get("snowflake_user_token") or ""),
            snowflake_role="WORKBENCH_PUBLISHER",
        )

    monkeypatch.setattr("app.auth.dependencies.resolve_and_upsert", resolve)
    settings = Settings(
        _env_file=None,
        auth_principal_cache_ttl_seconds=300,
        snowflake_database="CACHE_TEST_DB",
        snowflake_schema="CACHE_TEST_SCHEMA",
    )
    base = {
        "snowflake_user": "CACHE_TEST_USER",
        "email": "cache@example.com",
        "snowflake_role": "WORKBENCH_PUBLISHER",
        "oauth_session_id": "session-42",
    }

    first = _resolve_cached_principal({**base, "snowflake_user_token": "token-one"}, settings)
    second = _resolve_cached_principal({**base, "snowflake_user_token": "token-two"}, settings)

    assert calls == 1
    assert first.snowflake_user_token == "token-one"
    assert second.snowflake_user_token == "token-two"
    clear_principal_cache()
