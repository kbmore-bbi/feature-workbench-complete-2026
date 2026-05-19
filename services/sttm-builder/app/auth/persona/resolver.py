from __future__ import annotations

import zlib
from typing import Any

from fastapi import HTTPException
from snowflake.connector import DictCursor

from app.auth.models import AppPersona, CurrentPrincipal
from app.auth.persona.permissions import get_permissions
from app.config import Settings
from app.core.snowflake import get_service_connection, get_user_connection


def resolve_persona(row: dict[str, Any]) -> AppPersona:
    if bool(row["IS_ADMIN"]):
        return AppPersona.ADMIN
    if bool(row["IS_PUBLISHER"]):
        return AppPersona.PUBLISHER
    if bool(row["IS_VIEWER"]):
        return AppPersona.VIEWER
    raise HTTPException(status_code=403, detail="User is not assigned to an app persona")


def _local_dev_principal(
    *,
    snowflake_user: str,
    email: str,
    persona: AppPersona,
) -> CurrentPrincipal:
    return CurrentPrincipal(
        user_id=zlib.crc32(snowflake_user.encode("utf-8")),
        snowflake_user=snowflake_user,
        email=email,
        display_name=snowflake_user,
        app_persona=persona,
        permissions=get_permissions(persona),
        snowflake_user_token="",
    )


def _local_dev_persona_from_settings(settings: Settings) -> AppPersona:
    active_role = (settings.snowflake_role or "").strip().upper()

    if active_role == (settings.app_role_admin or "").strip().upper():
        return AppPersona.ADMIN
    if active_role == (settings.app_role_publisher or "").strip().upper():
        return AppPersona.PUBLISHER
    if active_role == (settings.app_role_viewer or "").strip().upper():
        return AppPersona.VIEWER

    raise HTTPException(
        status_code=403,
        detail=(
            "LOCAL_DEV_BYPASS_METADATA is enabled, but SNOWFLAKE_ROLE does not match "
            "APP_ROLE_ADMIN / APP_ROLE_PUBLISHER / APP_ROLE_VIEWER."
        ),
    )


def resolve_and_upsert(context: dict[str, Any], settings: Settings) -> CurrentPrincipal:
    is_local_dev = settings.local_dev_auth_enabled and not context["snowflake_user_token"]

    if is_local_dev and settings.local_dev_bypass_metadata:
        snowflake_user = settings.snowflake_user or context["email"] or "local-user"
        email = context["email"] or settings.local_dev_user_email or snowflake_user
        persona = _local_dev_persona_from_settings(settings)

        return _local_dev_principal(
            snowflake_user=snowflake_user,
            email=email,
            persona=persona,
        )

    with get_user_connection(context["snowflake_user_token"], settings) as connection:
        cursor = connection.cursor(DictCursor)
        cursor.execute(
            """
            SELECT
                CURRENT_USER() AS CURRENT_USER,
                CURRENT_ROLE() AS CURRENT_ROLE,
                IS_ROLE_IN_SESSION(%s) AS IS_ADMIN,
                IS_ROLE_IN_SESSION(%s) AS IS_PUBLISHER,
                IS_ROLE_IN_SESSION(%s) AS IS_VIEWER
            """,
            (
                settings.app_role_admin,
                settings.app_role_publisher,
                settings.app_role_viewer,
            ),
        )
        role_row = cursor.fetchone()
        if not role_row:
            cursor.close()
            raise HTTPException(status_code=500, detail="Failed to resolve Snowflake role context")

        persona = resolve_persona(role_row)
        snowflake_user = str(role_row["CURRENT_USER"])
        email = context["email"] or snowflake_user
        display_name = snowflake_user
        cursor.close()

    # App metadata is owned by the service. Caller-rights still determines the
    # persona above, but users should not need direct write grants on TBL_USERS.
    with get_service_connection(settings) as connection:
        cursor = connection.cursor(DictCursor)
        cursor.execute(
            f"""
            SELECT USER_ID, ROLE, IS_ACTIVE
            FROM {settings.qualified_users_table}
            WHERE UPPER(OKTA_SUB) = UPPER(%s)
            """,
            (snowflake_user,),
        )
        existing = cursor.fetchone()

        if existing and not bool(existing["IS_ACTIVE"]):
            cursor.close()
            raise HTTPException(status_code=403, detail="User account is deactivated")

        cursor.execute(
            f"""
            MERGE INTO {settings.qualified_users_table} AS t
            USING (
                SELECT
                    %s AS OKTA_SUB,
                    %s AS EMAIL,
                    %s AS DISPLAY_NAME,
                    %s AS ROLE,
                    CURRENT_TIMESTAMP() AS LAST_SEEN_DATETIME
            ) AS s
            ON UPPER(t.OKTA_SUB) = UPPER(s.OKTA_SUB)
            WHEN MATCHED THEN UPDATE SET
                EMAIL = s.EMAIL,
                DISPLAY_NAME = s.DISPLAY_NAME,
                ROLE = s.ROLE,
                LAST_SEEN_DATETIME = s.LAST_SEEN_DATETIME,
                LAST_MODIFIED_DATETIME = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT
                (OKTA_SUB, EMAIL, DISPLAY_NAME, ROLE, LAST_SEEN_DATETIME)
            VALUES
                (s.OKTA_SUB, s.EMAIL, s.DISPLAY_NAME, s.ROLE, s.LAST_SEEN_DATETIME)
            """,
            (
                snowflake_user,
                email,
                display_name,
                persona.value,
            ),
        )

        cursor.execute(
            f"""
            SELECT
                USER_ID,
                OKTA_SUB,
                EMAIL,
                DISPLAY_NAME,
                ROLE,
                IS_ACTIVE
            FROM {settings.qualified_users_table}
            WHERE UPPER(OKTA_SUB) = UPPER(%s)
            """,
            (snowflake_user,),
        )
        row = cursor.fetchone()
        if not row:
            cursor.close()
            raise HTTPException(status_code=500, detail="Failed to provision authenticated user")

        connection.commit()
        cursor.close()

    return CurrentPrincipal(
        user_id=int(row["USER_ID"]),
        snowflake_user=str(row["OKTA_SUB"]),
        email=str(row["EMAIL"]),
        display_name=str(row["DISPLAY_NAME"]) if row.get("DISPLAY_NAME") else None,
        app_persona=AppPersona(str(row["ROLE"]).upper()),
        permissions=get_permissions(persona),
        snowflake_user_token=context["snowflake_user_token"],
    )
