import { NodeSDK, logs, metrics } from '@opentelemetry/sdk-node';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { env, telemetryEnabled } from '../env.js';
import { buildInfo } from '../build-info.js';

let sdk: NodeSDK | undefined;

/**
 * Identity stamped on every span, metric, and log record.
 *
 * Exported because the pino OTLP transport runs in a worker thread with its own
 * SDK instance and inherits nothing from this one — it has to be handed the
 * same attributes explicitly, or its records arrive as `unknown_service`.
 */
export const resourceAttributes = {
  [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME,
  [ATTR_SERVICE_VERSION]: buildInfo.version,
  'deployment.environment.name': env.NODE_ENV,
  'git.commit': buildInfo.commit,
} as const;

/** Joins the configured base endpoint with an OTLP signal path. */
function signalUrl(path: string): string {
  return `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/, '')}${path}`;
}

/**
 * Starts the OpenTelemetry SDK when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
 * No-op otherwise — no exporters are constructed and nothing connects.
 * Idempotent; subsequent calls do nothing.
 *
 * Nothing here patches modules, so this does not have to run before any
 * particular import. See ADR-015 for why that is a deliberate constraint.
 */
export function initTelemetry(): void {
  if (sdk || !telemetryEnabled) return;

  sdk = new NodeSDK({
    resource: defaultResource().merge(resourceFromAttributes({ ...resourceAttributes })),
    traceExporter: new OTLPTraceExporter({ url: signalUrl('/v1/traces') }),
    metricReaders: [
      new metrics.PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: signalUrl('/v1/metrics') }),
        exportIntervalMillis: env.OTEL_METRIC_EXPORT_INTERVAL_MS,
      }),
    ],
    logRecordProcessors: [
      new logs.BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: signalUrl('/v1/logs') }),
      }),
    ],
    // Subscribes to undici's diagnostics channels, which is the only way to see
    // global fetch — the sole outbound HTTP path in this codebase. No module
    // patching, so it works identically under tsx, tsup's bundle, and Docker.
    instrumentations: [new UndiciInstrumentation()],
  });

  sdk.start();
}

/**
 * Flushes and shuts the SDK down. Called from the signal handlers in
 * `index.ts` so the final batch of spans, metrics, and logs is not lost on
 * restart. Resolves immediately when telemetry was never started.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  const stopping = sdk;
  sdk = undefined;
  await stopping.shutdown();
}
