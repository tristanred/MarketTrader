import type { Db } from '../db/index.js';
import type { ConfigReader } from '../config/runtime-config.js';
import { LimitOverridesService } from './overrides.js';
import { LimitResolver } from './resolver.js';
import { LimitEnforcer } from './enforce.js';

/** Everything per-user limits need, built once per app by {@link createLimits}. */
export interface Limits {
  /** The app's live options, so factories that only receive `limits` can read `limits.config.get(...)`. */
  config: ConfigReader;
  resolver: LimitResolver;
  overrides: LimitOverridesService;
  enforcer: LimitEnforcer;
}

declare module 'fastify' {
  interface FastifyInstance {
    limits: Limits;
  }
}

/** Builds the limits bundle. `disabled` lifts every limit for this app, the test fixture default. */
export function createLimits(deps: { db: Db; config: ConfigReader; disabled?: boolean }): Limits {
  const overrides = new LimitOverridesService(deps.db);
  const resolver = new LimitResolver(deps.config, overrides, {
    ...(deps.disabled !== undefined ? { disabled: deps.disabled } : {}),
  });
  const enforcer = new LimitEnforcer(resolver);
  return { config: deps.config, resolver, overrides, enforcer };
}
