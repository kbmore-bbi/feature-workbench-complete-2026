import { createRequestId } from "@/api/axiosInstance";
import {
  API_CONTRACT_VERSION,
  type STTMBuilderEnvelopeResponse,
  type STTMIntent,
} from "@/types/api-contract";
import type { WorkbenchRequest } from "@/services/workbenchService";
import { mockSleep } from "@/services/mock/mockConfig";

export const mockWorkbenchInfo = {
  name: "STTM Builder (mock)",
  environment: "local-dev",
  version: "mock-1.0.0",
  api_base_path: "/api/v1",
  health_path: "/healthz",
};

let mockThreadCounter = 0;

function nextMockThreadId() {
  mockThreadCounter += 1;
  return `mock-thread-${mockThreadCounter.toString().padStart(4, "0")}`;
}

function buildEnvelope(
  payload: WorkbenchRequest,
  data: STTMBuilderEnvelopeResponse["data"],
  extras?: Partial<STTMBuilderEnvelopeResponse>,
): STTMBuilderEnvelopeResponse {
  const operation =
    payload.interface === "AUTO_MAP"
      ? "sttm.auto_map"
      : payload.interface === "TRANSFORM"
        ? "sttm.transform"
        : "sttm.chat";

  return {
    contract_version: API_CONTRACT_VERSION,
    request_id: createRequestId(),
    operation,
    actor: { user_id: "mock-dev", role: "PUBLISHER" },
    context: {
      thread_id: payload.thread_id ?? nextMockThreadId(),
      source_tables: payload.source_tables ?? null,
      driving_table: payload.driving_table ?? null,
      relationships: payload.relationships ?? null,
      semantic_context: payload.semantic_context ?? null,
      selected_columns_by_table: payload.selected_columns_by_table ?? null,
      surface: payload.surface ?? "SOURCE_SELECTION",
      semantic_level_requested: payload.semantic_level_requested ?? "L1_CONTEXT",
      target_table: payload.target_table ?? null,
      selected_derived_sources: payload.selected_derived_sources ?? null,
      semantic_bundle_id: payload.semantic_bundle_id ?? "mock-bundle-001",
      semantic_bundle_label: "Mock semantic bundle",
      semantic_view_name: payload.semantic_view_name ?? "MOCK_SEMANTIC_VIEW",
      derived_source_lineage: payload.derived_source_lineage ?? null,
      datahub_context: { status: "mock-unavailable" },
    },
    data,
    warnings: [],
    error: null,
    meta: { mode: "mock" },
    thread_id: payload.thread_id ?? nextMockThreadId(),
    agent: data.agent,
    result: data.result,
    message: data.message ?? null,
    ...extras,
  };
}

function buildMockAutoMapResponse(payload: WorkbenchRequest): STTMBuilderEnvelopeResponse {
  const attributes = payload.attributes ?? [];
  const sourceTable = payload.source_tables?.[0];
  const sourcePrefix = sourceTable
    ? `${sourceTable.database}.${sourceTable.schema}.${sourceTable.table}`
  : "SALES_DB.SALES_CORE.ORDERS";

  const mappings = Object.fromEntries(
    attributes.map((attribute, index) => [
      attribute.target_attribute,
      {
        source_attributes: [`${sourcePrefix}.${attribute.target_attribute}`],
        confidence_score: Math.max(0.55, 0.92 - index * 0.04),
      },
    ]),
  );

  return buildEnvelope(payload, {
    intent: "AUTO_MAP",
    status: "completed",
    agent: "SOURCE_MAPPING_AGENT",
    result: { mappings },
    message: "Mock auto-map completed using local dev data.",
    artifact_type: "source_mapping",
    semantic_level_achieved: payload.semantic_level_requested ?? "L3_MAPPING_ENRICHED",
    semantic_refresh_status: {
      bundle_id: payload.semantic_bundle_id ?? "mock-bundle-001",
      bundle_hash: "mock-bundle-hash",
      bundle_label: "Mock semantic bundle",
      requested_level: payload.semantic_level_requested ?? "L3_MAPPING_ENRICHED",
      achieved_level: payload.semantic_level_requested ?? "L3_MAPPING_ENRICHED",
      status: "ready",
      semantic_view_name: payload.semantic_view_name ?? "MOCK_SEMANTIC_VIEW",
      promoted: false,
      cache_hit: true,
    },
  });
}

