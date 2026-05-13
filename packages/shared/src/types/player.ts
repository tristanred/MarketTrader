/** A user's participation record in a specific game. */
export interface GamePlayer {
  id: string;
  gameId: string;
  userId: string;
  /** Remaining virtual USD cash, updated after every trade. */
  cashBalance: number;
  joinedAt: string;
}

/** A single stock holding within a player's portfolio. */
export interface Portfolio {
  id: string;
  gamePlayerId: string;
  symbol: string;
  /** Whole shares only — no fractional shares. */
  quantity: number;
  /** Weighted-average purchase price per share across all buys. */
  avgCostBasis: number;
}

/** Direction of a trade order. */
export type TradeDirection = 'buy' | 'sell';

/** An executed trade record as returned by the API. */
export interface Trade {
  id: string;
  gamePlayerId: string;
  symbol: string;
  direction: TradeDirection;
  /** Number of shares traded. Always a positive integer. */
  quantity: number;
  /** Market price at execution time. */
  price: number;
  executedAt: string;
}

/**
 * How the server handles trade requests submitted while the market is closed.
 * - `instant`  — fill at the last known price (default).
 * - `disabled` — reject with 409 MARKET_CLOSED.
 * - `pending`  — queue the order; settle at next market open.
 */
export type MarketHoursMode = 'disabled' | 'pending' | 'instant';

/**
 * A queued trade awaiting market open. Returned by the trade endpoint with HTTP
 * 202 when {@link MarketHoursMode} is `pending` and the market is closed, and
 * by `GET /games/:id/trades/pending`.
 */
export interface PendingTrade {
  id: string;
  gamePlayerId: string;
  symbol: string;
  direction: TradeDirection;
  quantity: number;
  /** Quote used at placement time; final fill price may differ. */
  reservedPrice: number;
  /** Cash held aside on a buy. `null` for sells. */
  reservedCash: number | null;
  /** ISO 8601 timestamp when the order was placed. */
  placedAt: string;
}

export interface PlaceTradeRequest {
  symbol: string;
  direction: TradeDirection;
  /** Must be a positive integer ≥ 1. No fractional shares. Validated server-side. */
  quantity: number;
}
