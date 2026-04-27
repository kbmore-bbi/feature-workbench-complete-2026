from app.core.exceptions import SnowflakeQueryError
from app.core.config import Settings
from app.core.snowflake import SnowflakeClient
from app.schema.user import UserRolesResponse


class UserService:
    def __init__(self, client: SnowflakeClient, settings: Settings) -> None:
        self._client = client
        self._app_role_values = frozenset(
            {
                settings.app_role_admin,
                settings.app_role_publisher,
                settings.app_role_viewer,
            }
        )

    def list_roles(self) -> UserRolesResponse:
        """
        Partitions the user's Snowflake roles into App Roles and Data Roles.

        App Roles  — the env-configured app persona roles; user switches between these.
        Data Roles — everything else; govern data-level access, excluded from
                     app role switcher.

        Accessible to every App Role — Snowflake's APPLICABLE_ROLES view
        naturally scopes results to the calling user.
        """
        try:
            role_rows = self._client.session.sql(
                "SELECT ROLE_NAME "
                "FROM INFORMATION_SCHEMA.APPLICABLE_ROLES "
                "ORDER BY ROLE_NAME"
            ).collect()

            current_rows = self._client.session.sql(
                "SELECT CURRENT_ROLE() AS ROLE"
            ).collect()
        except Exception as exc:
            raise SnowflakeQueryError(f"Failed to fetch user roles: {exc}") from exc

        all_roles = [row["ROLE_NAME"] for row in role_rows]
        current = current_rows[0]["ROLE"] if current_rows else None

        app_roles = [r for r in all_roles if r in self._app_role_values]
        data_roles = [r for r in all_roles if r not in self._app_role_values]
        active_app_role = current if current in self._app_role_values else None

        return UserRolesResponse(
            app_roles=app_roles,
            active_app_role=active_app_role,
            data_roles=data_roles,
        )
