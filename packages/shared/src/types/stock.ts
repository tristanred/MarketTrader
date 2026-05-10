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
}

/** A single result from the symbol autocomplete endpoint. */
export interface StockSearchResult {
  symbol: string;
  /** Human-readable company or fund name. */
  name: string;
}
