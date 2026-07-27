from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode
from urllib.parse import urlparse

import httpx
from cryptography.fernet import Fernet
from fastapi import HTTPException, Request
from fastapi.responses import RedirectResponse
from snowflake.connector import DictCursor

from app.auth.persona.resolver import resolve_and_upsert
from app.config import Settings
from app.core.exceptions import OAuthTokenExchangeError
from app.core.snowflake import get_service_connection, get_user_connection

_OAUTH_STATE_VERSION = 1
_INTERNAL_OAUTH_HEADER = "x-workbench-oauth-access-token"
_INTERNAL_USER_HEADER = "x-workbench-oauth-user"
_INTERNAL_EMAIL_HEADER = "x-workbench-oauth-email"
_INTERNAL_ROLE_HEADER = "x-workbench-oauth-role"
_COOKIE_PATH = "/"
logger = logging.getLogger(__name__)


@dataclass
class OAuthTokens:
    access_token: str
    refresh_token: str | None
    access_token_expires_at: datetime
    refresh_token_expires_at: datetime | None = None


@dataclass
class OAuthSessionRecord:
    session_id: str
    snowflake_user: str
    snowflake_role: str | None
    email: str
    display_name: str | None
    app_user_id: str
    access_token_encrypted: str
    refresh_token_encrypted: str | None
    access_token_expires_at: datetime
    refresh_token_expires_at: datetime | None
    created_at: datetime | None = None
    last_accessed_at: datetime | None = None
    last_refreshed_at: datetime | None = None
    is_active: bool = True

    @property
    def access_token(self) -> str:
        raise RuntimeError("Use decrypt_access_token()")


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _fernet(settings: Settings) -> Fernet:
    raw_key = (
        settings.auth_session_encryption_key.strip()
        or settings.auth_session_secret.strip()
    )
    if not raw_key:
        raise HTTPException(
            status_code=500,
            detail="AUTH_SESSION_ENCRYPTION_KEY or AUTH_SESSION_SECRET must be configured",
        )
    if len(raw_key) == 44 and raw_key.endswith("="):
        try:
            return Fernet(raw_key.encode("utf-8"))
        except Exception:
            pass
    derived_key = base64.urlsafe_b64encode(hashlib.sha256(raw_key.encode("utf-8")).digest())
    return Fernet(derived_key)


def _encrypt(settings: Settings, value: str | None) -> str | None:
    if not value:
        return None
    return _fernet(settings).encrypt(value.encode("utf-8")).decode("utf-8")


def _decrypt(settings: Settings, value: str | None) -> str | None:
    if not value:
        return None
    return _fernet(settings).decrypt(value.encode("utf-8")).decode("utf-8")


def _sign_state(payload: str, settings: Settings) -> str:
    secret = settings.auth_session_secret.strip()
    if not secret:
        raise HTTPException(status_code=500, detail="AUTH_SESSION_SECRET must be configured")
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def _pkce_code_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _encode_state_cookie(
    *,
    state: str,
    code_verifier: str,
    next_path: str | None,
    settings: Settings,
) -> str:
    payload = {
        "v": _OAUTH_STATE_VERSION,
        "state": state,
        "code_verifier": code_verifier,
        "next": next_path or settings.auth_post_login_redirect_path,
        "iat": int(_utcnow().timestamp()),
    }
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")
    return f"{encoded}.{_sign_state(encoded, settings)}"


def _decode_state_cookie(raw_cookie: str, settings: Settings) -> dict[str, Any]:
    try:
        encoded, signature = raw_cookie.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid OAuth state cookie") from exc
    expected = _sign_state(encoded, settings)
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=400, detail="Invalid OAuth state signature")
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded.encode("utf-8")).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid OAuth state payload") from exc
    issued_at = int(payload.get("iat") or 0)
    max_age = max(60, settings.auth_oauth_state_ttl_seconds)
    if (_utcnow().timestamp() - issued_at) > max_age:
        raise HTTPException(status_code=400, detail="OAuth state has expired")
    if payload.get("v") != _OAUTH_STATE_VERSION:
        raise HTTPException(status_code=400, detail="Unsupported OAuth state version")
    return payload


