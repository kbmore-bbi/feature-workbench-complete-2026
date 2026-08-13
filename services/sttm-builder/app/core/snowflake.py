import logging
import hashlib
import time
from contextlib import contextmanager
from dataclasses import dataclass
from threading import BoundedSemaphore, Lock
from typing import Any, Optional

import snowflake.connector
from snowflake.snowpark import Session

from app.core.config import Settings
from app.core.exceptions import AuthenticationError, SnowflakeConnectionError
from app.core.warehouse_routing import (
    WarehouseWorkload,
    connection_session_parameters,
    resolve_warehouse,
)

logger = logging.getLogger(__name__)

_SERVICE_TOKEN_PATH = "/snowflake/session/token"
_LOCAL_CLIENT_CACHE: dict[str, "SnowflakeClient"] = {}
_LOCAL_CLIENT_LAST_VALIDATED: dict[str, float] = {}
_LOCAL_CLIENT_LOCK = Lock()
_LOCAL_CONNECTOR_CACHE: dict[str, snowflake.connector.SnowflakeConnection] = {}
_LOCAL_CONNECTOR_LAST_VALIDATED: dict[str, float] = {}
_LOCAL_CONNECTOR_LOCK = Lock()
_USER_CLIENT_CACHE: dict[str, tuple["SnowflakeClient", float]] = {}
_USER_CLIENT_LOCK = Lock()


@dataclass
class RestSessionContext:
    token: str
    host: str


def _read_token_file(token_path: str) -> str | None:
    try:
        with open(token_path) as f:
            token = f.read().strip()
    except OSError:
        return None
    return token or None


def get_service_token() -> str:
    """Read this container's own SPCS service OAuth token."""
    token = _read_token_file(_SERVICE_TOKEN_PATH)
    if token:
        logger.debug("Using SPCS service token from %s", _SERVICE_TOKEN_PATH)
        return token

    raise SnowflakeConnectionError(
        f"Cannot read the SPCS service token from {_SERVICE_TOKEN_PATH}"
    )


def get_caller_oauth_token(user_token: str) -> str:
    """
    Resolve the OAuth token to use for caller-rights sessions.

    Snowflake execute-as-caller services authenticate the user's session with
    a combined OAuth token in the form <service_token>.<ingress_user_token>.
    """
    if not user_token or not user_token.strip():
        raise AuthenticationError(
            "Sf-Context-Current-User-Token header is absent — "
            "request must arrive through SPCS ingress"
        )

    return f"{get_service_token()}.{user_token.strip()}"


def get_effective_oauth_token(settings: Settings, user_token: str | None) -> str:
    if settings.uses_custom_oauth and (user_token or "").strip():
        return (user_token or "").strip()
    if settings.spcs_execute_as_caller_enabled:
        return get_caller_oauth_token((user_token or "").strip())
    return get_service_token()


def get_runtime_snowflake_host(settings: Settings) -> str:
    return _normalize_host(settings.resolved_snowflake_host, settings.snowflake_account)


def _oauth_base_kwargs(
    settings: Settings,
    *,
    role: Optional[str] = None,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "authenticator": "oauth",
    }
    if settings.snowflake_account:
        kwargs["account"] = settings.snowflake_account
    if settings.resolved_snowflake_host:
        kwargs["host"] = settings.resolved_snowflake_host
    warehouse = resolve_warehouse(settings, workload)
    if warehouse:
        kwargs["warehouse"] = warehouse
    if settings.snowflake_database:
        kwargs["database"] = settings.snowflake_database
    if settings.snowflake_schema:
        kwargs["schema"] = settings.snowflake_schema
    if role:
        kwargs["role"] = role
    kwargs["session_parameters"] = connection_session_parameters(settings, workload)
    return kwargs


