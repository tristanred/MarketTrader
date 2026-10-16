// OK: the server bootstrap is imported statically on purpose; the rule is frontend-only.
import { initTelemetry } from './observability/otel.js';

export const i = initTelemetry;
