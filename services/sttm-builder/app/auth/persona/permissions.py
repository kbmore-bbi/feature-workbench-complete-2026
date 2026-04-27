from __future__ import annotations

from app.auth.models import AppPersona, PermissionSet


PERSONA_PERMISSIONS: dict[AppPersona, PermissionSet] = {
    AppPersona.VIEWER: PermissionSet(can_read=True),
    AppPersona.PUBLISHER: PermissionSet(
        can_read=True,
        can_edit=True,
        can_publish=True,
    ),
    AppPersona.ADMIN: PermissionSet(
        can_read=True,
        can_edit=True,
        can_publish=True,
        can_manage_users=True,
        can_view_audit=True,
    ),
}


def get_permissions(persona: AppPersona) -> PermissionSet:
    return PERSONA_PERMISSIONS[persona]
