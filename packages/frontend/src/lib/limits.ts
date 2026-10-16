import type { LimitExceededBody } from '@markettrader/shared';
import { ApiError } from '@/lib/api';

/** True when the server refused a request with a `LIMIT_EXCEEDED` body. */
export function isLimitExceeded(err: unknown): err is ApiError & { body: LimitExceededBody } {
  if (!(err instanceof ApiError)) return false;
  const b = err.body;
  return (
    typeof b === 'object' &&
    b !== null &&
    (b as Record<string, unknown>)['code'] === 'LIMIT_EXCEEDED' &&
    typeof (b as Record<string, unknown>)['error'] === 'string'
  );
}

const UNITS: ReadonlyArray<[seconds: number, name: string]> = [
  [86_400, 'day'],
  [3_600, 'hour'],
  [60, 'minute'],
];

/** "in 45 seconds", "in 3 minutes", "in 2 days" — rounded up, so it never promises too early. */
export function formatRetryAfter(seconds: number): string {
  for (const [size, name] of UNITS) {
    if (seconds >= size) {
      const n = Math.ceil(seconds / size);
      return `in ${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  const n = Math.max(1, Math.ceil(seconds));
  return `in ${n} second${n === 1 ? '' : 's'}`;
}

/**
 * One readable sentence (or three) for a limit refusal: what was hit, when to
 * retry, and — for accounts still on probation — why their limit is lower.
 */
export function formatLimitMessage(body: LimitExceededBody): string {
  const parts = [body.error.endsWith('.') ? body.error : `${body.error}.`];
  if (body.retryAfterSeconds !== undefined) {
    parts.push(`You can try again ${formatRetryAfter(body.retryAfterSeconds)}.`);
  }
  if (body.probation) {
    const span = body.maturityDays === undefined ? 'few' : String(body.maturityDays);
    parts.push(`New accounts have lower limits for their first ${span} days.`);
  }
  return parts.join(' ');
}
