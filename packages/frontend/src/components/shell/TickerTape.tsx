import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useTickerTapeSymbols } from '@/hooks/useTickerTapeSymbols';
import { INDICES_QUERY_KEY } from '@/hooks/useIndicesSocket';
import { useSetSelectedSymbol } from '@/contexts/SelectedSymbolContext';
import type { IndexQuote } from '@markettrader/shared';

// Hoisted: avoid building a new Intl formatter inside every chip on every
// render. Locale + options never change at runtime.
const PRICE_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/**
 * Sticky bottom chrome row: a left-scrolling marquee of server-configured
 * symbols + their latest quotes. Inside a game, clicking a chip pivots the
 * arena's center column to that symbol. Outside a game, it navigates to
 * `/symbols/:symbol` so the user can pick which game to trade in.
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
  const setSelectedSymbol = useSetSelectedSymbol();
  const inGame = !!params.gameId;

  // Build the looped list once per (symbols, quotes) change. The map lookup
  // is O(1) instead of a per-render Map allocation + getter chain.
  const looped = useMemo(() => {
    const bySymbol = new Map((quotes.data ?? []).map((q) => [q.symbol, q]));
    const items = symbols.map((s) => ({ symbol: s, quote: bySymbol.get(s) }));
    return [...items, ...items];
  }, [symbols, quotes.data]);

  if (symbols.length === 0) return null;

  return (
    <div
      data-testid="ticker-tape"
      className="h-6 border-t border-hairline-strong bg-bg/95 overflow-hidden"
    >
      <div
        data-testid="ticker-tape-marquee"
        className="flex h-full items-center gap-6 whitespace-nowrap animate-marquee px-4 text-[11px] font-mono"
      >
        {looped.map((it, idx) => (
          <TickerChip
            key={`${it.symbol}-${idx}`}
            symbol={it.symbol}
            quote={it.quote}
            inGame={inGame}
            onSelect={setSelectedSymbol}
          />
        ))}
      </div>
    </div>
  );
}

const TickerChip = memo(function TickerChip({
  symbol,
  quote,
  inGame,
  onSelect,
}: {
  symbol: string;
  quote: IndexQuote | undefined;
  inGame: boolean;
  onSelect: (symbol: string) => void;
}) {
  const change = quote?.changePct ?? 0;
  const last = quote?.last;
  const content = (
    <span className="flex items-baseline gap-1">
      <span className="text-text">{symbol}</span>
      {last !== undefined ? (
        <>
          <span className="text-muted">{PRICE_FMT.format(last)}</span>
          <span className={change >= 0 ? 'text-gain' : 'text-loss'}>
            {change >= 0 ? '+' : '−'}
            {Math.abs(change).toFixed(2)}%
          </span>
        </>
      ) : null}
    </span>
  );
  if (inGame) {
    return (
      <button type="button" onClick={() => onSelect(symbol)} className="hover:text-accent">
        {content}
      </button>
    );
  }
  return (
    <Link to={`/symbols/${symbol}`} className="hover:text-accent">
      {content}
    </Link>
  );
});
