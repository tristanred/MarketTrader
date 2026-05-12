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

export interface PlaceTradeRequest {
  symbol: string;
  direction: TradeDirection;
  /** Must be a positive integer ≥ 1. No fractional shares. Validated server-side. */
  quantity: number;
}
