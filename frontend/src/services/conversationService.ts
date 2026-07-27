import {
  buildApiEnvelope,
  resolveApiBaseUrl,
} from "@/api/axiosInstance";
import api from "@/api/axiosInstance";
import type {
  AssistantPreferenceState,
  AssistantSignalResponseData,
  ConversationEnvelopeRequest,
  ConversationEnvelopeResponse,
  ConversationOperation,
  ConversationSettingsResponseData,
  ConversationSignalsResponseData,
  EvidenceCitation,
  RelationshipContextItem,
  SemanticContextItem,
  SemanticLevel,
  SemanticSurface,
  TableRef,
} from "@/types/api-contract";
import {
  buildMockConversationInvokeResponse,
  getMockAssistantSettings,
  listMockAssistantSignals,
  mockConversationInvokeStream,
  respondToMockAssistantSignal,
  updateMockAssistantSettings,
} from "@/data/mock/conversation";
import { mockDelay, throwMockError, useMockDb } from "@/services/mock/mockConfig";
import { extractSseChunk } from "@/services/streaming/sse";

export type ConversationRequestPayload = {
  operation?: Extract<ConversationOperation, "conversation.ask" | "conversation.recommend" | "conversation.feedback">;
  thread_id?: string | null;
  logical_conversation_id?: string | null;
  physical_thread_segment?: number | null;
  parent_message_id?: number | null;
  message: string;
  requested_sources?: string[] | null;
  source_tables?: TableRef[] | null;
  driving_table?: TableRef | null;
  relationships?: RelationshipContextItem[] | null;
  semantic_context?: SemanticContextItem[] | null;
  selected_columns_by_table?: Record<string, string[]> | null;
  surface?: SemanticSurface | null;
  semantic_level_requested?: SemanticLevel | null;
  target_table?: TableRef | null;
  session_id?: string | null;
  selected_derived_sources?: string[] | null;
  semantic_bundle_id?: string | null;
  semantic_bundle_hash?: string | null;
  learning_context_id?: string | null;
  learning_context_hash?: string | null;
  workspace_context_id?: string | null;
  workspace_context_hash?: string | null;
  artifact_refs?: Array<Record<string, unknown>> | null;
  semantic_bundle_label?: string | null;
  semantic_view_name?: string | null;
  derived_source_lineage?: Array<Record<string, unknown>> | null;
  datahub_context?: Record<string, unknown> | null;
  mapping_intent?: Record<string, unknown> | null;
  project_id?: string | null;
  sttm_id?: string | null;
  checked_mapping_row_ids?: string[] | null;
  mapping_rows?: Array<Record<string, unknown>> | null;
  workspace_context?: Record<string, unknown> | null;
};

type ConversationStreamEvent =
  | { event: "status"; data: Record<string, unknown> }
  | { event: "context.resolved"; data: Record<string, unknown> }
  | { event: "activity.started" | "activity.progress" | "activity.completed"; data: Record<string, unknown> }
  | { event: "delta"; data: { text: string } }
  | { event: "response.text.delta" | "response.sql.delta"; data: { text: string } }
  | { event: "suggestions"; data: { items: string[] } }
  | { event: "suggestions.delta"; data: { items?: string[]; index?: number; text?: string } }
  | { event: "thread_checkpointed"; data: Record<string, unknown> }
  | { event: "thread_rolled_over"; data: Record<string, unknown> }
  | { event: "thread.checkpointed" | "thread.rolled_over"; data: Record<string, unknown> }
  | { event: "artifact_created"; data: Record<string, unknown> }
  | { event: "artifact.created"; data: Record<string, unknown> }
  | { event: "final"; data: ConversationEnvelopeResponse | Record<string, unknown> }
  | { event: "response.completed"; data: ConversationEnvelopeResponse | Record<string, unknown> }
  | { event: "error" | "response.failed"; data: { message?: string; code?: string; error?: { title?: string; detail?: string; code?: string } } };

function parseChunk(chunk: string) {
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
}

