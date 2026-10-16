declare const __APP_VERSION__: string;
declare const __GIT_COMMIT__: string;
declare const __BUILD_TIME__: string;

// OK: Vite always defines these, so no guard is needed on the frontend.
export const buildInfo = {
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
  buildTime: __BUILD_TIME__,
};
