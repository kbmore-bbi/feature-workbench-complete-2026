from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.auth.dependencies import get_current_principal
from app.auth.models import CurrentPrincipal
from app.core.config import SNOWFLAKE_SUPPORTED_MODELS, Settings, get_settings
from app.schema.contracts import ApiActor, ApiResponseEnvelope, build_response_envelope
from app.schema.agents import AgentInfo, AgentsListResponse

router = APIRouter(prefix="/agents", tags=["Agents"])


@router.get(
    "",
    response_model=ApiResponseEnvelope[AgentsListResponse],
    summary="List available Cortex Agents and their LLM options",
    description=(
        "Returns all Cortex Agents configured in this service, each with its default "
        "orchestration model. The `supported_models` list shows every Snowflake Cortex "
        "LLM the user can select when calling an agent."
    ),
)
def list_agents(
    request: Request,
    principal: Annotated[CurrentPrincipal, Depends(get_current_principal)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponseEnvelope[AgentsListResponse]:
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
    return build_response_envelope(
        operation="agents.list",
        request=request,
        actor=ApiActor(user_id=str(principal.user_id), role=principal.app_persona.value),
        data=AgentsListResponse(agents=agents),
    )
