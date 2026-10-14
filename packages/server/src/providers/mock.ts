import type {
  DiscoverItem,
  MarketMoverKind,
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';
import type { StockProvider } from './interface.js';
import { RANGE_BAR_SECONDS } from './interface.js';

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

/** Fixed market-mover lists for {@link MockProvider}: `[symbol, changePct]` pairs. */
const MOCK_MOVERS: Record<MarketMoverKind, ReadonlyArray<readonly [string, number]>> = {
  gainers: [
    ['NVDA', 6.2],
    ['TSLA', 4.8],
    ['AMD', 3.9],
    ['PLTR', 3.1],
    ['SMCI', 2.7],
  ],
  losers: [
    ['INTC', -5.4],
    ['BA', -3.8],
    ['NKE', -2.9],
    ['PFE', -2.2],
    ['DIS', -1.6],
  ],
  active: [
    ['AAPL', 0.8],
    ['NVDA', 6.2],
    ['TSLA', 4.8],
    ['AMZN', -0.4],
    ['F', 1.1],
  ],
  trending: [
    ['META', 1.9],
    ['MSFT', 0.5],
    ['GOOG', -0.7],
    ['NFLX', 2.3],
    ['UBER', -1.2],
  ],
};

/**
 * In-process {@link StockProvider} with hardcoded prices, used exclusively by
 * the e2e integration test suite. Avoids external network calls and keeps
 * portfolio math deterministic.
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

  async getMarketMovers(kind: MarketMoverKind, count: number): Promise<DiscoverItem[]> {
    return MOCK_MOVERS[kind].slice(0, count).map(([symbol, changePct]) => ({
      symbol,
      name: `${symbol} Mock Corp.`,
      price: this.prices[symbol] ?? 100,
      changePct,
    }));
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
    const stepSec = RANGE_BAR_SECONDS[range];

    const bars: StockHistoryBar[] = [];
    let last = base;
    for (let i = 0; i < n; i++) {
      const delta = (next() - 0.5) * base * 0.01;
      const open = last;
      const close = +(last + delta).toFixed(2);
      const high = +(Math.max(open, close) + next() * base * 0.004).toFixed(2);
      const low = +(Math.min(open, close) - next() * base * 0.004).toFixed(2);
      bars.push({
        time: nowSec - (n - 1 - i) * stepSec,
        open,
        high,
        low,
        close,
        volume: Math.round(50_000 + next() * 450_000),
      });
      last = close;
    }
    return bars;
  }

  async getDetails(symbol: string): Promise<StockDetails> {
    const sym = symbol.toUpperCase();
    const price = this.prices[sym] ?? 100;
    return {
      symbol: sym,
      price,
      change: 0,
      changePercent: 0,
      previousClose: price,
      dayVolume: 1_000_000,
      avgVolume: 1_000_000,
      exchange: 'MOCK',
      companyName: `${sym} Mock Corp.`,
      marketState: 'REGULAR',
      fetchedAt: new Date().toISOString(),
    };
  }
}
