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
    snowflake_role: str | None,
) -> CurrentPrincipal:
    return CurrentPrincipal(
        user_id=zlib.crc32(snowflake_user.encode("utf-8")),
        snowflake_user=snowflake_user,
        email=email,
        display_name=snowflake_user,
        app_persona=persona,
        permissions=get_permissions(persona),
        snowflake_user_token="",
        snowflake_role=snowflake_role,
        auth_source="local_dev",
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


def _users_table_metadata(connection, settings: Settings) -> dict[str, str]:
    cursor = connection.cursor(DictCursor)
    try:
        cursor.execute(f"DESC TABLE {settings.qualified_users_table}")
        rows = cursor.fetchall()
    finally:
        cursor.close()
    metadata: dict[str, str] = {}
    for row in rows:
        name = str((row.get("name") or row.get("NAME") or "")).strip().upper()
        if not name:
            continue
        metadata[name] = str((row.get("type") or row.get("TYPE") or "")).strip().upper()
    return metadata


def _first_present(metadata: dict[str, str], *candidates: str) -> str | None:
    for candidate in candidates:
        key = candidate.upper()
        if key in metadata:
            return key
    return None


def _numeric_user_id_column(column_type: str | None) -> bool:
    normalized = (column_type or "").upper()
    return any(token in normalized for token in ("NUMBER", "INT", "DECIMAL"))


def _generated_user_id(snowflake_user: str, metadata: dict[str, str], user_id_col: str | None) -> int | str:
    if user_id_col and _numeric_user_id_column(metadata.get(user_id_col)):
        return zlib.crc32(snowflake_user.encode("utf-8"))
    return snowflake_user


def _coerce_principal_user_id(value: Any, snowflake_user: str) -> int:
    if value is None:
        return zlib.crc32(snowflake_user.encode("utf-8"))
    try:
        return int(value)
    except (TypeError, ValueError):
        return zlib.crc32(snowflake_user.encode("utf-8"))


def _principal_auth_source(settings: Settings, context: dict[str, Any]) -> str:
    if not context.get("snowflake_user_token"):
        return "local_dev"
    return "custom_oauth" if settings.uses_custom_oauth else "ingress_headers"


def _select_user_row(
    connection,
    settings: Settings,
    metadata: dict[str, str],
    *,
    snowflake_user: str,
    email: str | None,
) -> dict[str, Any] | None:
    identity_col = _first_present(
        metadata,
        "OKTA_SUB",
        "SNOWFLAKE_USER",
        "USERNAME",
        "USER_NAME",
        "USER_ID",
    )
    email_col = _first_present(metadata, "EMAIL")
    role_col = _first_present(metadata, "ROLE")
    user_id_col = _first_present(metadata, "USER_ID")
    display_name_col = _first_present(metadata, "DISPLAY_NAME")
    active_col = _first_present(metadata, "IS_ACTIVE")
    created_col = _first_present(metadata, "CREATED_DATETIME", "CREATED_AT")
    last_seen_col = _first_present(metadata, "LAST_SEEN_DATETIME", "LAST_ACCESSED_AT")
    last_modified_col = _first_present(metadata, "LAST_MODIFIED_DATETIME", "UPDATED_AT")

    if not role_col:
        raise HTTPException(
            status_code=500,
            detail=f"{settings.qualified_users_table} must contain a ROLE column",
        )

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

    where_clauses: list[str] = []
    params: list[str] = []
    if identity_col and snowflake_user:
        where_clauses.append(f'UPPER("{identity_col}") = UPPER(%s)')
        params.append(snowflake_user)
    if email_col and email:
        where_clauses.append(f'UPPER("{email_col}") = UPPER(%s)')
        params.append(email)

    if not where_clauses:
        raise HTTPException(
            status_code=500,
            detail=(
                f"{settings.qualified_users_table} must contain either an identity column "
                "(OKTA_SUB/SNOWFLAKE_USER/USERNAME/USER_NAME/USER_ID) or EMAIL."
            ),
        )

    cursor = connection.cursor(DictCursor)
    try:
        cursor.execute(
            f"""
            SELECT {", ".join(select_parts)}
            FROM {settings.qualified_users_table}
            WHERE {" OR ".join(where_clauses)}
            QUALIFY ROW_NUMBER() OVER (ORDER BY 1) = 1
            """,
            tuple(params),
        )
        return cursor.fetchone()
    finally:
        cursor.close()


def _update_existing_user(
    connection,
    settings: Settings,
    metadata: dict[str, str],
    *,
    existing_row: dict[str, Any],
    snowflake_user: str,
    email: str,
    display_name: str,
    persona: AppPersona,
) -> None:
    identity_col = _first_present(
        metadata,
        "OKTA_SUB",
        "SNOWFLAKE_USER",
        "USERNAME",
        "USER_NAME",
        "USER_ID",
    )
    user_id_col = _first_present(metadata, "USER_ID")
    email_col = _first_present(metadata, "EMAIL")
    display_name_col = _first_present(metadata, "DISPLAY_NAME")
    role_col = _first_present(metadata, "ROLE")
    active_col = _first_present(metadata, "IS_ACTIVE")
    last_seen_col = _first_present(metadata, "LAST_SEEN_DATETIME", "LAST_ACCESSED_AT")
    last_modified_col = _first_present(metadata, "LAST_MODIFIED_DATETIME", "UPDATED_AT")

    assignments: list[str] = []
    params: list[Any] = []
    if identity_col and identity_col != user_id_col:
        assignments.append(f'"{identity_col}" = %s')
        params.append(snowflake_user)
    if email_col:
        assignments.append(f'"{email_col}" = %s')
        params.append(email)
    if display_name_col:
        assignments.append(f'"{display_name_col}" = %s')
        params.append(display_name)
    if role_col:
        assignments.append(f'"{role_col}" = %s')
        params.append(persona.value)
    if active_col:
        assignments.append(f'"{active_col}" = TRUE')
    if last_seen_col:
        assignments.append(f'"{last_seen_col}" = CURRENT_TIMESTAMP()')
    if last_modified_col:
        assignments.append(f'"{last_modified_col}" = CURRENT_TIMESTAMP()')

    if not assignments:
        return

    if user_id_col and existing_row.get("USER_ID") is not None:
        where_sql = "USER_ID = %s"
        params.append(existing_row["USER_ID"])
    elif identity_col and existing_row.get("IDENTITY_VALUE") is not None:
        where_sql = f'UPPER("{identity_col}") = UPPER(%s)'
        params.append(str(existing_row["IDENTITY_VALUE"]))
    elif email_col and existing_row.get("EMAIL") is not None:
        where_sql = f'UPPER("{email_col}") = UPPER(%s)'
        params.append(str(existing_row["EMAIL"]))
    else:
        raise HTTPException(
            status_code=500,
            detail=f"Unable to identify row in {settings.qualified_users_table} for update",
        )

    cursor = connection.cursor()
    try:
        cursor.execute(
            f"""
            UPDATE {settings.qualified_users_table}
            SET {", ".join(assignments)}
            WHERE {where_sql}
            """,
            tuple(params),
        )
    finally:
        cursor.close()


def _insert_new_user(
    connection,
    settings: Settings,
    metadata: dict[str, str],
    *,
    snowflake_user: str,
    email: str,
    display_name: str,
    persona: AppPersona,
) -> None:
    identity_col = _first_present(
        metadata,
        "OKTA_SUB",
        "SNOWFLAKE_USER",
        "USERNAME",
        "USER_NAME",
        "USER_ID",
    )
    user_id_col = _first_present(metadata, "USER_ID")
    email_col = _first_present(metadata, "EMAIL")
    display_name_col = _first_present(metadata, "DISPLAY_NAME")
    role_col = _first_present(metadata, "ROLE")
    active_col = _first_present(metadata, "IS_ACTIVE")
    last_seen_col = _first_present(metadata, "LAST_SEEN_DATETIME", "LAST_ACCESSED_AT")
    last_modified_col = _first_present(metadata, "LAST_MODIFIED_DATETIME", "UPDATED_AT")

    columns: list[str] = []
    values_sql: list[str] = []
    params: list[Any] = []

    if user_id_col:
        columns.append(f'"{user_id_col}"')
        if user_id_col == identity_col:
            params.append(snowflake_user)
        else:
            params.append(_generated_user_id(snowflake_user, metadata, user_id_col))
        values_sql.append("%s")
    if identity_col and identity_col != user_id_col:
        columns.append(f'"{identity_col}"')
        params.append(snowflake_user)
        values_sql.append("%s")
    if email_col:
        columns.append(f'"{email_col}"')
        params.append(email)
        values_sql.append("%s")
    if display_name_col:
        columns.append(f'"{display_name_col}"')
        params.append(display_name)
        values_sql.append("%s")
    if role_col:
        columns.append(f'"{role_col}"')
        params.append(persona.value)
        values_sql.append("%s")
    if active_col:
        columns.append(f'"{active_col}"')
        values_sql.append("TRUE")
    if last_seen_col:
        columns.append(f'"{last_seen_col}"')
        values_sql.append("CURRENT_TIMESTAMP()")
    if last_modified_col:
        columns.append(f'"{last_modified_col}"')
        values_sql.append("CURRENT_TIMESTAMP()")

    cursor = connection.cursor()
    try:
        cursor.execute(
            f"""
            INSERT INTO {settings.qualified_users_table}
            ({", ".join(columns)})
            VALUES ({", ".join(values_sql)})
            """,
            tuple(params),
        )
    finally:
        cursor.close()


def _upsert_metadata_principal(
    *,
    settings: Settings,
    context: dict[str, Any],
    persona: AppPersona,
    snowflake_user: str,
    email: str,
    display_name: str,
    snowflake_role: str | None,
) -> CurrentPrincipal:
    with get_service_connection(settings) as connection:
        metadata = _users_table_metadata(connection, settings)
        active_col = _first_present(metadata, "IS_ACTIVE")
        existing = _select_user_row(
            connection,
            settings,
            metadata,
            snowflake_user=snowflake_user,
            email=email,
        )

        if existing and active_col and existing.get("IS_ACTIVE") is not None and not bool(existing["IS_ACTIVE"]):
            raise HTTPException(status_code=403, detail="User account is deactivated")

        if existing:
            _update_existing_user(
                connection,
                settings,
                metadata,
                existing_row=existing,
                snowflake_user=snowflake_user,
                email=email,
                display_name=display_name,
                persona=persona,
            )
        else:
            _insert_new_user(
                connection,
                settings,
                metadata,
                snowflake_user=snowflake_user,
                email=email,
                display_name=display_name,
                persona=persona,
            )

        connection.commit()
        row = _select_user_row(
            connection,
            settings,
            metadata,
            snowflake_user=snowflake_user,
            email=email,
        )

    if not row:
        raise HTTPException(status_code=500, detail="Failed to provision authenticated user")

    try:
        resolved_persona = AppPersona(str(row["ROLE"]).upper())
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Invalid ROLE value in {settings.qualified_users_table}: {row.get('ROLE')}",
        ) from exc

    resolved_email = str(row["EMAIL"]) if row.get("EMAIL") else email
    resolved_display_name = str(row["DISPLAY_NAME"]) if row.get("DISPLAY_NAME") else display_name

    return CurrentPrincipal(
        user_id=_coerce_principal_user_id(row.get("USER_ID"), snowflake_user),
        snowflake_user=snowflake_user,
        email=resolved_email,
        display_name=resolved_display_name,
        app_persona=resolved_persona,
        permissions=get_permissions(resolved_persona),
        snowflake_user_token=str(context.get("snowflake_user_token") or ""),
        snowflake_role=snowflake_role,
        oauth_session_id=str(context["oauth_session_id"]) if context.get("oauth_session_id") else None,
        auth_source=_principal_auth_source(settings, context),
    )


