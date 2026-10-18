import type {
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';
import type { StockProvider } from '../../src/providers/index.js';
import { StockProviderError } from '../../src/providers/index.js';
import type { StockFundamentals } from '../../src/providers/interface.js';

type ProviderErrorCode = 'SYMBOL_NOT_FOUND' | 'PROVIDER_ERROR' | 'RATE_LIMITED';

/**
 * In-memory StockProvider used by integration tests.
 *
 * In addition to fixed quotes, supports:
 *  - `setError(symbol, code)` — make `getQuote(symbol)` throw a StockProviderError
 *  - `setStale(symbol, ageMs)` — return a quote whose `fetchedAt` is N ms in the past with `stale:true`
 *  - `setFundamentals(symbol, f)` / `setFundamentalsError(symbol, code)` — control
 *    `getFundamentals` independently of quotes. Pass `{ fundamentals: false }` for a
 *    provider without the method.
 */
export class MockStockProvider implements StockProvider {
  private quotes = new Map<string, StockQuote>();
  private errors = new Map<string, ProviderErrorCode>();
  private stale = new Map<string, number>();
  private fundamentals = new Map<string, StockFundamentals>();
  private fundamentalsErrors = new Map<string, ProviderErrorCode>();
  fundamentalsCalls = 0;

  readonly getFundamentals?: (symbol: string) => Promise<StockFundamentals>;

  constructor(options: { fundamentals?: boolean } = {}) {
    if (options.fundamentals !== false) {
      this.getFundamentals = async (symbol) => {
        this.fundamentalsCalls += 1;
        const errCode = this.fundamentalsErrors.get(symbol);
        if (errCode) throw new StockProviderError(errCode, `mock ${errCode}`);
        return (
          this.fundamentals.get(symbol) ?? {
            sector: 'Technology',
            industry: 'Software',
            marketCap: 1_000_000_000,
            trailingPE: 20,
          }
        );
      };
    }
  }

  setFundamentals(symbol: string, fundamentals: StockFundamentals): void {
    this.fundamentals.set(symbol, fundamentals);
  }

  setFundamentalsError(symbol: string, code: ProviderErrorCode): void {
    this.fundamentalsErrors.set(symbol, code);
  }

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

  setError(symbol: string, code: ProviderErrorCode): void {
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
    this.fundamentals.clear();
    this.fundamentalsErrors.clear();
    this.fundamentalsCalls = 0;
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

  async getDetails(symbol: string): Promise<StockDetails> {
    const errCode = this.errors.get(symbol);
    if (errCode) throw new StockProviderError(errCode, `mock ${errCode}`);
    const quote = this.quotes.get(symbol);
    const price = quote?.price ?? 100;
    return {
      symbol,
      price,
      change: quote?.change ?? 0,
      changePercent: quote?.changePercent ?? 0,
      previousClose: price,
      dayVolume: 1_000_000,
      avgVolume: 1_500_000,
      exchange: 'NASDAQ',
      companyName: `Mock ${symbol}`,
      fetchedAt: quote?.fetchedAt ?? new Date().toISOString(),
    };
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
