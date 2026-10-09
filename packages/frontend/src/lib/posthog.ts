import type { PostHog, Properties } from 'posthog-js';
import type { AuthUser } from '@markettrader/shared';
import { buildInfo } from '../build-info';
import { posthogConfig, posthogEnabled } from './posthogConfig';

type PendingCall = (client: PostHog) => void;
type LogLevel = 'info' | 'warn' | 'error';

// posthog-js is ~100 kB gzip, so it loads in its own chunk after first render,
// like the OTel SDK. Calls made before it arrives are replayed in order; the cap
// keeps a chunk that never loads from growing this for the life of the tab.
const MAX_PENDING = 200;
const pending: PendingCall[] = [];
let client: PostHog | null = null;
let loading: Promise<void> | null = null;

function run(call: PendingCall): void {
  if (!posthogEnabled) return;
  if (client) call(client);
  else if (pending.length < MAX_PENDING) pending.push(call);
}

/**
 * Downloads and initialises posthog-js, then flushes calls queued before it
 * arrived. Idempotent, and a no-op when PostHog is not configured. A failed
 * download disables analytics for the tab rather than throwing.
 */
export function loadPostHog(): Promise<void> {
  if (!posthogEnabled) return Promise.resolve();
  loading ??= import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(posthogConfig.key, {
        api_host: posthogConfig.apiHost,
        ui_host: posthogConfig.uiHost,
        defaults: '2026-05-30',
        logs: {
          serviceName: 'markettrader-frontend',
          environment: import.meta.env.MODE,
          serviceVersion: buildInfo.version,
          resourceAttributes: { 'git.commit': buildInfo.commit },
        },
        capture_exceptions: {
          capture_unhandled_errors: true,
          capture_unhandled_rejections: true,
          capture_console_errors: false,
        },
      });
      // Dev and production share one project; this is what tells them apart.
      posthog.register({ environment: import.meta.env.MODE, app_version: buildInfo.version });
      client = posthog;
      for (const call of pending.splice(0)) call(posthog);
    })
    .catch(() => {
      pending.length = 0;
    });
  return loading;
}

/** Records a product event. Safe to call before {@link loadPostHog} resolves. */
export function capture(event: string, properties?: Properties): void {
  run((ph) => ph.capture(event, properties));
}

/** Sends an error to PostHog error tracking — for errors something already caught. */
export function captureException(error: unknown, properties?: Properties): void {
  run((ph) => ph.captureException(error, properties));
}

/** Emits a structured log record to PostHog Logs. */
export function log(level: LogLevel, body: string, attributes?: Properties): void {
  run((ph) => ph.logger[level](body, attributes));
}

/**
 * Ties this browser's activity to `user`. Runs on every session refresh, so it
 * skips the network call when already identified as them. An identified id
 * belonging to someone else means a previous user's session ended without a
 * logout (a failed refresh does not reset), so that profile is cut loose first.
 */
export function identifyUser(user: AuthUser): void {
  run((ph) => {
    if (ph.get_distinct_id() === user.id) return;
    if (ph.get_property('$user_state') === 'identified') ph.reset();
    ph.identify(user.id, { username: user.username, groups: user.groups });
  });
}

/** Starts a fresh anonymous profile. Only for an explicit logout. */
export function resetUser(): void {
  run((ph) => ph.reset());
}
