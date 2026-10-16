import type { ConfigReader } from '../config/runtime-config.js';
import type { Limits } from '../limits/index.js';
import type { LimitSubject } from '../limits/resolver.js';
import type { RequestAccount } from '../limits/account.js';
import { LimitExceededError } from '../limits/errors.js';
import type { SlidingWindowCounter } from '../limits/sliding-window.js';

/**
 * What the socket routes need to enforce per-user limits. Optional on both
 * route factories so tests that mount a bare route keep their exact query
 * sequence (see `live-route-connect-window.test.ts`).
 */
export interface WsLimitDeps {
  limits: Limits;
  config: ConfigReader;
  /** Live sockets the user holds across both registries. */
  countUserSockets: (userId: string) => number;
}

/** A WS subject always has an account — sockets authenticate before any limit runs. */
export type WsSubject = LimitSubject & { account: RequestAccount };

async function admitted(check: () => Promise<void>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch (err) {
    if (err instanceof LimitExceededError) return false;
    throw err;
  }
}

/** False when opening one more socket would exceed the user's `wsConnections` limit. */
export function admitConnection(deps: WsLimitDeps, subject: WsSubject): Promise<boolean> {
  // Count-then-register is not atomic: upgrades in flight together can read the
  // same count and all be admitted. Tolerated because the overshoot is bounded
  // by how many upgrades one user can have in flight, which the per-IP upgrade
  // rate limit caps, and the next upgrade after they register sees the true count.
  return admitted(() =>
    deps.limits.enforcer.enforceFor(subject, 'wsConnections', async () =>
      deps.countUserSockets(subject.account.id),
    ),
  );
}

/**
 * Counts one `subscribe` against the user's `wsSubscribes` window and reports
 * whether it may be applied. The hit is recorded even when refused, so a client
 * that keeps hammering stays refused.
 */
export function admitSubscribe(
  deps: WsLimitDeps,
  counter: SlidingWindowCounter,
  subject: WsSubject,
): Promise<boolean> {
  const afterHit = counter.hit(subject.account.id);
  return admitted(() =>
    deps.limits.enforcer.enforceFor(subject, 'wsSubscribes', async () => afterHit - 1),
  );
}
