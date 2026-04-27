import pytest
from fastapi import HTTPException

from app.auth.models import AppPersona
from app.auth.persona.resolver import resolve_persona


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
