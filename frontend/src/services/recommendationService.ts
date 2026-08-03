import api from "@/api/axiosInstance";
import { API_ROUTES } from "@/api/routes";
import type {
  FIRRecommendation,
  FIRRecommendationEvaluationResponse,
  WorkbenchContextSnapshotV2,
} from "@/types/api-contract";

const RECOMMENDATION_CACHE_TTL_MS = 60_000;
const evaluationCache = new Map<
  string,
  { data: FIRRecommendationEvaluationResponse; expiresAt: number }
>();
const evaluationRequests = new Map<string, Promise<FIRRecommendationEvaluationResponse>>();

export type ApplicableRecommendation = {
  recommendation_id: string;
  recommendation_version: number;
  workflow_stage?: string | null;
  target_entity: Record<string, unknown>;
  title: string;
  business_rationale?: string | null;
  confidence?: number | null;
  compatibility_tier?: number | null;
  candidate_sources: Array<Record<string, unknown>>;
  missing_dependencies: string[];
  evidence_summary?: string | null;
  action_kind?: string | null;
  action_payload: Record<string, unknown>;
  preconditions: Array<Record<string, unknown>>;
  expected_workspace_hash?: string | null;
  requires_confirmation: boolean;
  can_apply: boolean;
  blocked_reasons: string[];
  validation_plan: string[];
};

export type RecommendationPreview = {
  recommendation: ApplicableRecommendation;
  before_workspace_hash: string;
  after_workspace_hash: string;
  workspace_diff: Array<{
    op: "add" | "remove" | "replace";
    path: string;
    before?: unknown;
    after?: unknown;
  }>;
  validation_impact: string[];
  can_apply: boolean;
  blocked_reasons: string[];
};

type RecommendationWorkspaceRequest = {
  sttm_id: string;
  workspace_snapshot: Record<string, unknown>;
  expected_workspace_hash: string;
  action_id?: string | null;
};

function evaluationKey(
  workspaceContext: WorkbenchContextSnapshotV2,
  checkpoint?: string | null,
  projectId?: string | null,
): string {
  return [
    projectId ?? workspaceContext.project_id ?? "",
    workspaceContext.sttm_id ?? "",
    workspaceContext.snapshot_id ?? "",
    workspaceContext.context_key,
    checkpoint ?? workspaceContext.checkpoint ?? workspaceContext.milestone ?? "",
  ].join("::");
}

