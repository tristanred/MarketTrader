// OK: the observability layer may use the whole API surface.
import { metrics, trace } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'; // BAD: semconv belongs to otel.ts

export const m = [metrics, trace, ATTR_SERVICE_NAME];