function toEnvelope(payload: ConversationRequestPayload): ConversationEnvelopeRequest {
  return buildApiEnvelope(
    payload.operation ?? "conversation.ask",
    {
      message: payload.message,
      requested_sources: payload.requested_sources ?? [],
    },
    {
      thread_id: payload.thread_id ?? null,
      logical_conversation_id: payload.logical_conversation_id ?? null,
      physical_thread_segment: payload.physical_thread_segment ?? null,
      parent_message_id: payload.parent_message_id ?? null,
      session_id: payload.session_id ?? null,
      source_tables: payload.source_tables ?? null,
      driving_table: payload.driving_table ?? null,
      relationships: payload.relationships ?? null,
      semantic_context: payload.semantic_context ?? null,
      selected_columns_by_table: payload.selected_columns_by_table ?? null,
      surface: payload.surface ?? "SOURCE_SELECTION",
      semantic_level_requested: payload.semantic_level_requested ?? "FULL_REGISTRY",
      target_table: payload.target_table ?? null,
      selected_derived_sources: payload.selected_derived_sources ?? null,
      semantic_bundle_id: payload.semantic_bundle_id ?? null,
      semantic_bundle_hash: payload.semantic_bundle_hash ?? null,
      learning_context_id: payload.learning_context_id ?? null,
      learning_context_hash: payload.learning_context_hash ?? null,
      workspace_context_id: payload.workspace_context_id ?? null,
      workspace_context_hash: payload.workspace_context_hash ?? null,
      artifact_refs: payload.artifact_refs ?? [],
      semantic_bundle_label: payload.semantic_bundle_label ?? null,
      semantic_view_name: payload.semantic_view_name ?? null,
      derived_source_lineage: payload.derived_source_lineage ?? null,
      datahub_context: payload.datahub_context ?? null,
      mapping_intent: payload.mapping_intent ?? null,
      project_id: payload.project_id ?? null,
      sttm_id: payload.sttm_id ?? null,
      checked_mapping_row_ids: payload.checked_mapping_row_ids ?? null,
      mapping_rows: payload.mapping_rows ?? null,
      workspace_context: payload.workspace_context ?? null,
    },
  ) as ConversationEnvelopeRequest;
}

