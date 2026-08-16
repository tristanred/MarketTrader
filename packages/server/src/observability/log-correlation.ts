import { trace, isSpanContextValid } from '@opentelemetry/api';

/**
 * pino `mixin` that stamps the active span's ids onto every log line, which is
 * what lets Grafana pivot from a log record to its trace.
 *
 * A mixin is used rather than `@opentelemetry/instrumentation-pino` because
 * that package patches the `pino` module, and module patching does not survive
 * tsup's bundle (ADR-015). The field names match the OTel log-record
 * convention so the collector maps them onto the record's trace context
 * instead of leaving them as loose attributes.
 */
export function traceContextMixin(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (!span) return {};

  const ctx = span.spanContext();
  if (!isSpanContextValid(ctx)) return {};

  return {
    trace_id: ctx.traceId,
    span_id: ctx.spanId,
    trace_flags: ctx.traceFlags.toString(16),
  };
}