def _sanitize_next_path(value: str | None, settings: Settings) -> str:
    candidate = (value or "").strip()
    if not candidate.startswith("/"):
        return settings.auth_post_login_redirect_path
    return candidate


def _cookie_kwargs(settings: Settings) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "httponly": True,
        "secure": settings.auth_session_cookie_secure,
        "samesite": settings.auth_session_cookie_samesite,
        "path": _COOKIE_PATH,
    }
    if settings.auth_session_cookie_domain.strip():
        kwargs["domain"] = settings.auth_session_cookie_domain.strip()
    return kwargs


def _oauth_post(
    *,
    settings: Settings,
    data: dict[str, Any],
) -> httpx.Response:
    client_id = settings.snowflake_oauth_client_id
    client_secret = settings.snowflake_oauth_client_secret
    basic_value = base64.b64encode(
        f"{client_id}:{client_secret}".encode("utf-8")
    ).decode("ascii")
    logger.info(
        "Snowflake OAuth request credential metadata "
        "(client_id_fp=%s, client_id_len=%s, client_secret_fp=%s, "
        "client_secret_len=%s, token_host=%s)",
        hashlib.sha256(client_id.encode("utf-8")).hexdigest()[:12],
        len(client_id),
        hashlib.sha256(client_secret.encode("utf-8")).hexdigest()[:12],
        len(client_secret),
        urlparse(settings.snowflake_oauth_token_url).hostname,
    )
    return httpx.post(
        settings.snowflake_oauth_token_url,
        data=data,
        headers={
            "Accept": "application/json",
            "Authorization": f"Basic {basic_value}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout=30.0,
    )


def _oauth_error_code(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return "oauth_token_request_failed"
    if not isinstance(payload, dict):
        return "oauth_token_request_failed"
    return str(payload.get("error") or "oauth_token_request_failed").strip()


def _raise_oauth_exchange_error(response: httpx.Response, *, operation: str) -> None:
    upstream_code = _oauth_error_code(response)
    logger.warning(
        "Snowflake OAuth %s failed (status=%s, upstream_code=%s)",
        operation,
        response.status_code,
        upstream_code,
    )
    raise OAuthTokenExchangeError(
        f"Snowflake OAuth {operation} failed",
        details=[{"field": "oauth", "message": upstream_code}],
    )


def _exchange_code_for_tokens(
    code: str,
    code_verifier: str,
    settings: Settings,
) -> OAuthTokens:
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": code_verifier,
        "redirect_uri": settings.snowflake_oauth_redirect_uri,
    }
    response = _oauth_post(settings=settings, data=payload)
    if response.status_code >= 400:
        _raise_oauth_exchange_error(response, operation="token exchange")
    payload = response.json()
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="OAuth token response omitted access_token")
    refresh_token = str(payload.get("refresh_token") or "").strip() or None
    expires_in = int(payload.get("expires_in") or 0)
    refresh_expires_in_raw = payload.get("refresh_token_expires_in")
    refresh_expires_in = int(refresh_expires_in_raw) if refresh_expires_in_raw else None
    now = _utcnow()
    return OAuthTokens(
        access_token=access_token,
        refresh_token=refresh_token,
        access_token_expires_at=now + timedelta(seconds=max(60, expires_in or 3600)),
        refresh_token_expires_at=(
            now + timedelta(seconds=refresh_expires_in)
            if refresh_expires_in
            else None
        ),
    )


