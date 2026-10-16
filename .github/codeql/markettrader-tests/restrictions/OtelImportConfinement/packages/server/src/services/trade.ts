import { SpanStatusCode } from '@opentelemetry/api'; // OK: the one value allowed outside observability/
import type { Span, Attributes } from '@opentelemetry/api'; // OK: types are erased
import { type Tracer, SpanStatusCode as Code } from '@opentelemetry/api'; // OK: type + SpanStatusCode
import { metrics, SpanStatusCode as S2 } from '@opentelemetry/api'; // BAD: metrics
import * as api from '@opentelemetry/api'; // BAD: whole namespace
import { NodeSDK } from '@opentelemetry/sdk-node'; // BAD: SDK outside otel.ts
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'; // BAD: patching instrumentation outside otel.ts
import FastifyOtel from '@fastify/otel'; // BAD: only plugins/otel.ts
import { hrTime } from '@opentelemetry/core'; // BAD: SDK-side package outside otel.ts
import { B3Propagator } from '@opentelemetry/propagator-b3'; // BAD

export function f(span: Span, a: Attributes, t: Tracer) {
  return [SpanStatusCode, Code, metrics, S2, api, NodeSDK, getNodeAutoInstrumentations, FastifyOtel, hrTime, B3Propagator, span, a, t];
}

export async function lazy() {
  return import('@opentelemetry/api'); // BAD: dynamic load of the whole API
}
