import { getApiData } from '@/api/axiosInstance';
import type { PermissionSet, UserSession } from '@/types/user';

export type SnowflakeContext = {
  current_user: string;
  current_role?: string | null;
  current_warehouse?: string | null;
  current_database?: string | null;
  current_schema?: string | null;
};

export type UserRolesResponse = {
  app_roles: string[];
  active_app_role?: string | null;
  data_roles: string[];
};

export const authService = {
  getSession: async (): Promise<UserSession> => {
    return getApiData<UserSession>('/v1/auth/session');
  },

  getPermissions: async (): Promise<PermissionSet> => {
    return getApiData<PermissionSet>('/v1/auth/permissions');
  },

  getSnowflakeContext: async (): Promise<SnowflakeContext> => {
    return getApiData<SnowflakeContext>('/v1/auth/snowflake-context');
  },

  getUserRoles: async (): Promise<UserRolesResponse> => {
    return getApiData<UserRolesResponse>('/v1/user/roles');
  },
};
