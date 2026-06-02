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

/**
 * The shape of an order's trigger condition.
 * - `market`     — fill at the next available quote (default).
 * - `limit`      — buy at-or-below / sell at-or-above `limitPrice`.
 * - `stop`       — when the quote crosses `stopPrice`, fill at the triggering quote.
 * - `stop_limit` — stop crosses → becomes a resting limit at `limitPrice`.
 * - `bracket`    — parent entry (market or limit) plus two OCO children
 *                  (a take-profit limit and a stop-loss stop).
 */
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'bracket';

/**
 * Lifecycle state of a `trades` row.
 * - `pending`   — accepted while the market is closed; settles at next open.
 * - `working`   — a resting order (limit/stop/bracket) awaiting its trigger.
 * - `executed`  — filled; terminal.
 * - `cancelled` — cancelled by the user, OCO, expiry, or a failed fill; terminal.
 */
export type TradeStatus = 'pending' | 'working' | 'executed' | 'cancelled';

/**
 * Order lifetime policy. Orthogonal to {@link OrderType}.
 * - `day` — cancelled at end of the trading day if not filled.
 * - `gtc` — Good-Til-Cancelled; lives until filled or explicitly cancelled.
 */
export type TimeInForce = 'day' | 'gtc';

/** Role of a row within a bracket-order triple. Null on non-bracket rows. */
export type BracketRole = 'entry' | 'take_profit' | 'stop_loss';

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

/**
 * A resting limit/stop/stop_limit/bracket order awaiting a price trigger.
 * Returned by the trade endpoint with HTTP 202 when an advanced order is
 * placed, and by `GET /games/:id/trades?status=working`.
 */
export interface WorkingOrder {
  id: string;
  gamePlayerId: string;
  symbol: string;
  direction: TradeDirection;
  quantity: number;
  orderType: OrderType;
  timeInForce: TimeInForce;
  limitPrice: number | null;
  stopPrice: number | null;
  /** ISO 8601 timestamp once the stop has triggered on a stop_limit. */
  stopTriggeredAt: string | null;
  parentTradeId: string | null;
  bracketRole: BracketRole | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  expiresAt: string | null;
  reservedCash: number | null;
  placedAt: string;
}

export interface PlaceTradeRequest {
  symbol: string;
  direction: TradeDirection;
  /** Must be a positive integer ≥ 1. No fractional shares. Validated server-side. */
  quantity: number;
  /** Defaults to `'market'`. See {@link OrderType}. */
  orderType?: OrderType;
  /** Defaults to `'day'`. See {@link TimeInForce}. */
  timeInForce?: TimeInForce;
  /** Required for `limit` and `stop_limit`. */
  limitPrice?: number;
  /** Required for `stop` and `stop_limit`. */
  stopPrice?: number;
  /** Required when `orderType='bracket'` — the TP child's limit price. */
  takeProfitPrice?: number;
  /** Required when `orderType='bracket'` — the SL child's stop price. */
  stopLossPrice?: number;
}
