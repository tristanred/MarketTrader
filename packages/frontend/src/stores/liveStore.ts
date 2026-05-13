import { create } from 'zustand';
import type { LeaderboardEntry, StockQuote } from '@markettrader/shared';
import type { WsTradeExecutedEvent } from '@markettrader/shared';

const HISTORY_LIMIT = 200;

export type TradeTick = WsTradeExecutedEvent['data'];

export interface PriceTick {
  time: number;
  price: number;
}

interface LiveState {
  /** Most recent quote per symbol (from WS price_update). */
  pricesBySymbol: Record<string, StockQuote>;
  /** Ring buffer of recent ticks per symbol — used by StockChart. */
  historyBySymbol: Record<string, PriceTick[]>;
  /** Latest leaderboard snapshot (overrides REST snapshot when present). */
  leaderboard: LeaderboardEntry[] | null;
  /** Most recent trades that happened during the live session, newest first. */
  recentTrades: TradeTick[];

  applyPriceUpdate: (quotes: StockQuote[]) => void;
  applyLeaderboard: (entries: LeaderboardEntry[]) => void;
  applyTradeExecuted: (trade: TradeTick) => void;
  reset: () => void;
}

export const useLiveStore = create<LiveState>((set) => ({
  pricesBySymbol: {},
  historyBySymbol: {},
  leaderboard: null,
  recentTrades: [],

  applyPriceUpdate: (quotes) =>
    set((s) => {
      const nextPrices = { ...s.pricesBySymbol };
      const nextHistory = { ...s.historyBySymbol };
      const now = Math.floor(Date.now() / 1000);
      for (const q of quotes) {
        nextPrices[q.symbol] = q;
        const prev = nextHistory[q.symbol] ?? [];
        const updated = [...prev, { time: now, price: q.price }];
        nextHistory[q.symbol] = updated.length > HISTORY_LIMIT ? updated.slice(-HISTORY_LIMIT) : updated;
      }
      return { pricesBySymbol: nextPrices, historyBySymbol: nextHistory };
    }),

  applyLeaderboard: (entries) => set({ leaderboard: entries }),

  applyTradeExecuted: (trade) =>
    set((s) => ({ recentTrades: [trade, ...s.recentTrades].slice(0, 20) })),

  reset: () => set({ pricesBySymbol: {}, historyBySymbol: {}, leaderboard: null, recentTrades: [] }),
}));
