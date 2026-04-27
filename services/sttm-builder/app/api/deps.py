from collections.abc import Generator
from typing import Annotated, Optional

from fastapi import Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.snowflake import SnowflakeClient
from app.core.snowflake_agent import SnowflakeAgentClient
from app.core.table_selection import TableSelectionService
from app.core.user import UserService
from app.core.sttm_builder import STTMBuilderService

_bearer = HTTPBearer()

_SPCS_USER_TOKEN_HEADER = "sf-context-current-user-token"


def get_snowflake_client(
    request: Request,
    role: Annotated[Optional[str], Query(description="Snowflake role to activate for this session")] = None,
) -> Generator[SnowflakeClient, None, None]:
    """
    Opens a Snowflake session under the calling user's identity via SPCS caller's rights.
    Requires the Sf-Context-Current-User-Token header injected by the SPCS ingress.
    If `role` is provided it is activated on the session.
    """
    user_token = request.headers.get(_SPCS_USER_TOKEN_HEADER, "")
    client = SnowflakeClient(user_token=user_token, role=role)
    try:
        yield client
    finally:
        client.close()


def get_snowflake_agent_client(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
) -> SnowflakeAgentClient:
    """Returns a Cortex Agent client authenticated with the caller's OAuth token."""
    return SnowflakeAgentClient(token=credentials.credentials)


def get_table_selection_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
) -> TableSelectionService:
    return TableSelectionService(client)


def get_sttm_builder_service(
    agent_client: Annotated[SnowflakeAgentClient, Depends(get_snowflake_agent_client)],
) -> STTMBuilderService:
    return STTMBuilderService(agent_client)


def get_user_service(
    client: Annotated[SnowflakeClient, Depends(get_snowflake_client)],
) -> UserService:
    return UserService(client)
