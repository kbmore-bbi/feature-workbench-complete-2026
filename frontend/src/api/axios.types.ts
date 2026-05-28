import 'axios';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** When true, suppresses the global error dialog for this request. */
    skipGlobalError?: boolean;
    /** Optional title override for the global error dialog. */
    errorTitle?: string;
    /** Optional sub-header (subtitle) for the global error dialog. */
    errorSubHeader?: string;
    /** Fallback message when the error payload cannot be parsed. */
    fallbackErrorMessage?: string;
  }
}

export type ApiErrorHandlingOptions = {
  silent?: boolean;
  title?: string;
  subHeader?: string;
  fallbackMessage?: string;
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type ApiRequestOptions = {
  method?: HttpMethod;
  url: string;
  data?: unknown;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  timeout?: number;
  unwrap?: boolean;
  errorHandling?: ApiErrorHandlingOptions;
  axiosConfig?: Omit<import('axios').AxiosRequestConfig, 'method' | 'url' | 'data' | 'params' | 'headers' | 'timeout'>;
};
