import logging
import os
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


class SnowflakeClient:
    """
    Wraps a Snowpark Session authenticated as the calling user via SPCS caller's rights.
    Combines this service's own OAuth token with the ingress-injected user token.
    """

    def __init__(self, user_token: str, role: Optional[str] = None) -> None:
        caller_token = build_caller_token(user_token)

        config: dict = {
            "account": os.environ["SNOWFLAKE_ACCOUNT"],
            "host": os.environ["SNOWFLAKE_HOST"],
            "authenticator": "oauth",
            "token": caller_token,
        }
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


def _connection_kwargs(settings: Settings, token: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "account": settings.snowflake_account,
        "authenticator": "oauth",
        "token": token,
        "warehouse": settings.snowflake_warehouse,
        "database": settings.snowflake_database,
        "schema": settings.snowflake_schema,
    }
    if settings.snowflake_host:
        kwargs["host"] = settings.snowflake_host
    return kwargs


def get_user_connection(
    ingress_user_token: str,
    settings: Settings,
) -> snowflake.connector.SnowflakeConnection:
    return snowflake.connector.connect(
        **_connection_kwargs(settings, build_caller_token(ingress_user_token))
    )


def get_service_connection(settings: Settings) -> snowflake.connector.SnowflakeConnection:
    return snowflake.connector.connect(
        **_connection_kwargs(settings, get_service_token())
    )
