import { buildApp } from './app.js';
import { env, telemetryEnabled, validateProductionEnv } from './env.js';
import { runMigrations } from './db/migrate.js';
import { closeDb } from './db/index.js';
import { initTelemetry, resourceAttributes, shutdownTelemetry } from './observability/otel.js';
import { traceContextMixin } from './observability/log-correlation.js';
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
 * Adds an OTLP target beside whatever pino already writes to, so journald keeps
 * receiving the exact same stream and telemetry is purely additive. Without an
 * explicit second target the transport would *replace* stdout, and a collector
 * outage would take the logs with it.
 */
function withOtlpTransport(logger: Exclude<typeof baseLogger, false>) {
  if (!telemetryEnabled) return logger;

  const existing = 'transport' in logger ? logger.transport : undefined;
  const otlpTarget = {
    target: 'pino-opentelemetry-transport',
    level: env.OTEL_LOG_LEVEL_MIN,
    options: {
      loggerName: env.OTEL_SERVICE_NAME,
      serviceVersion: buildInfo.version,
      // Worker threads get a fresh SDK, so the resource has to be repeated here
      // rather than inherited. Without it every log record lands in Loki tagged
      // `service_name="unknown_service"` and cannot be joined to its trace.
      resourceAttributes: { ...resourceAttributes },
    },
  };

  return {
    ...logger,
    transport: {
      targets: [
        // `pino/file` with fd 1 is how you keep plain stdout once any transport
        // is configured — pino routes everything through the worker thread.
        existing ?? { target: 'pino/file', options: { destination: 1 } },
        otlpTarget,
      ],
    },
  };
}

// Redact credential-bearing headers in non-test logs.
const loggerOptions =
  baseLogger === false
    ? false
    : {
        ...withOtlpTransport(baseLogger),
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
  const app = await buildApp({
    logger: loggerOptions,
    trustProxy: true,
    // In test mode the e2e suite burns through /auth/register's 10/min cap
    // when running multiple specs back-to-back. The infra is already in place
    // (disableRateLimit → allowList) — flip it on for tests only.
    disableRateLimit: env.NODE_ENV === 'test',
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
      // After close() so in-flight requests get their spans recorded, before
      // exit so the final batch is actually flushed rather than dropped.
      .then(shutdownTelemetry)
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
