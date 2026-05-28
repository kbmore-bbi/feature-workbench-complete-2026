import { parseAppError, type AppError, type AppErrorParseOverrides, type AppErrorPayload } from './app-error';

type ErrorListener = (payload: AppErrorPayload | null) => void;

let activeListener: ErrorListener | null = null;
const errorQueue: AppErrorPayload[] = [];

function emitCurrentError() {
  activeListener?.(errorQueue[0] ?? null);
}

export function publishAppErrorPayload(payload: AppErrorPayload) {
  errorQueue.push(payload);
  emitCurrentError();
}

export function registerGlobalErrorListener(listener: ErrorListener) {
  activeListener = listener;
  emitCurrentError();
  return () => {
    if (activeListener === listener) {
      activeListener = null;
    }
  };
}

export function dismissGlobalError() {
  errorQueue.shift();
  emitCurrentError();
}

export function showAppError(
  error: unknown,
  overrides: AppErrorParseOverrides = {},
): AppError {
  const appError = parseAppError(error, overrides);
  publishAppErrorPayload(appError.payload);
  return appError;
}

/** Report a non-API application error through the same global dialog. */
export function reportApplicationError(
  payload: AppErrorParseOverrides & Pick<AppErrorPayload, 'message'>,
): AppError {
  return showAppError(null, {
    source: 'application',
    title: payload.title ?? 'Application error',
    icon: payload.icon ?? 'error',
    ...payload,
  });
}

export function handleApiClientError(
  error: unknown,
  overrides: AppErrorParseOverrides = {},
  options: { silent?: boolean } = {},
): AppError {
  const appError = parseAppError(error, overrides);
  if (!options.silent) {
    publishAppErrorPayload(appError.payload);
  }
  return appError;
}
