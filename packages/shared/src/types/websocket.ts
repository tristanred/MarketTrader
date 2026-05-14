import type { StockQuote } from './stock.js';
import type { LeaderboardEntry } from './game.js';
import type { TradeDirection, WorkingOrder } from './player.js';

/**
 * Pushed by the server every 5 seconds with fresh quotes for all symbols
 * that at least one connected client is subscribed to.
 */
export interface WsPriceUpdateEvent {
  event: 'price_update';
  data: StockQuote[];
}

/** Pushed to all players in the game immediately after a trade is executed. */
export interface WsTradeExecutedEvent {
  event: 'trade_executed';
  data: {
    playerId: string;
    symbol: string;
    direction: TradeDirection;
    quantity: number;
    price: number;
    executedAt: string;
  };
}

/** Pushed to all players in the game after a trade changes the leaderboard ranking. */
export interface WsLeaderboardUpdateEvent {
  event: 'leaderboard_update';
  data: LeaderboardEntry[];
}

/** Pushed when a limit/stop/bracket order is placed and starts resting. */
export interface WsOrderPlacedEvent {
  event: 'order_placed';
  data: { playerId: string; order: WorkingOrder };
}

/**
 * Pushed when a working/pending order is cancelled — by user action, TIF
 * expiry, OCO sibling fill, or insufficient resources at fill time.
 */
export interface WsOrderCancelledEvent {
  event: 'order_cancelled';
  data: { playerId: string; tradeId: string; reason: string };
}

/**
 * Pushed when a stop_limit's stop has crossed and the order is now resting
 * as a limit. The order itself remains `working`; a `trade_executed` event
 * follows when the limit fills.
 */
export interface WsOrderTriggeredEvent {
  event: 'order_triggered';
  data: { playerId: string; tradeId: string; triggerPrice: number };
}

/**
 * Sent by the client after connecting to declare which symbols it wants price
 * updates for. The server merges these into the per-game subscription set.
 */
export interface WsSubscribeEvent {
  event: 'subscribe';
  data: { symbols: string[] };
}

/** Union of all event shapes the server can push to a connected client. */
export type WsServerEvent =
  | WsPriceUpdateEvent
  | WsTradeExecutedEvent
  | WsLeaderboardUpdateEvent
  | WsOrderPlacedEvent
  | WsOrderCancelledEvent
  | WsOrderTriggeredEvent;

/** Union of all event shapes a client can send to the server. */
export type WsClientEvent = WsSubscribeEvent;
