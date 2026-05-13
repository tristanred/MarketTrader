import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';

let initialized = false;

/**
 * Initializes Sentry if `SENTRY_DSN` is set. Safe to call multiple times;
 * subsequent calls are no-ops. Must run before {@link attachSentry} so the
 * error handler has a configured client to send to.
 */
export function initSentry(): void {
  if (initialized) return;
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0,
  });
  initialized = true;
}

/**
 * Forwards 5xx exceptions to Sentry without replacing Fastify's default
 * error handler. No-op when Sentry was never initialized.
 */
export function attachSentry(app: FastifyInstance): void {
  if (!initialized) return;
  app.addHook('onError', async (request, reply, err) => {
    const status = reply.statusCode >= 400 ? reply.statusCode : 500;
    if (status >= 500) {
      Sentry.captureException(err, {
        tags: { route: request.routeOptions?.url ?? request.url, method: request.method },
      });
    }
  });
}
