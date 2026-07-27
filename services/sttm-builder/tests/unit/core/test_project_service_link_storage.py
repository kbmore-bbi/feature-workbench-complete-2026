from unittest.mock import MagicMock

import pytest

from app.core.exceptions import AppValidationError
from app.core.project_service import ProjectService


class _FailingQuery:
    def __init__(self, message: str) -> None:
        self._message = message

    def collect(self):
        raise RuntimeError(self._message)


def _service() -> ProjectService:
    session = MagicMock()
    session.sql.side_effect = lambda _query: _FailingQuery(
        "Object TBL_FIR_PROJECT_LINKS does not exist or not authorized"
    )
    settings = MagicMock()
    settings.snowflake_projects_table = "TBL_PROJECTS"
    settings.snowflake_sttm_table = "TBL_STTM"
    settings.qualify_metadata_object_name.side_effect = lambda name: f"DB.META.{name}"
    return ProjectService(
        session=session,
        settings=settings,
        memory_service=MagicMock(),
    )


def test_missing_project_link_storage_is_empty_for_read_only_hydration() -> None:
    service = _service()

    assert service.list_project_links("401") == []


def test_missing_mapping_link_storage_is_empty_for_read_only_hydration() -> None:
    service = _service()
    service._session.sql.side_effect = lambda _query: _FailingQuery(
        "Object TBL_FIR_MAPPING_LINKS does not exist or not authorized"
    )

    assert service.list_mapping_links("601") == []


def test_selected_precedent_requires_migration_before_insert() -> None:
    service = _service()

    with pytest.raises(AppValidationError, match="Precedent linking is not deployed"):
        service._require_link_storage(
            service._project_links_table,
            field="precedent_links",
        )
