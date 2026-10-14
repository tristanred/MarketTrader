/**
 * Market-wide lists sourced from the stock provider (Yahoo screeners and
 * trending tickers). Shared by every game for a given session date.
 */
export type MarketMoverKind = 'gainers' | 'losers' | 'active' | 'trending';

/** Every section a Discover list can carry: the per-game daily picks plus the market movers. */
export type DiscoverSectionKind = 'picks' | MarketMoverKind;

/**
 * One stock in a Discover section. Prices are a snapshot taken when the list
 * was generated (after the session close), not live values.
 */
export interface DiscoverItem {
  symbol: string;
  name: string | null;
  /** Price at generation time; null when no quote was available. */
  price: number | null;
  /** Day change in percent (e.g. `2.5` for +2.5%) at generation time; null when unknown. */
  changePct: number | null;
  /** GICS sector. Present on daily picks only. */
  sector?: string;
}

export interface DiscoverSection {
  kind: DiscoverSectionKind;
  items: DiscoverItem[];
}

/**
 * A game's Discover list for one trading session. `sections` always starts
 * with `picks`; a market-mover section is omitted when it could not be fetched
 * for that session.
 */
export interface DiscoverList {
  gameId: string;
  /** NYSE session the list describes, `YYYY-MM-DD` in America/New_York. */
  sessionDate: string;
  /** ISO 8601 timestamp the daily picks were generated. */
  generatedAt: string;
  sections: DiscoverSection[];
}

/**
 * Body of `GET /games/:id/discover`. `preparing` means the background worker
 * has not produced a list for this game yet; `ended` means the game is over
 * and Discover is no longer offered.
 */
export type DiscoverResponse =
  { status: 'ready'; list: DiscoverList } | { status: 'preparing' } | { status: 'ended' };
