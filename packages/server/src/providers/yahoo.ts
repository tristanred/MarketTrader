import YahooFinance from 'yahoo-finance2';
import type {
  MarketState,
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';

const MARKET_STATES = new Set<MarketState>([
  'PRE',
  'PREPRE',
  'REGULAR',
  'POST',
  'POSTPOST',
  'CLOSED',
]);
function asMarketState(raw: unknown): MarketState | undefined {
  return typeof raw === 'string' && (MARKET_STATES as Set<string>).has(raw)
    ? (raw as MarketState)
    : undefined;
}
import type { StockProvider } from './interface.js';
import { StockProviderError } from './interface.js';
import { env } from '../env.js';
import { mostRecentTradingSession } from '../services/market-calendar.js';

/**
 * Maps the public range key to a (lookback, interval) pair for the Yahoo chart
 * API. Shorter ranges use intraday bars; longer ranges use daily bars.
 */
const RANGE_PARAMS: Record<
  StockHistoryRange,
  { lookbackDays: number; interval: '5m' | '15m' | '1h' | '1d' }
> = {
  '1d': { lookbackDays: 1, interval: '5m' },
  '5d': { lookbackDays: 5, interval: '15m' },
  '1mo': { lookbackDays: 31, interval: '1h' },
  '3mo': { lookbackDays: 93, interval: '1d' },
  '6mo': { lookbackDays: 186, interval: '1d' },
  '1y': { lookbackDays: 366, interval: '1d' },
};

function is429(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return m.includes('too many requests') || m.includes('status code 429');
}

/**
 * yahoo-finance2 throws `FailedYahooValidationError` when Yahoo's response drifts
 * from the library's bundled JSON schema even though the payload is otherwise
 * intact (e.g. search now returns `typeDisp: "Equity"` where the schema pins the
 * `"equity"` enum). The error carries the parsed response in `.result`, so return
 * it to keep benign schema drift from failing the call. Returns `undefined` for
 * any other error so the caller maps it through the normal error path.
 *
 * Scoped to `searchSymbols` deliberately: recovering an unvalidated `getQuote`
 * payload could feed a subtly-wrong price into trade execution (business rule #1).
 */
function recoverYahooValidationResult(err: unknown): unknown {
  if (
    err instanceof Error &&
    err.name === 'FailedYahooValidationError' &&
    'result' in err &&
    (err as { result?: unknown }).result != null
  ) {
    return (err as { result?: unknown }).result;
  }
  return undefined;
}

/**
 * {@link StockProvider} backed by Yahoo Finance via the `yahoo-finance2` package (v3).
 * Requires no API key and is the default provider (`STOCK_PROVIDER=yahoo`).
 *
 * Detects upstream HTTP 429 responses and:
 *   1. Maps them to {@link StockProviderError} with code `RATE_LIMITED`.
 *   2. Records a per-instance backoff deadline so subsequent calls inside the
 *      window fail fast without re-hitting Yahoo, avoiding rate-limit escalation.
 *
 * `searchSymbols` filters results to EQUITY quote types only, so funds and
 * crypto are excluded from autocomplete suggestions.
 */
export class YahooProvider implements StockProvider {
  private readonly client: InstanceType<typeof YahooFinance>;
  private rateLimitedUntil = 0;

  constructor() {
    this.client = new YahooFinance({
      validation: { logErrors: false },
      suppressNotices: ['yahooSurvey'],
    });
  }

  private throwIfRateLimited(): void {
    if (Date.now() < this.rateLimitedUntil) {
      throw new StockProviderError(
        'RATE_LIMITED',
        'Upstream provider is rate-limiting this client. Retry after the backoff window.',
      );
    }
  }

  private trip429(): never {
    this.rateLimitedUntil = Date.now() + env.STOCK_RATE_LIMIT_BACKOFF_MS;
    throw new StockProviderError(
      'RATE_LIMITED',
      'Upstream provider returned HTTP 429 Too Many Requests.',
    );
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    this.throwIfRateLimited();

    let result: Awaited<ReturnType<typeof this.client.quote>>;
    try {
      result = await this.client.quote(symbol);
    } catch (err) {
      if (is429(err)) this.trip429();
      throw new StockProviderError('PROVIDER_ERROR', `Yahoo Finance error for ${symbol}`);
    }

    // `quote()` may return undefined or an array when given a single string in some edge cases.
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || typeof row !== 'object' || !('regularMarketPrice' in row) || row.regularMarketPrice == null) {
      throw new StockProviderError('SYMBOL_NOT_FOUND', `Symbol not found: ${symbol}`);
    }

    const marketState = asMarketState((row as { marketState?: unknown }).marketState);
    const volume = (row as { regularMarketVolume?: unknown }).regularMarketVolume;
    return {
      symbol: typeof row.symbol === 'string' ? row.symbol : symbol,
      price: row.regularMarketPrice as number,
      change: (row.regularMarketChange as number | undefined) ?? 0,
      changePercent: (row.regularMarketChangePercent as number | undefined) ?? 0,
      fetchedAt: new Date().toISOString(),
      ...(marketState && { marketState }),
      ...(typeof volume === 'number' && { volume }),
    };
  }

  async getQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
    const out = new Map<string, StockQuote>();
    const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
    if (unique.length === 0) return out;

    this.throwIfRateLimited();

    let rows: Map<string, unknown>;
    try {
      // Validated batch (same trade-safety discipline as getQuote — these rows
      // are written into the shared price cache). `return: 'map'` keys by symbol.
      rows = await this.client.quote(
        unique,
        {
          return: 'map',
          fields: [
            'symbol',
            'regularMarketPrice',
            'regularMarketChange',
            'regularMarketChangePercent',
            'regularMarketVolume',
            'marketState',
          ],
        },
      );
    } catch (err) {
      if (is429(err)) this.trip429();
      throw new StockProviderError('PROVIDER_ERROR', 'Yahoo Finance batch quote failed');
    }

    const fetchedAt = new Date().toISOString();
    for (const [sym, raw] of rows) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      // Skip rows without a usable price — no partial quotes in the cache.
      if (row.regularMarketPrice == null) continue;
      const marketState = asMarketState(row.marketState);
      const volume = row.regularMarketVolume;
      out.set(sym, {
        symbol: typeof row.symbol === 'string' ? row.symbol : sym,
        price: row.regularMarketPrice as number,
        change: (row.regularMarketChange as number | undefined) ?? 0,
        changePercent: (row.regularMarketChangePercent as number | undefined) ?? 0,
        fetchedAt,
        ...(marketState && { marketState }),
        ...(typeof volume === 'number' && { volume }),
      });
    }
    return out;
  }

  async getDetails(symbol: string): Promise<StockDetails> {
    this.throwIfRateLimited();

    let result: Awaited<ReturnType<typeof this.client.quote>>;
    try {
      result = await this.client.quote(symbol);
    } catch (err) {
      if (is429(err)) this.trip429();
      throw new StockProviderError('PROVIDER_ERROR', `Yahoo Finance error for ${symbol}`);
    }

    const row = Array.isArray(result) ? result[0] : result;
    if (!row || typeof row !== 'object' || !('regularMarketPrice' in row) || row.regularMarketPrice == null) {
      throw new StockProviderError('SYMBOL_NOT_FOUND', `Symbol not found: ${symbol}`);
    }

    const r = row as Record<string, unknown>;
    const marketState = asMarketState(r.marketState);
    const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.length > 0 ? v : undefined;

    const details: StockDetails = {
      symbol: str(r.symbol) ?? symbol,
      price: r.regularMarketPrice as number,
      change: num(r.regularMarketChange) ?? 0,
      changePercent: num(r.regularMarketChangePercent) ?? 0,
      fetchedAt: new Date().toISOString(),
    };
    const previousClose = num(r.regularMarketPreviousClose);
    if (previousClose !== undefined) details.previousClose = previousClose;
    const dayVolume = num(r.regularMarketVolume);
    if (dayVolume !== undefined) details.dayVolume = dayVolume;
    const avgVolume = num(r.averageDailyVolume3Month);
    if (avgVolume !== undefined) details.avgVolume = avgVolume;
    const exchange = str(r.fullExchangeName);
    if (exchange !== undefined) details.exchange = exchange;
    const companyName = str(r.longName) ?? str(r.shortName);
    if (companyName !== undefined) details.companyName = companyName;
    if (marketState) details.marketState = marketState;
    return details;
  }

  async getHistory(symbol: string, range: StockHistoryRange): Promise<StockHistoryBar[]> {
    this.throwIfRateLimited();

    const { lookbackDays, interval } = RANGE_PARAMS[range];

    // For the intraday "1D" range, anchor the window to the most recent
    // NYSE regular session instead of "now − 1 day". Without this, weekend
    // and pre-market viewers get an empty chart — Yahoo returns no bars
    // when the requested window covers no trading minutes.
    let period1: Date;
    let period2: Date | undefined;
    if (range === '1d') {
      const session = mostRecentTradingSession();
      period1 = session.start;
      period2 = session.end;
    } else {
      period1 = new Date(Date.now() - lookbackDays * 86_400_000);
    }

    interface ChartBar {
      date?: Date | string | number;
      close?: number | null;
    }
    interface ChartResult {
      quotes?: ChartBar[];
    }
    let result: ChartResult;
    try {
      result = (await this.client.chart(symbol, {
        period1,
        ...(period2 ? { period2 } : {}),
        interval,
        return: 'array',
      })) as ChartResult;
    } catch (err) {
      if (is429(err)) this.trip429();
      throw new StockProviderError(
        'PROVIDER_ERROR',
        `Yahoo Finance history failed for ${symbol}`,
      );
    }

    const quotes: ChartBar[] = Array.isArray(result.quotes) ? result.quotes : [];
    const bars: StockHistoryBar[] = [];
    for (const q of quotes) {
      if (!q || q.close == null || !q.date) continue;
      bars.push({
        time: Math.floor(new Date(q.date).getTime() / 1000),
        close: q.close,
      });
    }
    return bars;
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    this.throwIfRateLimited();

    let result: { quotes?: unknown };
    try {
      result = await this.client.search(query);
    } catch (err) {
      if (is429(err)) this.trip429();
      const recovered = recoverYahooValidationResult(err);
      if (recovered === undefined) {
        throw new StockProviderError('PROVIDER_ERROR', `Yahoo Finance search failed for "${query}"`);
      }
      result = recovered as { quotes?: unknown };
    }

    interface EquityQuote {
      isYahooFinance: true;
      quoteType: 'EQUITY';
      symbol: string;
      shortname?: string;
      longname?: string;
    }
    const isEquity = (q: unknown): q is EquityQuote =>
      typeof q === 'object' &&
      q !== null &&
      (q as { isYahooFinance?: unknown }).isYahooFinance === true &&
      (q as { quoteType?: unknown }).quoteType === 'EQUITY' &&
      typeof (q as { symbol?: unknown }).symbol === 'string';

    const quotes = Array.isArray(result?.quotes) ? (result.quotes as unknown[]) : [];
    return quotes.filter(isEquity).map((q) => ({
      symbol: q.symbol,
      name: q.shortname ?? q.longname ?? q.symbol,
    }));
  }
}
