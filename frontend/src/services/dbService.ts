import { buildApiEnvelope, getApiData, postEnvelopeData } from "@/api/axiosInstance";
import {
  buildMockSemanticContextRefresh,
  buildMockValidateDerivedSource,
  getMockAttributes,
  getMockRelationships,
  listMockDerivedSources,
  mockDatabases,
  mockSchemasByDatabase,
  mockTablesBySchema,
  saveMockDerivedSource,
} from "./mock/dbMockData";
import { mockDelay, throwMockError, useMockDb } from "./mock/mockConfig";

type TableRef = { database: string; schema: string; table: string };

type DatabaseItem = {
  database_name: string;
  created?: string;
  schemas?: SchemaItem[];
};

type SchemaItem = {
  schema_name: string;
  created?: string;
};

type TableItem = {
  table_name: string;
  row_count?: number | null;
  column_count?: number;
};

type ColumnItem = {
  column_name: string;
  data_type: string;
  is_nullable?: string;
  ordinal_position?: number;
  comment?: string | null;
  is_primary_key?: boolean;
  is_foreign_key?: boolean;
};

type TableAttributes = {
  table: TableRef;
  columns: ColumnItem[];
};

type RelationshipItem = {
  id: string;
  left_table: TableRef;
  right_table: TableRef;
  constraint_name?: string | null;
  join_type?: "INNER" | "LEFT" | "RIGHT" | "FULL";
  source?: "FOREIGN_KEY" | "USER_DEFINED" | null;
  locked?: boolean;
  conditions?: Array<{
    left_column?: string;
    right_column?: string;
    fk_column?: string;
    pk_column?: string;
    operator?: string;
  }>;
};

type DerivedSourcePayload = {
  derived_source_id?: string | null;
  derived_source_name: string;
  sql_text: string;
  source_tables: TableRef[];
  parent_derived_source_ids?: string[];
  driving_table?: TableRef | null;
  relationships?: Array<{
    id?: string;
    left_table: TableRef;
    right_table: TableRef;
    join_type?: "INNER" | "LEFT" | "RIGHT" | "FULL";
    constraint_name?: string | null;
    source?: "FOREIGN_KEY" | "USER_DEFINED" | null;
    locked?: boolean;
    conditions?: Array<{
      left_column: string;
      right_column: string;
      operator?: string;
    }>;
  }>;
  filters?: unknown[];
  selected_columns_by_table?: Record<string, string[]>;
};

type DerivedSourcePreviewColumn = {
  name: string;
  data_type: string;
  is_primary_key?: boolean;
};

type DerivedSourceValidateResult = {
  valid: boolean;
  message: string;
  preview_columns: DerivedSourcePreviewColumn[];
  preview_rows: Array<{ values: Record<string, unknown> }>;
};

type DerivedSourceRecord = DerivedSourcePayload & {
  derived_source_id: string;
  preview_columns?: DerivedSourcePreviewColumn[];
  base_source_tables?: TableRef[];
  lineage_depth?: number;
  semantic_bundle_id?: string | null;
  semantic_view_name?: string | null;
  semantic_level?: string | null;
  upstream_hash?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_active?: boolean;
};

type SemanticLevel =
  | "L0_RELATIONSHIP"
  | "L1_CONTEXT"
  | "L2_ANALYST_READY"
  | "L3_MAPPING_ENRICHED";

type SemanticContextRefreshPayload = {
  selected_source_tables: TableRef[];
  selected_derived_sources?: string[];
  target_table?: TableRef | null;
  relationships?: Array<Record<string, unknown>>;
  requested_level?: SemanticLevel;
  force?: boolean;
};

type SemanticContextBundleResponse = {
  bundle_id: string;
  bundle_hash: string;
  bundle_label?: string | null;
  requested_level: SemanticLevel;
  achieved_level: SemanticLevel;
  semantic_view_name?: string | null;
  status: "ready" | "refreshed" | "promoted" | "partial" | "failed";
  promoted?: boolean;
  cache_hit?: boolean;
  summary: Record<string, unknown>;
  lineage?: Array<Record<string, unknown>>;
  semantic_context?: Array<Record<string, unknown>>;
  datahub_context?: Record<string, unknown> | null;
};

