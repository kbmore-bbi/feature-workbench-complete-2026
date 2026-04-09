from app.config import Settings
from app.core.workbench import get_workbench_info


def test_get_workbench_info_returns_expected_payload() -> None:
    settings = Settings(
        APP_NAME="Workbench API",
        APP_ENV="test",
        APP_VERSION="1.2.3",
    )

    payload = get_workbench_info(settings)

    assert payload.name == "Workbench API"
    assert payload.environment == "test"
    assert payload.version == "1.2.3"
    assert payload.api_base_path == "/api/v1"
    assert payload.health_path == "/healthz"