def _caller_oauth_attempts(
    settings: Settings,
    user_token: str,
    *,
    role: Optional[str] = None,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
) -> list[tuple[str, dict[str, Any]]]:
    base = _oauth_base_kwargs(settings, role=role, workload=workload)
    attempts: list[tuple[str, dict[str, Any]]] = []

    if settings.uses_custom_oauth:
        normalized_user_token = (user_token or "").strip()
        if normalized_user_token:
            attempts.append(
                (
                    "oauth_user_token",
                    {**base, "token": normalized_user_token},
                )
            )
    elif settings.spcs_execute_as_caller_enabled:
        normalized_user_token = (user_token or "").strip()
        if normalized_user_token:
            attempts.append(
                (
                    "combined_service_user_token",
                    {**base, "token": get_caller_oauth_token(normalized_user_token)},
                )
            )
    else:
        attempts.append(
            (
                "service_oauth_token",
                {**base, "token": get_service_token()},
            )
        )

    deduped: list[tuple[str, dict[str, Any]]] = []
    seen: set[tuple[tuple[str, str], ...]] = set()
    for label, config in attempts:
        signature = tuple(sorted((key, str(value)) for key, value in config.items()))
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append((label, config))
    return deduped


def _create_session_with_attempts(
    attempts: list[tuple[str, dict[str, Any]]],
) -> Session:
    errors: list[str] = []
    for label, config in attempts:
        try:
            session = Session.builder.configs(config).create()
            logger.info("Snowpark caller-rights session created using %s", label)
            return session
        except Exception as exc:
            logger.warning("Snowpark caller-rights attempt %s failed: %s", label, exc)
            errors.append(f"{label}: {exc}")
    raise SnowflakeConnectionError(
        "Failed to create Snowpark session via caller-rights attempts: "
        + " | ".join(errors)
    )


def _connect_with_attempts(
    attempts: list[tuple[str, dict[str, Any]]],
) -> snowflake.connector.SnowflakeConnection:
    errors: list[str] = []
    for label, config in attempts:
        try:
            connection = snowflake.connector.connect(**config)
            logger.info("Snowflake caller-rights connector created using %s", label)
            return connection
        except Exception as exc:
            logger.warning("Snowflake caller-rights connector attempt %s failed: %s", label, exc)
            errors.append(f"{label}: {exc}")
    raise SnowflakeConnectionError(
        "Failed to create Snowflake connection via caller-rights attempts: "
        + " | ".join(errors)
    )


def build_caller_token(settings: Settings, user_token: str) -> str:
    """
    Resolve the OAuth token used for REST-style Snowflake calls.

    In execute-as-caller ingress mode this is the combined
    ``<service_token>.<ingress_user_token>`` token.
    In custom OAuth mode this is the raw Snowflake OAuth access token.
    In temporary service-auth mode this falls back to the service token only.
    """
    token = get_effective_oauth_token(settings, user_token)
    logger.debug("Resolved Snowflake OAuth token for SPCS request (length=%d)", len(token))
    return token


def _direct_connection_kwargs(
    settings: Settings,
    role: Optional[str] = None,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
) -> dict[str, Any]:
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

    warehouse = resolve_warehouse(settings, workload)
    if warehouse:
        kwargs["warehouse"] = warehouse
    if settings.snowflake_database:
        kwargs["database"] = settings.snowflake_database
    if settings.snowflake_schema:
        kwargs["schema"] = settings.snowflake_schema
    effective_role = role or settings.snowflake_role
    if effective_role:
        kwargs["role"] = effective_role
    if settings.resolved_snowflake_host:
        kwargs["host"] = settings.resolved_snowflake_host
    kwargs["session_parameters"] = connection_session_parameters(settings, workload)
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


def _local_cache_key(
    settings: Settings,
    role: Optional[str] = None,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
) -> str:
    effective_role = role or settings.snowflake_role or ""
    return "|".join(
        [
            settings.snowflake_account or "",
            settings.snowflake_user or "",
            effective_role,
            workload.value,
            resolve_warehouse(settings, workload),
            settings.snowflake_database or "",
            settings.snowflake_schema or "",
            "externalbrowser" if settings.local_dev_uses_externalbrowser else "password",
        ]
    )


