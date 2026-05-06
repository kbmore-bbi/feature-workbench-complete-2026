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
};
