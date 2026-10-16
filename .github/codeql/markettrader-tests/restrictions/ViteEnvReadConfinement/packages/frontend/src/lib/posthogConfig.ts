// OK: the owning module for VITE_POSTHOG_*.
const key = import.meta.env.VITE_POSTHOG_KEY;
const apiHost = import.meta.env.VITE_POSTHOG_HOST;
export const posthogEnabled = Boolean(key && apiHost) && import.meta.env.MODE !== 'test';
export const otelUrl = import.meta.env.VITE_OTEL_EXPORTER_URL; // BAD: VITE_OTEL_* belongs to observability/otel.ts
