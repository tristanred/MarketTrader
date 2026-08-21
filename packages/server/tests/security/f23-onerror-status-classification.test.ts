import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { context, trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { node, tracing } from '@opentelemetry/sdk-node';
import { attachErrorCapture } from '../../src/observability/error-capture.js';

/**
 * Regression guard for the classification bug retired with the Sentry hook: an
 * `onError` hook must derive the status from the error, never from the reply.
 *
 * The reply has not been given its status yet when `onError` runs, so
 * `reply.statusCode` is still 200 for *every* error — a `>= 400 ? … : 500`
 * fallback therefore reports each 4xx as a server fault. Both cases below assert
 * that directly, so the test cannot pass by accident if the precondition ever
 * changes.
 *
 * The unrouted case matters on its own: the hook is registered on the root
 * instance, and Fastify copies root hooks onto the 404 context, so it fires
 * there too — with no route template to classify against.
 */
describe('onError classifies by error status, not reply status (F23)', () => {
  const exporter = new tracing.InMemorySpanExporter();
  const provider = new node.NodeTracerProvider({
    spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
  });
  const spans = new WeakMap<FastifyRequest, Span>();

  beforeAll(() => {
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
  });

  /**
   * Builds an app whose request span outlives the handler, mirroring how
   * `@fastify/otel` opens the span in `onRequest` and closes it in `onResponse`.
   * Returns the finished spans plus the reply status observed at hook time.
   */
  async function inject(url: string, payload: string) {
    exporter.reset();
    const app = Fastify({ logger: false });
    let replyStatusAtHookTime = -1;

    app.addHook('onRequest', (request, _reply, done) => {
      const span = provider.getTracer('test').startSpan('request');
      spans.set(request, span);
      context.with(trace.setSpan(context.active(), span), done);
    });
    app.addHook('onResponse', async (request) => {
      spans.get(request)?.end();
    });
    app.addHook('onError', async (_request, reply) => {
      replyStatusAtHookTime = reply.statusCode;
    });
    attachErrorCapture(app);

    app.post('/known', async () => ({ ok: true }));

    const res = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json' },
      payload,
    });
    await app.close();

    return {
      res,
      replyStatusAtHookTime,
      span: exporter.getFinishedSpans().find((s) => s.name === 'request'),
    };
  }

  it('leaves the span unset for an unrouted request whose body fails to parse', async () => {
    const { res, replyStatusAtHookTime, span } = await inject(`/nope?q=${'a'.repeat(50)}`, '');

    expect(res.statusCode).toBe(400);
    expect(replyStatusAtHookTime).toBe(200);
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('leaves the span unset for a matched route whose body fails to parse', async () => {
    const { res, replyStatusAtHookTime, span } = await inject('/known', '{not json');

    expect(res.statusCode).toBe(400);
    expect(replyStatusAtHookTime).toBe(200);
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });
});
