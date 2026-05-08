<<<<<<< HEAD
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
=======
export type User = {
    id: string;
    name:string;
}
>>>>>>> 9e0edb4435aae18a9a6e994b9396f0b13bfa7aa4
