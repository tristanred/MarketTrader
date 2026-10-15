import type { AnalyticsClient } from './posthog';

export function onError(posthog: AnalyticsClient | null, err: Error) {
  posthog?.captureException(err, 'user'); // OK: the error hook
}
