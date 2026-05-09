import type { StockQuote } from './stock.js';
import type { LeaderboardEntry } from './game.js';
import type { TradeDirection } from './player.js';

export interface WsPriceUpdateEvent {
  event: 'price_update';
  data: StockQuote[];
}

export interface WsTradeExecutedEvent {
  event: 'trade_executed';
  data: {
    playerId: string;
    symbol: string;
    direction: TradeDirection;
    quantity: number;
    price: number;
  };
}

export interface WsLeaderboardUpdateEvent {
  event: 'leaderboard_update';
  data: LeaderboardEntry[];
}

export interface WsSubscribeEvent {
  event: 'subscribe';
  data: { symbols: string[] };
}

export type WsServerEvent =
  | WsPriceUpdateEvent
  | WsTradeExecutedEvent
  | WsLeaderboardUpdateEvent;

export type WsClientEvent = WsSubscribeEvent;
