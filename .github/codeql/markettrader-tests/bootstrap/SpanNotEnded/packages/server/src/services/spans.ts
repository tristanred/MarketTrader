declare const tracer: {
  startActiveSpan<T>(name: string, ...rest: unknown[]): T;
  startSpan(name: string): { end(): void; setAttribute(k: string, v: unknown): void };
};
declare const SpanStatusCode: { ERROR: number };
type Span = { end(): void; recordException(e: unknown): void; setStatus(s: unknown): void };
declare function work(): Promise<number>;

// OK: the canonical shape, with options.
export function good() {
  return tracer.startActiveSpan('good', { attributes: {} }, async (span: Span) => {
    try {
      return await work();
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

// OK: callback defined separately but resolvable locally.
const named = async (s: Span) => {
  try {
    await work();
  } catch (e) {
    s.recordException(e);
    s.setStatus({ code: SpanStatusCode.ERROR });
    throw e;
  } finally {
    s.end();
  }
};
export function goodNamed() {
  return tracer.startActiveSpan('named', named);
}

// BAD: separately-defined callback is resolved and checked too.
const badNamed = async (s: Span) => {
  await work();
  s.end();
};
export function badNamedUse() {
  return tracer.startActiveSpan('badnamed', badNamed);
}

// BAD: end() only on the happy path.
export function noFinally() {
  return tracer.startActiveSpan('nofinally', async (span: Span) => {
    const r = await work();
    span.end();
    return r;
  });
}

// BAD: finally ends the span, but the catch neither records nor sets status.
export function noCatch() {
  return tracer.startActiveSpan('nocatch', async (span: Span) => {
    try {
      return await work();
    } finally {
      span.end();
    }
  });
}

// BAD: records the exception but never sets ERROR status.
export function noStatus() {
  return tracer.startActiveSpan('nostatus', async (span: Span) => {
    try {
      return await work();
    } catch (err) {
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
}

// BAD: no span parameter at all.
export function noParam() {
  return tracer.startActiveSpan('noparam', async () => work());
}

// OK: startSpan ended in the same function.
export function manualGood() {
  const span = tracer.startSpan('manual');
  try {
    span.setAttribute('k', 1);
  } finally {
    span.end();
  }
}

// BAD: startSpan never ended.
export function manualLeak() {
  const span = tracer.startSpan('leak');
  span.setAttribute('k', 1);
}
