import api from '../api/axiosInstance';

export type TableRef = {
  database: string;
  schema: string;
  table: string;
};

export type TargetAttributeItem = {
  target_table: TableRef;
  target_attribute: string;
  source_mappings?: Array<{
    table: TableRef;
    attribute: string;
  }> | null;
};

export type WorkbenchRequest = {
  interface: 'AUTO_MAP' | 'CHAT' | 'TRANSFORM';
  thread_id?: string | null;
  attributes?: TargetAttributeItem[] | null;
  source_tables?: TableRef[] | null;
  message?: string | null;
};

export const workbenchService = {
  invoke: async (payload: WorkbenchRequest) => {
    const response = await api.post('/v1/workbench/invoke', payload);
    return response.data;
  },

  getInfo: async () => {
    const response = await api.get('/v1/workbench/info');
    return response.data;
  },
};
