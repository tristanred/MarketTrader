import { metrics } from '@opentelemetry/api';

// Frontend is out of scope (server-only invariant).
export const meter = metrics.getMeter('spa');
