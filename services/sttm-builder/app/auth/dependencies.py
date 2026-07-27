from __future__ import annotations

import hashlib
import threading
import time

from fastapi import HTTPException, Request

from app.auth.custom_oauth import extract_custom_oauth_context
from app.auth.extractors.headers import extract_snowflake_context
from app.auth.models import AppPersona, CurrentPrincipal
from app.auth.persona.resolver import resolve_and_upsert
from app.config import Settings, get_settings


_PRINCIPAL_CACHE_LOCK = threading.Lock()
_PRINCIPAL_CACHE: dict[str, tuple[float, CurrentPrincipal]] = {}
_PRINCIPAL_INFLIGHT: dict[str, threading.Event] = {}


def clear_principal_cache() -> None:
    """Clear cached authorization decisions after an explicit auth mutation."""
    with _PRINCIPAL_CACHE_LOCK:
        _PRINCIPAL_CACHE.clear()
        for event in _PRINCIPAL_INFLIGHT.values():
            event.set()
        _PRINCIPAL_INFLIGHT.clear()


def _principal_cache_key(context: dict[str, object], settings: Settings) -> str:
    # Never retain the caller token. The stable identity, active role, auth
    # mode, and configured persona roles are sufficient to isolate decisions.
    identity = "|".join(
        [
            str(context.get("snowflake_user") or "").upper(),
            str(context.get("email") or "").upper(),
            str(context.get("oauth_session_id") or ""),
            str(context.get("snowflake_role") or "").upper(),
            settings.auth_mode,
            settings.app_role_admin,
            settings.app_role_publisher,
            settings.app_role_viewer,
            settings.qualified_users_table,
        ]
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _with_fresh_auth_context(
    principal: CurrentPrincipal,
    context: dict[str, object],
) -> CurrentPrincipal:
    # Tokens may refresh independently of the cached persona decision.
    return principal.model_copy(
        update={
            "snowflake_user_token": str(context.get("snowflake_user_token") or ""),
            "oauth_session_id": (
                str(context.get("oauth_session_id"))
                if context.get("oauth_session_id")
                else None
            ),
        },
        deep=True,
    )


def _resolve_cached_principal(
    context: dict[str, object],
    settings: Settings,
) -> CurrentPrincipal:
    ttl_seconds = max(0, int(settings.auth_principal_cache_ttl_seconds))
    if ttl_seconds <= 0:
        return resolve_and_upsert(context, settings)  # type: ignore[arg-type]
    key = _principal_cache_key(context, settings)
    now = time.monotonic()
    with _PRINCIPAL_CACHE_LOCK:
        cached = _PRINCIPAL_CACHE.get(key)
        if cached and cached[0] > now:
            return _with_fresh_auth_context(cached[1], context)
        event = _PRINCIPAL_INFLIGHT.get(key)
        owner = event is None
        if event is None:
            event = threading.Event()
            _PRINCIPAL_INFLIGHT[key] = event
    if not owner:
        event.wait(timeout=30)
        with _PRINCIPAL_CACHE_LOCK:
            cached = _PRINCIPAL_CACHE.get(key)
            if cached and cached[0] > time.monotonic():
                return _with_fresh_auth_context(cached[1], context)
    try:
        principal = resolve_and_upsert(context, settings)  # type: ignore[arg-type]
        with _PRINCIPAL_CACHE_LOCK:
            _PRINCIPAL_CACHE[key] = (
                time.monotonic() + ttl_seconds,
                principal.model_copy(deep=True),
            )
        return principal
    finally:
        if owner:
            with _PRINCIPAL_CACHE_LOCK:
                completed = _PRINCIPAL_INFLIGHT.pop(key, None)
                if completed is not None:
                    completed.set()


def get_current_principal(request: Request) -> CurrentPrincipal:
    cached = getattr(request.state, "current_principal", None)
    if cached is not None:
        return cached

    started = time.perf_counter()
    settings: Settings = get_settings()
    if settings.uses_custom_oauth:
        context = extract_custom_oauth_context(request, settings)
    else:
        context = extract_snowflake_context(request, settings)
    principal = _resolve_cached_principal(context, settings)
    getattr(request.state, "workbench_timings_ms", {})["auth"] = (
        time.perf_counter() - started
    ) * 1000
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
