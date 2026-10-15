import { ApiError } from '@/lib/api';
import { formatLimitMessage, isLimitExceeded } from '@/lib/limits';

/**
 * Extracts the most useful human-readable message from a thrown value.
 *
 * For an {@link ApiError}, prefers the server body's `message` field, then
 * `error` (routes return one or the other: trade errors send `{ code, message }`,
 * admin 409s send `{ error }`), falling back to `"<status> <statusText>"` with the
 * status written once.
 * For any other thrown value, returns its `Error.message` or `"Unknown error"`.
 * A {@link isLimitExceeded} body is rendered with {@link formatLimitMessage}.
 */
export function extractApiMessage(err: unknown): string {
  if (isLimitExceeded(err)) return formatLimitMessage(err.body);
  if (err instanceof ApiError) {
    const body = err.body;
    if (body && typeof body === 'object') {
      const rec = body as Record<string, unknown>;
      if (typeof rec['message'] === 'string') return rec['message'];
      if (typeof rec['error'] === 'string') return rec['error'];
    }
    // apiFetch's own message already leads with the status.
    if (err.message.startsWith(String(err.status))) return err.message;
    return `${err.status} ${err.message}`;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}
