import type { AxiosRequestConfig } from 'axios';
import type { ApiEnvelope } from '@/types/api-contract';
import api, { unwrapApiResponse } from './axiosInstance';
import type { ApiRequestOptions, HttpMethod } from './axios.types';

function toAxiosConfig(options: ApiRequestOptions): AxiosRequestConfig {
  const { errorHandling, axiosConfig, unwrap: _unwrap, ...rest } = options;

  return {
    ...axiosConfig,
    method: rest.method,
    url: rest.url,
    data: rest.data,
    params: rest.params,
    headers: rest.headers,
    timeout: rest.timeout,
    skipGlobalError: errorHandling?.silent ?? axiosConfig?.skipGlobalError,
    errorTitle: errorHandling?.title ?? axiosConfig?.errorTitle,
    errorSubHeader: errorHandling?.subHeader ?? axiosConfig?.errorSubHeader,
    fallbackErrorMessage:
      errorHandling?.fallbackMessage ?? axiosConfig?.fallbackErrorMessage,
  };
}

export async function apiRequest<T>(options: ApiRequestOptions): Promise<T> {
  const shouldUnwrap = options.unwrap !== false;
  const response = await api.request<T | ApiEnvelope<unknown, T>>(toAxiosConfig(options));
  return shouldUnwrap ? unwrapApiResponse(response.data) : (response.data as T);
}

function createMethodRequest(method: HttpMethod) {
  return async function request<T>(
    url: string,
    dataOrConfig?: unknown,
    config?: Omit<ApiRequestOptions, 'method' | 'url' | 'data'>,
  ): Promise<T> {
    const hasBody = method !== 'GET' && method !== 'DELETE' && method !== 'HEAD';
    const data = hasBody ? dataOrConfig : undefined;
    const requestConfig =
      hasBody
        ? config
        : (dataOrConfig as Omit<ApiRequestOptions, 'method' | 'url'> | undefined);

    return apiRequest<T>({
      ...requestConfig,
      method,
      url,
      data,
    });
  };
}

export const apiClient = {
  request: apiRequest,
  get: createMethodRequest('GET'),
  post: createMethodRequest('POST'),
  put: createMethodRequest('PUT'),
  patch: createMethodRequest('PATCH'),
  delete: createMethodRequest('DELETE'),

  postEnvelope<TResponse>(
    url: string,
    body: ApiEnvelope<unknown, unknown>,
    config?: Omit<ApiRequestOptions, 'method' | 'url' | 'data'>,
  ): Promise<TResponse> {
    return apiRequest<TResponse>({
      ...config,
      method: 'POST',
      url,
      data: body,
    });
  },
};
