import axios from 'axios';
import type { ApiEnvelope } from '@/types/api-contract';
import { API_CONTRACT_VERSION } from '@/types/api-contract';

export function resolveApiBaseUrl() {
  if (typeof window !== "undefined") {
    const currentHost = window.location.hostname;
    const isLocalBrowser =
      currentHost === "localhost" || currentHost === "127.0.0.1";
    if (isLocalBrowser) {
      const directOrigin =
        process.env.NEXT_PUBLIC_BACKEND_DEV_ORIGIN?.trim() ||
        "http://127.0.0.1:8000";
      return `${directOrigin.replace(/\/$/, "")}/api`;
    }
  }
  return "/api";
}

const api = axios.create({
  // In local browser development, bypass the Next dev proxy because long-running
  // AI requests can be interrupted by the proxy even when the backend succeeds.
  // In deployed environments, continue using the relative path for NGINX/SPCS routing.
  baseURL: resolveApiBaseUrl(),
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
});

// Response interceptor for global error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = String(error?.config?.url ?? "");
    const isAssistantSignalEvaluate = requestUrl.includes("/conversation/signals/evaluate");
    if (axios.isCancel(error) || error?.code === "ERR_CANCELED" || error?.name === "CanceledError") {
      return Promise.reject(error);
    }
    const isTimeout = error?.code === "ECONNABORTED" || String(error?.message ?? "").toLowerCase().includes("timeout");
    if (isAssistantSignalEvaluate) {
      return Promise.reject(error);
    }
    console.error('Global API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;

export function unwrapApiResponse<T>(payload: T | ApiEnvelope<unknown, T>): T {
  if (
    payload &&
    typeof payload === "object" &&
    ("contract_version" in payload || "schema_version" in payload) &&
    "data" in payload
  ) {
    return (payload as ApiEnvelope<unknown, T>).data;
  }

  return payload as T;
}

export function createRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildApiEnvelope<TData, TContext = Record<string, unknown>>(
  operation: string,
  data: TData,
  context?: TContext,
): ApiEnvelope<TContext, TData> {
  return {
    contract_version: API_CONTRACT_VERSION,
    request_id: createRequestId(),
    operation,
    actor: null,
    context: (context ?? {}) as TContext,
    data,
    warnings: [],
    error: null,
    meta: {},
  };
}

export async function getApiData<T>(url: string, config?: object): Promise<T> {
  const response = await api.get<T | ApiEnvelope<unknown, T>>(url, config);
  return unwrapApiResponse(response.data);
}

export async function postApiData<TRequest, TResponse>(
  url: string,
  body: TRequest,
  config?: object,
): Promise<TResponse> {
  const response = await api.post<TResponse | ApiEnvelope<unknown, TResponse>>(url, body, config);
  return unwrapApiResponse(response.data);
}

export async function postEnvelopeData<TResponse>(
  url: string,
  body: ApiEnvelope<unknown, unknown>,
  config?: object,
): Promise<TResponse> {
  const response = await api.post<TResponse | ApiEnvelope<unknown, TResponse>>(url, body, config);
  return unwrapApiResponse(response.data);
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: unknown } }).response;
    const data = response?.data;
    if (typeof data === "object" && data !== null) {
      const envelopeError = (data as { error?: { detail?: unknown; title?: unknown } }).error;
      if (typeof envelopeError?.detail === "string" && envelopeError.detail) {
        return envelopeError.detail;
      }
      if (typeof envelopeError?.title === "string" && envelopeError.title) {
        return envelopeError.title;
      }
      if (typeof (data as { message?: unknown }).message === "string") {
        return String((data as { message?: unknown }).message);
      }
    }
  }

  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return fallback;
}
