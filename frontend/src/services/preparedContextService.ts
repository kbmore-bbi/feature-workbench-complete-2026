import { API_ROUTES } from "@/api/routes";
import {
  buildApiEnvelope,
  getApiData,
  postEnvelopeData,
} from "@/api/axiosInstance";

export type PreparedContextStatus = "ready" | "updating" | "partial" | "failed";

export type PreparedWorkspaceContext = {
  workspace_context_id: string;
  workspace_context_hash: string;
  workspace_version: string;
  semantic_bundle_id?: string | null;
  semantic_bundle_hash?: string | null;
  semantic_registry_version?: string | null;
  semantic_projection_ids?: string[];
  learning_context_id?: string | null;
  learning_context_hash?: string | null;
  fir_epoch?: string | null;
  precedent_version?: string | null;
  correction_version?: string | null;
  artifact_refs?: Array<Record<string, unknown>>;
  status: PreparedContextStatus;
  cache_status: string;
  readiness?: Record<string, boolean>;
  stage_timings_ms?: Record<string, number>;
  warnings?: string[];
  created_at?: string | null;
  updated_at?: string | null;
};

export type PrepareWorkspaceContextRequest = {
  workspace: Record<string, unknown>;
  workspace_context_id?: string | null;
  workspace_context_hash?: string | null;
  semantic_bundle_id?: string | null;
  semantic_bundle_hash?: string | null;
  learning_context_id?: string | null;
  learning_context_hash?: string | null;
  semantic_registry_version?: string | null;
  fir_epoch?: string | null;
  precedent_version?: string | null;
  correction_version?: string | null;
  force?: boolean;
};

const inflight = new Map<string, Promise<PreparedWorkspaceContext>>();

function stableRequestKey(payload: PrepareWorkspaceContextRequest): string {
  const workspace = payload.workspace as {
    source_set_hash?: string;
    derived_set_hash?: string;
    project_id?: string;
    sttm_id?: string;
  };
  const stableWorkspace = { ...payload.workspace };
  [
    "context_hash",
    "context_key",
    "captured_at",
    "action",
    "milestone",
    "conversation_history",
    "conversation_messages",
  ].forEach((field) => delete stableWorkspace[field]);
  return [
    workspace.source_set_hash ?? "",
    workspace.derived_set_hash ?? "",
    JSON.stringify(stableWorkspace),
    workspace.project_id ?? "",
    workspace.sttm_id ?? "",
    payload.semantic_registry_version ?? "",
    payload.fir_epoch ?? "",
    payload.precedent_version ?? "",
    payload.correction_version ?? "",
    payload.force ? "force" : "cached",
  ].join("|");
}

export const preparedContextService = {
  prepare(payload: PrepareWorkspaceContextRequest): Promise<PreparedWorkspaceContext> {
    const key = stableRequestKey(payload);
    const existing = inflight.get(key);
    if (existing) return existing;

    const request = postEnvelopeData<PreparedWorkspaceContext>(
      API_ROUTES.workbench.contextPrepare,
      buildApiEnvelope("workbench.context.prepare", payload, {}),
      { timeout: 300000 },
    ).finally(() => {
      if (inflight.get(key) === request) inflight.delete(key);
    });
    inflight.set(key, request);
    return request;
  },

  get(contextId: string): Promise<PreparedWorkspaceContext> {
    return getApiData<PreparedWorkspaceContext>(
      API_ROUTES.workbench.contextStatus(contextId),
      {
        timeout: 30000,
        // A compact browser handle can legitimately be stale after a backend
        // restart or access-scope change. The provider silently discards it
        // and prepares the current snapshot again.
        skipGlobalError: true,
      },
    );
  },
};
