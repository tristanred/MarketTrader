import * as otel from '@opentelemetry/api';
import { meters } from './telemetry.js';

// BAD: a static field initialiser runs when the class is defined, at module load.
export class StaticField {
  static counter = otel.metrics.getMeter('static').createCounter('static.count');
}

// BAD: a static block runs at module load too.
export class StaticBlock {
  static tick: unknown;
  static {
    StaticBlock.tick = meters.workerTicks;
  }
}

// OK: an instance field initialiser runs per construction, not at load.
export class InstanceField {
  counter = otel.metrics.getMeter('instance').createCounter('instance.count');
}

// BAD: namespace import, at module load.
export const nsMeter = otel.metrics.getMeter('ns');