def get_local_cached_client(
    settings: Settings,
    role: Optional[str] = None,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
) -> "SnowflakeClient":
    key = _local_cache_key(settings, role, workload)
    with _LOCAL_CLIENT_LOCK:
        client = _LOCAL_CLIENT_CACHE.get(key)
        if client is not None:
            health_interval = max(
                0, int(settings.snowflake_session_healthcheck_interval_seconds)
            )
            if health_interval == 0 or (
                time.monotonic() - _LOCAL_CLIENT_LAST_VALIDATED.get(key, 0.0)
                < health_interval
            ):
                return client
            try:
                client.session.sql("SELECT 1").collect()
                _LOCAL_CLIENT_LAST_VALIDATED[key] = time.monotonic()
                return client
            except Exception:
                try:
                    client.close()
                except Exception:
                    logger.debug("Failed to close stale cached Snowpark session", exc_info=True)
                _LOCAL_CLIENT_CACHE.pop(key, None)
                _LOCAL_CLIENT_LAST_VALIDATED.pop(key, None)

        client = SnowflakeClient(
            settings=settings,
            user_token="",
            role=role,
            workload=workload,
        )
        _LOCAL_CLIENT_CACHE[key] = client
        _LOCAL_CLIENT_LAST_VALIDATED[key] = time.monotonic()
        return client


def _oauth_user_cache_key(
    settings: Settings,
    user_token: str,
    role: Optional[str] = None,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
) -> str:
    token_fingerprint = hashlib.sha256(user_token.encode("utf-8")).hexdigest()
    effective_role = role or settings.snowflake_role or ""
    return "|".join(
        [
            token_fingerprint,
            effective_role,
            workload.value,
            resolve_warehouse(settings, workload),
            settings.snowflake_database or "",
            settings.snowflake_schema or "",
            settings.resolved_snowflake_host or "",
            settings.snowflake_account or "",
        ]
    )


def get_oauth_cached_client(
    settings: Settings,
    user_token: str,
    role: Optional[str] = None,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
) -> "SnowflakeClient":
    """
    Reuse short-lived Snowpark sessions for the same signed-in OAuth user/role.

    In SPCS, establishing a fresh OAuth Snowpark session can cost many seconds,
    which made metadata endpoints feel slow even when the SQL itself was tiny.
    The cache stores only a token fingerprint in the key and keeps the live
    connector object in memory for the current service process.
    """
    normalized_token = (user_token or "").strip()
    ttl_seconds = max(0, int(settings.snowflake_user_session_cache_ttl_seconds))
    if not normalized_token or ttl_seconds <= 0:
        return SnowflakeClient(
            settings=settings,
            user_token=normalized_token,
            role=role,
            workload=workload,
        )

    key = _oauth_user_cache_key(settings, normalized_token, role, workload)
    now = time.monotonic()
    with _USER_CLIENT_LOCK:
        expired_keys = [
            cache_key
            for cache_key, (_client, expires_at) in _USER_CLIENT_CACHE.items()
            if expires_at <= now
        ]
        for cache_key in expired_keys:
            client, _expires_at = _USER_CLIENT_CACHE.pop(cache_key)
            try:
                client.close()
            except Exception:
                logger.debug("Failed to close expired cached OAuth Snowpark session", exc_info=True)

        cached = _USER_CLIENT_CACHE.get(key)
        if cached is not None:
            client, _expires_at = cached
            _USER_CLIENT_CACHE[key] = (client, now + ttl_seconds)
            return client

        client = SnowflakeClient(
            settings=settings,
            user_token=normalized_token,
            role=role,
            workload=workload,
        )
        _USER_CLIENT_CACHE[key] = (client, now + ttl_seconds)
        return client


def _local_connector_cache_key(
    settings: Settings,
    role: Optional[str] = None,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
) -> str:
    effective_role = role or settings.snowflake_role or ""
    return "|".join(
        [
            settings.snowflake_account or "",
            settings.snowflake_user or "",
            effective_role,
            workload.value,
            resolve_warehouse(settings, workload),
            settings.snowflake_database or "",
            settings.snowflake_schema or "",
            "externalbrowser" if settings.local_dev_uses_externalbrowser else "password",
            "connector",
        ]
    )