function buildMockChatResponse(payload: WorkbenchRequest): STTMBuilderEnvelopeResponse {
  const message = payload.message?.trim() || "Hello";
  const lowered = message.toLowerCase();
  const isDerivedSourceAsk =
    lowered.includes("derived source") ||
    lowered.includes("create derived") ||
    lowered.includes("sql view");

  if (isDerivedSourceAsk) {
    return buildEnvelope(payload, {
      intent: "CHAT",
      status: "completed",
      agent: "SOURCE_MAPPING_AGENT",
      result: null,
      message: "Here is a mock derived-source draft you can review in the builder.",
      artifact_type: "derived_source_draft",
      artifact: {
        sql_text:
          "SELECT c.CUSTOMER_ID, c.CUSTOMER_NAME, COUNT(o.ORDER_ID) AS ORDER_COUNT\nFROM SALES_DB.SALES_CORE.CUSTOMERS c\nLEFT JOIN SALES_DB.SALES_CORE.ORDERS o ON c.CUSTOMER_ID = o.CUSTOMER_ID\nGROUP BY 1, 2",
        source_name_suggestion: "Customer Order Summary",
        semantic_view_name: "MOCK_CUSTOMER_ORDER_SUMMARY",
        preview_rows: [{ CUSTOMER_ID: 1, CUSTOMER_NAME: "Acme Corp", ORDER_COUNT: 3 }],
        selected_columns_by_table: {
          "SALES_DB.SALES_CORE.CUSTOMERS": ["CUSTOMER_ID", "CUSTOMER_NAME"],
          "SALES_DB.SALES_CORE.ORDERS": ["ORDER_ID"],
        },
      },
      semantic_level_achieved: payload.semantic_level_requested ?? "L2_ANALYST_READY",
      semantic_refresh_status: {
        bundle_id: payload.semantic_bundle_id ?? "mock-bundle-001",
        bundle_hash: "mock-bundle-hash",
        bundle_label: "Mock semantic bundle",
        requested_level: payload.semantic_level_requested ?? "L2_ANALYST_READY",
        achieved_level: payload.semantic_level_requested ?? "L2_ANALYST_READY",
        status: "ready",
        semantic_view_name: payload.semantic_view_name ?? "MOCK_SEMANTIC_VIEW",
        promoted: false,
        cache_hit: true,
      },
    });
  }

  return buildEnvelope(payload, {
    intent: "CHAT",
    status: "completed",
    agent: "SOURCE_MAPPING_AGENT",
    result: null,
    message: `Mock STTM agent reply: I received "${message}". Select source tables and open mapping to try auto-map with local data.`,
    artifact_type: "analyst_answer",
    semantic_level_achieved: payload.semantic_level_requested ?? "L1_CONTEXT",
    semantic_refresh_status: {
      bundle_id: payload.semantic_bundle_id ?? "mock-bundle-001",
      bundle_hash: "mock-bundle-hash",
      bundle_label: "Mock semantic bundle",
      requested_level: payload.semantic_level_requested ?? "L1_CONTEXT",
      achieved_level: payload.semantic_level_requested ?? "L1_CONTEXT",
      status: "ready",
      semantic_view_name: payload.semantic_view_name ?? "MOCK_SEMANTIC_VIEW",
      promoted: false,
      cache_hit: true,
    },
  });
}

export function buildMockWorkbenchInvokeResponse(
  payload: WorkbenchRequest,
): STTMBuilderEnvelopeResponse {
  if (payload.interface === "AUTO_MAP") {
    return buildMockAutoMapResponse(payload);
  }
  if (payload.interface === "TRANSFORM") {
    return buildEnvelope(payload, {
      intent: "TRANSFORM",
      status: "completed",
      agent: "TRANSFORMATION_AGENT",
      result: {
        rules: (payload.attributes ?? []).map((attribute) => ({
          target_attribute: attribute.target_attribute,
          rule: `MOCK_TRANSFORM(${attribute.target_attribute})`,
          description: "Mock transformation rule for local development.",
        })),
      },
      message: "Mock transformation rules generated.",
      artifact_type: "transformation_rules",
    });
  }
  return buildMockChatResponse(payload);
}

export async function* mockInvokeStream(payload: WorkbenchRequest): AsyncGenerator<
  | { event: "status"; data: Record<string, unknown> }
  | { event: "delta"; data: { text: string } }
  | { event: "suggestions"; data: { items: string[] } }
  | { event: "final"; data: STTMBuilderEnvelopeResponse }
  | { event: "error"; data: { message?: string; code?: string } }
> {
  yield { event: "status", data: { message: "Preparing mock STTM agent response..." } };
  await mockSleep(250);

  const finalResponse = buildMockWorkbenchInvokeResponse(payload);
  const streamText =
    finalResponse.message ??
    finalResponse.data?.message ??
    "Mock STTM agent completed.";

  for (const token of streamText.split(/(\s+)/).filter(Boolean)) {
    yield { event: "delta", data: { text: token } };
    await mockSleep(35);
  }

  if (payload.interface === "CHAT" && !payload.target_table) {
    yield {
      event: "suggestions",
      data: {
        items: [
          "Create a derived source for selected tables",
          "Show relationships between selected tables",
          "Summarize the selected source tables",
        ],
      },
    };
  }

  yield { event: "final", data: finalResponse };
}

export type { STTMIntent };
