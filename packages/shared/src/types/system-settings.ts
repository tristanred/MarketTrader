/**
 * Persisted runtime configuration values that admins can change without a
 * redeploy. The only entry shipped in phase 2 is `ticker_tape_symbols`;
 * the table can hold additional keys in later phases without schema changes.
 */

/** Server-configured list of symbols scrolling in the bottom ticker tape. */
export interface TickerTapeSettings {
  symbols: string[];
  updatedAt: string;
}

/** Single tick on the indices/ticker channel. */
export interface IndexQuote {
  symbol: string;
  last: number;
  changeAbs: number;
  changePct: number;
  /** Optional full company / index name, used for tooltips. */
  name?: string;
}
