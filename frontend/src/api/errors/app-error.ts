import type { ApiError } from '@/types/api-contract';

export type AppErrorIcon = 'error' | 'warning' | 'info';

export type AppErrorPayload = {
  title: string;
  message: string;
  subHeader?: string;
  subMessage?: string;
  icon?: AppErrorIcon;
  statusCode?: number;
  code?: string;
  source?: 'api' | 'application';
};

export type AppErrorParseOverrides = Partial<AppErrorPayload> & {
  fallbackMessage?: string;
};

export class AppError extends Error {
  readonly payload: AppErrorPayload;

  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.name = 'AppError';
    this.payload = payload;
  }
}

const DEFAULT_ERROR_TITLE = 'Something went wrong';
const DEFAULT_ERROR_MESSAGE = 'An unexpected error occurred. Please try again.';

function readEnvelopeError(data: unknown): ApiError | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const envelopeError = (data as { error?: ApiError | null }).error;
  if (envelopeError && typeof envelopeError === 'object') {
    return envelopeError;
  }

  return null;
}

function iconForStatus(status?: number): AppErrorIcon {
  if (!status) {
    return 'error';
  }
  if (status >= 500) {
    return 'error';
  }
  if (status >= 400) {
    return 'warning';
  }
  return 'info';
}

export function parseAppError(
  error: unknown,
  overrides: AppErrorParseOverrides = {},
): AppError {
  if (error instanceof AppError) {
    if (Object.keys(overrides).length === 0) {
      return error;
    }
    return new AppError({ ...error.payload, ...overrides });
  }

  let statusCode: number | undefined;
  let responseData: unknown;
  let source: AppErrorPayload['source'] = overrides.source ?? 'application';

  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { status?: number; data?: unknown } }).response;
    statusCode = response?.status;
    responseData = response?.data;
    source = 'api';
  }

  const envelopeError = readEnvelopeError(responseData);
  const plainMessage =
    typeof responseData === 'object' &&
    responseData !== null &&
    typeof (responseData as { message?: unknown }).message === 'string'
      ? String((responseData as { message?: string }).message)
      : undefined;

  const title =
    overrides.title ??
    envelopeError?.title ??
    (statusCode ? `Request failed (${statusCode})` : DEFAULT_ERROR_TITLE);

  const message =
    overrides.message ??
    envelopeError?.detail ??
    plainMessage ??
    (error instanceof Error ? error.message : undefined) ??
    overrides.fallbackMessage ??
    DEFAULT_ERROR_MESSAGE;

  const subHeader =
    overrides.subHeader ??
    (envelopeError?.type ? String(envelopeError.type) : undefined) ??
    (statusCode && statusCode >= 400 ? 'API request error' : undefined);

  const subMessage =
    overrides.subMessage ??
    (envelopeError?.code ? `Error code: ${envelopeError.code}` : undefined) ??
    (envelopeError?.field ? `Field: ${envelopeError.field}` : undefined);

  const payload: AppErrorPayload = {
    title,
    message,
    subHeader,
    subMessage,
    icon: overrides.icon ?? iconForStatus(statusCode),
    statusCode,
    code: overrides.code ?? envelopeError?.code ?? undefined,
    source,
  };

  return new AppError(payload);
}

/** Lightweight message extraction for inline UI — avoids building full dialog payload. */
export function extractApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.payload.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'response' in error) {
    const data = (error as { response?: { data?: unknown } }).response?.data;
    const envelopeError = readEnvelopeError(data);
    if (envelopeError?.detail) {
      return envelopeError.detail;
    }
    if (envelopeError?.title) {
      return envelopeError.title;
    }
    if (
      typeof data === 'object' &&
      data !== null &&
      typeof (data as { message?: unknown }).message === 'string'
    ) {
      return String((data as { message?: string }).message);
    }
  }

  return fallback;
}
