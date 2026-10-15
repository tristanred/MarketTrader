import type { AnalyticsClient } from './posthog';

export function track(posthog: AnalyticsClient, distinctId: string, event: string) {
  posthog.capture({ distinctId, event }); // OK: the EventBus subscriber
}
