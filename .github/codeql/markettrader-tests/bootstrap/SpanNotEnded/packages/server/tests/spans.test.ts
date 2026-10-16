declare const tracer: { startSpan(name: string): { end(): void } };

// Out of scope (tests/): never flagged.
export function leakInTest() {
  tracer.startSpan('test');
}
