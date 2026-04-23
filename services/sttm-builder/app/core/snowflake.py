import os
from typing import Optional

from snowflake.snowpark import Session

from app.core.exceptions import SnowflakeConnectionError


class SnowflakeClient:
    """
    Wraps a Snowpark Session authenticated as the calling user via Okta OAuth.
    An optional role overrides the user's default role for this session.
    """

    def __init__(self, token: str, role: Optional[str] = None) -> None:
        config: dict = {
            "account": os.environ["SNOWFLAKE_ACCOUNT"],
            "host": os.environ["SNOWFLAKE_HOST"],
            "authenticator": "oauth",
            "token": token,
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
