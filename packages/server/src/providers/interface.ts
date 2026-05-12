import type { StockQuote, StockSearchResult } from '@markettrader/shared';

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
 * - `INSUFFICIENT_FUNDS`  — buy cost exceeds cash balance
 * - `INSUFFICIENT_SHARES` — sell quantity exceeds holding
 * - `INVALID_QUANTITY`    — quantity is not a positive integer
 */
export class TradeError extends Error {
  constructor(
    public readonly code: 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_SHARES' | 'INVALID_QUANTITY',
    message: string,
  ) {
    super(message);
    this.name = 'TradeError';
  }
}
