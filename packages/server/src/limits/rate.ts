import type { FastifyRequest } from 'fastify';
import type { RateLimitOptions } from '@fastify/rate-limit';
import type { ConfigReader } from '../config/runtime-config.js';
import type { Limits } from './index.js';
import { LIMIT_CATALOGUE } from './catalogue.js';
import { isPrivilegedConnection } from './policy.js';
import { subjectOf, type ResolvedLimit } from './resolver.js';
import { LimitExceededError } from './errors.js';

/** The per-user limits enforced by `@fastify/rate-limit` rather than by a count. */
export type RateLimitKey = 'trades' | 'orderCancels' | 'codeLookups';

// The plugin calls allowList, max and errorResponseBuilder separately, and
// only the first two may be async. Resolving once and keeping the result here
// gives all three the same answer, and lets the sync error builder report the
// basis. WeakMap so a request that never reaches the builder leaks nothing.
const resolutions = new WeakMap<FastifyRequest, ResolvedLimit>();

async function resolveOnce(
  limits: Limits,
  request: FastifyRequest,
  key: RateLimitKey,
): Promise<ResolvedLimit> {
  const cached = resolutions.get(request);
  if (cached?.key === key) return cached;
  const resolved = await limits.resolver.resolve(subjectOf(request), key);
  resolutions.set(request, resolved);
  return resolved;
}

/**
 * Route `config.rateLimit` for a per-user {@link RateLimitKey}: keyed by user
 * id, sized by the resolver on every request (so overrides and live edits
 * apply at once), skipped when the resolver says unlimited, and answered with
 * a {@link LimitExceededError}. Needs `authenticate` in the route's `onRequest`,
 * which the plugin runs first. A key shared by several routes must go through
 * one `app.rateLimit(...)` handler: each route config gets its own counter.
 */
export function rateLimitFor(limits: Limits, key: RateLimitKey): RateLimitOptions {
  const windowMs = LIMIT_CATALOGUE[key].windowMs ?? 60_000;
  return {
    timeWindow: windowMs,
    keyGenerator: (request) => `u:${request.account?.id ?? `ip:${request.ip}`}`,
    allowList: async (request) => (await resolveOnce(limits, request, key)).max === null,
    max: async (request) =>
      (await resolveOnce(limits, request, key)).max ?? Number.MAX_SAFE_INTEGER,
    errorResponseBuilder: (request, context) => {
      const resolved: ResolvedLimit = resolutions.get(request) ?? {
        key,
        max: context.max,
        basis: 'base' as const,
        privileged: false,
        probation: false,
      };
      const err = new LimitExceededError(
        { ...resolved, max: context.max },
        Math.max(1, Math.ceil(context.ttl / 1000)),
      );
      // The plugin calls onExceeded before this builder, so the denial is
      // already counted there.
      err.recorded = true;
      return err;
    },
  };
}

/**
 * Wraps one of the original per-IP configs: the hard-coded number stands, a
 * privileged address gets it × `LIMITS_PRIVILEGED_MULTIPLIER`, and an
 * authenticated admin is unbounded. Deliberately sets no `allowList`, so the
 * test fixtures' plugin-level bypass still covers the IP layer.
 */
export function withPrivilegedIp(
  config: ConfigReader,
  opts: { max: number; timeWindow: string | number },
): RateLimitOptions {
  return {
    timeWindow: opts.timeWindow,
    max: (request) => {
      if (request.account?.isAdmin) return Number.MAX_SAFE_INTEGER;
      return isPrivilegedConnection(request.ip, config)
        ? opts.max * config.get('LIMITS_PRIVILEGED_MULTIPLIER')
        : opts.max;
    },
  };
}

/** Bounded label for a rate-limit denial: the limit key, or the route for the IP layer. */
export function rateDenialLabel(request: FastifyRequest): string {
  const resolved = resolutions.get(request);
  if (resolved) return resolved.key;
  return `ip:${request.method} ${request.routeOptions.url ?? '<unmatched>'}`;
}
