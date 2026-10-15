import { PostHog } from 'posthog-node'; // BAD: only observability/posthog.ts imports the SDK
import { getPostHog } from '../observability/posthog';

export function placeTrade() {
  const ph = getPostHog();
  ph.capture({ distinctId: 'u', event: 'trade' }); // BAD: capture outside analytics.ts
  ph.captureException(new Error('x')); // BAD: captureException outside error-capture.ts
  return PostHog;
}
