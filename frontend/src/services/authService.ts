import api from '../api/axiosInstance';

export const authService = {
  getSession: async () => {
    const response = await api.get('/v1/auth/session');
    return response.data;
  },

  getPermissions: async () => {
    const response = await api.get('/v1/auth/permissions');
    return response.data;
  },

  getSnowflakeContext: async () => {
    const response = await api.get('/v1/auth/snowflake-context');
    return response.data;
  },

  getUserRoles: async () => {
    const response = await api.get('/v1/user/roles');
    return response.data;
  },
};
