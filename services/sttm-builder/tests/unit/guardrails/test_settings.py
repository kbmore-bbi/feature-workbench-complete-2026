from app.core.config import Settings


def test_debug_routes_disabled_in_non_local_env_by_default() -> None:
    settings = Settings(_env_file=None, app_env="prod")
    assert settings.debug_routes_enabled is False


def test_debug_routes_enabled_in_dev_env() -> None:
    settings = Settings(_env_file=None, app_env="dev")
    assert settings.debug_routes_enabled is True


def test_portable_metadata_placeholder_uses_configured_registry() -> None:
    settings = Settings(
        _env_file=None,
        snowflake_database="APP_DB",
        snowflake_schema="APP_METADATA",
    )

    assert (
        settings.qualify_metadata_object_name(
            "DB.SCHEMA.TBL_WORKBENCH_CONVERSATION_SEGMENTS"
        )
        == "APP_DB.APP_METADATA.TBL_WORKBENCH_CONVERSATION_SEGMENTS"
    )
