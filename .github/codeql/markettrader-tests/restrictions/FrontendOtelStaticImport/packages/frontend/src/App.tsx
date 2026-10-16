import { initBrowserTelemetry } from './observability/otel'; // BAD: static value import
import '@/observability/otel'; // BAD: side-effect import still bundles it
export { initBrowserTelemetry as init } from './observability/otel.ts'; // BAD: re-export
import { otelLabel } from './lib/observability/otelLabel'; // OK: different module

export const x = [initBrowserTelemetry, otelLabel];