export const recommendationService = {
  listApplicable: async (options: {
    projectId: string;
    sttmId: string;
    contextKey?: string | null;
    scopeKey?: string | null;
    workflowStage?: string | null;
    targetColumns?: string[];
    limit?: number;
    signal?: AbortSignal;
  }): Promise<ApplicableRecommendation[]> => {
    const response = await api.get(API_ROUTES.workbench.recommendations, {
      params: {
        project_id: options.projectId,
        sttm_id: options.sttmId,
        context_key: options.contextKey || undefined,
        scope_key: options.scopeKey || undefined,
        workflow_stage: options.workflowStage || undefined,
        target_columns: options.targetColumns,
        limit: options.limit ?? 50,
      },
      paramsSerializer: { indexes: null },
      signal: options.signal,
      timeout: 90_000,
    });
    return response.data as ApplicableRecommendation[];
  },

  preview: async (
    recommendationId: string,
    payload: RecommendationWorkspaceRequest,
  ): Promise<RecommendationPreview> => {
    const response = await api.post(
      API_ROUTES.workbench.recommendationPreview(recommendationId),
      payload,
      { timeout: 120_000 },
    );
    return response.data as RecommendationPreview;
  },

  apply: async (
    recommendationId: string,
    payload: RecommendationWorkspaceRequest & {
      idempotency_key: string;
      confirmed?: boolean;
    },
  ): Promise<RecommendationPreview & {
    status: "applied" | "already_applied" | "no_change";
    action_history_id: string;
    snapshot_id?: string | null;
  }> => {
    const response = await api.post(
      API_ROUTES.workbench.recommendationApply(recommendationId),
      payload,
      { timeout: 120_000 },
    );
    return response.data;
  },

  undo: async (
    recommendationId: string,
    payload: {
      sttm_id: string;
      action_history_id: string;
      expected_workspace_hash: string;
      idempotency_key: string;
    },
  ) => {
    const response = await api.post(
      API_ROUTES.workbench.recommendationUndo(recommendationId),
      payload,
      { timeout: 120_000 },
    );
    return response.data as {
      status: "undone" | "already_undone";
      action_history_id: string;
      workspace_hash: string;
      snapshot_id?: string | null;
    };
  },

  recordApplicableFeedback: async (
    recommendationId: string,
    payload: {
      outcome: "accepted" | "rejected" | "corrected";
      idempotency_key: string;
      sttm_id?: string | null;
      context_key?: string | null;
      snapshot_id?: string | null;
      reason?: string | null;
      correction?: Record<string, unknown> | null;
    },
  ) => {
    const response = await api.post(
      API_ROUTES.workbench.recommendationFeedback(recommendationId),
      payload,
      { timeout: 120_000 },
    );
    return response.data as {
      status: "recorded";
      recommendation_id: string;
      outcome_id: string;
    };
  },

  evaluate: async (
    workspaceContext: WorkbenchContextSnapshotV2,
    options?: { checkpoint?: string | null; projectId?: string | null; signal?: AbortSignal },
  ): Promise<FIRRecommendationEvaluationResponse> => {
    const checkpoint = options?.checkpoint ?? workspaceContext.checkpoint ?? workspaceContext.milestone;
    const projectId = options?.projectId ?? workspaceContext.project_id;
    const key = evaluationKey(workspaceContext, checkpoint, projectId);
    const cached = evaluationCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const pending = evaluationRequests.get(key);
    if (pending) return pending;
    const request = api.post(
      "/v1/recommendations/evaluate",
      {
        workspace_context: workspaceContext,
        checkpoint,
        project_id: projectId,
        limit: 20,
        include_search_fallback: true,
        include_evidence: false,
      },
      {
        timeout: 90000,
        signal: options?.signal,
        // Checkpoint evaluation is background guidance. A slow FIR lookup must
        // never interrupt table selection with a blocking application dialog.
        skipGlobalError: true,
      },
    )
      .then((response) => {
        const data = response.data as FIRRecommendationEvaluationResponse;
        evaluationCache.set(key, {
          data,
          expiresAt: Date.now() + RECOMMENDATION_CACHE_TTL_MS,
        });
        return data;
      })
      .finally(() => evaluationRequests.delete(key));
    evaluationRequests.set(key, request);
    return request;
  },

  get: async (recommendationId: string): Promise<FIRRecommendation> => {
    const response = await api.get(
      `/v1/recommendations/${encodeURIComponent(recommendationId)}`,
      { timeout: 90000 },
    );
    return response.data as FIRRecommendation;
  },

  recordOutcome: async (
    recommendationId: string,
    payload: {
      outcome_type: string;
      context_key?: string | null;
      snapshot_id?: string | null;
      user_id?: string | null;
      payload?: Record<string, unknown>;
    },
  ) => {
    await api.post(`/v1/recommendations/${encodeURIComponent(recommendationId)}/outcomes`, payload, {
      timeout: 120000,
      skipGlobalError: true,
    });
  },

  recordShownOutcomes: async (
    items: Array<{
      recommendation_id: string;
      context_key?: string | null;
      snapshot_id?: string | null;
      user_id?: string | null;
      payload?: Record<string, unknown>;
    }>,
  ) => {
    if (!items.length) return;
    await api.post(
      "/v1/recommendations/outcomes/batch",
      {
        items: items.map((item) => ({ ...item, outcome_type: "shown" })),
      },
      { timeout: 180000, skipGlobalError: true },
    );
  },
};
