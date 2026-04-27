from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class AppPersona(str, Enum):
    VIEWER = "VIEWER"
    PUBLISHER = "PUBLISHER"
    ADMIN = "ADMIN"


class PermissionSet(BaseModel):
    can_read: bool = True
    can_edit: bool = False
    can_publish: bool = False
    can_manage_users: bool = False
    can_view_audit: bool = False


class CurrentPrincipal(BaseModel):
    user_id: int
    snowflake_user: str
    email: str
    display_name: str | None
    app_persona: AppPersona
    permissions: PermissionSet
    snowflake_user_token: str


class SessionResponse(BaseModel):
    user_id: int
    email: str
    display_name: str | None
    app_persona: AppPersona
    ui_permissions: PermissionSet


class UserSummary(BaseModel):
    user_id: int
    snowflake_user: str
    email: str
    display_name: str | None
    app_persona: AppPersona
    is_active: bool
    created_at: datetime | None = None
    last_seen_at: datetime | None = None
    last_modified_at: datetime | None = None


class SnowflakeContextResponse(BaseModel):
    current_user: str
    current_role: str | None = None
    current_warehouse: str | None = None
    current_database: str | None = None
    current_schema: str | None = None
