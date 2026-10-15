// OK: the server bootstrap owns SDK, exporters, instrumentations, resources and semconv.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { metrics } from '@opentelemetry/api';

export const parts = [NodeSDK, resourceFromAttributes, OTLPTraceExporter, UndiciInstrumentation, ATTR_SERVICE_NAME, metrics];
