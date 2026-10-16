import type { FastifyRequest } from 'fastify';
import type { LimitKey } from '@markettrader/shared';
import { LimitExceededError } from './errors.js';
import { subjectOf, type LimitResolver, type LimitSubject } from './resolver.js';

/** Called once per denial. The usage tracker is the real recorder. */
export type DenialRecorder = (subject: LimitSubject, key: LimitKey | string) => void;

/** Optional extras for {@link LimitEnforcer.enforce}. */
export interface EnforceOptions {
  /** Seconds until one more would be admitted; only computed on denial. */
  retryAfter?: () => Promise<number | undefined>;
}

/**
 * Seconds until the oldest row counted in a rolling window ages out, rounded up,
 * at least 1. Undefined when no row was counted; the whole window when the
 * timestamp is unparseable, which is the safe upper bound.
 */
export function secondsUntilWindowFrees(
  oldestIso: string | null,
  windowMs: number,
  now: number = Date.now(),
): number | undefined {
  if (oldestIso === null) return undefined;
  const oldest = Date.parse(oldestIso);
  if (Number.isNaN(oldest)) return Math.max(1, Math.ceil(windowMs / 1000));
  return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
}

/**
 * Applies quota and concurrent limits at their call sites. Resolves first, so an
 * unlimited subject (admin, limits off) never pays for the count query.
 */
export class LimitEnforcer {
  constructor(
    private readonly resolver: LimitResolver,
    private readonly recordDenial: DenialRecorder = () => {},
  ) {}

  /** Throws {@link LimitExceededError} when `count()` has already reached the request's limit. */
  enforce(
    request: FastifyRequest,
    key: LimitKey,
    count: () => Promise<number>,
    opts?: EnforceOptions,
  ): Promise<void> {
    return this.enforceFor(subjectOf(request), key, count, opts);
  }

  /** Same as {@link LimitEnforcer.enforce} for a subject not tied to a request. */
  async enforceFor(
    subject: LimitSubject,
    key: LimitKey,
    count: () => Promise<number>,
    opts: EnforceOptions = {},
  ): Promise<void> {
    const resolved = await this.resolver.resolve(subject, key);
    if (resolved.max === null) return;
    if ((await count()) < resolved.max) return;
    this.recordDenial(subject, key);
    const retryAfter = opts.retryAfter ? await opts.retryAfter() : undefined;
    const err = new LimitExceededError({ ...resolved, max: resolved.max }, retryAfter);
    err.recorded = true;
    throw err;
  }
}
