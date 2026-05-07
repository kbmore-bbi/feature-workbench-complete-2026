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

export type RelationshipContextItem = {
  left_table: TableRef;
  right_table: TableRef;
  constraint_name?: string | null;
  join_type?: "INNER" | "LEFT" | "RIGHT" | "FULL";
  source?: "FOREIGN_KEY" | "USER_DEFINED" | null;
  locked?: boolean;
  conditions?: Array<{
    left_column: string;
    right_column: string;
    operator?: string;
  }>;
};

export type WorkbenchRequest = {
  interface: 'AUTO_MAP' | 'CHAT' | 'TRANSFORM';
  thread_id?: string | null;
  attributes?: TargetAttributeItem[] | null;
  source_tables?: TableRef[] | null;
  message?: string | null;
  driving_table?: TableRef | null;
  relationships?: RelationshipContextItem[] | null;
  selected_columns_by_table?: Record<string, string[]> | null;
};

export const workbenchService = {
  invoke: async (payload: WorkbenchRequest) => {
    const response = await api.post('/v1/workbench/invoke', payload, {
      timeout: 120000,
    });
    return response.data;
  },

  getInfo: async () => {
    const response = await api.get('/v1/workbench/info');
    return response.data;
  },
};
