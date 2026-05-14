import type {
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';

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
  /** Returns matching equity symbols for an autocomplete query. */
  searchSymbols(query: string): Promise<StockSearchResult[]>;
  /**
   * Returns historical closing prices for the symbol covering the given range.
   * Bars are sorted by ascending time. Bar resolution is provider-defined per
   * range — intraday for `1d`/`5d`, daily for longer ranges.
   */
  getHistory(symbol: string, range: StockHistoryRange): Promise<StockHistoryBar[]>;
  /**
   * Fetches richer, slower-moving information about a symbol — used by the
   * Quote Information modal and the standalone `/symbols/:symbol` page.
   * Implementations should fill what they can and leave the rest undefined.
   */
  getDetails(symbol: string): Promise<StockDetails>;
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
 * - `ORDER_NOT_WORKING`         — attempted to fill an order that was already cancelled/filled
 * - `INSUFFICIENT_FUNDS_AT_FILL`— resting buy could not be funded when its trigger fired
 */
export type TradeErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'INSUFFICIENT_SHARES'
  | 'INVALID_QUANTITY'
  | 'INVALID_ORDER'
  | 'ORDER_NOT_WORKING'
  | 'INSUFFICIENT_FUNDS_AT_FILL';

export class TradeError extends Error {
  constructor(public readonly code: TradeErrorCode, message: string) {
    super(message);
    this.name = 'TradeError';
  }
}
