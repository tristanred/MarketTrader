const key = import.meta.env.VITE_POSTHOG_KEY;
const apiHost = import.meta.env.VITE_POSTHOG_HOST;

/**
 * Whether this bundle sends anything to PostHog. Off unless both build-time vars
 * are set — the same "unset means silently off" rule as `VITE_OTEL_EXPORTER_URL`
 * — and always off under Vitest, which reads the root `.env` and would otherwise
 * post the suite's activity to the real project.
 *
 * Lives apart from `posthog.ts` so that reading it never pulls the SDK into the
 * importing chunk.
 */
export const posthogEnabled = Boolean(key && apiHost) && import.meta.env.MODE !== 'test';

/** Init values for posthog-js; only meaningful when {@link posthogEnabled}. */
export const posthogConfig = {
  key: key ?? '',
  /** Normally the same-origin `/relay` proxy, so ad blockers and the CSP see first-party traffic. */
  apiHost: apiHost ?? '',
  /** Where toolbar and "view in PostHog" links point; never proxied. */
  uiHost: import.meta.env.VITE_POSTHOG_UI_HOST || 'https://us.posthog.com',
} as const;
