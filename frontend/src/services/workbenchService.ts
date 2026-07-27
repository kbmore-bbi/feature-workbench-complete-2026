import api from '../api/axiosInstance';
import {
  type MappingIntent,
  type RelationGraphContext,
  type RelationshipContextItem,
  type SemanticLevel,
  type SemanticContextItem,
  type SemanticSurface,
  type STTMBuilderEnvelopeRequest,
  type STTMBuilderEnvelopeResponse,
  type STTMIntent,
  type STTMOperation,
  type TableRef,
  type TargetAttributeItem,
} from '@/types/api-contract';
import { buildApiEnvelope, getApiData, postEnvelopeData, resolveApiBaseUrl } from '@/api/axiosInstance';
import { API_ROUTES } from '@/api/routes';
import { handleApiClientError } from '@/api/errors/error-bus';
import {
  buildMockWorkbenchInvokeResponse,
  mockInvokeStream,
  mockWorkbenchInfo,
} from '@/data/mock/workbench';
import { mockDelay, throwMockError, useMockDb } from './mock/mockConfig';
import { extractSseChunk } from './streaming/sse';

type WorkbenchStreamEvent =
  | { event: "status" | "context.resolved" | "activity.started" | "activity.progress" | "activity.completed"; data: Record<string, unknown> }
  | { event: "delta" | "response.text.delta" | "response.sql.delta"; data: { text: string } }
  | { event: "suggestions" | "suggestions.delta"; data: { items?: string[]; index?: number; text?: string } }
  | { event: "thread_checkpointed" | "thread_rolled_over" | "thread.checkpointed" | "thread.rolled_over" | "artifact_created" | "artifact.created"; data: Record<string, unknown> }
  | { event: "final" | "response.completed"; data: STTMBuilderEnvelopeResponse }
  | { event: "error" | "response.failed"; data: { message?: string; code?: string } };

/**
 * Request payload for direct AGT_SOURCE_MAPPING invocation.
 * This bypasses the orchestrator for faster auto-mapping.
 */
export type DirectAutoMapRequest = {
  request_id?: string | null;
  attributes: TargetAttributeItem[];
  source_tables: TableRef[];
  target_table?: TableRef | null;
  driving_table?: TableRef | null;
  relationships?: RelationshipContextItem[] | null;
  semantic_context?: SemanticContextItem[] | null;
  selected_columns_by_table?: Record<string, string[]> | null;
  selected_derived_sources?: string[] | null;
  semantic_bundle_id?: string | null;
  semantic_bundle_label?: string | null;
  semantic_view_name?: string | null;
  derived_source_lineage?: Array<Record<string, unknown>> | null;
  datahub_context?: Record<string, unknown> | null;
  mapping_intent?: MappingIntent | null;
  message?: string | null;
  project_id?: string | null;
  workspace_context?: Record<string, unknown> | null;
  relation_graph?: RelationGraphContext | null;
};

/**
 * Response from direct AGT_SOURCE_MAPPING invocation.
 */
export type DirectAutoMapResponse = {
  request_id: string;
  status: 'completed' | 'needs_input' | 'failed';
  mappings: Record<string, {
    source_attributes: string[];
    confidence_score: number;
    confidence_reason?: string | null;
    candidate_source_attributes?: string[];
    unmatched_reason?: string | null;
    preprocessing_rule?: string | null;
    preprocessing_rule_type?: string | null;
    preprocessing_nl_rule?: string | null;
    processing_order?: number | null;
    description?: string | null;
  }>;
  message?: string | null;
  warnings?: Array<{ code: string; message: string }>;
  error?: { title: string; detail: string; code: string } | null;
  meta?: Record<string, unknown>;
  semantic_refresh_status?: {
    bundle_id?: string | null;
    bundle_label?: string | null;
    semantic_view_name?: string | null;
  } | null;
};

export type { RelationshipContextItem, TableRef, TargetAttributeItem };

