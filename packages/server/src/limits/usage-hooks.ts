import type { FastifyInstance, FastifyRequest } from 'fastify';
import { meters } from '../observability/telemetry.js';
import type { Limits } from './index.js';
import type { DenialRecorder } from './enforce.js';
import type { LimitExceededError } from './errors.js';
import { rateDenialLabel } from './rate.js';
import { subjectOf } from './resolver.js';
import { subjectForUsage, usageSubjectOf, type UsageTracker } from './usage-tracker.js';

/** Probes and docs: never counted, never limited. */
const UNTRACKED = ['/health', '/version', '/docs'];
/** Admin routes are immune by definition; the probes are not user traffic. */
const CEILING_EXEMPT = ['/admin', ...UNTRACKED];

/** Seconds a ceiling refusal asks the client to wait — one half-window of the sliding minute. */
const CEILING_RETRY_AFTER_SECONDS = 30;

function under(url: string | undefined, prefixes: readonly string[]): boolean {
  return url !== undefined && prefixes.some((p) => url === p || url.startsWith(`${p}/`));
}

/** `METHOD /registered/:pattern` — bounded cardinality, unlike the raw URL. */
export function usageRoute(request: FastifyRequest): string {
  const url = request.routeOptions.url;
  return url === undefined ? '* <unmatched>' : `${request.method} ${url}`;
}

/** Records every limit refusal in the tracker and the `limits.denied` metric. */
export function denialRecorderFor(tracker: UsageTracker): DenialRecorder {
  return (subject, key) => {
    tracker.recordDenial(usageSubjectOf(subject), key);
    meters.limitsDenied.add(1, { limit: key });
  };
}

/**
 * `onExceeded` for `@fastify/rate-limit`. Per-user configs are labelled with
 * their limit key; the per-IP configs underneath with `ip:<METHOD /route>`.
 */
export function recordRateLimitDenial(tracker: UsageTracker, request: FastifyRequest): void {
  const label = rateDenialLabel(request);
  tracker.recordDenial(subjectForUsage(request), label);
  meters.limitsDenied.add(1, { limit: label });
}

/** The error handler's fallback for a {@link LimitExceededError} no recorder saw (e.g. `assertOpenOrderCapacity`). */
export function recordUnrecordedDenial(
  tracker: UsageTracker,
  request: FastifyRequest,
  err: LimitExceededError,
): void {
  denialRecorderFor(tracker)(subjectOf(request), err.resolved.key);
}

/**
 * Root-level hooks: `preHandler` enforces the per-user `apiRequests` ceiling
 * (it runs after each route's `onRequest: authenticate`, so `request.account`
 * is set), and `onResponse` feeds the request counters. Must be registered
 * before any route so every route inherits them.
 */
export function registerUsageHooks(app: FastifyInstance, limits: Limits): void {
  app.addHook('preHandler', async (request) => {
    const account = request.account;
    if (!account || account.isAdmin) return;
    if (under(request.routeOptions.url, CEILING_EXEMPT)) return;
    const count = limits.tracker.hitMinute(account.id);
    await limits.enforcer.enforce(request, 'apiRequests', async () => count - 1, {
      retryAfter: async () => CEILING_RETRY_AFTER_SECONDS,
    });
  });

  app.addHook('onResponse', async (request) => {
    if (under(request.routeOptions.url, UNTRACKED)) return;
    limits.tracker.recordRequest(subjectForUsage(request), usageRoute(request));
  });
}
