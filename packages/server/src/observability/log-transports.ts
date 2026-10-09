/** One entry of pino's `transport.targets` (pino is fastify's dependency, not ours). */
export interface LogTransportTarget {
  target: string;
  level: string;
  options: Record<string, unknown>;
}

/** Inputs to {@link logExportTargets}, separated from `env` so the wiring is testable. */
export interface LogExportConfig {
  /** Ship to the OTLP collector (endpoint read from `OTEL_EXPORTER_OTLP_ENDPOINT` by the exporter). */
  collector: { level: string } | null;
  /** Ship to PostHog Logs. */
  posthog: { host: string; key: string; level: string } | null;
  loggerName: string;
  serviceVersion: string;
  resourceAttributes: Record<string, string>;
}

/**
 * The pino transport targets that export logs off-box, one per destination.
 * Each is its own `pino-opentelemetry-transport` instance with its own level,
 * so PostHog can take only warnings while the collector takes everything, and
 * an outage at one does not touch the other.
 *
 * Two instances in one pino worker are safe: each emits through its own
 * `LoggerProvider`; only the global registration is first-wins, and nothing
 * here reads the global.
 */
export function logExportTargets(cfg: LogExportConfig): LogTransportTarget[] {
  const base = {
    loggerName: cfg.loggerName,
    serviceVersion: cfg.serviceVersion,
    // Worker threads get a fresh SDK, so the resource has to be repeated here
    // rather than inherited. Without it every log record lands tagged
    // `service_name="unknown_service"` and cannot be joined to its trace.
    resourceAttributes: { ...cfg.resourceAttributes },
  };

  const targets: LogTransportTarget[] = [];
  if (cfg.collector) {
    targets.push({
      target: 'pino-opentelemetry-transport',
      level: cfg.collector.level,
      options: base,
    });
  }
  if (cfg.posthog) {
    targets.push({
      target: 'pino-opentelemetry-transport',
      level: cfg.posthog.level,
      options: {
        ...base,
        logRecordProcessorOptions: {
          recordProcessorType: 'batch',
          exporterOptions: {
            protocol: 'http',
            httpExporterOptions: {
              url: `${cfg.posthog.host.replace(/\/+$/, '')}/i/v1/logs`,
              headers: { Authorization: `Bearer ${cfg.posthog.key}` },
            },
          },
        },
      },
    });
  }
  return targets;
}
