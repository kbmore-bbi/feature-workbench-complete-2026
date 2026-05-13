from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request

from app.core.config import Settings


def extract_snowflake_context(request: Request, settings: Settings) -> dict[str, Any]:
    snowflake_user = request.headers.get("Sf-Context-Current-User")
    snowflake_email = request.headers.get("Sf-Context-Current-User-Email")
    snowflake_user_token = request.headers.get("Sf-Context-Current-User-Token")

    if not snowflake_user or not snowflake_user_token:
        if settings.local_dev_auth_enabled:
            if not settings.snowflake_user:
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Local development auth is enabled, but SNOWFLAKE_USER is "
                        "not configured"
                    ),
                )

            if (
                not settings.local_dev_uses_externalbrowser
                and not settings.snowflake_password
            ):
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Local development auth is enabled, but SNOWFLAKE_PASSWORD is "
                        "not configured"
                    ),
                )

            return {
                "snowflake_user": settings.snowflake_user,
                "email": settings.local_dev_effective_email,
                "snowflake_user_token": "",
            }

        raise HTTPException(status_code=401, detail="Missing Snowflake authentication context")

    return {
        "snowflake_user": snowflake_user,
        "email": snowflake_email or snowflake_user,
        "snowflake_user_token": snowflake_user_token,
    }
