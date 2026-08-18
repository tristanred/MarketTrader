import { context, trace } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { buildInfo } from '../build-info';

const SCOPE = 'markettrader-frontend';

/** Base path the browser posts OTLP to. Empty disables browser telemetry entirely. */
const exporterUrl = import.meta.env.VITE_OTEL_EXPORTER_URL ?? '';

let started = false;

/**
 * Starts browser telemetry: document-load and fetch traces, Web Vitals as
 * metrics, and uncaught errors as log records. All of it is gated on
 * `VITE_OTEL_EXPORTER_URL` being set at build time, so a build without it ships
 * an inert module.
 *
 * Trace context propagates to the API because requests are same-origin
 * (`API_BASE = '/api'`), so `traceparent` rides along without a CORS preflight
 * and the server's span joins this trace.
 *
 * Idempotent — React's StrictMode double-invokes effects in development.
 */
export function initBrowserTelemetry(): void {
  if (started || !exporterUrl) return;
  started = true;

  const base = exporterUrl.replace(/\/+$/, '');
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SCOPE,
    [ATTR_SERVICE_VERSION]: buildInfo.version,
    'git.commit': buildInfo.commit,
  });

  const tracerProvider = new WebTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${base}/v1/traces` })),
    ],
  });
  // The default StackContextManager is deliberate: ZoneContextManager would
  // pull in zone.js, which is a large dependency and patches globals the app
  // does not otherwise rely on.
  tracerProvider.register();

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${base}/v1/logs` }),
      }),
    ],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
        exportIntervalMillis: 60_000,
      }),
    ],
  });

  registerInstrumentations({
    tracerProvider,
    instrumentations: [
      new DocumentLoadInstrumentation(),
      new FetchInstrumentation({
        // Same-origin only. Without this the exporter's own POSTs to /otel would
        // be traced, and each export would generate the spans for the next one.
        ignoreUrls: [new RegExp(`^${base}/`)],
        propagateTraceHeaderCorsUrls: [/^\//],
      }),
    ],
  });

  registerWebVitals(meterProvider);
  registerErrorCapture();
  flushOnHide(tracerProvider, loggerProvider, meterProvider);
}

/**
 * Records Core Web Vitals as histograms. Each metric fires at most once per
 * page view (INP and CLS settle late, which is why they arrive via callback
 * rather than being read at load).
 */
function registerWebVitals(meterProvider: MeterProvider): void {
  const meter = meterProvider.getMeter(SCOPE, buildInfo.version);
  const histograms = new Map<string, ReturnType<typeof meter.createHistogram>>();

  const record = (metric: Metric) => {
    const name = `markettrader.web_vitals.${metric.name.toLowerCase()}`;
    let histogram = histograms.get(name);
    if (!histogram) {
      // CLS is a unitless ratio; every other vital is a duration.
      histogram = meter.createHistogram(name, {
        description: `Core Web Vital: ${metric.name}`,
        unit: metric.name === 'CLS' ? '1' : 'ms',
      });
      histograms.set(name, histogram);
    }
    histogram.record(metric.value, { rating: metric.rating });
  };

  onCLS(record);
  onFCP(record);
  onINP(record);
  onLCP(record);
  onTTFB(record);
}

/**
 * Forwards uncaught errors and unhandled promise rejections as log records.
 *
 * This is new capability rather than a port: Sentry was server-side only, so
 * browser errors have never been reported anywhere (ADR-015). Listeners are
 * passive — neither one calls `preventDefault`, so the browser still logs to
 * the console and any other handler still runs.
 */
function registerErrorCapture(): void {
  const logger = logs.getLogger(SCOPE, buildInfo.version);

  const emit = (message: string, error: unknown, kind: string) => {
    const activeSpan = trace.getSpan(context.active());
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: 'ERROR',
      body: message,
      attributes: {
        'error.kind': kind,
        'error.type': error instanceof Error ? error.name : typeof error,
        'error.stack': error instanceof Error ? (error.stack ?? '') : '',
        'url.path': window.location.pathname,
        ...(activeSpan && { trace_id: activeSpan.spanContext().traceId }),
      },
    });
  };

  window.addEventListener('error', (event) => {
    emit(event.message, event.error, 'uncaught');
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    emit(
      reason instanceof Error ? reason.message : String(reason),
      reason,
      'unhandled_rejection',
    );
  });
}

/**
 * Flushes on `visibilitychange`, not `beforeunload`.
 *
 * Mobile browsers frequently kill a backgrounded tab without ever firing
 * `beforeunload`, so a batch still sitting in a processor at that point is lost.
 * `hidden` is the last event guaranteed to fire, which makes it the only
 * reliable place to force an export.
 */
function flushOnHide(
  tracerProvider: WebTracerProvider,
  loggerProvider: LoggerProvider,
  meterProvider: MeterProvider,
): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    void tracerProvider.forceFlush();
    void loggerProvider.forceFlush();
    void meterProvider.forceFlush();
  });
}
