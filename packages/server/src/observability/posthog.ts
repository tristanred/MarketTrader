import { PostHog } from 'posthog-node';
import { env, posthogEnabled } from '../env.js';

/**
 * The subset of the posthog-node client the app uses. Narrow on purpose so
 * tests can hand in a plain fake instead of a real client.
 */
export type AnalyticsClient = Pick<PostHog, 'capture' | 'captureException'>;

// Well inside the 10 s force-exit timer in index.ts, which also has to cover
// app.close() and the OTel flush.
const SHUTDOWN_TIMEOUT_MS = 3_000;

let client: PostHog | null | undefined;

/**
 * The process-wide posthog-node client, created on first use. `null` when
 * `POSTHOG_KEY`/`POSTHOG_HOST` are unset, and always under `NODE_ENV=test` so
 * neither the unit suite nor e2e runs post to a real project.
 */
export function getPostHog(): PostHog | null {
  if (client === undefined) {
    client =
      posthogEnabled && env.NODE_ENV !== 'test'
        ? new PostHog(env.POSTHOG_KEY, { host: env.POSTHOG_HOST })
        : null;
  }
  return client;
}

/** Flushes queued events and closes the client. Resolves at once when it never started. */
export async function shutdownPostHog(): Promise<void> {
  if (!client) return;
  const stopping = client;
  client = null;
  await stopping.shutdown(SHUTDOWN_TIMEOUT_MS);
}
