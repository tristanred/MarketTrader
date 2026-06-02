import { ApiError } from '@/lib/api';

/**
 * Extracts the most useful human-readable message from a thrown value.
 *
 * For an {@link ApiError}, prefers the server body's `message` field, then
 * `error` (routes return one or the other: trade errors send `{ code, message }`,
 * admin 409s send `{ error }`), falling back to `"<status> <statusText>"`.
 * For any other thrown value, returns its `Error.message` or `"Unknown error"`.
 */
export function extractApiMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body;
    if (body && typeof body === 'object') {
      const rec = body as Record<string, unknown>;
      if (typeof rec['message'] === 'string') return rec['message'];
      if (typeof rec['error'] === 'string') return rec['error'];
    }
    return `${err.status} ${err.message}`;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}
