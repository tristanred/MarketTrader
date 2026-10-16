// OK: the one place @fastify/otel is registered.
import FastifyOtelInstrumentation from '@fastify/otel';
import { trace } from '@opentelemetry/api';

export const p = [FastifyOtelInstrumentation, trace];
