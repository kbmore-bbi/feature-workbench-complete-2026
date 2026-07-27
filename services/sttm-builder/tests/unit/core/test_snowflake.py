from app.core.config import Settings
from app.core.snowflake import get_user_connection


def test_rest_snowflake_host_uses_public_oauth_endpoint_over_internal_host() -> None:
    settings = Settings(
        _env_file=None,
        snowflake_host="internal-host.snowflakecomputing.internal",
        snowflake_oauth_token_url="https://public-account.snowflakecomputing.com/oauth/token-request",
    )

    assert settings.resolved_snowflake_host == "internal-host.snowflakecomputing.internal"
    assert settings.rest_snowflake_host == "public-account.snowflakecomputing.com"


def test_get_user_connection_uses_direct_credentials_in_local_dev(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _connect(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr("app.core.snowflake.snowflake.connector.connect", _connect)

    settings = Settings(
        _env_file=None,
        local_dev_auth_enabled=True,
        snowflake_account="org-account",
        snowflake_host="org-account.snowflakecomputing.com",
        snowflake_user="DEV_USER",
        snowflake_password="secret",
        snowflake_role="WORKBENCH_PUBLISHER",
        snowflake_warehouse="DEV_WH",
        snowflake_database="DEV_DB",
        snowflake_schema="PUBLIC",
    )

    get_user_connection("", settings)

    assert captured["account"] == "org-account"
    assert captured["user"] == "DEV_USER"
    assert captured["password"] == "secret"
    assert captured["role"] == "WORKBENCH_PUBLISHER"
    assert "token" not in captured
