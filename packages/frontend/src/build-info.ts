declare const __APP_VERSION__: string;
declare const __GIT_COMMIT__: string;
declare const __BUILD_TIME__: string;

/**
 * Build stamp for this bundle. Vite substitutes the `__*__` identifiers through
 * its `define` config, which applies identically in dev, build, and test — so
 * unlike the server's equivalent this needs no undeclared-global fallback.
 */
export const buildInfo = {
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
  buildTime: __BUILD_TIME__,
} as const;
