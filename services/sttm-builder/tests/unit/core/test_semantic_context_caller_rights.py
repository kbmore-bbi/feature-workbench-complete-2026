from app.core.config import Settings
from app.core.semantic_context import SemanticContextService


class _Session:
    def __init__(self) -> None:
        self.queries: list[str] = []

    def sql(self, query: str):
        self.queries.append(query)
        raise AssertionError("caller-rights request must not issue storage DDL")


def test_semantic_storage_ddl_is_skipped_for_custom_oauth_caller_runtime() -> None:
    service = SemanticContextService.__new__(SemanticContextService)
    service._session = _Session()
    service._settings = Settings(
        _env_file=None,
        auth_mode="custom_oauth",
        spcs_execute_as_caller_enabled=True,
    )

    service.ensure_storage_exists()

    assert service._session.queries == []
