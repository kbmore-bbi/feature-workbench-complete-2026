export type PermissionSet = {
  can_read: boolean;
  can_edit: boolean;
  can_publish: boolean;
  can_manage_users: boolean;
  can_view_audit: boolean;
};

export type UserSession = {
  user_id: number;
  email: string;
  display_name: string | null;
  app_persona: 'VIEWER' | 'PUBLISHER' | 'ADMIN';
  ui_permissions: PermissionSet;
};
