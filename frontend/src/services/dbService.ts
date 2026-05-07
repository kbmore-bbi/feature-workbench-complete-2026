import api from "../api/axiosInstance";
import {
  getMockAttributes,
  mockDatabases,
  mockDelay,
  mockSchemasByDatabase,
  mockTablesBySchema,
} from "./dbMockData";

const useMockDb = process.env.NEXT_PUBLIC_USE_MOCK_DB === "true";
const forceMockError = process.env.NEXT_PUBLIC_MOCK_DB_ERROR === "true";

function throwMockError() {
  if (forceMockError) {
    throw new Error("Mock database API failed");
  }
}

export const dbService = {
  getExplorerData: async () => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockDatabases);
    }

    const response = await api.get("/v1/table-selection/databases");
    return response.data;
  },

  getDatabaseSchemas: async (database: string) => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockSchemasByDatabase[database] ?? []);
    }

    const response = await api.get("/v1/table-selection/schemas", {
      params: { database },
    });
    return response.data;
  },

  getSchemaTables: async (database: string, schema: string) => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockTablesBySchema[`${database}.${schema}`] ?? []);
    }

    const response = await api.get("/v1/table-selection/tables", {
      params: { database, schema },
    });
    return response.data;
  },

  getTableAttributes: async (tables: string[]) => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(getMockAttributes(tables));
    }

    const response = await api.get("/v1/table-selection/attributes", {
      params: { tables },
      paramsSerializer: {
        indexes: null,
      },
    });

    return response.data;
  },

  getTableRelationships: async (
    tables: Array<{ database: string; schema: string; table: string }>
  ) => {
    if (useMockDb) {
      throwMockError();
      return mockDelay([]);
    }

    const response = await api.post("/v1/table-selection/relationships", {
      tables,
    });
    return response.data;
  },

  listDerivedSources: async () => {
    const response = await api.get("/v1/derived-sources");
    return response.data;
  },

  validateDerivedSource: async (payload: {
    derived_source_id?: string | null;
    derived_source_name: string;
    sql_text: string;
    source_tables: Array<{ database: string; schema: string; table: string }>;
    driving_table?: { database: string; schema: string; table: string } | null;
    relationships?: unknown[];
    filters?: unknown[];
    selected_columns_by_table?: Record<string, string[]>;
  }) => {
    const response = await api.post("/v1/derived-sources/validate", payload);
    return response.data;
  },

  saveDerivedSource: async (payload: {
    derived_source_id?: string | null;
    derived_source_name: string;
    sql_text: string;
    source_tables: Array<{ database: string; schema: string; table: string }>;
    driving_table?: { database: string; schema: string; table: string } | null;
    relationships?: unknown[];
    filters?: unknown[];
    selected_columns_by_table?: Record<string, string[]>;
  }) => {
    const response = await api.post("/v1/derived-sources", payload);
    return response.data;
  },
};
