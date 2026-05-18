import { buildApp } from './app.js';
import { env, validateProductionEnv } from './env.js';
import { runMigrations } from './db/migrate.js';
import { closeDb } from './db/index.js';
import { initSentry } from './observability/sentry.js';

const baseLogger =
  env.NODE_ENV === 'test'
    ? false
    : env.NODE_ENV === 'development'
      ? {
          level: 'debug',
          transport: { target: 'pino-pretty', options: { colorize: true } },
        }
      : { level: 'info' };

// Redact credential-bearing headers in non-test logs.
const loggerOptions =
  baseLogger === false
    ? false
    : {
        ...baseLogger,
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
initSentry();

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