export const dbService = {
  getExplorerData: async (): Promise<DatabaseItem[]> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockDatabases);
    }

    return postEnvelopeData<DatabaseItem[]>(
      "/v1/table-selection/databases",
      buildApiEnvelope("table_selection.list_databases", {}),
    );
  },

  getDatabaseSchemas: async (database: string): Promise<SchemaItem[]> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockSchemasByDatabase[database] ?? []);
    }

    return postEnvelopeData<SchemaItem[]>(
      "/v1/table-selection/schemas",
      buildApiEnvelope("table_selection.list_schemas", { database }, { database }),
    );
  },

  getSchemaTables: async (database: string, schema: string): Promise<TableItem[]> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockTablesBySchema[`${database}.${schema}`] ?? []);
    }

    return postEnvelopeData<TableItem[]>(
      "/v1/table-selection/tables",
      buildApiEnvelope("table_selection.list_tables", { database, schema }, { database, schema }),
    );
  },

  getTableAttributes: async (tables: string[]): Promise<TableAttributes[]> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(getMockAttributes(tables));
    }

    return postEnvelopeData<TableAttributes[]>(
      "/v1/table-selection/attributes",
      buildApiEnvelope("table_selection.list_attributes", { tables }, { tables }),
    );
  },

  getTableRelationships: async (
    tables: Array<{ database: string; schema: string; table: string }>
  ): Promise<RelationshipItem[]> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(getMockRelationships(tables));
    }

    return postEnvelopeData<RelationshipItem[]>(
      "/v1/table-selection/relationships",
      buildApiEnvelope("table_selection.list_relationships", { tables }, { tables }),
    );
  },

  listDerivedSources: async (): Promise<DerivedSourceRecord[]> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(listMockDerivedSources() as DerivedSourceRecord[]);
    }

    return getApiData<DerivedSourceRecord[]>("/v1/derived-sources");
  },

  validatePreProcessExpression: async (
    payload: DerivedSourcePayload,
  ): Promise<DerivedSourceValidateResult> => {
    return dbService.validateDerivedSource(payload);
  },

  validateDerivedSource: async (payload: DerivedSourcePayload): Promise<DerivedSourceValidateResult> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(buildMockValidateDerivedSource(payload));
    }

    return postEnvelopeData<DerivedSourceValidateResult>(
      "/v1/derived-sources/validate",
      buildApiEnvelope("derived_source.validate", payload, {
        source_tables: payload.source_tables,
        driving_table: payload.driving_table ?? null,
        relationships: payload.relationships ?? [],
        selected_columns_by_table: payload.selected_columns_by_table ?? {},
      }),
    );
  },

  saveDerivedSource: async (payload: DerivedSourcePayload): Promise<DerivedSourceRecord> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(saveMockDerivedSource(payload) as DerivedSourceRecord);
    }

    return postEnvelopeData<DerivedSourceRecord>(
      "/v1/derived-sources",
      buildApiEnvelope("derived_source.save", payload, {
        source_tables: payload.source_tables,
        driving_table: payload.driving_table ?? null,
        relationships: payload.relationships ?? [],
        selected_columns_by_table: payload.selected_columns_by_table ?? {},
      }),
    );
  },

  refreshSemanticContext: async (
    payload: SemanticContextRefreshPayload
  ): Promise<SemanticContextBundleResponse> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(buildMockSemanticContextRefresh(payload) as SemanticContextBundleResponse);
    }

    return postEnvelopeData<SemanticContextBundleResponse>(
      "/v1/semantic-context/refresh",
      buildApiEnvelope("semantic_context.refresh", payload),
      { timeout: 120000 },
    );
  },
};
