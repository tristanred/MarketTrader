import type {
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';
import type { StockProvider } from '../../src/providers/index.js';
import { StockProviderError } from '../../src/providers/index.js';

/**
 * In-memory StockProvider used by integration tests.
 *
 * In addition to fixed quotes, supports:
 *  - `setError(symbol, code)` — make `getQuote(symbol)` throw a StockProviderError
 *  - `setStale(symbol, ageMs)` — return a quote whose `fetchedAt` is N ms in the past with `stale:true`
 */
export class MockStockProvider implements StockProvider {
  private quotes = new Map<string, StockQuote>();
  private errors = new Map<string, 'SYMBOL_NOT_FOUND' | 'PROVIDER_ERROR' | 'RATE_LIMITED'>();
  private stale = new Map<string, number>();

  setQuote(symbol: string, quote: Partial<StockQuote> = {}): void {
    this.quotes.set(symbol, {
      symbol,
      price: 100,
      change: 0,
      changePercent: 0,
      fetchedAt: new Date().toISOString(),
      ...quote,
    });
  }

  setError(symbol: string, code: 'SYMBOL_NOT_FOUND' | 'PROVIDER_ERROR' | 'RATE_LIMITED'): void {
    this.errors.set(symbol, code);
  }

  setStale(symbol: string, ageMs: number, quote: Partial<StockQuote> = {}): void {
    this.quotes.set(symbol, {
      symbol,
      price: 100,
      change: 0,
      changePercent: 0,
      ...quote,
      fetchedAt: new Date(Date.now() - ageMs).toISOString(),
      stale: true,
    });
    this.stale.set(symbol, ageMs);
  }

  clear(): void {
    this.quotes.clear();
    this.errors.clear();
    this.stale.clear();
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    const errCode = this.errors.get(symbol);
    if (errCode) throw new StockProviderError(errCode, `mock ${errCode}`);
    return (
      this.quotes.get(symbol) ?? {
        symbol,
        price: 100,
        change: 0,
        changePercent: 0,
        fetchedAt: new Date().toISOString(),
      }
    );
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    return [{ symbol: query.toUpperCase(), name: `Mock ${query}` }];
  }

  async getHistory(symbol: string, _range: StockHistoryRange): Promise<StockHistoryBar[]> {
    // Deterministic flat-ish series so chart-route tests can assert shape.
    const now = Math.floor(Date.now() / 1000);
    const base = this.quotes.get(symbol)?.price ?? 100;
    return Array.from({ length: 10 }, (_, i) => ({
      time: now - (9 - i) * 300,
      close: base + Math.sin(i) * 0.5,
    }));
  }
}
