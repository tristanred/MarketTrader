import { create } from 'zustand';
import type { TradeDirection } from '@markettrader/shared';

/**
 * UI-coordination store for the Quote Information modal and the rich Trade
 * Order dialog. Any descendant of GameDetailPage — including global chrome
 * components like the TickerTape and StatusStrip — can call `openQuote(symbol)`
 * or `openTradeOrder(symbol, direction)` to surface either dialog.
 */
interface QuoteDialogState {
  symbol: string | null;
  open: boolean;
  tradeOrderSymbol: string | null;
  tradeOrderOpen: boolean;
  /** Direction to open the trade dialog in. Defaults to 'buy'. */
  tradeOrderDirection: TradeDirection;
  openQuote: (symbol: string) => void;
  closeQuote: () => void;
  openTradeOrder: (symbol: string, direction?: TradeDirection) => void;
  closeTradeOrder: () => void;
}

export const useQuoteDialogStore = create<QuoteDialogState>((set) => ({
  symbol: null,
  open: false,
  tradeOrderSymbol: null,
  tradeOrderOpen: false,
  tradeOrderDirection: 'buy',
  openQuote: (symbol) => set({ symbol, open: true }),
  closeQuote: () => set({ open: false }),
  openTradeOrder: (symbol, direction = 'buy') =>
    set({ tradeOrderSymbol: symbol, tradeOrderOpen: true, tradeOrderDirection: direction }),
  closeTradeOrder: () => set({ tradeOrderOpen: false }),
}));
