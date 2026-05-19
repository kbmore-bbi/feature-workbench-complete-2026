from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from snowflake.connector import DictCursor

from app.auth.dependencies import get_current_principal, require_persona
from app.auth.models import (
    AppPersona,
    CurrentPrincipal,
    PermissionSet,
    SessionResponse,
    SnowflakeContextResponse,
    UserSummary,
)
from app.config import Settings, get_settings
from app.core.snowflake import get_user_connection
from app.schema.contracts import ApiActor, ApiResponseEnvelope, build_response_envelope


auth_router = APIRouter()
admin_router = APIRouter()


@auth_router.get("/session", response_model=ApiResponseEnvelope[SessionResponse])
def get_session(
    request: Request,
    current_principal: CurrentPrincipal = Depends(get_current_principal),
) -> ApiResponseEnvelope[SessionResponse]:
    return build_response_envelope(
        operation="auth.session",
        request=request,
        actor=ApiActor(
            user_id=str(current_principal.user_id),
            role=current_principal.app_persona.value,
        ),
        data=SessionResponse(
        user_id=current_principal.user_id,
        email=current_principal.email,
        display_name=current_principal.display_name,
        app_persona=current_principal.app_persona,
        ui_permissions=current_principal.permissions,
        ),
    )


@auth_router.get("/permissions", response_model=ApiResponseEnvelope[PermissionSet])
def get_permissions(
    request: Request,
    current_principal: CurrentPrincipal = Depends(get_current_principal),
):
    return build_response_envelope(
        operation="auth.permissions",
        request=request,
        actor=ApiActor(
            user_id=str(current_principal.user_id),
            role=current_principal.app_persona.value,
        ),
        data=current_principal.permissions,
    )


@auth_router.get("/snowflake-context", response_model=ApiResponseEnvelope[SnowflakeContextResponse])
def get_snowflake_context(
    request: Request,
    current_principal: CurrentPrincipal = Depends(get_current_principal),
    settings: Settings = Depends(get_settings),
) -> ApiResponseEnvelope[SnowflakeContextResponse]:
    with get_user_connection(current_principal.snowflake_user_token, settings) as connection:
        cursor = connection.cursor(DictCursor)
        cursor.execute(
            """
            SELECT
                CURRENT_USER() AS CURRENT_USER,
                CURRENT_ROLE() AS CURRENT_ROLE,
                CURRENT_WAREHOUSE() AS CURRENT_WAREHOUSE,
                CURRENT_DATABASE() AS CURRENT_DATABASE,
                CURRENT_SCHEMA() AS CURRENT_SCHEMA
            """
        )
        row = cursor.fetchone()
        cursor.close()

    data = SnowflakeContextResponse(
        current_user=str(row["CURRENT_USER"]),
        current_role=str(row["CURRENT_ROLE"]) if row.get("CURRENT_ROLE") else None,
        current_warehouse=(
            str(row["CURRENT_WAREHOUSE"]) if row.get("CURRENT_WAREHOUSE") else None
        ),
        current_database=(
            str(row["CURRENT_DATABASE"]) if row.get("CURRENT_DATABASE") else None
        ),
        current_schema=str(row["CURRENT_SCHEMA"]) if row.get("CURRENT_SCHEMA") else None,
    )
    return build_response_envelope(
        operation="auth.snowflake_context",
        request=request,
        actor=ApiActor(
            user_id=str(current_principal.user_id),
            role=current_principal.app_persona.value,
        ),
        context={
            "current_role": data.current_role,
            "current_database": data.current_database,
            "current_schema": data.current_schema,
        },
        data=data,
    )


@admin_router.get("/users", response_model=ApiResponseEnvelope[list[UserSummary]])
def list_users(
    request: Request,
    current_principal: CurrentPrincipal = Depends(require_persona(AppPersona.ADMIN)),
    settings: Settings = Depends(get_settings),
) -> ApiResponseEnvelope[list[UserSummary]]:
    with get_user_connection(current_principal.snowflake_user_token, settings) as connection:
        cursor = connection.cursor(DictCursor)
        cursor.execute(
            f"""
            SELECT
                USER_ID,
                OKTA_SUB,
                EMAIL,
                DISPLAY_NAME,
                ROLE,
                IS_ACTIVE,
                CREATED_DATETIME,
                LAST_SEEN_DATETIME,
                LAST_MODIFIED_DATETIME
            FROM {settings.qualified_users_table}
            ORDER BY USER_ID
            """
        )
        rows = cursor.fetchall()
        cursor.close()

    users = [
        UserSummary(
            user_id=int(row["USER_ID"]),
            snowflake_user=str(row["OKTA_SUB"]),
            email=str(row["EMAIL"]),
            display_name=str(row["DISPLAY_NAME"]) if row.get("DISPLAY_NAME") else None,
            app_persona=AppPersona(str(row["ROLE"]).upper()),
            is_active=bool(row["IS_ACTIVE"]),
            created_at=row.get("CREATED_DATETIME"),
            last_seen_at=row.get("LAST_SEEN_DATETIME"),
            last_modified_at=row.get("LAST_MODIFIED_DATETIME"),
        )
        for row in rows
    ]
    return build_response_envelope(
        operation="admin.list_users",
        request=request,
        actor=ApiActor(
            user_id=str(current_principal.user_id),
            role=current_principal.app_persona.value,
        ),
        data=users,
    )


@admin_router.post("/users/{user_id}/deactivate", response_model=ApiResponseEnvelope[UserSummary])
def deactivate_user(
    request: Request,
    user_id: int,
    current_principal: CurrentPrincipal = Depends(require_persona(AppPersona.ADMIN)),
    settings: Settings = Depends(get_settings),
) -> ApiResponseEnvelope[UserSummary]:
    with get_user_connection(current_principal.snowflake_user_token, settings) as connection:
        cursor = connection.cursor(DictCursor)
        cursor.execute(
            f"""
            UPDATE {settings.qualified_users_table}
            SET
                IS_ACTIVE = FALSE,
                LAST_MODIFIED_DATETIME = CURRENT_TIMESTAMP()
            WHERE USER_ID = %s
            """,
            (user_id,),
        )
        if cursor.rowcount == 0:
            cursor.close()
            raise HTTPException(status_code=404, detail="User not found")

        cursor.execute(
            f"""
            SELECT
                USER_ID,
                OKTA_SUB,
                EMAIL,
                DISPLAY_NAME,
                ROLE,
                IS_ACTIVE,
                CREATED_DATETIME,
                LAST_SEEN_DATETIME,
                LAST_MODIFIED_DATETIME
            FROM {settings.qualified_users_table}
            WHERE USER_ID = %s
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        connection.commit()
        cursor.close()

    return build_response_envelope(
        operation="admin.deactivate_user",
        request=request,
        actor=ApiActor(
            user_id=str(current_principal.user_id),
            role=current_principal.app_persona.value,
        ),
        data=UserSummary(
            user_id=int(row["USER_ID"]),
            snowflake_user=str(row["OKTA_SUB"]),
            email=str(row["EMAIL"]),
            display_name=str(row["DISPLAY_NAME"]) if row.get("DISPLAY_NAME") else None,
            app_persona=AppPersona(str(row["ROLE"]).upper()),
            is_active=bool(row["IS_ACTIVE"]),
            created_at=row.get("CREATED_DATETIME"),
            last_seen_at=row.get("LAST_SEEN_DATETIME"),
            last_modified_at=row.get("LAST_MODIFIED_DATETIME"),
        ),
    )
