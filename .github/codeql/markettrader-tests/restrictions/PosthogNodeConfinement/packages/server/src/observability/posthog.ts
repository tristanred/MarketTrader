import { PostHog } from 'posthog-node'; // OK: the owning module

export type AnalyticsClient = Pick<PostHog, 'capture' | 'captureException'>;

export function getPostHog(): PostHog {
  return new PostHog('key', { host: 'h' });
}
