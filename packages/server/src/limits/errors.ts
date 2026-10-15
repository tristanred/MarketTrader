import type { FastifyInstance } from 'fastify';
import type { LimitExceededBody, LimitKey, LimitKind } from '@markettrader/shared';
import type { ConfigReader } from '../config/runtime-config.js';
import { LIMIT_CATALOGUE } from './catalogue.js';
import type { ResolvedLimit } from './resolver.js';

/** "Game creation limit reached (3 per week)". */
export function limitMessage(key: LimitKey, max: number): string {
  const d = LIMIT_CATALOGUE[key];
  return `${d.label} limit reached (${max} ${d.per})`;
}

/** 409 for "too many open at once" (matches the existing watchlist caps); 429 for everything windowed. */
export function statusFor(kind: LimitKind): 409 | 429 {
  return kind === 'concurrent' ? 409 : 429;
}

/** Thrown by enforcement points; turned into a {@link LimitExceededBody} by {@link registerLimitErrorHandler}. */
export class LimitExceededError extends Error {
  /**
   * True once the denial has been counted (by the enforcer or the rate-limit
   * plugin's `onExceeded`). Denials thrown from elsewhere stay false and are
   * counted by the error handler instead, never both.
   */
  recorded = false;

  /** Set so the `onError` capture hook classifies a denial as a 4xx, not a server fault. */
  readonly statusCode: 409 | 429;

  constructor(
    readonly resolved: ResolvedLimit & { max: number },
    readonly retryAfterSeconds?: number,
  ) {
    super(limitMessage(resolved.key, resolved.max));
    this.name = 'LimitExceededError';
    this.statusCode = statusFor(LIMIT_CATALOGUE[resolved.key].kind);
  }
}

/**
 * The response body for a denial. While the account is on probation the body
 * also carries `LIMITS_MATURITY_DAYS`, so a client can say how long the reduced limit lasts.
 */
export function limitExceededBody(err: LimitExceededError, config: ConfigReader): LimitExceededBody {
  return {
    error: err.message,
    code: 'LIMIT_EXCEEDED',
    limit: err.resolved.key,
    max: err.resolved.max,
    probation: err.resolved.probation,
    ...(err.resolved.probation ? { maturityDays: config.get('LIMITS_MATURITY_DAYS') } : {}),
    ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
  };
}

/**
 * Root error handler for {@link LimitExceededError}. Must be registered before
 * any route plugin, because route contexts inherit the error handler at
 * registration. Any other error is rethrown, which hands it to Fastify's
 * default handler, so existing error bodies are unchanged.
 */
export function registerLimitErrorHandler(app: FastifyInstance, config: ConfigReader): void {
  app.setErrorHandler((err: Error, _request, reply) => {
    if (!(err instanceof LimitExceededError)) throw err;
    if (err.retryAfterSeconds !== undefined) {
      void reply.header('retry-after', String(err.retryAfterSeconds));
    }
    return reply.code(err.statusCode).send(limitExceededBody(err, config));
  });
}
