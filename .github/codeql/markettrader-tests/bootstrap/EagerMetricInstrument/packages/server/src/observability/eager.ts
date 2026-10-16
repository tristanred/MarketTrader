import { metrics } from '@opentelemetry/api';

// BAD: meter and instrument created at module load.
const meter = metrics.getMeter('eager');
export const counter = meter.createCounter('eager.count');

function build() {
  const m = metrics.getMeter('built');
  return m.createUpDownCounter('built.clients');
}

// BAD: a load-time call into a function that creates instruments.
export const built = build();

// BAD: an IIFE runs at load too.
export const viaIife = (() => metrics.getMeter('iife').createGauge('iife.gauge'))();

// OK: only called later.
export function later() {
  return build();
}

// BAD: reading the lazy proxy at load builds every instrument now.
import { meters } from './telemetry.js';
export const trades = meters.trades;
export const { duration } = meters;

// OK: proxy read only when recording.
export function record() {
  meters.trades.add(1);
}

// OK: not an OpenTelemetry meter.
const registry = { createCounter: (n: string) => n };
export const notOtel = registry.createCounter('x');
