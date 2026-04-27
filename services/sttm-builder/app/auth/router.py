from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from snowflake.connector import DictCursor

from app.auth.dependencies import get_current_principal, require_persona
from app.auth.models import (
    AppPersona,
    CurrentPrincipal,
    SessionResponse,
    SnowflakeContextResponse,
    UserSummary,
)
from app.config import Settings, get_settings
from app.core.snowflake import get_user_connection


auth_router = APIRouter()
admin_router = APIRouter()


@auth_router.get("/session", response_model=SessionResponse)
def get_session(
    current_principal: CurrentPrincipal = Depends(get_current_principal),
) -> SessionResponse:
    return SessionResponse(
        user_id=current_principal.user_id,
        email=current_principal.email,
        display_name=current_principal.display_name,
        app_persona=current_principal.app_persona,
        ui_permissions=current_principal.permissions,
    )


@auth_router.get("/permissions")
def get_permissions(
    current_principal: CurrentPrincipal = Depends(get_current_principal),
):
    return current_principal.permissions


@auth_router.get("/snowflake-context", response_model=SnowflakeContextResponse)
def get_snowflake_context(
    current_principal: CurrentPrincipal = Depends(get_current_principal),
    settings: Settings = Depends(get_settings),
) -> SnowflakeContextResponse:
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

    return SnowflakeContextResponse(
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


@admin_router.get("/users", response_model=list[UserSummary])
def list_users(
    current_principal: CurrentPrincipal = Depends(require_persona(AppPersona.ADMIN)),
    settings: Settings = Depends(get_settings),
) -> list[UserSummary]:
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

    return [
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


@admin_router.post("/users/{user_id}/deactivate", response_model=UserSummary)
def deactivate_user(
    user_id: int,
    current_principal: CurrentPrincipal = Depends(require_persona(AppPersona.ADMIN)),
    settings: Settings = Depends(get_settings),
) -> UserSummary:
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

    return UserSummary(
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
