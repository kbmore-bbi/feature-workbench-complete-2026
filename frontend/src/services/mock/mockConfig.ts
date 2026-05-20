/** Dev-only: use local fixtures instead of Snowflake / backend APIs. */
export const useMockDb = process.env.NEXT_PUBLIC_USE_MOCK_DB === "true";

/** Dev-only: force mock service methods to throw (error-path testing). */
export const forceMockError = process.env.NEXT_PUBLIC_MOCK_DB_ERROR === "true";

export function throwMockError(): void {
  if (forceMockError) {
    throw new Error("Mock database API failed");
  }
}

export function mockDelay<T>(data: T, delay = 500): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(data), delay);
  });
}

export function mockSleep(delay = 200): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delay);
  });
}