def _resolve_service_mode_principal(context: dict[str, Any], settings: Settings) -> CurrentPrincipal:
    with get_service_connection(settings) as connection:
        metadata = _users_table_metadata(connection, settings)
        row = _select_user_row(
            connection,
            settings,
            metadata,
            snowflake_user=str(context["snowflake_user"]),
            email=str(context.get("email") or context["snowflake_user"]),
        )

    if not row:
        raise HTTPException(
            status_code=403,
            detail=(
                "Authenticated user is not provisioned in the application users table "
                f"({settings.qualified_users_table})."
            ),
        )

    if row.get("IS_ACTIVE") is not None and not bool(row["IS_ACTIVE"]):
        raise HTTPException(status_code=403, detail="User account is deactivated")

    try:
        persona = AppPersona(str(row["ROLE"]).upper())
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Invalid ROLE value in {settings.qualified_users_table}: {row.get('ROLE')}",
        ) from exc

    resolved_email = (
        str(row["EMAIL"])
        if row.get("EMAIL")
        else str(context.get("email") or context["snowflake_user"])
    )
    resolved_display_name = (
        str(row["DISPLAY_NAME"])
        if row.get("DISPLAY_NAME")
        else str(context["snowflake_user"])
    )

    return CurrentPrincipal(
        user_id=_coerce_principal_user_id(row.get("USER_ID"), str(context["snowflake_user"])),
        snowflake_user=str(context["snowflake_user"]),
        email=resolved_email,
        display_name=resolved_display_name,
        app_persona=persona,
        permissions=get_permissions(persona),
        snowflake_user_token=str(context.get("snowflake_user_token") or ""),
        snowflake_role=str(context.get("snowflake_role") or "") or None,
        oauth_session_id=str(context["oauth_session_id"]) if context.get("oauth_session_id") else None,
        auth_source=_principal_auth_source(settings, context),
    )


