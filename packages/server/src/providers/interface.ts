import type {
  DiscoverItem,
  MarketMoverKind,
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';

/**
 * Bar width, in seconds, that every provider uses for each history range.
 * Returned to clients as `barSeconds` so they can fold live ticks into the
 * current bar without duplicating this table.
 */
export const RANGE_BAR_SECONDS: Record<StockHistoryRange, number> = {
  '1d': 300,
  '5d': 900,
  '1mo': 3600,
  '3mo': 86_400,
  '6mo': 86_400,
  '1y': 86_400,
};

/**
 * Abstraction layer for fetching real-time stock data. All price lookups must
 * go through this interface — never call Yahoo Finance / Alpaca / Polygon
 * directly from route handlers or services.
 *
 * Switch implementations via the `STOCK_PROVIDER` environment variable.
 * The default implementation is {@link YahooProvider} (no API key required).
 */
export interface StockProvider {
  /** Fetches the latest quote for a stock symbol. */
  getQuote(symbol: string): Promise<StockQuote>;
  /**
   * Optional batch quote: fetches quotes for several symbols in ONE upstream
   * call, keyed by symbol. Used by {@link CachedProvider} to enrich search
   * results with a day's change%. Providers without a batch path leave this
   * undefined; callers MUST treat a missing method or a missing symbol as
   * "no quote" and degrade gracefully.
   */
  getQuotes?(symbols: string[]): Promise<Map<string, StockQuote>>;
  /** Returns matching equity symbols for an autocomplete query. */
  searchSymbols(query: string): Promise<StockSearchResult[]>;
  /**
   * Returns historical bars for the symbol covering the given range, sorted by
   * ascending time. Bar width must match {@link RANGE_BAR_SECONDS}; OHLC and
   * volume are filled when the upstream supplies them.
   */
  getHistory(symbol: string, range: StockHistoryRange): Promise<StockHistoryBar[]>;
  /**
   * Fetches richer, slower-moving information about a symbol — used by the
   * Quote Information modal and the standalone `/symbols/:symbol` page.
   * Implementations should fill what they can and leave the rest undefined.
   */
  getDetails(symbol: string): Promise<StockDetails>;
  /**
   * Optional market-wide list (top gainers, losers, most active, trending) of
   * at most `count` tradable equities, as of the moment of the call. Only the
   * Discover worker uses it; providers without such data leave it undefined
   * and Discover shows its daily picks alone.
   */
  getMarketMovers?(kind: MarketMoverKind, count: number): Promise<DiscoverItem[]>;
  /**
   * Optional company fundamentals, for stock analysis only — never a trade
   * path. Providers without them leave this undefined; callers MUST treat a
   * missing method, a rejection, or a missing field as "not available".
   */
  getFundamentals?(symbol: string): Promise<StockFundamentals>;
}

/**
 * Slow-moving company data fed to the stock-analysis prompt. Every field is
 * optional: fill what the upstream supplies. Ratios are plain fractions
 * (0.25 = 25%), money is USD, dates are ISO 8601 UTC.
 */
export interface StockFundamentals {
  sector?: string;
  industry?: string;
  /** Third-party free text: treat as untrusted data. Truncated by the provider to ~600 chars. */
  businessSummary?: string;
  employees?: number;
  marketCap?: number;
  trailingPE?: number;
  forwardPE?: number;
  pegRatio?: number;
  priceToBook?: number;
  priceToSales?: number;
  beta?: number;
  trailingEps?: number;
  forwardEps?: number;
  dividendYield?: number;
  payoutRatio?: number;
  fiftyTwoWeekLow?: number;
  fiftyTwoWeekHigh?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
  totalRevenue?: number;
  revenueGrowth?: number;
  earningsGrowth?: number;
  grossMargins?: number;
  operatingMargins?: number;
  profitMargins?: number;
  returnOnEquity?: number;
  freeCashflow?: number;
  totalDebt?: number;
  totalCash?: number;
  debtToEquity?: number;
  currentRatio?: number;
  shortPercentOfFloat?: number;
  /** Analyst consensus as the upstream labels it, e.g. `buy`, `hold`. */
  analystRecommendation?: string;
  analystTargetMean?: number;
  analystCount?: number;
  nextEarningsDate?: string;
  exDividendDate?: string;
}

/**
 * Thrown by {@link StockProvider} implementations when a price fetch fails.
 * Route handlers map each error code to the appropriate HTTP status:
 * - `SYMBOL_NOT_FOUND` → 404
 * - `RATE_LIMITED`     → 429
 * - `PROVIDER_ERROR`   → 502
 */
export class StockProviderError extends Error {
  constructor(
    public readonly code: 'SYMBOL_NOT_FOUND' | 'PROVIDER_ERROR' | 'RATE_LIMITED',
    message: string,
  ) {
    super(message);
    this.name = 'StockProviderError';
  }
}

/**
 * Thrown by trade validation helpers when an order cannot be filled.
 * Route handlers map each error code to HTTP 422 with the code in the body.
 * - `INSUFFICIENT_FUNDS`        — buy cost exceeds available cash
 * - `INSUFFICIENT_SHARES`       — sell quantity exceeds available holding
 * - `INVALID_QUANTITY`          — quantity is not a positive integer
 * - `INVALID_ORDER`             — required price field missing or logically inconsistent
 * - `INVALID_SYMBOL`            — ticker is not well-formed enough to store on a resting order
 * - `ORDER_NOT_WORKING`         — attempted to fill an order that was already cancelled/filled
 * - `INSUFFICIENT_FUNDS_AT_FILL`— resting buy could not be funded when its trigger fired
 */
export type TradeErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'INSUFFICIENT_SHARES'
  | 'INVALID_QUANTITY'
  | 'INVALID_ORDER'
  | 'INVALID_SYMBOL'
  | 'ORDER_NOT_WORKING'
  | 'INSUFFICIENT_FUNDS_AT_FILL';

export class TradeError extends Error {
  constructor(public readonly code: TradeErrorCode, message: string) {
    super(message);
    this.name = 'TradeError';
  }
}
