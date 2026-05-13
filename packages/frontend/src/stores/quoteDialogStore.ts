import { create } from 'zustand';

/**
 * UI-coordination store for the Quote Information modal and the "Trade" action
 * it can hand off to {@link TradePanel}. Any descendant of GameDetailPage can
 * call `openQuote(symbol)` to surface the modal; clicking "Trade" inside the
 * modal writes `selectedTradeSymbol`, which TradePanel observes to pre-fill
 * its input.
 */
interface QuoteDialogState {
  symbol: string | null;
  open: boolean;
  selectedTradeSymbol: string | null;
  openQuote: (symbol: string) => void;
  closeQuote: () => void;
  setSelectedTradeSymbol: (symbol: string | null) => void;
}

export const useQuoteDialogStore = create<QuoteDialogState>((set) => ({
  symbol: null,
  open: false,
  selectedTradeSymbol: null,
  openQuote: (symbol) => set({ symbol, open: true }),
  closeQuote: () => set({ open: false }),
  setSelectedTradeSymbol: (selectedTradeSymbol) => set({ selectedTradeSymbol }),
}));
