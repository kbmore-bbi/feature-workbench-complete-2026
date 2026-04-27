import api from '../api/axiosInstance';

export const dbService = {
  getExplorerData: async () => {
    const response = await api.get('/v1/table-selection/databases');
    return response.data;
  },

  getSchemaTables: async (database: string, schema: string) => {
    const response = await api.get('/v1/table-selection/tables', {
      params: { database, schema },
    });
    return response.data;
  },

  getTableAttributes: async (tables: string[]) => {
    const response = await api.get('/v1/table-selection/attributes', {
      params: { tables },
      paramsSerializer: {
        indexes: null,
      },
    });
    return response.data;
  },
};
