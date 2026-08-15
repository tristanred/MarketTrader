declare const __APP_VERSION__: string | undefined;
declare const __GIT_COMMIT__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

/**
 * Build stamp for the running bundle, surfaced by `GET /version`.
 *
 * tsup and vitest replace the `__*__` identifiers at build time. `tsx watch`
 * has no define step, so each falls back to a dev sentinel — `typeof` is the
 * only reference form that does not throw on a genuinely undeclared global.
 */
export const buildInfo = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  commit: typeof __GIT_COMMIT__ === 'string' ? __GIT_COMMIT__ : 'dev',
  buildTime: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : new Date().toISOString(),
} as const;