def _refresh_tokens(refresh_token: str, settings: Settings) -> OAuthTokens:
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    response = _oauth_post(settings=settings, data=payload)
    if response.status_code >= 400:
        _raise_oauth_exchange_error(response, operation="token refresh")
    payload = response.json()
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="OAuth refresh response omitted access_token")
    next_refresh_token = str(payload.get("refresh_token") or "").strip() or refresh_token
    expires_in = int(payload.get("expires_in") or 0)
    refresh_expires_in_raw = payload.get("refresh_token_expires_in")
    refresh_expires_in = int(refresh_expires_in_raw) if refresh_expires_in_raw else None
    now = _utcnow()
    return OAuthTokens(
        access_token=access_token,
        refresh_token=next_refresh_token,
        access_token_expires_at=now + timedelta(seconds=max(60, expires_in or 3600)),
        refresh_token_expires_at=(
            now + timedelta(seconds=refresh_expires_in)
            if refresh_expires_in
            else None
        ),
    )


def _session_select_row(session_id: str, settings: Settings) -> OAuthSessionRecord | None:
    with get_service_connection(settings) as connection:
        cursor = connection.cursor(DictCursor)
        try:
            cursor.execute(
                f"""
                SELECT
                    SESSION_ID,
                    SNOWFLAKE_USER,
                    SNOWFLAKE_ROLE,
                    EMAIL,
                    DISPLAY_NAME,
                    APP_USER_ID,
                    ACCESS_TOKEN_ENCRYPTED,
                    REFRESH_TOKEN_ENCRYPTED,
                    ACCESS_TOKEN_EXPIRES_AT,
                    REFRESH_TOKEN_EXPIRES_AT,
                    CREATED_AT,
                    LAST_ACCESSED_AT,
                    LAST_REFRESHED_AT,
                    IS_ACTIVE
                FROM {settings.qualified_oauth_sessions_table}
                WHERE SESSION_ID = %s
                  AND IS_ACTIVE = TRUE
                """,
                (session_id,),
            )
            row = cursor.fetchone()
        finally:
            cursor.close()
    if not row:
        return None
    return OAuthSessionRecord(
        session_id=str(row["SESSION_ID"]),
        snowflake_user=str(row["SNOWFLAKE_USER"]),
        snowflake_role=str(row["SNOWFLAKE_ROLE"]) if row.get("SNOWFLAKE_ROLE") else None,
        email=str(row["EMAIL"]),
        display_name=str(row["DISPLAY_NAME"]) if row.get("DISPLAY_NAME") else None,
        app_user_id=str(row["APP_USER_ID"]),
        access_token_encrypted=str(row["ACCESS_TOKEN_ENCRYPTED"]),
        refresh_token_encrypted=(
            str(row["REFRESH_TOKEN_ENCRYPTED"]) if row.get("REFRESH_TOKEN_ENCRYPTED") else None
        ),
        access_token_expires_at=_to_utc(row.get("ACCESS_TOKEN_EXPIRES_AT")) or _utcnow(),
        refresh_token_expires_at=_to_utc(row.get("REFRESH_TOKEN_EXPIRES_AT")),
        created_at=_to_utc(row.get("CREATED_AT")),
        last_accessed_at=_to_utc(row.get("LAST_ACCESSED_AT")),
        last_refreshed_at=_to_utc(row.get("LAST_REFRESHED_AT")),
        is_active=bool(row.get("IS_ACTIVE", True)),
    )


