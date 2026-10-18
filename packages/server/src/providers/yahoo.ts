import YahooFinance from 'yahoo-finance2';
import type {
  DiscoverItem,
  MarketMoverKind,
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
import type { StockFundamentals, StockProvider } from './interface.js';
import { StockProviderError } from './interface.js';
import type { ConfigReader } from '../config/runtime-config.js';
import { mostRecentTradingSession } from '../services/market-calendar.js';
import { isTradableSymbol } from '../services/symbol.js';

const SCREENER_IDS = {
  gainers: 'day_gainers',
  losers: 'day_losers',
  active: 'most_actives',
} as const;

/**
 * Over-fetch factor for market-mover lists: Yahoo's lists mix in ETFs, ADRs
 * with odd tickers, futures and crypto, which are filtered out afterwards.
 */
const MOVERS_OVERFETCH = 3;

const FUNDAMENTALS_MODULES = [
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'assetProfile',
  'calendarEvents',
] as const;

/** Longest `businessSummary` returned, ellipsis included. Keeps the analysis prompt small. */
const BUSINESS_SUMMARY_MAX_CHARS = 600;

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
 * Scoped to display- and analysis-only calls (`searchSymbols`, `getMarketMovers`,
 * `getFundamentals`) deliberately: recovering an unvalidated `getQuote` payload
 * could feed a subtly-wrong price into trade execution (business rule #1).
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
 * {@link StockProvider} backed by Yahoo Finance via the `yahoo-finance2` package (v4).
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

  constructor(private readonly config: ConfigReader) {
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
    this.rateLimitedUntil = Date.now() + this.config.get('STOCK_RATE_LIMIT_BACKOFF_MS');
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
    const r = row as Record<string, unknown>;
    const volume = r.regularMarketVolume;
    const open = r.regularMarketOpen;
    const high = r.regularMarketDayHigh;
    const low = r.regularMarketDayLow;
    return {
      symbol: typeof row.symbol === 'string' ? row.symbol : symbol,
      price: row.regularMarketPrice as number,
      change: (row.regularMarketChange as number | undefined) ?? 0,
      changePercent: (row.regularMarketChangePercent as number | undefined) ?? 0,
      fetchedAt: new Date().toISOString(),
      ...(marketState && { marketState }),
      ...(typeof volume === 'number' && { volume }),
      ...(typeof open === 'number' && { open }),
      ...(typeof high === 'number' && { high }),
      ...(typeof low === 'number' && { low }),
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
            'regularMarketOpen',
            'regularMarketDayHigh',
            'regularMarketDayLow',
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
      const open = row.regularMarketOpen;
      const high = row.regularMarketDayHigh;
      const low = row.regularMarketDayLow;
      out.set(sym, {
        symbol: typeof row.symbol === 'string' ? row.symbol : sym,
        price: row.regularMarketPrice as number,
        change: (row.regularMarketChange as number | undefined) ?? 0,
        changePercent: (row.regularMarketChangePercent as number | undefined) ?? 0,
        fetchedAt,
        ...(marketState && { marketState }),
        ...(typeof volume === 'number' && { volume }),
        ...(typeof open === 'number' && { open }),
        ...(typeof high === 'number' && { high }),
        ...(typeof low === 'number' && { low }),
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

  /**
   * Company fundamentals from one `quoteSummary` call. Throws `SYMBOL_NOT_FOUND`
   * when Yahoo knows no such symbol or returns none of the requested modules,
   * `RATE_LIMITED` on a 429, and `PROVIDER_ERROR` otherwise.
   */
  async getFundamentals(symbol: string): Promise<StockFundamentals> {
    this.throwIfRateLimited();

    let result: unknown;
    try {
      result = await this.client.quoteSummary(symbol, { modules: [...FUNDAMENTALS_MODULES] });
    } catch (err) {
      if (is429(err)) this.trip429();
      if (isYahooNotFound(err)) {
        throw new StockProviderError('SYMBOL_NOT_FOUND', `Symbol not found: ${symbol}`);
      }
      result = recoverYahooValidationResult(err);
      if (result === undefined) {
        throw new StockProviderError(
          'PROVIDER_ERROR',
          `Yahoo Finance fundamentals failed for ${symbol}`,
        );
      }
    }

    const modules = asRecord(result);
    if (FUNDAMENTALS_MODULES.every((m) => modules[m] == null)) {
      throw new StockProviderError('SYMBOL_NOT_FOUND', `Symbol not found: ${symbol}`);
    }
    return toFundamentals(modules);
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
      open?: number | null;
      high?: number | null;
      low?: number | null;
      close?: number | null;
      volume?: number | null;
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
        ...(q.open != null && { open: q.open }),
        ...(q.high != null && { high: q.high }),
        ...(q.low != null && { low: q.low }),
        close: q.close,
        ...(q.volume != null && { volume: q.volume }),
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

  async getMarketMovers(kind: MarketMoverKind, count: number): Promise<DiscoverItem[]> {
    this.throwIfRateLimited();
    const rows =
      kind === 'trending' ? await this.trendingRows(count) : await this.screenerRows(kind, count);
    return rows.flatMap(toDiscoverItem).slice(0, count);
  }

  private async screenerRows(
    kind: Exclude<MarketMoverKind, 'trending'>,
    count: number,
  ): Promise<unknown[]> {
    let result: { quotes?: unknown };
    try {
      result = await this.client.screener({
        scrIds: SCREENER_IDS[kind],
        count: count * MOVERS_OVERFETCH,
      });
    } catch (err) {
      if (is429(err)) this.trip429();
      const recovered = recoverYahooValidationResult(err);
      if (recovered === undefined) {
        throw new StockProviderError('PROVIDER_ERROR', `Yahoo Finance screener failed for ${kind}`);
      }
      result = recovered as { quotes?: unknown };
    }
    return Array.isArray(result?.quotes) ? (result.quotes as unknown[]) : [];
  }

  /** Trending only returns tickers, so a batch quote supplies name, price, and type. */
  private async trendingRows(count: number): Promise<unknown[]> {
    let symbols: string[];
    try {
      const result = await this.client.trendingSymbols('US', { count: count * MOVERS_OVERFETCH });
      symbols = result.quotes.map((q) => q.symbol);
    } catch (err) {
      if (is429(err)) this.trip429();
      const recovered = recoverYahooValidationResult(err) as { quotes?: unknown } | undefined;
      if (recovered === undefined) {
        throw new StockProviderError('PROVIDER_ERROR', 'Yahoo Finance trending symbols failed');
      }
      symbols = (Array.isArray(recovered.quotes) ? recovered.quotes : [])
        .map((q: unknown) => (q as { symbol?: unknown }).symbol)
        .filter((sym): sym is string => typeof sym === 'string');
    }
    const candidates = symbols.filter(isTradableSymbol);
    if (candidates.length === 0) return [];

    let rows: Map<string, unknown>;
    try {
      rows = await this.client.quote(candidates, {
        return: 'map',
        fields: [
          'symbol',
          'shortName',
          'longName',
          'quoteType',
          'regularMarketPrice',
          'regularMarketChangePercent',
        ],
      });
    } catch (err) {
      if (is429(err)) this.trip429();
      const recovered = recoverYahooValidationResult(err);
      if (!(recovered instanceof Map)) {
        throw new StockProviderError('PROVIDER_ERROR', 'Yahoo Finance trending quotes failed');
      }
      rows = recovered as Map<string, unknown>;
    }
    // Keep Yahoo's trending order rather than the map's.
    return candidates.map((sym) => rows.get(sym)).filter((row) => row != null);
  }
}

/**
 * Narrows one Yahoo quote-shaped row (screener or quote) to a Discover item.
 * Returns `[]` for anything that isn't a tradable equity with a price, so it
 * can be used with `flatMap`.
 */
function toDiscoverItem(raw: unknown): DiscoverItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const row = raw as Record<string, unknown>;
  const symbol = row.symbol;
  if (typeof symbol !== 'string' || !isTradableSymbol(symbol)) return [];
  if (row.quoteType !== 'EQUITY') return [];
  if (typeof row.regularMarketPrice !== 'number') return [];
  const name = row.shortName ?? row.longName;
  return [
    {
      symbol,
      name: typeof name === 'string' ? name : null,
      price: row.regularMarketPrice,
      changePct:
        typeof row.regularMarketChangePercent === 'number' ? row.regularMarketChangePercent : null,
    },
  ];
}

/**
 * Yahoo's `{ error: { code: "Not Found" } }` body surfaces as a plain `Error`
 * (yahoo-finance2 has no `NotFoundError` class); a bare 404 is an `HTTPError`
 * carrying the status in `code`.
 */
function isYahooNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (err as { code?: unknown }).code === 404 || /quote not found/i.test(err.message);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** A payload recovered from a failed validation can still hold Yahoo's `{ raw, fmt }` wrappers. */
function unwrapRaw(v: unknown): unknown {
  return v !== null && typeof v === 'object' && !(v instanceof Date) && 'raw' in v
    ? (v as { raw: unknown }).raw
    : v;
}

function toNum(v: unknown): number | undefined {
  const n = unwrapRaw(v);
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function toStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

/**
 * Below this a numeric date is epoch seconds, above it milliseconds: 1e11 s is
 * the year 5138, while 1e11 ms is 1973 — older than any date Yahoo reports here.
 */
const EPOCH_SECONDS_CEILING = 1e11;

/**
 * Normalises a Yahoo date to ISO 8601 UTC. Validation turns epoch seconds into
 * `Date`s, but it coerces in place and a recovered payload may have stopped
 * partway, so raw numbers and strings are accepted too.
 */
function toIso(v: unknown): string | undefined {
  const raw = unwrapRaw(v);
  let ms: number;
  if (raw instanceof Date) ms = raw.getTime();
  else if (typeof raw === 'number') ms = Math.abs(raw) < EPOCH_SECONDS_CEILING ? raw * 1000 : raw;
  else if (typeof raw === 'string' && raw.trim().length > 0) ms = Date.parse(raw);
  else return undefined;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Picks the earliest earnings date from today on, else Yahoo's first. */
function nextEarningsDate(calendar: Record<string, unknown>): string | undefined {
  const raw = asRecord(calendar.earnings).earningsDate;
  const dates = (Array.isArray(raw) ? raw : [])
    .map(toIso)
    .filter((d): d is string => d !== undefined);
  // From the start of today, not now: a call later today is still the next one.
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const cutoff = startOfToday.toISOString();
  const upcoming = dates.filter((d) => d >= cutoff).sort();
  return upcoming[0] ?? dates[0];
}

function truncateSummary(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const flat = text.replace(/\s+/g, ' ');
  if (flat.length <= BUSINESS_SUMMARY_MAX_CHARS) return flat;
  const cut = flat.slice(0, BUSINESS_SUMMARY_MAX_CHARS - 1);
  const lastSpace = cut.lastIndexOf(' ');
  // One unbroken run longer than the limit has no word boundary to cut at.
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function isUsdOrUnstated(currency: unknown): boolean {
  const c = toStr(currency);
  return c === undefined || c.toUpperCase() === 'USD';
}

/**
 * Narrows a `quoteSummary` result (validated or recovered) to
 * {@link StockFundamentals}, dropping anything missing, non-finite, or in a
 * currency other than USD.
 */
function toFundamentals(modules: Record<string, unknown>): StockFundamentals {
  const summary = asRecord(modules.summaryDetail);
  const stats = asRecord(modules.defaultKeyStatistics);
  const financial = asRecord(modules.financialData);
  const profile = asRecord(modules.assetProfile);
  const calendar = asRecord(modules.calendarEvents);

  // Prices are quoted in the listing's currency and statements in the filer's,
  // which differ for ADRs. Money in anything but USD is dropped, not mislabelled.
  const priceUsd = isUsdOrUnstated(summary.currency);
  const statementsUsd = isUsdOrUnstated(financial.financialCurrency);
  // Yahoo does not say which of the two an ADR's EPS is in, so it needs both.
  const epsUsd = priceUsd && statementsUsd;
  const ifUsd = (usd: boolean, v: number | undefined) => (usd ? v : undefined);

  // Yahoo reports debt-to-equity as a percentage (≈150 for 1.5×).
  const debtToEquityPct = toNum(financial.debtToEquity);
  const recommendation = toStr(financial.recommendationKey);

  const fields: { [K in keyof StockFundamentals]-?: StockFundamentals[K] | undefined } = {
    sector: toStr(profile.sector) ?? toStr(profile.sectorDisp),
    industry: toStr(profile.industry) ?? toStr(profile.industryDisp),
    businessSummary: truncateSummary(toStr(profile.longBusinessSummary)),
    employees: toNum(profile.fullTimeEmployees),
    marketCap: ifUsd(priceUsd, toNum(summary.marketCap)),
    trailingPE: toNum(summary.trailingPE),
    forwardPE: toNum(summary.forwardPE) ?? toNum(stats.forwardPE),
    pegRatio: toNum(stats.pegRatio),
    priceToBook: toNum(stats.priceToBook),
    priceToSales: toNum(summary.priceToSalesTrailing12Months),
    beta: toNum(summary.beta) ?? toNum(stats.beta),
    trailingEps: ifUsd(epsUsd, toNum(stats.trailingEps)),
    forwardEps: ifUsd(epsUsd, toNum(stats.forwardEps)),
    dividendYield: toNum(summary.dividendYield),
    payoutRatio: toNum(summary.payoutRatio),
    fiftyTwoWeekLow: ifUsd(priceUsd, toNum(summary.fiftyTwoWeekLow)),
    fiftyTwoWeekHigh: ifUsd(priceUsd, toNum(summary.fiftyTwoWeekHigh)),
    fiftyDayAverage: ifUsd(priceUsd, toNum(summary.fiftyDayAverage)),
    twoHundredDayAverage: ifUsd(priceUsd, toNum(summary.twoHundredDayAverage)),
    totalRevenue: ifUsd(statementsUsd, toNum(financial.totalRevenue)),
    revenueGrowth: toNum(financial.revenueGrowth),
    earningsGrowth: toNum(financial.earningsGrowth),
    grossMargins: toNum(financial.grossMargins),
    operatingMargins: toNum(financial.operatingMargins),
    profitMargins: toNum(financial.profitMargins) ?? toNum(stats.profitMargins),
    returnOnEquity: toNum(financial.returnOnEquity),
    freeCashflow: ifUsd(statementsUsd, toNum(financial.freeCashflow)),
    totalDebt: ifUsd(statementsUsd, toNum(financial.totalDebt)),
    totalCash: ifUsd(statementsUsd, toNum(financial.totalCash)),
    debtToEquity: debtToEquityPct === undefined ? undefined : debtToEquityPct / 100,
    currentRatio: toNum(financial.currentRatio),
    shortPercentOfFloat: toNum(stats.shortPercentOfFloat),
    // `none` is Yahoo's label for "no analyst coverage", not a recommendation.
    analystRecommendation: recommendation === 'none' ? undefined : recommendation,
    analystTargetMean: ifUsd(priceUsd, toNum(financial.targetMeanPrice)),
    analystCount: toNum(financial.numberOfAnalystOpinions),
    nextEarningsDate: nextEarningsDate(calendar),
    exDividendDate: toIso(calendar.exDividendDate) ?? toIso(summary.exDividendDate),
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as StockFundamentals;
}
