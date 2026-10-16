import type { Db } from '../db/index.js';
import type { ConfigReader } from '../config/runtime-config.js';
import { LimitOverridesService } from './overrides.js';
import { LimitResolver } from './resolver.js';
import { LimitEnforcer } from './enforce.js';
import { UsageTracker } from './usage-tracker.js';
import { denialRecorderFor } from './usage-hooks.js';

/** Everything per-user limits need, built once per app by {@link createLimits}. */
export interface Limits {
  /** The app's live options, so factories that only receive `limits` can read `limits.config.get(...)`. */
  config: ConfigReader;
  resolver: LimitResolver;
  overrides: LimitOverridesService;
  enforcer: LimitEnforcer;
  /** In-process request/denial counters; flushed by the usage-rollup worker. */
  tracker: UsageTracker;
}

declare module 'fastify' {
  interface FastifyInstance {
    limits: Limits;
  }
}

/** Builds the limits bundle. `disabled` lifts every limit for this app, the test fixture default. */
export function createLimits(deps: {
  db: Db;
  config: ConfigReader;
  disabled?: boolean;
  tracker?: UsageTracker;
}): Limits {
  const tracker = deps.tracker ?? new UsageTracker();
  const overrides = new LimitOverridesService(deps.db);
  const resolver = new LimitResolver(deps.config, overrides, {
    ...(deps.disabled !== undefined ? { disabled: deps.disabled } : {}),
  });
  const enforcer = new LimitEnforcer(resolver, denialRecorderFor(tracker));
  return { config: deps.config, resolver, overrides, enforcer, tracker };
}
