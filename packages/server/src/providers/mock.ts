import type {
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';
import type { StockProvider } from './interface.js';

/**
 * Deterministic price table used by {@link MockProvider}. Keys are uppercase
 * tickers; the value is the fixed price returned for that symbol. Unknown
 * symbols fall back to $100.
 */
export const MOCK_PRICE_MAP: Record<string, number> = {
  AAPL: 180,
  MSFT: 420,
  GOOG: 140,
  NVDA: 950,
  TSLA: 240,
  AMZN: 200,
  META: 500,
};

/**
 * In-process {@link StockProvider} with hardcoded prices, used exclusively by
 * the e2e integration test suite. Avoids external network calls and keeps
 * portfolio math deterministic. Unimplemented methods throw — they are filled
 * in by later tasks in the integration-test-suite plan.
 */
export class MockProvider implements StockProvider {
  private readonly prices: Record<string, number>;

  constructor(overrides: Record<string, number> = {}) {
    this.prices = { ...MOCK_PRICE_MAP, ...overrides };
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    const sym = symbol.toUpperCase();
    const price = this.prices[sym] ?? 100;
    return {
      symbol: sym,
      price,
      change: 0,
      changePercent: 0,
      fetchedAt: new Date().toISOString(),
      marketState: 'REGULAR',
    };
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    const q = query.trim().toUpperCase();
    const symbols = Object.keys(this.prices);
    const matches = q === '' ? symbols : symbols.filter((s) => s.includes(q));
    return matches.slice(0, 10).map((symbol) => ({
      symbol,
      name: `${symbol} Mock Corp.`,
    }));
  }

  async getHistory(_symbol: string, _range: StockHistoryRange): Promise<StockHistoryBar[]> {
    throw new Error('not implemented');
  }

  async getDetails(_symbol: string): Promise<StockDetails> {
    throw new Error('not implemented');
  }
}
