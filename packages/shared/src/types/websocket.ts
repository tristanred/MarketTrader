import type { StockQuote } from './stock.js';
import type { LeaderboardEntry } from './game.js';
import type { TradeDirection } from './player.js';

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
  | WsLeaderboardUpdateEvent;

/** Union of all event shapes a client can send to the server. */
export type WsClientEvent = WsSubscribeEvent;
