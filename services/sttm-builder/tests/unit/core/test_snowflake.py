from app.core.config import Settings
from app.core.snowflake import get_user_connection


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
