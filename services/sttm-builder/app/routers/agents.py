from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import SNOWFLAKE_SUPPORTED_MODELS, Settings, get_settings
from app.schema.agents import AgentInfo, AgentsListResponse

router = APIRouter(prefix="/agents", tags=["Agents"])

_bearer = HTTPBearer()


@router.get(
    "",
    response_model=AgentsListResponse,
    summary="List available Cortex Agents and their LLM options",
    description=(
        "Returns all Cortex Agents configured in this service, each with its default "
        "orchestration model. The `supported_models` list shows every Snowflake Cortex "
        "LLM the user can select when calling an agent."
    ),
)
def list_agents(
    _: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AgentsListResponse:
    agents = [
        AgentInfo(
            id=a.id,
            display_name=a.display_name,
            description=a.description,
            default_model=a.default_model,
            supported_models=SNOWFLAKE_SUPPORTED_MODELS,
        )
        for a in settings.agents
    ]
    return AgentsListResponse(agents=agents)
