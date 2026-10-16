declare const tracer: { startSpan(name: string): { end(): void } };

// Out of scope (tools/): never flagged.
export function seed(row: { id: string }) {
  tracer.startSpan(`seed ${row.id}`).end();
}
