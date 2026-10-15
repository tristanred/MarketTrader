interface Quote { price: number }
interface StockProvider {
  getQuote(symbol: string): Promise<Quote>;
  getQuotes?(symbols: string[]): Promise<Map<string, Quote>>;
}

export async function perRowLoop(provider: StockProvider, rows: { symbol: string }[]) {
  for (const row of rows) {
    await provider.getQuote(row.symbol); // $ Alert
  }
}

export async function whileLoop(provider: StockProvider, symbols: string[]) {
  let i = 0;
  while (i < symbols.length) {
    await provider.getQuote(symbols[i]); // $ Alert
    i++;
  }
}

export async function promiseAllMap(provider: StockProvider, symbols: string[]) {
  return Promise.all(symbols.map((s) => provider.getQuote(s))); // $ Alert
}

export async function promiseAllSettledViaVar(provider: StockProvider, symbols: string[]) {
  const pending = symbols.map(async (s) => {
    const q = await provider.getQuote(s); // $ Alert
    return q.price;
  });
  return Promise.allSettled(pending);
}

export async function singleQuote(provider: StockProvider, symbol: string) {
  return provider.getQuote(symbol);
}

export async function sequentialMapNotAwaitedTogether(provider: StockProvider, symbols: string[]) {
  // map without Promise.all is not a concurrent fan-out on its own.
  return symbols.map((s) => s.toUpperCase());
}

const MAX_CONCURRENT = 8;

export async function chunked(provider: StockProvider, symbols: string[]) {
  const out: Quote[] = [];
  for (let i = 0; i < symbols.length; i += MAX_CONCURRENT) {
    const slice = symbols.slice(i, i + MAX_CONCURRENT);
    const settled = await Promise.all(slice.map((s) => provider.getQuote(s).catch(() => null)));
    for (const q of settled) if (q) out.push(q);
  }
  return out;
}

// POSITIVE: slice(0) is a copy, not a chunk.
export async function sliceCopy(provider: StockProvider, symbols: string[]) {
  return Promise.all(symbols.slice(0).map((s) => provider.getQuote(s)));
}

// POSITIVE: open-ended slice inside a loop is still the whole tail.
export async function sliceTail(provider: StockProvider, symbols: string[]) {
  for (let i = 0; i < 1; i++) {
    const rest = symbols.slice(i);
    await Promise.all(rest.map((s) => provider.getQuote(s)));
  }
}

declare function withRetry<T>(fn: () => Promise<T>): Promise<T>;

// POSITIVE: the per-row call is wrapped in a closure inside the loop body.
export async function retryInLoop(provider: StockProvider, rows: { symbol: string }[]) {
  for (const row of rows) {
    if (row.symbol) {
      await withRetry(() => provider.getQuote(row.symbol));
    }
  }
}

// POSITIVE: optional-call spelling inside a forEach.
export function optionalForEach(provider: Partial<StockProvider>, symbols: string[]) {
  symbols.forEach((s) => {
    void provider.getQuote?.(s);
  });
}

export async function batched(provider: StockProvider, symbols: string[]) {
  if (provider.getQuotes) return provider.getQuotes(symbols);
  return new Map();
}
