import type { TelemetryHandle } from './observability/otel'; // OK: erased at build time

// OK: lazy load after render.
void import('./observability/otel')
  .then(({ initBrowserTelemetry }) => initBrowserTelemetry())
  .catch(() => {});

export type H = TelemetryHandle;
