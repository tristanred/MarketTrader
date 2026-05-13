import { useQuoteDialogStore } from '@/stores/quoteDialogStore';
import { cn } from '@/lib/utils';

interface SymbolButtonProps {
  symbol: string;
  className?: string;
}

/**
 * Renders a stock symbol as a button that opens the Quote Information modal.
 * Used wherever a ticker appears in a list/table — trade history, pending
 * orders, portfolio holdings.
 */
export function SymbolButton({ symbol, className }: SymbolButtonProps) {
  const openQuote = useQuoteDialogStore((s) => s.openQuote);
  return (
    <button
      type="button"
      onClick={() => openQuote(symbol)}
      className={cn(
        'font-medium hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
    >
      {symbol}
    </button>
  );
}
