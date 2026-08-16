import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';

/**
 * Records 5xx exceptions on the active span and marks it failed, without
 * replacing Fastify's default error handler.
 *
 * Replaces the retired Sentry integration (ADR-015). `@fastify/otel` is
 * configured with `recordExceptions: true` and so already attaches the
 * exception event; what it does not do is distinguish a handled 4xx from a
 * genuine server fault. Setting the span status only for 5xx is what makes
 * `status = error` a usable filter in Grafana rather than a synonym for "the
 * client sent something invalid".
 *
 * The accompanying error *log* needs no wiring here: Fastify already logs the
 * error through pino, and the trace-context mixin stamps it with the ids that
 * link it back to this span.
 */
export function attachErrorCapture(app: FastifyInstance): void {
  app.addHook('onError', async (_request, reply, err) => {
    // `err.statusCode` first, and it matters: Fastify has not applied the status
    // to the reply yet when onError runs, so `reply.statusCode` is still 200
    // here for *every* error. The retired Sentry hook read the reply first and
    // therefore classified every thrown 4xx — validation failures included — as
    // a 5xx server fault.
    const status =
      typeof err.statusCode === 'number'
        ? err.statusCode
        : reply.statusCode >= 400
          ? reply.statusCode
          : 500;
    if (status < 500) return;

    const span = trace.getActiveSpan();
    if (!span) return;

    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  });
}
