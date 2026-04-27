from pydantic import BaseModel, Field


class UserRolesResponse(BaseModel):
    app_roles: list[str] = Field(
        description=(
            "App persona roles granted to this user. "
            "These are the env-configured roles used by the workbench persona model."
        )
    )
    active_app_role: str | None = Field(
        description=(
            "The app persona role currently active on this session (CURRENT_ROLE()). "
            "None if the session is running under a non-app role."
        )
    )
    data_roles: list[str] = Field(
        description=(
            "All other Snowflake roles granted to this user, excluding app persona roles. "
            "These govern data-level access and are informational only."
        )
    )
