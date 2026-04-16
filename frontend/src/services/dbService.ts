import api from '../api/axiosInstance';

export const dbService = {
  // Fetches the hierarchical DB/Schema structure for the Tree View
  getExplorerData: async () => {
    const response = await api.get('/explorer');
    return response.data;
  },
  
  // Fetches tables for a specific schema
  getSchemaTables: async (dbId: string, schemaId: string) => {
    const response = await api.get(`/database/${dbId}/schema/${schemaId}/tables`);
    return response.data;
  }
};
