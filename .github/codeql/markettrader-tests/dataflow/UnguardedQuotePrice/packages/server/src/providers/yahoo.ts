class StockProviderError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export class YahooFinanceProvider {
  constructor(private client: any) {}

  async getQuote(symbol: string) {
    const result = await this.client.quote(symbol);
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || row.regularMarketPrice == null) {
      throw new StockProviderError('SYMBOL_NOT_FOUND', `Symbol not found: ${symbol}`);
    }
    // BAD: only null-checked; 0 / negative / NaN pass.
    return { symbol, price: row.regularMarketPrice as number, change: 0 };
  }

  async getQuotes(symbols: string[]) {
    const out = new Map<string, unknown>();
    const rows: Map<string, unknown> = await this.client.quote(symbols, { return: 'map' });
    for (const [sym, raw] of rows) {
      const row = raw as Record<string, unknown>;
      if (row.regularMarketPrice == null) continue;
      // BAD: only null-checked.
      out.set(sym, { symbol: sym, price: row.regularMarketPrice as number });
    }
    for (const [sym, raw] of rows) {
      const row = raw as Record<string, unknown>;
      if (typeof row.regularMarketPrice !== 'number' || !(row.regularMarketPrice > 0)) continue;
      // GOOD: positivity guard dominates.
      out.set(sym, { symbol: sym, price: row.regularMarketPrice });
    }
    return out;
  }

  async getDetails(symbol: string) {
    const row = await this.client.quote(symbol);
    // GOOD (out of scope): details are display-only, not an execution price.
    return { symbol, price: row.regularMarketPrice as number };
  }
}
