declare const tracer: {
  startActiveSpan<T>(name: string, ...rest: unknown[]): T;
  startSpan(name: string): { end(): void; updateName(n: string): void };
};
declare const app: {
  get(path: string, handler: (request: any, reply: any) => unknown): void;
};

// OK: literal name; the symbol goes on an attribute.
export function quote(params: { symbol: string }) {
  return tracer.startActiveSpan(
    'stock.quote',
    { attributes: { 'stock.symbol': params.symbol } },
    async (span: { end(): void }) => {
      span.end();
    },
  );
}

// OK: template over a parameter that every caller passes as a literal.
function upstream(operation: string) {
  return tracer.startActiveSpan(`provider.${operation}`, async (span: { end(): void }) => {
    span.end();
  });
}
export const a = upstream('getQuote');
export const b = upstream('search');

// OK: route template and method are bounded.
export function requestHook(span: { updateName(n: string): void }, request: any) {
  span.updateName(`${request.method} ${request.routeOptions.url}`);
}

// BAD: symbol property in the name.
export function bySymbol(params: { symbol: string }) {
  const s = tracer.startSpan(`quote ${params.symbol}`);
  s.end();
}

// BAD: route params in the name.
app.get('/games/:id', async (request, reply) => {
  const s = tracer.startSpan('game ' + request.params.gameId);
  s.end();
  return reply;
});

// BAD: user id via updateName.
export function forUser(span: { updateName(n: string): void }, user: { userId: string }) {
  span.updateName(`user.${user.userId}`);
}

// BAD: raw request URL (path params and query string) in the name.
export function rawUrl(span: { updateName(n: string): void }, request: any) {
  span.updateName(`${request.method} ${request.url}`);
}

// BAD: raw node request URL in the name.
export function rawNodeUrl(span: { updateName(n: string): void }, req: any) {
  span.updateName(`${req.method} ${req.raw.url}`);
}

// BAD: a parameter named `symbol` in the name.
export function bySymbolParam(symbol: string) {
  const s = tracer.startSpan(`quote ${symbol}`);
  s.end();
}

// OK: optional-chained route template (otel.ts shape).
export function hookedOptional(span: { updateName(n: string): void }, request: any) {
  const route = request.routeOptions?.url;
  if (route) span.updateName(`${request.method} ${route}`);
}

// OK: `symbol` parameter only reaches attributes (cached-provider.ts shape).
export function upstreamWithSymbol(operation: string, symbol: string | undefined) {
  return tracer.startActiveSpan(
    `provider.${operation}`,
    { attributes: { ...(symbol && { 'provider.symbol': symbol }) } },
    async (span: { end(): void }) => {
      span.end();
    },
  );
}
export const c = upstreamWithSymbol('getQuote', 'AAPL');
