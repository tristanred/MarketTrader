import type { PostHog } from 'posthog-js'; // OK: type-only in the facade
import { type Properties } from 'posthog-js'; // OK: every specifier is a type
import posthogStatic from 'posthog-js'; // BAD: static value import defeats lazy loading

let client: PostHog | null = null;

export function loadPostHog(): Promise<void> {
  // OK: the lazy load is the point of the facade.
  return import('posthog-js').then((m) => {
    client = m.default;
  });
}

export function capture(event: string, props?: Properties) {
  client?.capture(event, props);
  return posthogStatic;
}
