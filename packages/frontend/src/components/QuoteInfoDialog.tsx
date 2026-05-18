import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { QuoteInfo } from '@/components/QuoteInfo';

interface QuoteInfoDialogProps {
  open: boolean;
  symbol: string | null;
  /** Optional game context — when present, QuoteInfo shows a "Your position" card. */
  gameId?: string;
  onOpenChange: (open: boolean) => void;
  onTradeClick?: (symbol: string) => void;
}

/**
 * Compact modal wrapper around {@link QuoteInfo}. The internal `activeSymbol`
 * tracks the in-modal search pivot so the parent doesn't have to re-open the
 * dialog when the user jumps to another ticker.
 */
export function QuoteInfoDialog({
  open,
  symbol,
  gameId,
  onOpenChange,
  onTradeClick,
}: QuoteInfoDialogProps) {
  const [activeSymbol, setActiveSymbol] = useState<string | null>(symbol);

  useEffect(() => {
    if (open) setActiveSymbol(symbol);
  }, [open, symbol]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wide">Quote Information</DialogTitle>
        </DialogHeader>
        {activeSymbol && (
          <QuoteInfo
            symbol={activeSymbol}
            variant="compact"
            onSymbolChange={setActiveSymbol}
            {...(gameId && { gameId })}
            {...(onTradeClick && {
              onTradeClick: (s: string) => {
                onTradeClick(s);
                onOpenChange(false);
              },
            })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
