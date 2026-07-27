import { createRequestId } from "@/api/axiosInstance";
import {
  API_CONTRACT_VERSION,
  type AssistantPreferenceState,
  type AssistantSignal,
  type AssistantSignalResponseData,
  type ConversationEnvelopeResponse,
  type ConversationSettingsResponseData,
  type ConversationSignalsResponseData,
  type MappingIntent,
} from "@/types/api-contract";
import type { ConversationRequestPayload } from "@/services/conversationService";
import {
  buildMockWorkbenchInvokeResponse,
  mockInvokeStream,
} from "./workbench";

export const MOCK_ASSISTANT_PREFERENCES: AssistantPreferenceState = {
  feedback_enabled: true,
  recommendations_enabled: true,
};

export const MOCK_ASSISTANT_SIGNALS: AssistantSignal[] = [
  {
    signal_id: "mock-signal-feedback-001",
    signal_type: "feedback",
    layer: "feedback",
    status: "new",
    source: "mock",
    title: "How helpful was the last mapping suggestion?",
    message: "Rate the auto-map quality so the assistant can improve recommendations.",
    options: ["Very helpful", "Somewhat helpful", "Not helpful"],
    allow_free_text: true,
    requires_response: true,
    confidence: 0.82,
    entity_type: "mapping",
    entity_ids: ["mapping-1"],
    created_at: new Date().toISOString(),
  },
  {
    signal_id: "mock-signal-recommendation-001",
    signal_type: "recommendation",
    layer: "recommendation",
    status: "new",
    source: "mock",
    title: "Review relationship between ORDERS and CUSTOMERS",
    message:
      "A foreign-key relationship was detected. Confirm it before running auto-map for better confidence.",
    options: ["Accept relationship", "Dismiss"],
    allow_free_text: false,
    requires_response: false,
    confidence: 0.91,
    entity_type: "relationship",
    entity_ids: ["FK_ORDERS_CUSTOMERS"],
    created_at: new Date().toISOString(),
  },
];

export const MOCK_MAPPING_INTENT: MappingIntent = {
  business_goal: "Unify sales reporting for commercial analytics",
  lifecycle: "update",
  target_outcome: "Publish FACT_SALES_UNIFIED to enterprise DWH",
  domain_hints: ["sales", "orders", "customers"],
  source: "mock",
  confidence: 0.88,
  updated_at: new Date().toISOString(),
};

let mockAssistantPreferences: AssistantPreferenceState = {
  ...MOCK_ASSISTANT_PREFERENCES,
};

let mockSignalStore: AssistantSignal[] = MOCK_ASSISTANT_SIGNALS.map((signal) => ({
  ...signal,
}));

export function getMockAssistantSettings(): ConversationSettingsResponseData {
  return {
    settings: { ...mockAssistantPreferences },
  };
}

export function updateMockAssistantSettings(
  settings: AssistantPreferenceState,
): ConversationSettingsResponseData {
  mockAssistantPreferences = { ...settings };
  return getMockAssistantSettings();
}

export function listMockAssistantSignals(): ConversationSignalsResponseData {
  const unreadCount = mockSignalStore.filter((signal) => signal.status === "new").length;
  return {
    settings: { ...mockAssistantPreferences },
    signals: mockSignalStore.map((signal) => ({ ...signal })),
    inferences: [
      {
        inference_id: "mock-inference-001",
        inference_type: "relationship_hint",
        summary: "ORDERS and CUSTOMERS share CUSTOMER_ID and are strong join candidates.",
        confidence: 0.93,
        source: "mock",
        entity_type: "relationship",
        entity_ids: ["FK_ORDERS_CUSTOMERS"],
      },
    ],
    unread_count: unreadCount,
    mapping_intent: MOCK_MAPPING_INTENT,
  };
}

export function evaluateMockAssistantSignals(
  _payload: Record<string, unknown>,
): ConversationSignalsResponseData {
  return listMockAssistantSignals();
}

export function respondToMockAssistantSignal(payload: {
  signal_id: string;
  status?: "acknowledged" | "responded" | "dismissed";
}): AssistantSignalResponseData {
  mockSignalStore = mockSignalStore.map((signal) =>
    signal.signal_id === payload.signal_id
      ? {
          ...signal,
          status: payload.status ?? "responded",
          updated_at: new Date().toISOString(),
        }
      : signal,
  );

  return {
    signal_id: payload.signal_id,
    status: payload.status ?? "responded",
    feedback_recorded: true,
  };
}

export function buildMockConversationInvokeResponse(
  payload: ConversationRequestPayload & { operation?: string },
): ConversationEnvelopeResponse {
  const workbenchResponse = buildMockWorkbenchInvokeResponse({
    interface: "CHAT",
    message: payload.message,
    thread_id: payload.thread_id ?? null,
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
    semantic_view_name: payload.semantic_view_name ?? null,
    derived_source_lineage: payload.derived_source_lineage ?? null,
    datahub_context: payload.datahub_context ?? null,
    mapping_intent: (payload.mapping_intent as MappingIntent | null | undefined) ?? null,
  });

  return {
    contract_version: API_CONTRACT_VERSION,
    request_id: createRequestId(),
    operation: payload.operation ?? "conversation.ask",
    actor: workbenchResponse.actor,
    context: workbenchResponse.context,
    data: {
      status: "completed",
      route: "conversation",
      intent_class: "quick_answer",
      agent: workbenchResponse.data?.agent ?? "SOURCE_MAPPING_AGENT",
      message:
        workbenchResponse.data?.message ??
        workbenchResponse.message ??
        "Mock conversation response.",
      approval_required: false,
      artifact: workbenchResponse.data?.artifact ?? null,
      citations: [],
    },
    warnings: [],
    error: null,
    meta: { mode: "mock" },
  };
}

export { mockInvokeStream as mockConversationInvokeStream };
