export interface GamePlayer {
  id: string;
  gameId: string;
  userId: string;
  cashBalance: number;
  joinedAt: string;
}

export interface Portfolio {
  id: string;
  gamePlayerId: string;
  symbol: string;
  quantity: number;
  avgCostBasis: number;
}

export type TradeDirection = 'buy' | 'sell';

export interface Trade {
  id: string;
  gamePlayerId: string;
  symbol: string;
  direction: TradeDirection;
  quantity: number;
  price: number;
  executedAt: string;
}

export interface PlaceTradeRequest {
  symbol: string;
  direction: TradeDirection;
  /** Must be a positive integer ≥ 1. No fractional shares. Validated server-side. */
  quantity: number;
}
