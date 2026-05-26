import type { StockQuote } from './stock.js';
import type { LeaderboardEntry } from './game.js';
import type { TradeDirection, WorkingOrder } from './player.js';
import type { IndexQuote } from './system-settings.js';
import type { WsAchievementUnlockedEvent } from './achievement.js';

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
  | WsOrderTriggeredEvent
  | WsAchievementUnlockedEvent;

/** Union of all event shapes a client can send to the server. */
export type WsClientEvent = WsSubscribeEvent;

/**
 * Pushed by the server every 5 seconds on the global `/ws/live` socket with
 * fresh quotes for major indices (^GSPC/^IXIC/^DJI) plus all configured
 * ticker-tape symbols. `unavailable: true` means the active provider could
 * not fetch indices (e.g. Alpaca) — UI should render an explicit indicator.
 */
export interface WsIndicesEvent {
  event: 'indices';
  data: {
    quotes: IndexQuote[];
    at: string;
    unavailable?: boolean;
  };
}

/** Pushed on the global socket when an admin changes the ticker-tape symbol list. */
export interface WsTickerTapeConfigChangedEvent {
  event: 'ticker_tape_config_changed';
  data: {
    symbols: string[];
    at: string;
  };
}

/** Union of every message that can be sent on the global `/ws/live` socket. */
export type LiveWsMessage = WsIndicesEvent | WsTickerTapeConfigChangedEvent;
