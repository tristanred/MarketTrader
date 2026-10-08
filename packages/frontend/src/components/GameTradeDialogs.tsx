import { useEffect } from 'react';
import type { Game } from '@markettrader/shared';
import { QuoteInfoDialog } from '@/components/QuoteInfoDialog';
import { TradeOrderDialog } from '@/components/TradeOrderDialog';
import { useQuoteDialogStore } from '@/stores/quoteDialogStore';

type TradeFlags = Pick<
  Game,
  'allowShortSelling' | 'allowLimitOrders' | 'allowStopOrders' | 'allowBracketOrders' | 'allowGTC'
>;

export interface GameTradeDialogsProps {
  gameId: string;
  game: Partial<TradeFlags>;
  /** Symbol the trade dialog opens on when it was opened without one. */
  fallbackSymbol?: string | null;
  /** Called with the symbol a player chose to trade from the quote dialog, before it opens. */
  onTradeSymbol?: (symbol: string) => void;
}

/**
 * The quote and trade dialogs for a game page, driven by
 * {@link useQuoteDialogStore} so any `SymbolButton` or chrome on the page can
 * open them. Resets the store on unmount so an open dialog doesn't follow the
 * player to another page.
 */
export function GameTradeDialogs({
  gameId,
  game,
  fallbackSymbol = null,
  onTradeSymbol,
}: GameTradeDialogsProps) {
  useEffect(() => {
    return () => {
      const s = useQuoteDialogStore.getState();
      s.closeTradeOrder();
      s.closeQuote();
    };
  }, []);
  const quoteDialog = useQuoteDialogStore();

  return (
    <>
      <QuoteInfoDialog
        open={quoteDialog.open}
        symbol={quoteDialog.symbol}
        gameId={gameId}
        onOpenChange={(open) => {
          if (!open) quoteDialog.closeQuote();
        }}
        onTradeClick={(s) => {
          onTradeSymbol?.(s);
          quoteDialog.openTradeOrder(s, 'buy');
        }}
      />
      <TradeOrderDialog
        open={quoteDialog.tradeOrderOpen}
        initialSymbol={quoteDialog.tradeOrderSymbol ?? fallbackSymbol}
        initialDirection={quoteDialog.tradeOrderDirection}
        gameId={gameId}
        allowShortSelling={game.allowShortSelling ?? false}
        allowLimitOrders={game.allowLimitOrders ?? false}
        allowStopOrders={game.allowStopOrders ?? false}
        allowBracketOrders={game.allowBracketOrders ?? false}
        allowGTC={game.allowGTC ?? false}
        onOpenChange={(open) => {
          if (!open) quoteDialog.closeTradeOrder();
        }}
        onSeeQuote={(s) => {
          quoteDialog.closeTradeOrder();
          quoteDialog.openQuote(s);
        }}
      />
    </>
  );
}
