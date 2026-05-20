import type { PermissionSet, UserSession } from "@/types/user";
import type { SnowflakeContext, UserRolesResponse } from "@/services/authService";

export const mockUserSession: UserSession = {
  user_id: 7,
  email: "publisher@example.com",
  display_name: "Shane Watson",
  app_persona: "PUBLISHER",
  ui_permissions: {
    can_read: true,
    can_edit: true,
    can_publish: true,
    can_manage_users: false,
    can_view_audit: false,
  },
};

export const mockPermissions: PermissionSet = {
  can_read: true,
  can_edit: true,
  can_publish: true,
  can_manage_users: false,
  can_view_audit: false,
};

export const mockSnowflakeContext: SnowflakeContext = {
  current_user: "PUBLISHER@EXAMPLE.COM",
  current_role: "WORKBENCH_PUBLISHER",
  current_warehouse: "WORKBENCH_WH",
  current_database: "AI_WORKBENCH_DEV",
  current_schema: "APP_RUNTIME",
};

export const mockUserRoles: UserRolesResponse = {
  app_roles: ["PUBLISHER"],
  active_app_role: "PUBLISHER",
  data_roles: ["SALES_ANALYST", "FINANCE_ANALYST"],
};
