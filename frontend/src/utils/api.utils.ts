/**
 * Central API utilities — import URLs, HTTP client, and error helpers from here.
 */
export { API_ROUTES } from '@/api/routes';
export type { ApiRouteGroup } from '@/api/routes';

export { apiClient, apiRequest } from '@/api/api-client';
export type { ApiRequestOptions, ApiErrorHandlingOptions, HttpMethod } from '@/api/axios.types';

export {
  buildApiEnvelope,
  createRequestId,
  getApiData,
  getApiErrorMessage,
  postApiData,
  postEnvelopeData,
  resolveApiBaseUrl,
  unwrapApiResponse,
} from '@/api/axiosInstance';

export { AppError, extractApiErrorMessage, parseAppError } from '@/api/errors/app-error';
export type { AppErrorIcon, AppErrorPayload } from '@/api/errors/app-error';

export {
  dismissGlobalError,
  reportApplicationError,
  showAppError,
} from '@/api/errors/error-bus';

export { default as api } from '@/api/axiosInstance';
