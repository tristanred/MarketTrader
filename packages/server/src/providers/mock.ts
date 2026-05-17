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
 * portfolio math deterministic. `getDetails` is filled in by a later task in
 * the integration-test-suite plan.
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

  async getHistory(symbol: string, range: StockHistoryRange): Promise<StockHistoryBar[]> {
    const counts: Record<StockHistoryRange, number> = {
      '1d': 30,
      '5d': 60,
      '1mo': 30,
      '3mo': 90,
      '6mo': 180,
      '1y': 250,
    };
    const n = counts[range];

    const sym = symbol.toUpperCase();
    const seed = [...sym].reduce((a, c) => a + c.charCodeAt(0), 0);
    let rand = seed;
    const next = () => {
      rand = (rand * 9301 + 49297) % 233280;
      return rand / 233280;
    };

    const base = this.prices[sym] ?? 100;
    const nowSec = Math.floor(Date.now() / 1000);
    const stepSec = range === '1d' ? 60 * 5 : 24 * 60 * 60;

    const bars: StockHistoryBar[] = [];
    let last = base;
    for (let i = 0; i < n; i++) {
      const delta = (next() - 0.5) * base * 0.01;
      const close = +(last + delta).toFixed(2);
      bars.push({
        time: nowSec - (n - 1 - i) * stepSec,
        close,
      });
      last = close;
    }
    return bars;
  }

  async getDetails(_symbol: string): Promise<StockDetails> {
    throw new Error('not implemented');
  }
}
