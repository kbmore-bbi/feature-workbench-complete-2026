import api from "@/api/axiosInstance";
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
