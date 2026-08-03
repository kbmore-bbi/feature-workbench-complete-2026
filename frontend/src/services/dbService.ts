import api, {
  buildApiEnvelope,
  getApiData,
  getApiErrorMessage,
  postEnvelopeData,
  resolveApiBaseUrl,
} from "@/api/axiosInstance";
import { API_ROUTES } from "@/api/routes";
import type {
  DbtConversionRequest,
  DbtConversionResponse,
  MappingSqlPreviewRequest,
  MappingSqlPreviewResponse,
  MappingSqlCompileRequest,
  MappingSqlCompileResponse,
  MappingSqlParseRequest,
  MappingSqlParseResponse,
  MappingSqlReviewRequest,
  MappingSqlReviewResponse,
  TestCaseGenerationRequest,
  TestCaseGenerationResponse,
  WorkbookExportRequest,
} from "@/types/api-contract";
import {
  buildMockDbtConversion,
  buildMockMappingSqlPreview,
  buildMockMappingSqlReview,
  buildMockSemanticContextRefresh,
  buildMockValidateDerivedSource,
  buildMockWorkbookBlob,
  getMockAttributes,
  getMockRelationships,
  listMockDerivedSources,
  mockDatabases,
  mockSchemasByDatabase,
  mockStreamDbtConversion,
  mockTablesBySchema,
  saveMockDerivedSource,
} from "@/data/mock";
import { mockDelay, throwMockError, useMockDb } from "./mock/mockConfig";

type TableRef = { database: string; schema: string; table: string };

type AgentArtifactJob = {
  job_id: string;
  job_type: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  result?: {
    data?: Record<string, unknown>;
    error?: { detail?: string | null; title?: string | null } | null;
  } | null;
  error?: string | null;
};

function waitForAgentPoll(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Agent job polling was cancelled.", "AbortError"));
      return;
    }
    const handleAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Agent job polling was cancelled.", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function pollAgentArtifactJob(
  url: (jobId: string) => string,
  jobId: string,
  signal?: AbortSignal,
): Promise<AgentArtifactJob> {
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("Agent job polling was cancelled.", "AbortError");
    const job = await getApiData<AgentArtifactJob>(url(jobId), {
      timeout: 30000,
      signal,
      skipGlobalError: true,
    });
    if (job.status === "completed" || job.status === "failed") return job;
    await waitForAgentPoll(2000, signal);
  }
  throw new Error("The agent job did not finish within 30 minutes. Its durable job record remains available.");
}

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
  purpose?: string | null;
  business_description?: string | null;
  output_columns?: Array<Record<string, unknown>>;
  column_semantics?: Array<Record<string, unknown>>;
  grain?: string | null;
  keys?: string[];
  generated_by_request_id?: string | null;
};

type DerivedSourcePreviewColumn = {
  name: string;
  data_type: string;
  is_primary_key?: boolean;
};

type DerivedSourceValidateResult = {
  valid: boolean;
  message: string;
  sql_text?: string | null;
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
  source_dependency_hash?: string | null;
  physical_view_name?: string | null;
  semantic_projection?: Record<string, unknown>;
  semantic_quality?: "complete" | "incomplete" | string;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_active?: boolean;
};

type DbtStreamTelemetryEvent =
  | {
      type: "fetch_begin";
      url: string;
    }
  | {
      type: "fetch_resolved";
      url: string;
      status: number;
      ok: boolean;
      headers: Record<string, string>;
    }
  | {
      type: "first_chunk";
      byteLength: number;
    }
  | {
      type: "sse_event";
      eventName: string;
    };

type DbtStreamTelemetry = {
  onEvent?: (event: DbtStreamTelemetryEvent) => void;
};

type SemanticLevel =
  | "FULL_REGISTRY"  // Recommended default
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
  semantic_model_yaml?: string | null;
  status: "ready" | "refreshed" | "promoted" | "partial" | "failed";
  promoted?: boolean;
  cache_hit?: boolean;
  cache_status?: string;
  cache_age_ms?: number | null;
  registry_version?: string | null;
  raw_assets?: Array<Record<string, unknown>>;
  composed_yaml?: string | null;
  derived_semantics?: Array<Record<string, unknown>>;
  excluded_relationships?: Array<Record<string, unknown>>;
  composition_diagnostics?: Array<Record<string, unknown>>;
  stage_timings_ms?: Record<string, number>;
  summary: Record<string, unknown>;
  lineage?: Array<Record<string, unknown>>;
  semantic_context?: Array<Record<string, unknown>>;
  datahub_context?: Record<string, unknown> | null;
};