export const conversationService = {
  invoke: async (
    payload: ConversationRequestPayload & {
      operation: Extract<ConversationOperation, "conversation.ask" | "conversation.recommend" | "conversation.feedback">;
      feedback?: {
        category?: string;
        rating?: number | null;
        comment?: string | null;
        target_request_id?: string | null;
      } | null;
    },
  ): Promise<ConversationEnvelopeResponse> => {
    const envelope = buildApiEnvelope(
      payload.operation,
      {
        message: payload.message,
        requested_sources: payload.requested_sources ?? [],
        feedback: payload.feedback ?? null,
      },
      {
        thread_id: payload.thread_id ?? null,
        logical_conversation_id: payload.logical_conversation_id ?? null,
        physical_thread_segment: payload.physical_thread_segment ?? null,
        parent_message_id: payload.parent_message_id ?? null,
        session_id: payload.session_id ?? null,
        source_tables: payload.source_tables ?? null,
        driving_table: payload.driving_table ?? null,
        relationships: payload.relationships ?? null,
        semantic_context: payload.semantic_context ?? null,
        selected_columns_by_table: payload.selected_columns_by_table ?? null,
        surface: payload.surface ?? "SOURCE_SELECTION",
        semantic_level_requested: payload.semantic_level_requested ?? "FULL_REGISTRY",
        target_table: payload.target_table ?? null,
        selected_derived_sources: payload.selected_derived_sources ?? null,
        semantic_bundle_id: payload.semantic_bundle_id ?? null,
        semantic_bundle_hash: payload.semantic_bundle_hash ?? null,
        learning_context_id: payload.learning_context_id ?? null,
        learning_context_hash: payload.learning_context_hash ?? null,
        workspace_context_id: payload.workspace_context_id ?? null,
        workspace_context_hash: payload.workspace_context_hash ?? null,
        artifact_refs: payload.artifact_refs ?? [],
        semantic_bundle_label: payload.semantic_bundle_label ?? null,
        semantic_view_name: payload.semantic_view_name ?? null,
        derived_source_lineage: payload.derived_source_lineage ?? null,
        datahub_context: payload.datahub_context ?? null,
        mapping_intent: payload.mapping_intent ?? null,
        project_id: payload.project_id ?? null,
        sttm_id: payload.sttm_id ?? null,
        workspace_context: payload.workspace_context ?? null,
      },
    ) as ConversationEnvelopeRequest;

    if (useMockDb) {
      throwMockError();
      return mockDelay(
        buildMockConversationInvokeResponse({
          ...payload,
          operation: payload.operation,
        }),
      );
    }

    const response = await api.post<ConversationEnvelopeResponse>("/v1/workbench/conversation/invoke", envelope, {
      timeout: 60000,
    });
    return response.data;
  },
  invokeStream: async function* (
    payload: ConversationRequestPayload,
  ): AsyncGenerator<ConversationStreamEvent> {
    if (useMockDb) {
      throwMockError();
      for await (const event of mockConversationInvokeStream({
        interface: "CHAT",
        message: payload.message,
        thread_id: payload.thread_id ?? null,
        source_tables: payload.source_tables ?? null,
        driving_table: payload.driving_table ?? null,
        relationships: payload.relationships ?? null,
        semantic_context: payload.semantic_context ?? null,
        selected_columns_by_table: payload.selected_columns_by_table ?? null,
        surface: payload.surface ?? "SOURCE_SELECTION",
        semantic_level_requested: payload.semantic_level_requested ?? "FULL_REGISTRY",
        target_table: payload.target_table ?? null,
        selected_derived_sources: payload.selected_derived_sources ?? null,
        semantic_bundle_id: payload.semantic_bundle_id ?? null,
        semantic_view_name: payload.semantic_view_name ?? null,
        derived_source_lineage: payload.derived_source_lineage ?? null,
        datahub_context: payload.datahub_context ?? null,
        mapping_intent: payload.mapping_intent ?? null,
      })) {
        if (event.event === "final") {
          yield { event: "final", data: event.data as unknown as Record<string, unknown> };
          continue;
        }
        yield event as ConversationStreamEvent;
      }
      return;
    }

    const response = await fetch(`${resolveApiBaseUrl()}/v1/workbench/conversation/invoke/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toEnvelope(payload)),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        errorText
          ? `Conversation streaming request failed with HTTP ${response.status}: ${errorText}`
          : `Conversation streaming request failed with HTTP ${response.status}`,
      );
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let extracted = extractSseChunk(buffer);
      while (extracted !== null) {
        const parsed = parseChunk(extracted.chunk);
        buffer = extracted.remaining;
        if (parsed) {
          yield parsed as ConversationStreamEvent;
        }
        extracted = extractSseChunk(buffer);
      }
    }

    if (buffer.trim()) {
      const parsed = parseChunk(buffer);
      if (parsed) {
        yield parsed as ConversationStreamEvent;
      }
    }
  },
  getAssistantSettings: async (): Promise<ConversationSettingsResponseData> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(getMockAssistantSettings());
    }

    const envelope = buildApiEnvelope("conversation.settings.get", {}, {}) as ConversationEnvelopeRequest;
    const response = await api.post("/v1/workbench/conversation/settings", envelope, { timeout: 30000 });
    return response.data.data as ConversationSettingsResponseData;
  },
  updateAssistantSettings: async (settings: AssistantPreferenceState): Promise<ConversationSettingsResponseData> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(updateMockAssistantSettings(settings));
    }

    const envelope = buildApiEnvelope("conversation.settings.update", settings, {}) as ConversationEnvelopeRequest;
    const response = await api.post("/v1/workbench/conversation/settings", envelope, { timeout: 30000 });
    return response.data.data as ConversationSettingsResponseData;
  },
  listSignals: async (): Promise<ConversationSignalsResponseData> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(listMockAssistantSignals());
    }

    const envelope = buildApiEnvelope("conversation.signals.list", {}, {}) as ConversationEnvelopeRequest;
    const response = await api.post("/v1/workbench/conversation/signals", envelope, { timeout: 30000 });
    return response.data.data as ConversationSignalsResponseData;
  },
  respondToSignal: async (payload: {
    signal_id: string;
    status?: "acknowledged" | "responded" | "dismissed";
    option_selected?: string | null;
    rating?: number | null;
    comment?: string | null;
    feedback_type?: string;
  }): Promise<AssistantSignalResponseData> => {
    if (useMockDb) {
      throwMockError();
      return mockDelay(
        respondToMockAssistantSignal({
          signal_id: payload.signal_id,
          status: payload.status,
        }),
      );
    }

    const envelope = buildApiEnvelope("conversation.signals.respond", payload, {}) as ConversationEnvelopeRequest;
    const response = await api.post("/v1/workbench/conversation/signals/respond", envelope, { timeout: 60000 });
    return response.data.data as AssistantSignalResponseData;
  },
};

export type { ConversationStreamEvent, EvidenceCitation };
