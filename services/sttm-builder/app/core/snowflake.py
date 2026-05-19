import logging
from contextlib import contextmanager
from dataclasses import dataclass
from threading import Lock
from typing import Any, Optional

import snowflake.connector
from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.exceptions import AuthenticationError, SnowflakeConnectionError

logger = logging.getLogger(__name__)

_SERVICE_TOKEN_PATH = "/snowflake/session/token"
_LOCAL_CLIENT_CACHE: dict[str, "SnowflakeClient"] = {}
_LOCAL_CLIENT_LOCK = Lock()
_LOCAL_CONNECTOR_CACHE: dict[str, snowflake.connector.SnowflakeConnection] = {}
_LOCAL_CONNECTOR_LOCK = Lock()


@dataclass
class RestSessionContext:
    token: str
    host: str


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
    if not settings.snowflake_user:
        raise SnowflakeConnectionError(
            "Local development auth is enabled, but SNOWFLAKE_USER is not configured."
        )

    kwargs: dict[str, Any] = {
        "account": settings.snowflake_account,
        "user": settings.snowflake_user,
    }
    if settings.local_dev_uses_externalbrowser:
        kwargs["authenticator"] = "externalbrowser"
    else:
        if not settings.snowflake_password:
            raise SnowflakeConnectionError(
                "Local development auth is enabled, but SNOWFLAKE_PASSWORD is not configured."
            )
        kwargs["password"] = settings.snowflake_password

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


def _normalize_host(host: str, account: str) -> str:
    resolved_host = (host or "").strip().replace("_", "-").lower()
    if resolved_host.endswith(".snowflakecomputing.com"):
        return resolved_host

    normalized_account = (account or "").strip().replace("_", "-").lower()
    if normalized_account.endswith(".snowflakecomputing.com"):
        return normalized_account
    if normalized_account:
        return f"{normalized_account}.snowflakecomputing.com"
    return resolved_host


def _local_cache_key(settings: Settings, role: Optional[str] = None) -> str:
    effective_role = role or settings.snowflake_role or ""
    return "|".join(
        [
            settings.snowflake_account or "",
            settings.snowflake_user or "",
            effective_role,
            settings.snowflake_warehouse or "",
            settings.snowflake_database or "",
            settings.snowflake_schema or "",
            "externalbrowser" if settings.local_dev_uses_externalbrowser else "password",
        ]
    )


def get_local_cached_client(
    settings: Settings,
    role: Optional[str] = None,
) -> "SnowflakeClient":
    key = _local_cache_key(settings, role)
    with _LOCAL_CLIENT_LOCK:
        client = _LOCAL_CLIENT_CACHE.get(key)
        if client is not None:
            try:
                client.session.sql("SELECT 1").collect()
                return client
            except Exception:
                try:
                    client.close()
                except Exception:
                    logger.debug("Failed to close stale cached Snowpark session", exc_info=True)
                _LOCAL_CLIENT_CACHE.pop(key, None)

        client = SnowflakeClient(
            settings=settings,
            user_token="",
            role=role,
        )
        _LOCAL_CLIENT_CACHE[key] = client
        return client


def _local_connector_cache_key(settings: Settings, role: Optional[str] = None) -> str:
    effective_role = role or settings.snowflake_role or ""
    return "|".join(
        [
            settings.snowflake_account or "",
            settings.snowflake_user or "",
            effective_role,
            settings.snowflake_warehouse or "",
            settings.snowflake_database or "",
            settings.snowflake_schema or "",
            "externalbrowser" if settings.local_dev_uses_externalbrowser else "password",
            "connector",
        ]
    )


def get_local_cached_connector(
    settings: Settings,
    role: Optional[str] = None,
) -> snowflake.connector.SnowflakeConnection:
    key = _local_connector_cache_key(settings, role)
    with _LOCAL_CONNECTOR_LOCK:
        connection = _LOCAL_CONNECTOR_CACHE.get(key)
        if connection is not None:
            try:
                cursor = connection.cursor()
                cursor.execute("SELECT 1")
                cursor.close()
                return connection
            except Exception:
                try:
                    connection.close()
                except Exception:
                    logger.debug("Failed to close stale cached connector session", exc_info=True)
                _LOCAL_CONNECTOR_CACHE.pop(key, None)

        connection = snowflake.connector.connect(**_direct_connection_kwargs(settings, role))
        _LOCAL_CONNECTOR_CACHE[key] = connection
        return connection


@contextmanager
def get_local_cached_connector_context(
    settings: Settings,
    role: Optional[str] = None,
):
    connection = get_local_cached_connector(settings, role)
    yield connection


def get_local_rest_session_context(
    settings: Settings,
    role: Optional[str] = None,
) -> RestSessionContext:
    try:
        connection = get_local_cached_connector(settings, role)
        rest = getattr(connection, "_rest", None)
        token = getattr(rest, "_token", None) if rest else None
        if not token:
            raise SnowflakeConnectionError(
                "Failed to extract the Snowflake connector session token for local REST calls."
            )

        host = _normalize_host(
            getattr(connection, "host", "") or settings.resolved_snowflake_host,
            settings.snowflake_account,
        )
        if not host:
            raise SnowflakeConnectionError(
                "Failed to determine the Snowflake host for local REST calls."
            )

        return RestSessionContext(token=token, host=host)
    except Exception as exc:
        if isinstance(exc, SnowflakeConnectionError):
            raise
        raise SnowflakeConnectionError(
            f"Failed to initialize local Snowflake REST session context: {exc}"
        ) from exc


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

    def get_rest_session_context(self) -> RestSessionContext:
        server_connection = getattr(self._session, "_conn", None)
        connector_connection = getattr(server_connection, "_conn", None) if server_connection else None
        rest = getattr(connector_connection, "_rest", None) if connector_connection else None
        token = getattr(rest, "_token", None) if rest else None

        if not token:
            raise SnowflakeConnectionError(
                "Failed to extract the Snowflake connector session token from the active session."
            )

        host = _normalize_host(
            getattr(connector_connection, "host", ""),
            getattr(connector_connection, "account", ""),
        )
        if not host:
            raise SnowflakeConnectionError(
                "Failed to determine the Snowflake host from the active session."
            )

        return RestSessionContext(token=token, host=host)

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
        if settings.local_dev_uses_externalbrowser:
            return get_local_cached_connector_context(settings)
        return snowflake.connector.connect(**_direct_connection_kwargs(settings))
    return snowflake.connector.connect(
        **_oauth_connection_kwargs(settings, build_caller_token(ingress_user_token or ""))
    )


def get_service_connection(settings: Settings) -> snowflake.connector.SnowflakeConnection:
    if settings.local_dev_auth_enabled:
        if settings.local_dev_uses_externalbrowser:
            return get_local_cached_connector_context(settings)
        return snowflake.connector.connect(**_direct_connection_kwargs(settings))
    return snowflake.connector.connect(
        **_oauth_connection_kwargs(settings, get_service_token())
    )