def get_local_cached_connector(
    settings: Settings,
    role: Optional[str] = None,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
) -> snowflake.connector.SnowflakeConnection:
    key = _local_connector_cache_key(settings, role, workload)
    with _LOCAL_CONNECTOR_LOCK:
        connection = _LOCAL_CONNECTOR_CACHE.get(key)
        if connection is not None:
            health_interval = max(
                0, int(settings.snowflake_session_healthcheck_interval_seconds)
            )
            if health_interval == 0 or (
                time.monotonic() - _LOCAL_CONNECTOR_LAST_VALIDATED.get(key, 0.0)
                < health_interval
            ):
                return connection
            try:
                cursor = connection.cursor()
                cursor.execute("SELECT 1")
                cursor.close()
                _LOCAL_CONNECTOR_LAST_VALIDATED[key] = time.monotonic()
                return connection
            except Exception:
                try:
                    connection.close()
                except Exception:
                    logger.debug("Failed to close stale cached connector session", exc_info=True)
                _LOCAL_CONNECTOR_CACHE.pop(key, None)
                _LOCAL_CONNECTOR_LAST_VALIDATED.pop(key, None)

        connection = snowflake.connector.connect(
            **_direct_connection_kwargs(settings, role, workload)
        )
        _LOCAL_CONNECTOR_CACHE[key] = connection
        _LOCAL_CONNECTOR_LAST_VALIDATED[key] = time.monotonic()
        return connection


@contextmanager
def get_local_cached_connector_context(
    settings: Settings,
    role: Optional[str] = None,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
):
    connection = get_local_cached_connector(settings, role, workload)
    yield connection


