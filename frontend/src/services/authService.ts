import { getApiData } from '@/api/axiosInstance';
import { API_ROUTES } from '@/api/routes';
import type { PermissionSet, UserSession } from '@/types/user';
import {
  mockPermissions,
  mockSnowflakeContext,
  mockUserRoles,
  mockUserSession,
} from '@/data/mock/auth';
import { mockDelay, throwMockError, useMockDb } from './mock/mockConfig';

// v3 was sessionStorage (cleared on tab close); v4 is localStorage (persists across sessions).
const STTM_BUILDER_SESSION_STORAGE_KEY_LEGACY = "sttm-builder-session-v3";
const STTM_BUILDER_SESSION_STORAGE_KEY = "sttm-builder-session-v4";
const AUTH_SESSION_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedUserSession: { value: UserSession; expiresAt: number } | null = null;
let pendingUserSession: Promise<UserSession> | null = null;

export function clearBrowserWorkbenchSession() {
  cachedUserSession = null;
  pendingUserSession = null;
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(STTM_BUILDER_SESSION_STORAGE_KEY);
    // Also clear the legacy sessionStorage key if it still exists.
    window.sessionStorage.removeItem(STTM_BUILDER_SESSION_STORAGE_KEY_LEGACY);
    window.sessionStorage.removeItem("sttm.activeSemanticContext");
  } catch {
    // Ignore browser storage cleanup failures.
  }
}

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
    if (cachedUserSession && cachedUserSession.expiresAt > Date.now()) {
      return cachedUserSession.value;
    }
    if (pendingUserSession) return pendingUserSession;
    pendingUserSession = getApiData<UserSession>(API_ROUTES.auth.session, {
      skipGlobalError: true,
    })
      .then((value) => {
        cachedUserSession = {
          value,
          expiresAt: Date.now() + AUTH_SESSION_CACHE_TTL_MS,
        };
        return value;
      })
      .finally(() => {
        pendingUserSession = null;
      });
    return pendingUserSession;
  },

  getPermissions: async (): Promise<PermissionSet> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockPermissions);
    }
    return getApiData<PermissionSet>(API_ROUTES.auth.permissions);
  },

  getSnowflakeContext: async (): Promise<SnowflakeContext> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockSnowflakeContext);
    }
    return getApiData<SnowflakeContext>(API_ROUTES.auth.snowflakeContext);
  },

  getUserRoles: async (): Promise<UserRolesResponse> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockUserRoles);
    }
    return getApiData<UserRolesResponse>(API_ROUTES.user.roles);
  },

  getLoginUrl: (next = "/dashboard"): string => {
    const encodedNext = encodeURIComponent(next);
    return `/api${API_ROUTES.auth.login}?next=${encodedNext}`;
  },

  logout: (): void => {
    clearBrowserWorkbenchSession();
    window.location.href = `/api${API_ROUTES.auth.logout}`;
  },
};
