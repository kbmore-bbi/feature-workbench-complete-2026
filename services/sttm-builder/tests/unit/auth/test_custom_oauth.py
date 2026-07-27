import base64
from urllib.parse import parse_qs, urlparse
from pathlib import Path

import httpx
import pytest
from fastapi import Request

from app.auth.custom_oauth import (
    _decode_state_cookie,
    _exchange_code_for_tokens,
    _pkce_code_challenge,
    _refresh_tokens,
    build_login_redirect,
)
from app.config import Settings
from app.core.exceptions import OAuthTokenExchangeError
from scripts.render_spcs_spec import _validate_spcs_oauth_config


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        auth_mode="custom_oauth",
        auth_session_secret="state-signing-secret",
        auth_session_encryption_key="session-encryption-secret",
        auth_session_cookie_secure=False,
        snowflake_oauth_client_id="oauth-client-id",
        snowflake_oauth_client_secret="oauth-client-secret",
        snowflake_oauth_authorize_url="https://account.example/oauth/authorize",
        snowflake_oauth_token_url="https://account.example/oauth/token-request",
        snowflake_oauth_redirect_uri="https://app.example/api/v1/auth/callback",
        snowflake_oauth_scope="session:role:FOCUS_ADMIN",
    )


def _request(query: str = "") -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": "/api/v1/auth/login",
            "raw_path": b"/api/v1/auth/login",
            "query_string": query.encode(),
            "headers": [],
            "client": ("127.0.0.1", 1234),
            "server": ("app.example", 443),
        }
    )


def _state_cookie(response: object, cookie_name: str) -> str:
    header = response.headers["set-cookie"]  # type: ignore[attr-defined]
    prefix = f"{cookie_name}="
    return header.split(prefix, 1)[1].split(";", 1)[0].strip('"')


def test_login_redirect_uses_pkce_and_binds_verifier_to_signed_state() -> None:
    settings = _settings()
    response = build_login_redirect(_request("next=%2Fdashboard"), settings)

    query = parse_qs(urlparse(response.headers["location"]).query)
    assert query["code_challenge_method"] == ["S256"]
    assert "code_challenge" in query
    assert "code_verifier" not in query

    state_payload = _decode_state_cookie(
        _state_cookie(response, settings.auth_state_cookie_name),
        settings,
    )
    assert state_payload["state"] == query["state"][0]
    assert state_payload["next"] == "/dashboard"
    assert query["code_challenge"] == [
        _pkce_code_challenge(state_payload["code_verifier"])
    ]


def test_token_exchange_uses_basic_auth_only_and_sends_pkce(monkeypatch) -> None:
    settings = _settings()
    captured: dict[str, object] = {}

    def _post(url: str, **kwargs: object) -> httpx.Response:
        captured["url"] = url
        captured.update(kwargs)
        return httpx.Response(
            200,
            json={
                "access_token": "access-token",
                "refresh_token": "refresh-token",
                "expires_in": 600,
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr("app.auth.custom_oauth.httpx.post", _post)

    tokens = _exchange_code_for_tokens("authorization-code", "pkce-verifier", settings)

    assert tokens.access_token == "access-token"
    expected_basic = base64.b64encode(
        b"oauth-client-id:oauth-client-secret"
    ).decode("ascii")
    assert captured["headers"] == {
        "Accept": "application/json",
        "Authorization": f"Basic {expected_basic}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    assert "auth" not in captured
    assert captured["data"] == {
        "grant_type": "authorization_code",
        "code": "authorization-code",
        "code_verifier": "pkce-verifier",
        "redirect_uri": settings.snowflake_oauth_redirect_uri,
    }
    assert "client_id" not in captured["data"]  # type: ignore[operator]
    assert "client_secret" not in captured["data"]  # type: ignore[operator]


@pytest.mark.parametrize(
    ("operation", "invoke"),
    [
        (
            "token exchange",
            lambda settings: _exchange_code_for_tokens("bad-code", "verifier", settings),
        ),
        ("token refresh", lambda settings: _refresh_tokens("bad-refresh", settings)),
    ],
)
def test_oauth_failures_are_sanitized(
    monkeypatch,
    operation: str,
    invoke,
) -> None:
    settings = _settings()
    raw_secret_marker = "must-not-leak-upstream-response"

    def _post(url: str, **_: object) -> httpx.Response:
        return httpx.Response(
            401,
            json={
                "error": "invalid_client",
                "message": raw_secret_marker,
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr("app.auth.custom_oauth.httpx.post", _post)

    with pytest.raises(OAuthTokenExchangeError) as exc_info:
        invoke(settings)

    assert str(exc_info.value) == f"Snowflake OAuth {operation} failed"
    assert raw_secret_marker not in str(exc_info.value)
    assert exc_info.value.details == [{"field": "oauth", "message": "invalid_client"}]


def test_spcs_renderer_rejects_localhost_oauth_callback(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_MODE", "custom_oauth")
    monkeypatch.setenv(
        "SNOWFLAKE_OAUTH_REDIRECT_URI",
        "http://localhost:3000/api/v1/auth/callback",
    )

    with pytest.raises(SystemExit, match="must be an HTTPS public callback URL"):
        _validate_spcs_oauth_config(Path("webapp.yaml.tmpl"))


def test_spcs_renderer_accepts_https_public_oauth_callback(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_MODE", "custom_oauth")
    monkeypatch.setenv(
        "SNOWFLAKE_OAUTH_REDIRECT_URI",
        "https://app.example/api/v1/auth/callback",
    )
    monkeypatch.setenv("AUTH_SESSION_COOKIE_SECURE", "true")

    _validate_spcs_oauth_config(Path("webapp.yaml.tmpl"))


def test_spcs_renderer_rejects_insecure_oauth_cookie(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_MODE", "custom_oauth")
    monkeypatch.setenv(
        "SNOWFLAKE_OAUTH_REDIRECT_URI",
        "https://app.example/api/v1/auth/callback",
    )
    monkeypatch.setenv("AUTH_SESSION_COOKIE_SECURE", "false")

    with pytest.raises(SystemExit, match="AUTH_SESSION_COOKIE_SECURE must be true"):
        _validate_spcs_oauth_config(Path("webapp.yaml.tmpl"))