def get_local_rest_session_context(
    settings: Settings,
    role: Optional[str] = None,
    workload: WarehouseWorkload = WarehouseWorkload.AGENT,
) -> RestSessionContext:
    try:
        connection = get_local_cached_connector(settings, role, workload)
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
    Wraps a Snowpark Session authenticated as the current application user.

    In ingress-header mode it uses SPCS caller's rights with the combined
    service-token plus ingress-token format. In custom OAuth mode it uses the
    Snowflake OAuth access token directly.
    """

    def __init__(
        self,
        settings: Settings,
        user_token: str | None = None,
        role: Optional[str] = None,
        workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
    ) -> None:
        self._workload = workload
        self._warehouse = resolve_warehouse(settings, workload)
        if using_local_dev_auth(settings, user_token):
            config = _direct_connection_kwargs(settings, role, workload)
            retry_attempts = max(1, settings.snowflake_session_retry_attempts)
            backoff_seconds = max(0.0, settings.snowflake_session_retry_backoff_seconds)
            last_error: Exception | None = None
            for attempt in range(1, retry_attempts + 1):
                try:
                    self._session = Session.builder.configs(config).create()
                    return
                except Exception as exc:
                    last_error = exc
                    if attempt >= retry_attempts:
                        break
                    logger.warning(
                        "Snowpark session creation failed (attempt %s/%s). Retrying in %.1fs: %s",
                        attempt,
                        retry_attempts,
                        backoff_seconds,
                        exc,
                    )
                    if backoff_seconds > 0:
                        time.sleep(backoff_seconds)

            raise SnowflakeConnectionError(
                f"Failed to create Snowpark session: {last_error}"
            ) from last_error
        else:
            attempts = _caller_oauth_attempts(
                settings,
                user_token or "",
                role=role,
                workload=workload,
            )
            if not attempts:
                raise SnowflakeConnectionError("No caller-rights OAuth attempts could be constructed")
            retry_attempts = max(1, settings.snowflake_session_retry_attempts)
            backoff_seconds = max(0.0, settings.snowflake_session_retry_backoff_seconds)
            last_error: Exception | None = None
            for attempt in range(1, retry_attempts + 1):
                try:
                    self._session = _create_session_with_attempts(attempts)
                    return
                except Exception as exc:
                    last_error = exc
                    if attempt >= retry_attempts:
                        break
                    logger.warning(
                        "Snowpark caller-rights session creation failed (attempt %s/%s). Retrying in %.1fs: %s",
                        attempt,
                        retry_attempts,
                        backoff_seconds,
                        exc,
                    )
                    if backoff_seconds > 0:
                        time.sleep(backoff_seconds)

            raise SnowflakeConnectionError(
                f"Failed to create Snowpark session: {last_error}"
            ) from last_error

    @property
    def session(self) -> Session:
        return self._session

    @property
    def workload(self) -> WarehouseWorkload:
        return self._workload

    @property
    def warehouse(self) -> str:
        return self._warehouse

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


class SnowflakeSessionLeasePool:
    """Bound independent Snowpark sessions; a session is never shared concurrently."""

    def __init__(
        self,
        *,
        settings: Settings,
        user_token: str | None,
        role: str | None,
        workload: WarehouseWorkload,
        maximum: int,
    ) -> None:
        self._settings = settings
        self._user_token = user_token
        self._role = role
        self._workload = workload
        self._limit = BoundedSemaphore(max(1, maximum))
        self._idle: list[SnowflakeClient] = []
        self._lock = Lock()

    @contextmanager
    def lease(self):
        acquired = self._limit.acquire(timeout=5)
        if not acquired:
            raise SnowflakeConnectionError("Snowflake session lease capacity is exhausted")
        client: SnowflakeClient | None = None
        try:
            with self._lock:
                if self._idle:
                    client = self._idle.pop()
            if client is None:
                client = SnowflakeClient(
                    settings=self._settings,
                    user_token=self._user_token,
                    role=self._role,
                    workload=self._workload,
                )
            yield client
            with self._lock:
                self._idle.append(client)
            client = None
        finally:
            if client is not None:
                client.close()
            self._limit.release()

    def close(self) -> None:
        with self._lock:
            clients, self._idle = self._idle, []
        for client in clients:
            client.close()


def _oauth_connection_kwargs(
    settings: Settings,
    token: str,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "account": settings.snowflake_account,
        "authenticator": "oauth",
        "token": token,
    }
    warehouse = resolve_warehouse(settings, workload)
    if warehouse:
        kwargs["warehouse"] = warehouse
    if settings.snowflake_database:
        kwargs["database"] = settings.snowflake_database
    if settings.snowflake_schema:
        kwargs["schema"] = settings.snowflake_schema
    if settings.resolved_snowflake_host:
        kwargs["host"] = settings.resolved_snowflake_host
    kwargs["session_parameters"] = connection_session_parameters(settings, workload)
    return kwargs


def get_user_connection(
    ingress_user_token: str | None,
    settings: Settings,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
) -> snowflake.connector.SnowflakeConnection:
    if using_local_dev_auth(settings, ingress_user_token):
        if settings.local_dev_uses_externalbrowser:
            return get_local_cached_connector_context(settings, workload=workload)
        return snowflake.connector.connect(
            **_direct_connection_kwargs(settings, workload=workload)
        )
    attempts = _caller_oauth_attempts(
        settings,
        ingress_user_token or "",
        workload=workload,
    )
    if not attempts:
        raise SnowflakeConnectionError("No caller-rights OAuth attempts could be constructed")
    return _connect_with_attempts(attempts)


def get_service_connection(
    settings: Settings,
    workload: WarehouseWorkload = WarehouseWorkload.CONTROL,
) -> snowflake.connector.SnowflakeConnection:
    if settings.local_dev_auth_enabled:
        if settings.local_dev_uses_externalbrowser:
            return get_local_cached_connector_context(settings, workload=workload)
        return snowflake.connector.connect(
            **_direct_connection_kwargs(settings, workload=workload)
        )
    return snowflake.connector.connect(
        **_oauth_connection_kwargs(settings, get_service_token(), workload)
    )