def _upsert_session_record(
    *,
    session_id: str,
    principal: Any,
    tokens: OAuthTokens,
    settings: Settings,
    created_at: datetime | None = None,
) -> None:
    now = _utcnow()
    with get_service_connection(settings) as connection:
        cursor = connection.cursor()
        try:
            cursor.execute(
                f"""
                MERGE INTO {settings.qualified_oauth_sessions_table} AS t
                USING (
                    SELECT
                        %s AS SESSION_ID,
                        %s AS SNOWFLAKE_USER,
                        %s AS SNOWFLAKE_ROLE,
                        %s AS EMAIL,
                        %s AS DISPLAY_NAME,
                        %s AS APP_USER_ID,
                        %s AS ACCESS_TOKEN_ENCRYPTED,
                        %s AS REFRESH_TOKEN_ENCRYPTED,
                        %s AS ACCESS_TOKEN_EXPIRES_AT,
                        %s AS REFRESH_TOKEN_EXPIRES_AT,
                        %s AS CREATED_AT,
                        %s AS LAST_ACCESSED_AT,
                        %s AS LAST_REFRESHED_AT,
                        TRUE AS IS_ACTIVE
                ) AS s
                ON t.SESSION_ID = s.SESSION_ID
                WHEN MATCHED THEN UPDATE SET
                    SNOWFLAKE_USER = s.SNOWFLAKE_USER,
                    SNOWFLAKE_ROLE = s.SNOWFLAKE_ROLE,
                    EMAIL = s.EMAIL,
                    DISPLAY_NAME = s.DISPLAY_NAME,
                    APP_USER_ID = s.APP_USER_ID,
                    ACCESS_TOKEN_ENCRYPTED = s.ACCESS_TOKEN_ENCRYPTED,
                    REFRESH_TOKEN_ENCRYPTED = s.REFRESH_TOKEN_ENCRYPTED,
                    ACCESS_TOKEN_EXPIRES_AT = s.ACCESS_TOKEN_EXPIRES_AT,
                    REFRESH_TOKEN_EXPIRES_AT = s.REFRESH_TOKEN_EXPIRES_AT,
                    LAST_ACCESSED_AT = s.LAST_ACCESSED_AT,
                    LAST_REFRESHED_AT = s.LAST_REFRESHED_AT,
                    IS_ACTIVE = TRUE
                WHEN NOT MATCHED THEN INSERT (
                    SESSION_ID,
                    SNOWFLAKE_USER,
                    SNOWFLAKE_ROLE,
                    EMAIL,
                    DISPLAY_NAME,
                    APP_USER_ID,
                    ACCESS_TOKEN_ENCRYPTED,
                    REFRESH_TOKEN_ENCRYPTED,
                    ACCESS_TOKEN_EXPIRES_AT,
                    REFRESH_TOKEN_EXPIRES_AT,
                    CREATED_AT,
                    LAST_ACCESSED_AT,
                    LAST_REFRESHED_AT,
                    IS_ACTIVE
                ) VALUES (
                    s.SESSION_ID,
                    s.SNOWFLAKE_USER,
                    s.SNOWFLAKE_ROLE,
                    s.EMAIL,
                    s.DISPLAY_NAME,
                    s.APP_USER_ID,
                    s.ACCESS_TOKEN_ENCRYPTED,
                    s.REFRESH_TOKEN_ENCRYPTED,
                    s.ACCESS_TOKEN_EXPIRES_AT,
                    s.REFRESH_TOKEN_EXPIRES_AT,
                    s.CREATED_AT,
                    s.LAST_ACCESSED_AT,
                    s.LAST_REFRESHED_AT,
                    s.IS_ACTIVE
                )
                """,
                (
                    session_id,
                    principal.snowflake_user,
                    principal.snowflake_role,
                    principal.email,
                    principal.display_name,
                    str(principal.user_id),
                    _encrypt(settings, tokens.access_token),
                    _encrypt(settings, tokens.refresh_token),
                    tokens.access_token_expires_at,
                    tokens.refresh_token_expires_at,
                    created_at or now,
                    now,
                    now,
                ),
            )
            connection.commit()
        finally:
            cursor.close()


def _touch_session(session_id: str, settings: Settings) -> None:
    with get_service_connection(settings) as connection:
        cursor = connection.cursor()
        try:
            cursor.execute(
                f"""
                UPDATE {settings.qualified_oauth_sessions_table}
                SET LAST_ACCESSED_AT = CURRENT_TIMESTAMP()
                WHERE SESSION_ID = %s
                """,
                (session_id,),
            )
            connection.commit()
        finally:
            cursor.close()


def invalidate_session(session_id: str, settings: Settings) -> None:
    with get_service_connection(settings) as connection:
        cursor = connection.cursor()
        try:
            cursor.execute(
                f"""
                UPDATE {settings.qualified_oauth_sessions_table}
                SET IS_ACTIVE = FALSE,
                    LAST_ACCESSED_AT = CURRENT_TIMESTAMP()
                WHERE SESSION_ID = %s
                """,
                (session_id,),
            )
            connection.commit()
        finally:
            cursor.close()


