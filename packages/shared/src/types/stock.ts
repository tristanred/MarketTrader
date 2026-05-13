/** Real-time stock quote as returned by the active {@link StockProvider}. */
export interface StockQuote {
  symbol: string;
  /** Latest market price in USD. */
  price: number;
  /** Absolute price change since previous close (may be 0 for some providers). */
  change: number;
  /** Percentage change since previous close (may be 0 for some providers). */
  changePercent: number;
  /** ISO 8601 timestamp of when this quote was fetched from the provider. */
  fetchedAt: string;
  /**
   * True when the live provider was rate-limited and this quote came from the
   * server-side cache. Consumers should warn the user before acting on it.
   * Undefined or false on fresh quotes.
   */
  stale?: boolean;
}

/** A single result from the symbol autocomplete endpoint. */
export interface StockSearchResult {
  symbol: string;
  /** Human-readable company or fund name. */
  name: string;
}

/** Time ranges supported by the history endpoint. */
export type StockHistoryRange = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y';

/** A single historical bar — close-only is enough for a line chart. */
export interface StockHistoryBar {
  /** Unix epoch seconds — what lightweight-charts expects as its `time` key. */
  time: number;
  /** Close price for the bar. */
  close: number;
}

/** Response body for GET /stocks/:symbol/history. */
export interface StockHistoryResponse {
  symbol: string;
  range: StockHistoryRange;
  bars: StockHistoryBar[];
  /** ISO 8601 timestamp of when the upstream returned this series. */
  fetchedAt: string;
}
