from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from snowflake.connector import DictCursor

from app.auth.custom_oauth import (
    build_login_redirect,
    build_logout_redirect,
    complete_oauth_callback,
)
from app.auth.dependencies import clear_principal_cache, get_current_principal, require_persona
from app.auth.models import (
    AppPersona,
    CurrentPrincipal,
    PermissionSet,
    SessionResponse,
    SnowflakeContextResponse,
    UserSummary,
)
from app.auth.persona.resolver import (
    _coerce_principal_user_id,
    _first_present,
    _users_table_metadata,
)
from app.config import Settings, get_settings
from app.core.snowflake import get_user_connection
from app.schema.contracts import ApiActor, ApiResponseEnvelope, build_response_envelope


auth_router = APIRouter()
admin_router = APIRouter()


def _build_user_summary_select(metadata: dict[str, str]) -> tuple[str, str]:
    user_id_col = _first_present(metadata, "USER_ID")
    identity_col = _first_present(
        metadata,
        "OKTA_SUB",
        "SNOWFLAKE_USER",
        "USERNAME",
        "USER_NAME",
        "USER_ID",
    )
    email_col = _first_present(metadata, "EMAIL")
    display_name_col = _first_present(metadata, "DISPLAY_NAME")
    role_col = _first_present(metadata, "ROLE")
    active_col = _first_present(metadata, "IS_ACTIVE")
    created_col = _first_present(metadata, "CREATED_DATETIME", "CREATED_AT")
    last_seen_col = _first_present(metadata, "LAST_SEEN_DATETIME", "LAST_ACCESSED_AT")
    last_modified_col = _first_present(metadata, "LAST_MODIFIED_DATETIME", "UPDATED_AT")

    if not role_col:
        raise HTTPException(status_code=500, detail="Users table must contain a ROLE column")

    select_parts = [f'"{role_col}" AS ROLE']
    if user_id_col:
        select_parts.append(f'"{user_id_col}" AS USER_ID')
    if identity_col:
        select_parts.append(f'"{identity_col}" AS IDENTITY_VALUE')
    if email_col:
        select_parts.append(f'"{email_col}" AS EMAIL')
    if display_name_col:
        select_parts.append(f'"{display_name_col}" AS DISPLAY_NAME')
    if active_col:
        select_parts.append(f'"{active_col}" AS IS_ACTIVE')
    if created_col:
        select_parts.append(f'"{created_col}" AS CREATED_AT')
    if last_seen_col:
        select_parts.append(f'"{last_seen_col}" AS LAST_SEEN_AT')
    if last_modified_col:
        select_parts.append(f'"{last_modified_col}" AS LAST_MODIFIED_AT')
    return ", ".join(select_parts), user_id_col or ""


def _row_to_user_summary(row: dict[str, Any]) -> UserSummary:
    snowflake_user = str(
        row.get("IDENTITY_VALUE")
        or row.get("EMAIL")
        or row.get("DISPLAY_NAME")
        or row.get("USER_ID")
        or ""
    )
    return UserSummary(
        user_id=_coerce_principal_user_id(row.get("USER_ID"), snowflake_user),
        snowflake_user=snowflake_user,
        email=str(row.get("EMAIL") or snowflake_user),
        display_name=str(row["DISPLAY_NAME"]) if row.get("DISPLAY_NAME") else None,
        app_persona=AppPersona(str(row["ROLE"]).upper()),
        is_active=bool(row.get("IS_ACTIVE", True)),
        created_at=row.get("CREATED_AT"),
        last_seen_at=row.get("LAST_SEEN_AT"),
        last_modified_at=row.get("LAST_MODIFIED_AT"),
    )


@auth_router.get("/login")
def oauth_login(
    request: Request,
    settings: Settings = Depends(get_settings),
):
    if not settings.uses_custom_oauth:
        raise HTTPException(status_code=404, detail="OAuth login is disabled")
    return build_login_redirect(request, settings)


@auth_router.get("/callback")
def oauth_callback(
    request: Request,
    settings: Settings = Depends(get_settings),
):
    if not settings.uses_custom_oauth:
        raise HTTPException(status_code=404, detail="OAuth callback is disabled")
    return complete_oauth_callback(request, settings)


@auth_router.get("/logout")
def oauth_logout(
    request: Request,
    settings: Settings = Depends(get_settings),
):
    if not settings.uses_custom_oauth:
        raise HTTPException(status_code=404, detail="OAuth logout is disabled")
    return build_logout_redirect(request, settings)


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
        metadata = _users_table_metadata(connection, settings)
        select_sql, user_id_col = _build_user_summary_select(metadata)
        cursor = connection.cursor(DictCursor)
        cursor.execute(
            f"""
            SELECT
                {select_sql}
            FROM {settings.qualified_users_table}
            ORDER BY {"USER_ID" if user_id_col else "ROLE"}
            """
        )
        rows = cursor.fetchall()
        cursor.close()

    users = [_row_to_user_summary(row) for row in rows]
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
        metadata = _users_table_metadata(connection, settings)
        user_id_col = _first_present(metadata, "USER_ID")
        last_modified_col = _first_present(metadata, "LAST_MODIFIED_DATETIME", "UPDATED_AT")
        active_col = _first_present(metadata, "IS_ACTIVE")
        select_sql, _ = _build_user_summary_select(metadata)

        if not user_id_col:
            raise HTTPException(status_code=500, detail="Users table must contain USER_ID")
        if not active_col:
            raise HTTPException(status_code=500, detail="Users table must contain IS_ACTIVE")

        assignments = [f'"{active_col}" = FALSE']
        if last_modified_col:
            assignments.append(f'"{last_modified_col}" = CURRENT_TIMESTAMP()')

        cursor = connection.cursor(DictCursor)
        cursor.execute(
            f"""
            UPDATE {settings.qualified_users_table}
            SET
                {", ".join(assignments)}
            WHERE "{user_id_col}" = %s
            """,
            (user_id,),
        )
        if cursor.rowcount == 0:
            cursor.close()
            raise HTTPException(status_code=404, detail="User not found")

        cursor.execute(
            f"""
            SELECT
                {select_sql}
            FROM {settings.qualified_users_table}
            WHERE "{user_id_col}" = %s
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        connection.commit()
        cursor.close()

    clear_principal_cache()

    return build_response_envelope(
        operation="admin.deactivate_user",
        request=request,
        actor=ApiActor(
            user_id=str(current_principal.user_id),
            role=current_principal.app_persona.value,
        ),
        data=_row_to_user_summary(row),
    )
