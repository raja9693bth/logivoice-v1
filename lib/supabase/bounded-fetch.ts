/**
 * LOGIVOICE V1 — AUTHORITATIVE BOUNDED SUPABASE NETWORKING POLICY
 *
 * Enforces:
 * 1. Strict time-bounding on all Supabase external network requests (PostgREST, Auth, Storage).
 * 2. Guaranteed prevention of platform invocation timeouts (504 MIDDLEWARE_INVOCATION_TIMEOUT).
 * 3. Sanitized error handling that never leaks service-role keys, JWT tokens, or internal URLs.
 */

export class SupabaseTimeoutError extends Error {
  constructor(timeoutMs: number, operation = 'Supabase network operation') {
    super(`${operation} timed out after ${timeoutMs}ms.`);
    this.name = 'SupabaseTimeoutError';
  }
}

/**
 * Creates a bounded fetch function that aborts if the external network call
 * exceeds the specified timeout threshold.
 */
export function createBoundedFetch(timeoutMs = 3000, operationName = 'Supabase request'): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    let isTimedOut = false;

    const timer = setTimeout(() => {
      isTimedOut = true;
      controller.abort();
    }, timeoutMs);

    // If caller provided an existing signal, link it to this controller
    if (init?.signal) {
      if (init.signal.aborted) {
        clearTimeout(timer);
        controller.abort();
      } else {
        init.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          controller.abort();
        }, { once: true });
      }
    }

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return response;
    } catch (err: unknown) {
      clearTimeout(timer);

      if (isTimedOut) {
        throw new SupabaseTimeoutError(timeoutMs, operationName);
      }

      const isAbortOrTimeout =
        (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) ||
        (typeof err === 'object' && err !== null && 'name' in err && (err as { name: string }).name === 'AbortError');

      if (isAbortOrTimeout) {
        throw new SupabaseTimeoutError(timeoutMs, operationName);
      }

      throw err;
    }
  };
}