const TABLE_METADATA_CACHE_TTL_MS = 10 * 60 * 1000;

type TimedCacheEntry<T> = {
  data: T;
  expiresAt: number;
  schemaHash: string;
};

const attributeCache = new Map<string, TimedCacheEntry<TableAttributes[]>>();
const attributeRequests = new Map<string, Promise<TableAttributes[]>>();
const relationshipCache = new Map<string, TimedCacheEntry<RelationshipItem[]>>();
const relationshipRequests = new Map<string, Promise<RelationshipItem[]>>();
const metadataCache = new Map<string, TimedCacheEntry<unknown>>();
const metadataRequests = new Map<string, Promise<unknown>>();
const semanticBundleCache = new Map<string, TimedCacheEntry<SemanticContextBundleResponse>>();
const semanticBundleRequests = new Map<string, Promise<SemanticContextBundleResponse>>();

function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).sort().join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${key}:${stableKey(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function cachedMetadata<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const cached = metadataCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data as T;
  const pending = metadataRequests.get(key);
  if (pending) return pending as Promise<T>;
  const request = loader()
    .then((data) => {
      metadataCache.set(key, {
        data,
        expiresAt: Date.now() + TABLE_METADATA_CACHE_TTL_MS,
        schemaHash: key,
      });
      return data;
    })
    .finally(() => metadataRequests.delete(key));
  metadataRequests.set(key, request);
  return request;
}

function tableSetKey(tables: string[]): string {
  return [...new Set(tables.map((table) => table.trim().toUpperCase()).filter(Boolean))]
    .sort()
    .join("|");
}

function relationshipTableSetKey(tables: TableRef[]): string {
  return tableSetKey(tables.map((table) => `${table.database}.${table.schema}.${table.table}`));
}

function metadataSchemaHash(attributes: TableAttributes[]): string {
  return attributes
    .map((item) =>
      `${item.table.database}.${item.table.schema}.${item.table.table}:` +
      item.columns
        .map((column) => `${column.ordinal_position ?? ""}:${column.column_name}:${column.data_type}`)
        .join(","),
    )
    .sort()
    .join("|");
}

function buildMockTestCaseGeneration(
  payload: TestCaseGenerationRequest,
): TestCaseGenerationResponse {
  const documents = (payload.mappings ?? []).map((mapping, index) => ({
    test_case_id: `MOCK-TC-${String(index + 1).padStart(3, "0")}`,
    group: mapping.rule?.toLowerCase().includes("direct")
      ? "Null Checks"
      : "Transformation Rules",
    target_attribute: mapping.target_column,
    source_columns:
      mapping.source_columns?.join(", ") ||
      mapping.source_column ||
      mapping.constant_value ||
      "Value binding",
    mapping_rule: mapping.expression || mapping.rule || "Direct",
    test_case_description: `Mock validation for ${mapping.target_column}.`,
    test_type: "Positive",
    sample_source_input: "mock input",
    expected_target_value: "mock expected value",
    confidence: "High",
  }));
  const groups = new Map<string, string[]>();
  documents.forEach((document) => {
    groups.set(document.group, [
      ...(groups.get(document.group) ?? []),
      document.target_attribute,
    ]);
  });
  return {
    status: "completed",
    domain_name: payload.domain_name ?? null,
    target_layer: payload.target_layer ?? null,
    materialization: payload.materialization ?? null,
    target_model: payload.target_table.table,
    target_table: `${payload.target_table.database}.${payload.target_table.schema}.${payload.target_table.table}`,
    test_groups: [...groups.entries()].map(([group, target_columns]) => ({
      group,
      target_columns,
    })),
    seed_files: [],
    test_case_document: documents,
    agent_name: "MOCK_TEST_CASE_GENERATION_AGENT",
    retrieved_inference_ids: [],
    retrieved_recommendation_ids: [],
    used_inference_ids: [],
    used_recommendation_ids: [],
  };
}

export const dbService = {
  getExplorerData: async (): Promise<DatabaseItem[]> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockDatabases);
    }

    return cachedMetadata("databases", () =>
      postEnvelopeData<DatabaseItem[]>(
        API_ROUTES.tableSelection.databases,
        buildApiEnvelope("table_selection.list_databases", {}),
      ),
    );
  },

  getDatabaseSchemas: async (database: string): Promise<SchemaItem[]> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockSchemasByDatabase[database] ?? []);
    }

    return cachedMetadata(`schemas:${database.toUpperCase()}`, () => postEnvelopeData<SchemaItem[]>(
      API_ROUTES.tableSelection.schemas,
      buildApiEnvelope("table_selection.list_schemas", { database }, { database }),
    ));
  },

  getSchemaTables: async (database: string, schema: string): Promise<TableItem[]> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockTablesBySchema[`${database}.${schema}`] ?? []);
    }

    return cachedMetadata(
      `tables:${database.toUpperCase()}.${schema.toUpperCase()}`,
      () => postEnvelopeData<TableItem[]>(
        API_ROUTES.tableSelection.tables,
        buildApiEnvelope("table_selection.list_tables", { database, schema }, { database, schema }),
        { timeout: 120000, skipGlobalError: true },
      ),
    );
  },

  getTableAttributes: async (tables: string[]): Promise<TableAttributes[]> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(getMockAttributes(tables));
    }

    const key = tableSetKey(tables);
    const cached = attributeCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const pending = attributeRequests.get(key);
    if (pending) return pending;
    const request = postEnvelopeData<TableAttributes[]>(
      API_ROUTES.tableSelection.attributes,
      buildApiEnvelope("table_selection.list_attributes", { tables }, { tables }),
      { timeout: 120000, skipGlobalError: true },
    )
      .then((data) => {
        attributeCache.set(key, {
          data,
          expiresAt: Date.now() + TABLE_METADATA_CACHE_TTL_MS,
          schemaHash: metadataSchemaHash(data),
        });
        return data;
      })
      .finally(() => attributeRequests.delete(key));
    attributeRequests.set(key, request);
    return request;
  },

  getTableRelationships: async (
    tables: Array<{ database: string; schema: string; table: string }>
  ): Promise<RelationshipItem[]> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(getMockRelationships(tables));
    }

    const key = relationshipTableSetKey(tables);
    const cached = relationshipCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const pending = relationshipRequests.get(key);
    if (pending) return pending;
    const request = postEnvelopeData<RelationshipItem[]>(
      API_ROUTES.tableSelection.relationships,
      buildApiEnvelope("table_selection.list_relationships", { tables }, { tables }),
      { timeout: 120000, skipGlobalError: true },
    )
      .then((data) => {
        relationshipCache.set(key, {
          data,
          expiresAt: Date.now() + TABLE_METADATA_CACHE_TTL_MS,
          schemaHash: key,
        });
        return data;
      })
      .finally(() => relationshipRequests.delete(key));
    relationshipRequests.set(key, request);
    return request;
  },

  listDerivedSources: async (): Promise<DerivedSourceRecord[]> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(listMockDerivedSources() as DerivedSourceRecord[]);
    }

    return cachedMetadata("derived-sources", () =>
      getApiData<DerivedSourceRecord[]>(API_ROUTES.derivedSources.list),
    );
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
      API_ROUTES.derivedSources.validate,
      buildApiEnvelope("derived_source.validate", payload, {
        source_tables: payload.source_tables,
        driving_table: payload.driving_table ?? null,
        relationships: payload.relationships ?? [],
        selected_columns_by_table: payload.selected_columns_by_table ?? {},
      }),
      { timeout: 120000, skipGlobalError: true },
    );
  },

  saveDerivedSource: async (payload: DerivedSourcePayload): Promise<DerivedSourceRecord> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(saveMockDerivedSource(payload) as DerivedSourceRecord);
    }

    const result = await postEnvelopeData<DerivedSourceRecord>(
      API_ROUTES.derivedSources.save,
      buildApiEnvelope("derived_source.save", payload, {
        source_tables: payload.source_tables,
        driving_table: payload.driving_table ?? null,
        relationships: payload.relationships ?? [],
        selected_columns_by_table: payload.selected_columns_by_table ?? {},
      }),
      { timeout: 180000, skipGlobalError: true },
    );
    metadataCache.delete("derived-sources");
    semanticBundleCache.clear();
    return result;
  },

  refreshSemanticContext: async (
    payload: SemanticContextRefreshPayload
  ): Promise<SemanticContextBundleResponse> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(buildMockSemanticContextRefresh(payload) as SemanticContextBundleResponse);
    }

    const normalizedPayload = { ...payload, requested_level: "FULL_REGISTRY" as const };
    const key = stableKey(normalizedPayload);
    if (!payload.force) {
      const cached = semanticBundleCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.data;
      const pending = semanticBundleRequests.get(key);
      if (pending) return pending;
    }
    const request = postEnvelopeData<SemanticContextBundleResponse>(
      API_ROUTES.semanticContext.refresh,
      buildApiEnvelope("semantic_context.refresh", normalizedPayload),
      { timeout: 120000, skipGlobalError: true },
    )
      .then((data) => {
        semanticBundleCache.set(key, {
          data,
          expiresAt: Date.now() + TABLE_METADATA_CACHE_TTL_MS,
          schemaHash: data.registry_version ?? data.bundle_hash,
        });
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(
            "sttm.activeSemanticContext",
            JSON.stringify({
              bundle_id: data.bundle_id,
              bundle_hash: data.bundle_hash,
              registry_version: data.registry_version ?? null,
              cache_status: data.cache_status ?? "miss",
            }),
          );
        }
        return data;
      })
      .finally(() => semanticBundleRequests.delete(key));
    semanticBundleRequests.set(key, request);
    return request;
  },

  compileMappingSql: async (
    payload: MappingSqlCompileRequest,
  ): Promise<MappingSqlCompileResponse> => {
    return postEnvelopeData<MappingSqlCompileResponse>(
      "/v1/workbench/mapping-sql/compile",
      buildApiEnvelope("mapping_sql.compile", payload, {
        target_table: payload.target_table ?? null,
        relation_graph: payload.relation_graph,
      }),
      { timeout: 120000, skipGlobalError: true },
    );
  },

  reviewMappingSql: async (
    payload: MappingSqlReviewRequest,
  ): Promise<MappingSqlReviewResponse> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(buildMockMappingSqlReview(payload));
    }

    return postEnvelopeData<MappingSqlReviewResponse>(
      "/v1/workbench/mapping-sql/review",
      buildApiEnvelope("mapping_sql.review", payload, {
        source_tables: payload.source_tables,
        target_table: payload.target_table ?? null,
        driving_table: payload.driving_table ?? null,
        relationships: payload.relationships ?? [],
        semantic_bundle_id: payload.semantic_bundle_id ?? null,
        semantic_view_name: payload.semantic_view_name ?? null,
      }),
      { timeout: 120000 },
    );
  },

  parseMappingSql: async (
    payload: MappingSqlParseRequest,
  ): Promise<MappingSqlParseResponse> => {
    return postEnvelopeData<MappingSqlParseResponse>(
      "/v1/workbench/mapping-sql/parse",
      buildApiEnvelope("mapping_sql.parse", payload),
      { timeout: 120000 },
    );
  },

  previewMappingSql: async (
    payload: MappingSqlPreviewRequest,
  ): Promise<MappingSqlPreviewResponse> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(buildMockMappingSqlPreview(payload));
    }

    return postEnvelopeData<MappingSqlPreviewResponse>(
      "/v1/workbench/mapping-sql/preview",
      buildApiEnvelope("mapping_sql.preview", payload, {
        source_tables: payload.source_tables,
        target_table: payload.target_table ?? null,
        driving_table: payload.driving_table ?? null,
        relationships: payload.relationships ?? [],
        semantic_bundle_id: payload.semantic_bundle_id ?? null,
        semantic_view_name: payload.semantic_view_name ?? null,
      }),
      { timeout: 120000 },
    );
  },

  generateDbtConversion: async (
    payload: DbtConversionRequest,
  ): Promise<DbtConversionResponse> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(buildMockDbtConversion(payload));
    }

    return postEnvelopeData<DbtConversionResponse>(
      "/v1/workbench/dbt-conversion",
      buildApiEnvelope("dbt_conversion.generate", payload, {
        project_id: payload.project_id ?? null,
        sttm_id: payload.sttm_id ?? null,
        target_table: payload.target_table,
        source_tables: payload.source_tables,
        driving_table: payload.driving_table ?? null,
        relationships: payload.relationships ?? [],
        semantic_bundle_id: payload.semantic_bundle_id ?? null,
        semantic_view_name: payload.semantic_view_name ?? null,
      }),
      { timeout: 300000 },
    );
  },

  generateTestCases: async (
    payload: TestCaseGenerationRequest,
  ): Promise<TestCaseGenerationResponse> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(buildMockTestCaseGeneration(payload));
    }

    const started = await postEnvelopeData<AgentArtifactJob>(
      API_ROUTES.testCases.jobs,
      buildApiEnvelope("test_cases.generate", payload, {
        project_id: payload.project_id ?? null,
        sttm_id: payload.sttm_id ?? null,
        target_table: payload.target_table,
        source_tables: payload.source_tables,
        relationships: payload.relationships ?? [],
      }),
      { timeout: 30000 },
    );
    const job = await pollAgentArtifactJob(API_ROUTES.testCases.job, started.job_id);
    if (job.status === "failed") throw new Error(job.error || "Test-case generation failed.");
    if (job.result?.error) {
      throw new Error(job.result.error.detail || job.result.error.title || "Test-case generation failed.");
    }
    if (!job.result?.data) throw new Error("Test-case generation completed without a result.");
    return job.result.data as unknown as TestCaseGenerationResponse;
  },

  streamDbtConversion: async function* (
    payload: DbtConversionRequest,
    signal?: AbortSignal,
    telemetry?: DbtStreamTelemetry,
  ): AsyncGenerator<
    | { event: "status"; data: Record<string, unknown> }
    | { event: "artifact"; data: Record<string, unknown> }
    | { event: "final"; data: Record<string, unknown> }
    | { event: "error"; data: { message?: string; code?: string } }
  > {
    if (useMockDb) {
      throwMockError();
      if (signal?.aborted) {
        return;
      }
      yield* mockStreamDbtConversion(payload);
      return;
    }

    const url = `${resolveApiBaseUrl()}${API_ROUTES.dbtConversion.jobs}`;
    telemetry?.onEvent?.({
      type: "fetch_begin",
      url,
    });

    const started = await postEnvelopeData<AgentArtifactJob>(
      API_ROUTES.dbtConversion.jobs,
      buildApiEnvelope("dbt_conversion.generate", payload, {
          project_id: payload.project_id ?? null,
          sttm_id: payload.sttm_id ?? null,
          target_table: payload.target_table,
          source_tables: payload.source_tables,
          driving_table: payload.driving_table ?? null,
          relationships: payload.relationships ?? [],
          semantic_bundle_id: payload.semantic_bundle_id ?? null,
          semantic_view_name: payload.semantic_view_name ?? null,
      }),
      { timeout: 30000, signal },
    );

    telemetry?.onEvent?.({
      type: "fetch_resolved",
      url,
      status: 202,
      ok: true,
      headers: {},
    });

    yield { event: "status", data: { phase: "queued", message: "DBT conversion job queued safely in the background." } };
    let lastStage = "";
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      const job = await getApiData<AgentArtifactJob>(API_ROUTES.dbtConversion.job(started.job_id), {
        timeout: 30000,
        signal,
        skipGlobalError: true,
      });
      if (job.stage !== lastStage) {
        lastStage = job.stage;
        yield { event: "status", data: { phase: job.stage, message: `DBT conversion: ${job.stage.replaceAll("_", " ")}.` } };
      }
      if (job.status === "failed") {
        yield { event: "error", data: { message: job.error || "DBT conversion failed.", code: "DBT_CONVERSION_JOB_FAILED" } };
        return;
      }
      if (job.status === "completed") {
        if (!job.result?.data) {
          yield { event: "error", data: { message: "DBT conversion completed without a result.", code: "DBT_CONVERSION_EMPTY_RESULT" } };
          return;
        }
        yield { event: "final", data: job.result };
        return;
      }
      await waitForAgentPoll(2000, signal);
    }
    yield { event: "error", data: { message: "DBT conversion did not finish within 30 minutes.", code: "DBT_CONVERSION_JOB_TIMEOUT" } };
    return;

  },

  exportSttmWorkbook: async (
    payload: WorkbookExportRequest,
  ): Promise<Blob> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(buildMockWorkbookBlob(payload));
    }

    try {
      const response = await api.post(
        "/v1/workbench/exports/sttm-excel",
        buildApiEnvelope("workbook.export.sttm_excel", payload, {
          source_tables: payload.source_tables ?? [],
          target_table: payload.target_table ?? null,
        }),
        {
          responseType: "blob",
          timeout: 120000,
          headers: { "Content-Type": "application/json" },
        },
      );
      return response.data as Blob;
    } catch (error) {
      const blobData = (error as { response?: { data?: unknown } })?.response?.data;
      if (blobData instanceof Blob) {
        try {
          const text = await blobData.text();
          const parsed = JSON.parse(text) as { message?: string; error?: { detail?: string; title?: string } };
          throw new Error(
            parsed.error?.detail ||
            parsed.error?.title ||
            parsed.message ||
            "Unable to generate the Excel workbook."
          );
        } catch {
          // Fall back to the standard API error parser below.
        }
      }
      throw new Error(getApiErrorMessage(error, "Unable to generate the Excel workbook."));
    }
  },
};
