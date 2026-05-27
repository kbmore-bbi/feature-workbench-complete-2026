import {
  buildApiEnvelope,
  resolveApiBaseUrl,
} from "@/api/axiosInstance";
import api from "@/api/axiosInstance";
import type {
  ConversationEnvelopeRequest,
  ConversationEnvelopeResponse,
  ConversationOperation,
  EvidenceCitation,
  RelationshipContextItem,
  SemanticContextItem,
  SemanticLevel,
  SemanticSurface,
  TableRef,
} from "@/types/api-contract";
import { mockInvokeStream } from "@/services/mock/workbenchMockData";
import { throwMockError, useMockDb } from "@/services/mock/mockConfig";

export type ConversationRequestPayload = {
  operation?: Extract<ConversationOperation, "conversation.ask" | "conversation.recommend" | "conversation.feedback">;
  thread_id?: string | null;
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
  selected_derived_sources?: string[] | null;
  semantic_bundle_id?: string | null;
  semantic_bundle_label?: string | null;
  semantic_view_name?: string | null;
  derived_source_lineage?: Array<Record<string, unknown>> | null;
  datahub_context?: Record<string, unknown> | null;
};

type ConversationStreamEvent =
  | { event: "status"; data: Record<string, unknown> }
  | { event: "delta"; data: { text: string } }
  | { event: "suggestions"; data: { items: string[] } }
  | { event: "final"; data: ConversationEnvelopeResponse | Record<string, unknown> }
  | { event: "error"; data: { message?: string; code?: string } };

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
      parent_message_id: payload.parent_message_id ?? null,
      source_tables: payload.source_tables ?? null,
      driving_table: payload.driving_table ?? null,
      relationships: payload.relationships ?? null,
      semantic_context: payload.semantic_context ?? null,
      selected_columns_by_table: payload.selected_columns_by_table ?? null,
      surface: payload.surface ?? "SOURCE_SELECTION",
      semantic_level_requested: payload.semantic_level_requested ?? "L1_CONTEXT",
      target_table: payload.target_table ?? null,
      selected_derived_sources: payload.selected_derived_sources ?? null,
      semantic_bundle_id: payload.semantic_bundle_id ?? null,
      semantic_bundle_label: payload.semantic_bundle_label ?? null,
      semantic_view_name: payload.semantic_view_name ?? null,
      derived_source_lineage: payload.derived_source_lineage ?? null,
      datahub_context: payload.datahub_context ?? null,
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
        parent_message_id: payload.parent_message_id ?? null,
        source_tables: payload.source_tables ?? null,
        driving_table: payload.driving_table ?? null,
        relationships: payload.relationships ?? null,
        semantic_context: payload.semantic_context ?? null,
        selected_columns_by_table: payload.selected_columns_by_table ?? null,
        surface: payload.surface ?? "SOURCE_SELECTION",
        semantic_level_requested: payload.semantic_level_requested ?? "L1_CONTEXT",
        target_table: payload.target_table ?? null,
        selected_derived_sources: payload.selected_derived_sources ?? null,
        semantic_bundle_id: payload.semantic_bundle_id ?? null,
        semantic_bundle_label: payload.semantic_bundle_label ?? null,
        semantic_view_name: payload.semantic_view_name ?? null,
        derived_source_lineage: payload.derived_source_lineage ?? null,
        datahub_context: payload.datahub_context ?? null,
      },
    ) as ConversationEnvelopeRequest;
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
      for await (const event of mockInvokeStream({
        interface: "CHAT",
        message: payload.message,
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
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseChunk(chunk);
        if (parsed) {
          yield parsed as ConversationStreamEvent;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    if (buffer.trim()) {
      const parsed = parseChunk(buffer);
      if (parsed) {
        yield parsed as ConversationStreamEvent;
      }
    }
  },
};

export type { ConversationStreamEvent, EvidenceCitation };
