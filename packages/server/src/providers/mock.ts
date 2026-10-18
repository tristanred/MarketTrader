import type {
  DiscoverItem,
  MarketMoverKind,
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';
import type { StockFundamentals, StockProvider } from './interface.js';
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

/** Midnight UTC `days` from today: relative to the run, yet stable within a day. */
function daysFromToday(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

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

  /** Plausible fundamentals derived from a hash of the symbol, so each ticker is stable. */
  async getFundamentals(symbol: string): Promise<StockFundamentals> {
    const sym = symbol.toUpperCase();
    const price = this.prices[sym] ?? 100;
    const seed = [...sym].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 10_007, 7);
    const frac = (salt: number) => ((seed * (salt + 1) * 7_919) % 1_000) / 1_000;
    const round = (v: number, dp: number) => +v.toFixed(dp);

    const trailingPE = round(12 + frac(1) * 30, 2);
    const shares = Math.round(1e9 + frac(2) * 9e9);
    const totalRevenue = Math.round(price * shares * (0.1 + frac(3) * 0.4));
    return {
      sector: 'Technology',
      industry: 'Software—Infrastructure',
      businessSummary: `${sym} Mock Corp. designs and sells mock products and services worldwide.`,
      employees: Math.round(5_000 + frac(4) * 150_000),
      marketCap: price * shares,
      trailingPE,
      forwardPE: round(trailingPE * (0.75 + frac(5) * 0.2), 2),
      pegRatio: round(0.8 + frac(6) * 2, 2),
      priceToBook: round(2 + frac(7) * 20, 2),
      priceToSales: round((price * shares) / totalRevenue, 2),
      beta: round(0.6 + frac(8) * 1.2, 2),
      trailingEps: round(price / trailingPE, 2),
      forwardEps: round((price / trailingPE) * 1.1, 2),
      dividendYield: round(frac(9) * 0.03, 4),
      payoutRatio: round(frac(10) * 0.5, 4),
      fiftyTwoWeekLow: round(price * 0.7, 2),
      fiftyTwoWeekHigh: round(price * 1.2, 2),
      fiftyDayAverage: round(price * 0.98, 2),
      twoHundredDayAverage: round(price * 0.92, 2),
      totalRevenue,
      revenueGrowth: round(frac(11) * 0.3 - 0.05, 4),
      earningsGrowth: round(frac(12) * 0.4 - 0.1, 4),
      grossMargins: round(0.4 + frac(13) * 0.4, 4),
      operatingMargins: round(0.1 + frac(14) * 0.3, 4),
      profitMargins: round(0.05 + frac(15) * 0.25, 4),
      returnOnEquity: round(0.05 + frac(16) * 0.4, 4),
      freeCashflow: Math.round(totalRevenue * 0.2),
      totalDebt: Math.round(totalRevenue * 0.4),
      totalCash: Math.round(totalRevenue * 0.3),
      debtToEquity: round(0.2 + frac(17) * 1.5, 2),
      currentRatio: round(0.8 + frac(18) * 2, 2),
      shortPercentOfFloat: round(frac(19) * 0.05, 4),
      analystRecommendation: 'buy',
      analystTargetMean: round(price * 1.15, 2),
      analystCount: 10 + Math.round(frac(20) * 40),
      nextEarningsDate: daysFromToday(7 + Math.round(frac(21) * 60)),
      exDividendDate: daysFromToday(-10 - Math.round(frac(22) * 60)),
    };
  }
}
