from __future__ import annotations

from fastapi import HTTPException, Request

from app.auth.extractors.headers import extract_snowflake_context
from app.auth.models import AppPersona, CurrentPrincipal
from app.auth.persona.resolver import resolve_and_upsert
from app.config import get_settings


def get_current_principal(request: Request) -> CurrentPrincipal:
    cached = getattr(request.state, "current_principal", None)
    if cached is not None:
        return cached

    principal = resolve_and_upsert(extract_snowflake_context(request), get_settings())
    request.state.current_principal = principal
    return principal


def require_persona(*personas: AppPersona):
    allowed = set(personas)

    def dependency(request: Request) -> CurrentPrincipal:
        principal = get_current_principal(request)
        if principal.app_persona not in allowed:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return principal

    return dependency
