import { getApiData } from '@/api/axiosInstance';
import type { PermissionSet, UserSession } from '@/types/user';
import {
  mockPermissions,
  mockSnowflakeContext,
  mockUserRoles,
  mockUserSession,
} from './mock/authMockData';
import { mockDelay, throwMockError, useMockDb } from './mock/mockConfig';

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
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockUserSession);
    }
    return getApiData<UserSession>('/v1/auth/session');
  },

  getPermissions: async (): Promise<PermissionSet> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockPermissions);
    }
    return getApiData<PermissionSet>('/v1/auth/permissions');
  },

  getSnowflakeContext: async (): Promise<SnowflakeContext> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockSnowflakeContext);
    }
    return getApiData<SnowflakeContext>('/v1/auth/snowflake-context');
  },

  getUserRoles: async (): Promise<UserRolesResponse> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockUserRoles);
    }
    return getApiData<UserRolesResponse>('/v1/user/roles');
  },
};