def decrypt_access_token(record: OAuthSessionRecord, settings: Settings) -> str:
    token = _decrypt(settings, record.access_token_encrypted)
    if not token:
        raise HTTPException(status_code=401, detail="OAuth session is missing an access token")
    return token


def decrypt_refresh_token(record: OAuthSessionRecord, settings: Settings) -> str | None:
    return _decrypt(settings, record.refresh_token_encrypted)


def _refresh_session_if_needed(record: OAuthSessionRecord, settings: Settings) -> OAuthSessionRecord:
    now = _utcnow()
    if record.access_token_expires_at > now + timedelta(
        seconds=max(30, settings.auth_access_token_refresh_skew_seconds)
    ):
        _touch_session(record.session_id, settings)
        return record

    refresh_token = decrypt_refresh_token(record, settings)
    if not refresh_token:
        invalidate_session(record.session_id, settings)
        raise HTTPException(status_code=401, detail="OAuth session has expired")

    refreshed = _refresh_tokens(refresh_token, settings)
    principal_context = {
        "snowflake_user": record.snowflake_user,
        "email": record.email,
        "display_name": record.display_name,
        "snowflake_user_token": refreshed.access_token,
        "snowflake_role": record.snowflake_role,
        "oauth_session_id": record.session_id,
    }
    principal = resolve_and_upsert(principal_context, settings)
    _upsert_session_record(
        session_id=record.session_id,
        principal=principal,
        tokens=refreshed,
        settings=settings,
        created_at=record.created_at,
    )
    updated = _session_select_row(record.session_id, settings)
    if not updated:
        raise HTTPException(status_code=401, detail="OAuth session disappeared during refresh")
    return updated


def build_login_redirect(request: Request, settings: Settings) -> RedirectResponse:
    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)
    next_path = _sanitize_next_path(request.query_params.get("next"), settings)
    params = {
        "client_id": settings.snowflake_oauth_client_id,
        "response_type": "code",
        "redirect_uri": settings.snowflake_oauth_redirect_uri,
        "scope": settings.snowflake_oauth_scope,
        "state": state,
        "code_challenge": _pkce_code_challenge(code_verifier),
        "code_challenge_method": "S256",
    }
    response = RedirectResponse(
        url=f"{settings.snowflake_oauth_authorize_url}?{urlencode(params)}",
        status_code=302,
    )
    response.set_cookie(
        settings.auth_state_cookie_name,
        _encode_state_cookie(
            state=state,
            code_verifier=code_verifier,
            next_path=next_path,
            settings=settings,
        ),
        max_age=settings.auth_oauth_state_ttl_seconds,
        **_cookie_kwargs(settings),
    )
    return response


def build_logout_redirect(request: Request, settings: Settings) -> RedirectResponse:
    session_id = request.cookies.get(settings.auth_session_cookie_name, "").strip()
    if session_id:
        invalidate_session(session_id, settings)
    response = RedirectResponse(
        url=_sanitize_next_path(settings.auth_post_logout_redirect_path, settings),
        status_code=302,
    )
    response.delete_cookie(settings.auth_session_cookie_name, path=_COOKIE_PATH)
    response.delete_cookie(settings.auth_state_cookie_name, path=_COOKIE_PATH)
    return response


