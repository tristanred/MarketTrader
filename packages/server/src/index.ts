import { buildApp } from './app.js';
import { env, posthogEnabled, telemetryEnabled, validateProductionEnv } from './env.js';
import { runMigrations } from './db/migrate.js';
import { closeDb, db } from './db/index.js';
import { bootstrapAdmin } from './db/seed-admin.js';
import { initTelemetry, resourceAttributes, shutdownTelemetry } from './observability/otel.js';
import { traceContextMixin } from './observability/log-correlation.js';
import { logExportTargets } from './observability/log-transports.js';
import { shutdownPostHog } from './observability/posthog.js';
import { buildInfo } from './build-info.js';

const baseLogger =
  env.NODE_ENV === 'test'
    ? false
    : env.NODE_ENV === 'development'
      ? {
          level: 'debug',
          transport: { target: 'pino-pretty', options: { colorize: true } },
        }
      : { level: 'info' };

/**
 * Adds log-export targets (the OTLP collector, PostHog, or both) beside whatever
 * pino already writes to, so journald keeps receiving the exact same stream and
 * export is purely additive. Without an explicit stdout target the transport
 * would *replace* stdout, and an exporter outage would take the logs with it.
 */
function withLogExport(logger: Exclude<typeof baseLogger, false>) {
  const exportTargets = logExportTargets({
    collector: telemetryEnabled ? { level: env.OTEL_LOG_LEVEL_MIN } : null,
    posthog: posthogEnabled
      ? { host: env.POSTHOG_HOST, key: env.POSTHOG_KEY, level: env.POSTHOG_LOG_LEVEL_MIN }
      : null,
    loggerName: env.OTEL_SERVICE_NAME,
    serviceVersion: buildInfo.version,
    resourceAttributes: { ...resourceAttributes },
  });
  if (exportTargets.length === 0) return logger;

  const existing = 'transport' in logger ? logger.transport : undefined;
  return {
    ...logger,
    transport: {
      targets: [
        // `pino/file` with fd 1 is how you keep plain stdout once any transport
        // is configured — pino routes everything through the worker thread.
        existing ?? { target: 'pino/file', options: { destination: 1 } },
        ...exportTargets,
      ],
    },
  };
}

// Redact credential-bearing headers in non-test logs.
const loggerOptions =
  baseLogger === false
    ? false
    : {
        ...withLogExport(baseLogger),
        mixin: traceContextMixin,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          censor: '[redacted]',
        },
      };

if (env.NODE_ENV === 'production') {
  validateProductionEnv();
}
initTelemetry();

try {
  await runMigrations();
  // Before listen(): a fresh database must not accept requests while it still
  // has no administrator.
  await bootstrapAdmin(db);
  const app = await buildApp({
    logger: loggerOptions,
    trustProxy: env.TRUST_PROXY,
    // In test mode the e2e suite burns through /auth/register's 10/min cap
    // when running multiple specs back-to-back. The infra is already in place
    // (disableRateLimit → allowList) — flip it on for tests only.
    disableRateLimit: env.NODE_ENV === 'test',
    loginThrottle: { disabled: env.NODE_ENV === 'test' },
  });
  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'shutdown started');
    // Force exit if graceful close hangs. EC2 sends SIGKILL after 10s anyway;
    // we exit early so the container restart isn't delayed by a stuck client.
    const force = setTimeout(() => {
      app.log.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 10_000);
    force.unref();

    app
      .close()
      // After close() so in-flight requests get their spans recorded and their
      // analytics events queued, before exit so the final batch is actually
      // flushed rather than dropped. Independent sinks, so in parallel.
      .then(() => Promise.all([shutdownTelemetry(), shutdownPostHog()]))
      .then(closeDb)
      .then(() => {
        app.log.info('shutdown complete');
        process.exit(0);
      })
      .catch((err) => {
        app.log.error({ err }, 'shutdown failed');
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} catch (err) {
  console.error(err);
  process.exit(1);
}
