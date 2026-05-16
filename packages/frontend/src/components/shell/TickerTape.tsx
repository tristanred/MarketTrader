import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useTickerTapeSymbols } from '@/hooks/useTickerTapeSymbols';
import { INDICES_QUERY_KEY } from '@/hooks/useIndicesSocket';
import { useMaybeSetSelectedSymbol } from '@/contexts/SelectedSymbolContext';
import { useQuoteDialogStore } from '@/stores/quoteDialogStore';
import type { IndexQuote } from '@markettrader/shared';

/**
 * Sticky bottom chrome row: a left-scrolling marquee of server-configured
 * symbols + their latest quotes. Click behavior depends on context:
 * - Inside a game, a tradeable symbol opens the Trade Order dialog for that
 *   game (so the user can buy/sell without leaving the arena).
 * - Inside a game, an index (symbol prefixed with `^`) pivots the arena's
 *   center column to that symbol — indices can't be traded.
 * - Outside a game, every click navigates to `/symbols/:symbol` where the
 *   user picks which game to trade in.
 */
export function TickerTape() {
  const symbols = useTickerTapeSymbols();
  // Cache is fed by useIndicesSocket — queryFn is a no-op since we never fetch.
  const quotes = useQuery<IndexQuote[]>({
    queryKey: INDICES_QUERY_KEY,
    queryFn: () => [],
    enabled: false,
    initialData: [],
  });
  const params = useParams();
  const setSelectedSymbol = useMaybeSetSelectedSymbol();
  const openTradeOrder = useQuoteDialogStore((s) => s.openTradeOrder);
  const inGame = !!params.gameId;

  if (symbols.length === 0) return null;

  const quoteBySymbol = new Map(quotes.data?.map((q) => [q.symbol, q]));
  const items = symbols.map((s) => ({ symbol: s, quote: quoteBySymbol.get(s) }));
  // Duplicate items for a seamless loop — the marquee animates to -50%.
  const looped = [...items, ...items];

  return (
    <div
      data-testid="ticker-tape"
      className="h-6 border-t border-hairline-strong bg-bg/95 overflow-hidden"
    >
      <div
        data-testid="ticker-tape-marquee"
        className="flex h-full items-center gap-6 whitespace-nowrap animate-marquee px-4 text-[11px] font-mono"
      >
        {looped.map((it, idx) => {
          const change = it.quote?.changePct ?? 0;
          const last = it.quote?.last;
          const content = (
            <span className="flex items-baseline gap-1">
              <span className="text-text">{it.symbol}</span>
              {last !== undefined ? (
                <>
                  <span className="text-muted">
                    {new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(last)}
                  </span>
                  <span className={change >= 0 ? 'text-gain' : 'text-loss'}>
                    {change >= 0 ? '+' : '−'}{Math.abs(change).toFixed(2)}%
                  </span>
                </>
              ) : null}
            </span>
          );
          return (
            <TickerItem
              key={`${it.symbol}-${idx}`}
              symbol={it.symbol}
              inGame={inGame}
              onTradeInGame={openTradeOrder}
              onPivotArena={setSelectedSymbol}
            >
              {content}
            </TickerItem>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Routes a click on a ticker chip to the correct destination based on
 * context. Kept as a module-level helper (not inlined) so the same logic
 * can be reused by {@link StatusStrip} and any future chrome surface.
 */
function TickerItem({
  symbol,
  inGame,
  onTradeInGame,
  onPivotArena,
  children,
}: {
  symbol: string;
  inGame: boolean;
  onTradeInGame: (symbol: string) => void;
  onPivotArena: ((symbol: string) => void) | null;
  children: React.ReactNode;
}) {
  if (!inGame) {
    return (
      <Link to={`/symbols/${symbol}`} className="hover:text-accent">
        {children}
      </Link>
    );
  }
  // Indices (^GSPC, ^IXIC, ^DJI) aren't tradeable — pivot the arena instead.
  if (isIndex(symbol)) {
    return (
      <button
        type="button"
        onClick={() => onPivotArena?.(symbol)}
        className="hover:text-accent"
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onTradeInGame(symbol)}
      className="hover:text-accent"
    >
      {children}
    </button>
  );
}

export function isIndex(symbol: string): boolean {
  return symbol.startsWith('^');
}
