import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { context, trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { node, tracing } from '@opentelemetry/sdk-node';
import { attachErrorCapture } from '../../src/observability/error-capture.js';

/**
 * Covers what replaced Sentry (ADR-015): a 5xx must mark its span failed, and a
 * 4xx must not. That distinction is what keeps `status = error` a usable filter
 * in Grafana rather than a synonym for "the client sent something invalid".
 */
describe('attachErrorCapture', () => {
  const exporter = new tracing.InMemorySpanExporter();
  // NodeTracerProvider rather than BasicTracerProvider: `.register()` installs
  // the AsyncLocalStorage context manager, without which `getActiveSpan()`
  // returns nothing once execution leaves the handler and reaches onError.
  const provider = new node.NodeTracerProvider({
    spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
  });

  beforeAll(() => {
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
  });

  /**
   * Stands in for @fastify/otel: opens the request span in `onRequest` and
   * closes it in `onResponse`, so the span is still live when `onError` fires.
   * Ending it inside the handler — as an earlier version of this test did —
   * makes the assertion vacuous, because a finished span silently ignores
   * `setStatus`.
   */
  const spans = new WeakMap<FastifyRequest, Span>();

  async function requestWithSpan(handler: () => never, expectedStatus: number) {
    exporter.reset();
    const app = Fastify({ logger: false });

    app.addHook('onRequest', (request, _reply, done) => {
      const span = provider.getTracer('test').startSpan('request');
      spans.set(request, span);
      context.with(trace.setSpan(context.active(), span), done);
    });
    app.addHook('onResponse', async (request) => {
      spans.get(request)?.end();
    });
    attachErrorCapture(app);

    app.get('/boom', async () => handler());

    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(expectedStatus);
    await app.close();
    return exporter.getFinishedSpans();
  }

  it('marks the span failed and records the exception on a 5xx', async () => {
    const finished = await requestWithSpan(() => {
      throw new Error('kaboom');
    }, 500);

    const span = finished.find((s) => s.name === 'request');
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.status.message).toBe('kaboom');
    expect(span?.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('leaves the span unset on a 4xx, which is a client problem not a fault', async () => {
    const finished = await requestWithSpan(() => {
      const err = new Error('bad request') as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    }, 400);

    const span = finished.find((s) => s.name === 'request');
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });
});
