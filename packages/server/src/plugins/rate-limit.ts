import type { FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';

/**
 * Registers the rate-limit plugin. Routes opt in via `config.rateLimit`.
 *
 * When `disabled` is true, the plugin is registered with an effectively
 * infinite ceiling so per-route configs are honored but never trigger. Used
 * in tests, where shared fixtures would otherwise blow through the limits
 * (especially `/auth/register`, capped at 10/min).
 */
export async function registerRateLimit(
  app: FastifyInstance,
  opts: { disabled?: boolean } = {},
): Promise<void> {
  // No keyGenerator on purpose. The default is `req.ip`, which is only as
  // trustworthy as Fastify's `trustProxy` — bounded by TRUST_PROXY (see env.ts).
  // Keying on X-Real-IP instead would be strictly weaker: that header is just as
  // client-settable whenever the app is reached without going through the proxy.
  await app.register(fastifyRateLimit, {
    global: false, // opt-in per route; avoids rate-limiting /health and future public endpoints
    // `allowList: () => true` bypasses the limiter for every request, including
    // per-route configs. Used in tests so shared-app fixtures don't hit caps
    // like /auth/register's 10/min.
    ...(opts.disabled ? { allowList: () => true } : {}),
  });
}