def complete_oauth_callback(request: Request, settings: Settings) -> RedirectResponse:
    error = request.query_params.get("error")
    if error:
        raise HTTPException(
            status_code=401,
            detail=request.query_params.get("error_description") or error,
        )
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    if not code or not state:
        raise HTTPException(status_code=400, detail="OAuth callback is missing code or state")

    raw_state_cookie = request.cookies.get(settings.auth_state_cookie_name, "").strip()
    if not raw_state_cookie:
        raise HTTPException(status_code=400, detail="Missing OAuth state cookie")
    state_payload = _decode_state_cookie(raw_state_cookie, settings)
    if state_payload.get("state") != state:
        raise HTTPException(status_code=400, detail="OAuth state mismatch")

    code_verifier = str(state_payload.get("code_verifier") or "").strip()
    if not code_verifier:
        raise HTTPException(status_code=400, detail="OAuth state is missing PKCE verifier")

    tokens = _exchange_code_for_tokens(code, code_verifier, settings)
    principal_context = resolve_token_context(tokens.access_token, settings)
    principal = resolve_and_upsert(principal_context, settings)
    session_id = uuid.uuid4().hex
    _upsert_session_record(
        session_id=session_id,
        principal=principal,
        tokens=tokens,
        settings=settings,
    )

    response = RedirectResponse(
        url=_sanitize_next_path(str(state_payload.get("next") or ""), settings),
        status_code=302,
    )
    response.set_cookie(
        settings.auth_session_cookie_name,
        session_id,
        max_age=settings.auth_session_cookie_max_age_seconds,
        **_cookie_kwargs(settings),
    )
    response.delete_cookie(settings.auth_state_cookie_name, path=_COOKIE_PATH)
    return response


def resolve_token_context(access_token: str, settings: Settings) -> dict[str, Any]:
    with get_user_connection(access_token, settings) as connection:
        cursor = connection.cursor(DictCursor)
        try:
            cursor.execute(
                """
                SELECT
                    CURRENT_USER() AS CURRENT_USER,
                    CURRENT_ROLE() AS CURRENT_ROLE
                """
            )
            row = cursor.fetchone()
        finally:
            cursor.close()
    if not row:
        raise HTTPException(status_code=401, detail="Failed to resolve Snowflake OAuth identity")
    current_user = str(row["CURRENT_USER"])
    current_role = str(row["CURRENT_ROLE"]) if row.get("CURRENT_ROLE") else None
    return {
        "snowflake_user": current_user,
        "email": current_user,
        "display_name": current_user,
        "snowflake_user_token": access_token,
        "snowflake_role": current_role,
        "oauth_session_id": None,
    }


def extract_custom_oauth_context(request: Request, settings: Settings) -> dict[str, Any]:
    internal_access_token = request.headers.get(_INTERNAL_OAUTH_HEADER, "").strip()
    if internal_access_token:
        return {
            "snowflake_user": request.headers.get(_INTERNAL_USER_HEADER, "").strip() or "oauth-user",
            "email": request.headers.get(_INTERNAL_EMAIL_HEADER, "").strip()
            or request.headers.get(_INTERNAL_USER_HEADER, "").strip()
            or "oauth-user",
            "display_name": request.headers.get(_INTERNAL_USER_HEADER, "").strip() or "oauth-user",
            "snowflake_user_token": internal_access_token,
            "snowflake_role": request.headers.get(_INTERNAL_ROLE_HEADER, "").strip() or None,
            "oauth_session_id": None,
        }

    if settings.local_dev_auth_enabled:
        return {
            "snowflake_user": settings.snowflake_user,
            "email": settings.local_dev_effective_email,
            "display_name": settings.snowflake_user,
            "snowflake_user_token": "",
            "snowflake_role": settings.snowflake_role or None,
            "oauth_session_id": None,
        }

    session_id = request.cookies.get(settings.auth_session_cookie_name, "").strip()
    if not session_id:
        raise HTTPException(status_code=401, detail="Missing authenticated session")

    record = _session_select_row(session_id, settings)
    if not record:
        raise HTTPException(status_code=401, detail="Unknown or expired authenticated session")

    record = _refresh_session_if_needed(record, settings)
    return {
        "snowflake_user": record.snowflake_user,
        "email": record.email,
        "display_name": record.display_name,
        "snowflake_user_token": decrypt_access_token(record, settings),
        "snowflake_role": record.snowflake_role,
        "oauth_session_id": record.session_id,
    }
