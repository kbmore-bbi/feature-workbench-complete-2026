from app.core.config import Settings


def test_debug_routes_disabled_in_non_local_env_by_default() -> None:
    settings = Settings(_env_file=None, app_env="prod")
    assert settings.debug_routes_enabled is False


def test_debug_routes_enabled_in_dev_env() -> None:
    settings = Settings(_env_file=None, app_env="dev")
    assert settings.debug_routes_enabled is True
