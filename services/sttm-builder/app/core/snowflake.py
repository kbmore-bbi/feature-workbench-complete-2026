import logging
from typing import Any, Optional

import snowflake.connector
from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.exceptions import AuthenticationError, SnowflakeConnectionError

logger = logging.getLogger(__name__)

_SERVICE_TOKEN_PATH = "/snowflake/session/token"


def get_service_token() -> str:
    """Read this container's own SPCS service OAuth token."""
    try:
        with open(_SERVICE_TOKEN_PATH) as f:
            token = f.read().strip()
    except OSError as e:
        raise SnowflakeConnectionError(
            f"Cannot read SPCS service token from {_SERVICE_TOKEN_PATH}: {e}"
        ) from e
    if not token:
        raise SnowflakeConnectionError(
            f"SPCS service token at {_SERVICE_TOKEN_PATH} is empty"
        )
    return token


def build_caller_token(user_token: str) -> str:
    """
    Combine this service's own token with the ingress-injected user token.
    Snowflake caller's rights requires: <service_token>.<user_token>.
    The user token is injected by the SPCS ingress proxy as Sf-Context-Current-User-Token.
    """
    if not user_token or not user_token.strip():
        raise AuthenticationError(
            "Sf-Context-Current-User-Token header is absent — "
            "request must arrive through SPCS ingress"
        )
    combined = f"{get_service_token()}.{user_token.strip()}"

    logger.debug(
        "Built combined token: prefix=%s...%s length=%d",
        combined[:8],
        combined[-4:],
        len(combined),
    )
    return combined


def _direct_connection_kwargs(settings: Settings, role: Optional[str] = None) -> dict[str, Any]:
    if not settings.snowflake_user or not settings.snowflake_password:
        raise SnowflakeConnectionError(
            "Local development auth is enabled, but SNOWFLAKE_USER or "
            "SNOWFLAKE_PASSWORD is not configured."
        )

    kwargs: dict[str, Any] = {
        "account": settings.snowflake_account,
        "user": settings.snowflake_user,
        "password": settings.snowflake_password,
    }
    if settings.snowflake_warehouse:
        kwargs["warehouse"] = settings.snowflake_warehouse
    if settings.snowflake_database:
        kwargs["database"] = settings.snowflake_database
    if settings.snowflake_schema:
        kwargs["schema"] = settings.snowflake_schema
    effective_role = role or settings.snowflake_role
    if effective_role:
        kwargs["role"] = effective_role
    if settings.resolved_snowflake_host:
        kwargs["host"] = settings.resolved_snowflake_host
    return kwargs


def using_local_dev_auth(settings: Settings, user_token: str | None = None) -> bool:
    return settings.local_dev_auth_enabled and not (user_token or "").strip()


class SnowflakeClient:
    """
    Wraps a Snowpark Session authenticated as the calling user via SPCS caller's rights.
    Combines this service's own OAuth token with the ingress-injected user token.
    """

    def __init__(
        self,
        settings: Settings,
        user_token: str | None = None,
        role: Optional[str] = None,
    ) -> None:
        if using_local_dev_auth(settings, user_token):
            config = _direct_connection_kwargs(settings, role)
        else:
            caller_token = build_caller_token(user_token or "")
            config: dict[str, Any] = {
                "account": settings.snowflake_account,
                "authenticator": "oauth",
                "token": caller_token,
            }
            if settings.resolved_snowflake_host:
                config["host"] = settings.resolved_snowflake_host
            if role:
                config["role"] = role

        try:
            self._session = Session.builder.configs(config).create()
        except Exception as e:
            raise SnowflakeConnectionError(
                f"Failed to create Snowpark session: {e}"
            ) from e

    @property
    def session(self) -> Session:
        return self._session

    def close(self) -> None:
        self._session.close()


def _oauth_connection_kwargs(settings: Settings, token: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "account": settings.snowflake_account,
        "authenticator": "oauth",
        "token": token,
    }
    if settings.snowflake_warehouse:
        kwargs["warehouse"] = settings.snowflake_warehouse
    if settings.snowflake_database:
        kwargs["database"] = settings.snowflake_database
    if settings.snowflake_schema:
        kwargs["schema"] = settings.snowflake_schema
    if settings.resolved_snowflake_host:
        kwargs["host"] = settings.resolved_snowflake_host
    return kwargs


def get_user_connection(
    ingress_user_token: str | None,
    settings: Settings,
) -> snowflake.connector.SnowflakeConnection:
    if using_local_dev_auth(settings, ingress_user_token):
        return snowflake.connector.connect(**_direct_connection_kwargs(settings))
    return snowflake.connector.connect(
        **_oauth_connection_kwargs(settings, build_caller_token(ingress_user_token or ""))
    )


def get_service_connection(settings: Settings) -> snowflake.connector.SnowflakeConnection:
    if settings.local_dev_auth_enabled:
        return snowflake.connector.connect(**_direct_connection_kwargs(settings))
    return snowflake.connector.connect(
        **_oauth_connection_kwargs(settings, get_service_token())
    )
