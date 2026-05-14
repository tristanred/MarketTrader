import { create } from 'zustand';

/**
 * UI-coordination store for the Quote Information modal, the rich Trade Order
 * dialog, and the legacy hand-off to {@link TradePanel}. Any descendant of
 * GameDetailPage can call `openQuote(symbol)` or `openTradeOrder(symbol)` to
 * surface either dialog. `selectedTradeSymbol` is retained for the bottom
 * TradePanel pre-fill flow.
 */
interface QuoteDialogState {
  symbol: string | null;
  open: boolean;
  tradeOrderSymbol: string | null;
  tradeOrderOpen: boolean;
  selectedTradeSymbol: string | null;
  openQuote: (symbol: string) => void;
  closeQuote: () => void;
  openTradeOrder: (symbol: string) => void;
  closeTradeOrder: () => void;
  setSelectedTradeSymbol: (symbol: string | null) => void;
}

export const useQuoteDialogStore = create<QuoteDialogState>((set) => ({
  symbol: null,
  open: false,
  tradeOrderSymbol: null,
  tradeOrderOpen: false,
  selectedTradeSymbol: null,
  openQuote: (symbol) => set({ symbol, open: true }),
  closeQuote: () => set({ open: false }),
  openTradeOrder: (symbol) => set({ tradeOrderSymbol: symbol, tradeOrderOpen: true }),
  closeTradeOrder: () => set({ tradeOrderOpen: false }),
  setSelectedTradeSymbol: (selectedTradeSymbol) => set({ selectedTradeSymbol }),
}));