export type WorkbenchRequest = {
  interface: STTMIntent;
  thread_id?: string | null;
  logical_conversation_id?: string | null;
  physical_thread_segment?: number | null;
  parent_message_id?: number | null;
  session_id?: string | null;
  attributes?: TargetAttributeItem[] | null;
  source_tables?: TableRef[] | null;
  message?: string | null;
  driving_table?: TableRef | null;
  relationships?: RelationshipContextItem[] | null;
  semantic_context?: SemanticContextItem[] | null;
  selected_columns_by_table?: Record<string, string[]> | null;
  surface?: SemanticSurface | null;
  semantic_level_requested?: SemanticLevel | null;
  target_table?: TableRef | null;
  selected_derived_sources?: string[] | null;
  semantic_bundle_id?: string | null;
  semantic_bundle_hash?: string | null;
  learning_context_id?: string | null;
  learning_context_hash?: string | null;
  workspace_context_id?: string | null;
  workspace_context_hash?: string | null;
  artifact_refs?: Array<Record<string, unknown>> | null;
  semantic_view_name?: string | null;
  derived_source_lineage?: Array<Record<string, unknown>> | null;
  datahub_context?: Record<string, unknown> | null;
  mapping_intent?: MappingIntent | null;
  project_id?: string | null;
  sttm_id?: string | null;
  workspace_context?: Record<string, unknown> | null;
  relation_graph?: RelationGraphContext | null;
};

export type AutoMapJobPartial = {
  batch_index: number;
  attribute_count: number;
  target_attributes: string[];
  response: STTMBuilderEnvelopeResponse;
  completed_at?: string;
};

export type AutoMapJob = {
  job_id: string;
  request_id?: string | null;
  status: "queued" | "running" | "completed" | "failed";
  stage?: string | null;
  attribute_count: number;
  batch_count: number;
  completed_batch_count: number;
  completed_attribute_count: number;
  partial_responses: AutoMapJobPartial[];
  response?: STTMBuilderEnvelopeResponse | null;
  error?: { code?: string; message?: string } | null;
  prepared_context_hash?: string | null;
  semantic_bundle_id?: string | null;
  timings_ms?: Record<string, number>;
};

const operationByIntent: Record<STTMIntent, STTMOperation> = {
  AUTO_MAP: "sttm.auto_map",
  CHAT: "sttm.chat",
  TRANSFORM: "sttm.transform",
};

function nullableNonEmptyArray<T>(items?: T[] | null): T[] | null {
  return items && items.length > 0 ? items : null;
}

function toEnvelope(payload: WorkbenchRequest): STTMBuilderEnvelopeRequest {
  return buildApiEnvelope(
    operationByIntent[payload.interface],
    {
      intent: payload.interface,
      attributes: nullableNonEmptyArray(payload.attributes),
      message: payload.message ?? null,
    },
    {
      thread_id: payload.thread_id ?? null,
      logical_conversation_id: payload.logical_conversation_id ?? null,
      physical_thread_segment: payload.physical_thread_segment ?? null,
      parent_message_id: payload.parent_message_id ?? null,
      session_id: payload.session_id ?? null,
      source_tables: nullableNonEmptyArray(payload.source_tables),
      driving_table: payload.driving_table ?? null,
      relationships: payload.relationships ?? null,
      semantic_context: payload.semantic_context ?? null,
      selected_columns_by_table: payload.selected_columns_by_table ?? null,
      surface: payload.surface ?? "SOURCE_SELECTION",
      semantic_level_requested: payload.semantic_level_requested ?? "FULL_REGISTRY",
      target_table: payload.target_table ?? null,
      selected_derived_sources: nullableNonEmptyArray(payload.selected_derived_sources),
      semantic_bundle_id: payload.semantic_bundle_id ?? null,
      semantic_bundle_hash: payload.semantic_bundle_hash ?? null,
      learning_context_id: payload.learning_context_id ?? null,
      learning_context_hash: payload.learning_context_hash ?? null,
      workspace_context_id: payload.workspace_context_id ?? null,
      workspace_context_hash: payload.workspace_context_hash ?? null,
      artifact_refs: payload.artifact_refs ?? [],
      semantic_view_name: payload.semantic_view_name ?? null,
      derived_source_lineage: payload.derived_source_lineage ?? null,
      datahub_context: payload.datahub_context ?? null,
      mapping_intent: payload.mapping_intent ?? null,
      project_id: payload.project_id ?? null,
      sttm_id: payload.sttm_id ?? null,
      workspace_context: payload.workspace_context ?? null,
      relation_graph: payload.relation_graph ?? null,
    },
  ) as STTMBuilderEnvelopeRequest;
}