def resolve_and_upsert(context: dict[str, Any], settings: Settings) -> CurrentPrincipal:
    is_local_dev = settings.local_dev_auth_enabled and not context.get("snowflake_user_token")

    if is_local_dev and settings.local_dev_bypass_metadata:
        snowflake_user = settings.snowflake_user or str(context.get("email") or "local-user")
        email = str(context.get("email") or settings.local_dev_effective_email or snowflake_user)
        persona = _local_dev_persona_from_settings(settings)
        return _local_dev_principal(
            snowflake_user=snowflake_user,
            email=email,
            persona=persona,
            snowflake_role=settings.snowflake_role or None,
        )

    if not settings.spcs_execute_as_caller_enabled and not settings.uses_custom_oauth:
        return _resolve_service_mode_principal(context, settings)

    with get_user_connection(str(context.get("snowflake_user_token") or ""), settings) as connection:
        cursor = connection.cursor(DictCursor)
        try:
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
        finally:
            cursor.close()

    if not role_row:
        raise HTTPException(status_code=500, detail="Failed to resolve Snowflake role context")

    persona = resolve_persona(role_row)
    snowflake_user = str(role_row["CURRENT_USER"])
    snowflake_role = str(role_row["CURRENT_ROLE"]) if role_row.get("CURRENT_ROLE") else None
    email = str(context.get("email") or snowflake_user)
    display_name = str(context.get("display_name") or snowflake_user)

    return _upsert_metadata_principal(
        settings=settings,
        context=context,
        persona=persona,
        snowflake_user=snowflake_user,
        email=email,
        display_name=display_name,
        snowflake_role=snowflake_role,
    )
