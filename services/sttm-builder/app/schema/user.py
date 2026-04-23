from pydantic import BaseModel, Field


class UserRolesResponse(BaseModel):
    app_roles: list[str] = Field(
        description=(
            "App Roles (STTM_VIEWER, STTM_PUBLISHER, STTM_ADMIN) that are granted "
            "to this user. At most 3. Use these to switch the active role."
        )
    )
    active_app_role: str | None = Field(
        description=(
            "The App Role currently active on this session (CURRENT_ROLE()). "
            "None if the session is running under a non-App Role."
        )
    )
    data_roles: list[str] = Field(
        description=(
            "All other Snowflake roles granted to this user, excluding App Roles. "
            "These govern data-level access and are informational only."
        )
    )
