import { buildInfo } from '../build-info';

declare const __APP_VERSION__: string | undefined; // BAD: re-declaring the global outside build-info.ts

export function version() {
  const v = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : buildInfo.version; // BAD x2: even guarded, use buildInfo
  return { v, buildInfo };
}
