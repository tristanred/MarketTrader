/**
 * The trading session the quote was captured in, as reported by the upstream
 * provider. `REGULAR` is 9:30–16:00 ET on US markets; `PRE`/`POST` are extended
 * hours; `CLOSED` covers nights/weekends/holidays. Used by the chart to decide
 * whether to extend the price line — outside `REGULAR`, providers echo the last
 * close indefinitely and the line should freeze.
 */
export type MarketState = 'PRE' | 'REGULAR' | 'POST' | 'POSTPOST' | 'PREPRE' | 'CLOSED';

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
   * Trading session at fetch time. Undefined when the provider didn't report it
   * (e.g. older cache rows). Treat undefined as "unknown" — neither open nor closed.
   */
  marketState?: MarketState;
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

/**
 * Response body for GET /market/status. The chart uses `state === 'REGULAR'`
 * to decide whether to extend the price line with live WebSocket ticks; the
 * other fields are informational.
 */
export interface MarketStatusResult {
  state: MarketState;
  /** ISO 8601 timestamp the upstream reported (or our own clock for the static provider). */
  asOf: string;
  /** ISO 8601 timestamp of the next session transition, if the source knows it. */
  nextChangeAt?: string;
  /** Which implementation produced this status — for diagnostics. */
  source: 'yahoo' | 'alpaca' | 'static';
}
