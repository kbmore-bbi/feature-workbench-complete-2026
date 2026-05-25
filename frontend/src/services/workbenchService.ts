import api from '../api/axiosInstance';
import {
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
import { buildApiEnvelope, getApiData, resolveApiBaseUrl } from '@/api/axiosInstance';
import {
  buildMockWorkbenchInvokeResponse,
  mockInvokeStream,
  mockWorkbenchInfo,
} from './mock/workbenchMockData';
import { mockDelay, throwMockError, useMockDb } from './mock/mockConfig';

export type { RelationshipContextItem, TableRef, TargetAttributeItem };

export type WorkbenchRequest = {
  interface: STTMIntent;
  thread_id?: string | null;
  parent_message_id?: number | null;
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
  semantic_view_name?: string | null;
  derived_source_lineage?: Array<Record<string, unknown>> | null;
  datahub_context?: Record<string, unknown> | null;
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
      parent_message_id: payload.parent_message_id ?? null,
      source_tables: nullableNonEmptyArray(payload.source_tables),
      driving_table: payload.driving_table ?? null,
      relationships: payload.relationships ?? null,
      semantic_context: payload.semantic_context ?? null,
      selected_columns_by_table: payload.selected_columns_by_table ?? null,
      surface: payload.surface ?? "SOURCE_SELECTION",
      semantic_level_requested: payload.semantic_level_requested ?? "L1_CONTEXT",
      target_table: payload.target_table ?? null,
      selected_derived_sources: nullableNonEmptyArray(payload.selected_derived_sources),
      semantic_bundle_id: payload.semantic_bundle_id ?? null,
      semantic_view_name: payload.semantic_view_name ?? null,
      derived_source_lineage: payload.derived_source_lineage ?? null,
      datahub_context: payload.datahub_context ?? null,
    },
  ) as STTMBuilderEnvelopeRequest;
}

export const workbenchService = {
  invoke: async (payload: WorkbenchRequest) => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(buildMockWorkbenchInvokeResponse(payload));
    }

    const response = await api.post<STTMBuilderEnvelopeResponse>('/v1/workbench/invoke', toEnvelope(payload), {
      timeout: 300000,
    });
    return response.data;
  },

  getInfo: async () => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(mockWorkbenchInfo);
    }
    return getApiData('/v1/workbench/info');
  },

  invokeStream: async function* (payload: WorkbenchRequest): AsyncGenerator<
    | { event: "status"; data: Record<string, unknown> }
    | { event: "delta"; data: { text: string } }
    | { event: "suggestions"; data: { items: string[] } }
    | { event: "final"; data: STTMBuilderEnvelopeResponse }
    | { event: "error"; data: { message?: string; code?: string } }
  > {
    if (useMockDb) {
      throwMockError();
      yield* mockInvokeStream(payload);
      return;
    }

    const response = await fetch(`${resolveApiBaseUrl()}/v1/workbench/invoke/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toEnvelope(payload)),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        errorText
          ? `Streaming request failed with HTTP ${response.status}: ${errorText}`
          : `Streaming request failed with HTTP ${response.status}`
      );
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
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseChunk(chunk);
        if (parsed) {
          yield parsed as
            | { event: "status"; data: Record<string, unknown> }
            | { event: "delta"; data: { text: string } }
            | { event: "suggestions"; data: { items: string[] } }
            | { event: "final"; data: STTMBuilderEnvelopeResponse }
            | { event: "error"; data: { message?: string; code?: string } };
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    if (buffer.trim()) {
      const parsed = parseChunk(buffer);
      if (parsed) {
        yield parsed as
          | { event: "status"; data: Record<string, unknown> }
          | { event: "delta"; data: { text: string } }
          | { event: "suggestions"; data: { items: string[] } }
          | { event: "final"; data: STTMBuilderEnvelopeResponse }
          | { event: "error"; data: { message?: string; code?: string } };
      }
    }
  },
};
