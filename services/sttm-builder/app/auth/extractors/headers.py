from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request


def extract_snowflake_context(request: Request) -> dict[str, Any]:
    snowflake_user = request.headers.get("Sf-Context-Current-User")
    snowflake_email = request.headers.get("Sf-Context-Current-User-Email")
    snowflake_user_token = request.headers.get("Sf-Context-Current-User-Token")

    if not snowflake_user or not snowflake_user_token:
        raise HTTPException(status_code=401, detail="Missing Snowflake authentication context")

    return {
        "snowflake_user": snowflake_user,
        "email": snowflake_email or snowflake_user,
        "snowflake_user_token": snowflake_user_token,
    }