export const workbenchService = {
  startAutoMapJob: async (payload: WorkbenchRequest): Promise<AutoMapJob> =>
    postEnvelopeData<AutoMapJob>(
      API_ROUTES.workbench.autoMapJobs,
      toEnvelope(payload),
      { timeout: 300000 },
    ),

  getAutoMapJob: async (jobId: string): Promise<AutoMapJob> =>
    getApiData<AutoMapJob>(`${API_ROUTES.workbench.autoMapJobs}/${encodeURIComponent(jobId)}`, {
      timeout: 30000,
    }),

  invoke: async (payload: WorkbenchRequest) => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(buildMockWorkbenchInvokeResponse(payload));
    }

    const response = await api.post<STTMBuilderEnvelopeResponse>(API_ROUTES.workbench.invoke, toEnvelope(payload), {
      timeout: 300000,
    });
    return response.data;
  },

  getInfo: async () => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockWorkbenchInfo);
    }
    return getApiData(API_ROUTES.workbench.info);
  },

  invokeStream: async function* (payload: WorkbenchRequest): AsyncGenerator<WorkbenchStreamEvent> {
    if (useMockDb) {
      throwMockError();
      yield* mockInvokeStream(payload);
      return;
    }

    const parseChunk = (chunk: string) => {
      let eventName = "message";
      const dataParts: string[] = [];
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          dataParts.push(line.slice(5).trimStart());
        }
      }
      if (!dataParts.length) return null;
      const raw = dataParts.join("\n");
      try {
        return { event: eventName, data: JSON.parse(raw) };
      } catch {
        return { event: eventName, data: { text: raw } };
      }
    };

    const maxAttempts = payload.interface === "CHAT" ? 2 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await fetch(`${resolveApiBaseUrl()}${API_ROUTES.workbench.invokeStream}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toEnvelope(payload)),
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => "");
        const streamError = new Error(
          errorText
            ? `Streaming request failed with HTTP ${response.status}: ${errorText}`
            : `Streaming request failed with HTTP ${response.status}`
        );
        handleApiClientError(streamError, {
          title: 'Streaming request failed',
          subHeader: 'Workbench invoke stream',
          fallbackMessage: 'Unable to stream the workbench response.',
        });
        throw streamError;
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = "";
      let receivedAnswerEvent = false;

      const forward = (parsed: ReturnType<typeof parseChunk>) => {
        if (
          parsed &&
          !["status", "context.resolved", "activity.started", "activity.progress", "activity.completed"].includes(parsed.event)
        ) receivedAnswerEvent = true;
        return parsed;
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let extracted = extractSseChunk(buffer);
        while (extracted !== null) {
          const parsed = forward(parseChunk(extracted.chunk));
          buffer = extracted.remaining;
          if (parsed) {
            yield parsed as WorkbenchStreamEvent;
            if (
              parsed.event === "final" ||
              parsed.event === "response.completed" ||
              parsed.event === "error" ||
              parsed.event === "response.failed"
            ) return;
          }
          extracted = extractSseChunk(buffer);
        }
      }

      if (buffer.trim()) {
        const parsed = forward(parseChunk(buffer));
        if (parsed) {
          yield parsed as WorkbenchStreamEvent;
          if (
            parsed.event === "final" ||
            parsed.event === "response.completed" ||
            parsed.event === "error" ||
            parsed.event === "response.failed"
          ) return;
        }
      }

      if (!receivedAnswerEvent && attempt + 1 < maxAttempts) {
        yield {
          event: "status",
          data: {
            phase: "reconnecting",
            message: "The assistant connection restarted. Reconnecting once...",
          },
        };
        continue;
      }
      throw new Error(
        receivedAnswerEvent
          ? "The assistant response was interrupted before completion."
          : "The assistant stream closed before returning an answer."
      );
    }
  },

  /**
   * Direct invocation of AGT_SOURCE_MAPPING, bypassing the orchestrator.
   * This provides faster auto-mapping by calling the source mapping agent directly.
   */
  directAutoMap: async (payload: DirectAutoMapRequest): Promise<DirectAutoMapResponse> => {
    if (useMockDb) {
      throwMockError();
      // Return a mock response structure
      return mockDelay({
        request_id: payload.request_id ?? 'mock-request-id',
        status: 'completed' as const,
        mappings: {},
        message: 'Mock direct auto-map response',
        warnings: [],
        error: null,
        meta: { mock: true },
      });
    }

    const response = await api.post<DirectAutoMapResponse>(
      API_ROUTES.workbench.autoMapDirect,
      payload,
      { timeout: 180000 }
    );
    return response.data;
  },

  /**
   * Direct invocation of AGT_SOURCE_MAPPING with SSE streaming.
   * Provides real-time progress updates during auto-mapping.
   */
  directAutoMapStream: async function* (
    payload: DirectAutoMapRequest
  ): AsyncGenerator<
    | { event: "status"; data: Record<string, unknown> }
    | { event: "delta"; data: { text: string } }
    | { event: "final"; data: DirectAutoMapResponse }
    | { event: "error"; data: { message?: string; code?: string } }
  > {
    if (useMockDb) {
      throwMockError();
      yield { event: "status", data: { phase: "mock", message: "Mock streaming" } };
      yield {
        event: "final",
        data: {
          request_id: payload.request_id ?? 'mock-request-id',
          status: 'completed' as const,
          mappings: {},
          message: 'Mock direct auto-map stream response',
          warnings: [],
          error: null,
          meta: { mock: true, streaming: true },
        },
      };
      return;
    }

    const response = await fetch(
      `${resolveApiBaseUrl()}${API_ROUTES.workbench.autoMapDirectStream}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => "");
      const streamError = new Error(
        errorText
          ? `Direct auto-map streaming failed with HTTP ${response.status}: ${errorText}`
          : `Direct auto-map streaming failed with HTTP ${response.status}`
      );
      handleApiClientError(streamError, {
        title: 'Direct auto-map streaming failed',
        subHeader: 'AGT_SOURCE_MAPPING direct invocation',
        fallbackMessage: 'Unable to stream the direct auto-map response.',
      });
      throw streamError;
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";

    const parseChunk = (chunk: string) => {
      let eventName = "message";
      const dataParts: string[] = [];
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          dataParts.push(line.slice(5).trimStart());
        }
      }
      if (!dataParts.length) return null;
      const raw = dataParts.join("\n");
      try {
        return { event: eventName, data: JSON.parse(raw) };
      } catch {
        return { event: eventName, data: { text: raw } };
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let extracted = extractSseChunk(buffer);
      while (extracted !== null) {
        const parsed = parseChunk(extracted.chunk);
        buffer = extracted.remaining;
        if (parsed) {
          yield parsed as
            | { event: "status"; data: Record<string, unknown> }
            | { event: "delta"; data: { text: string } }
            | { event: "final"; data: DirectAutoMapResponse }
            | { event: "error"; data: { message?: string; code?: string } };
        }
        extracted = extractSseChunk(buffer);
      }
    }

    if (buffer.trim()) {
      const parsed = parseChunk(buffer);
      if (parsed) {
        yield parsed as
          | { event: "status"; data: Record<string, unknown> }
          | { event: "delta"; data: { text: string } }
          | { event: "final"; data: DirectAutoMapResponse }
          | { event: "error"; data: { message?: string; code?: string } };
      }
    }
  },
};
