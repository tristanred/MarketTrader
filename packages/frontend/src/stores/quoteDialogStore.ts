import { create } from 'zustand';

/**
 * UI-coordination store for the Quote Information modal and the rich Trade
 * Order dialog. Any descendant of GameDetailPage can call `openQuote(symbol)`
 * or `openTradeOrder(symbol)` to surface either dialog.
 */
interface QuoteDialogState {
  symbol: string | null;
  open: boolean;
  tradeOrderSymbol: string | null;
  tradeOrderOpen: boolean;
  openQuote: (symbol: string) => void;
  closeQuote: () => void;
  openTradeOrder: (symbol: string) => void;
  closeTradeOrder: () => void;
}

export const useQuoteDialogStore = create<QuoteDialogState>((set) => ({
  symbol: null,
  open: false,
  tradeOrderSymbol: null,
  tradeOrderOpen: false,
  openQuote: (symbol) => set({ symbol, open: true }),
  closeQuote: () => set({ open: false }),
  openTradeOrder: (symbol) => set({ tradeOrderSymbol: symbol, tradeOrderOpen: true }),
  closeTradeOrder: () => set({ tradeOrderOpen: false }),
}));
