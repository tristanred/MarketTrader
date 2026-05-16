import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useTickerTapeSymbols } from '@/hooks/useTickerTapeSymbols';
import { INDICES_QUERY_KEY } from '@/hooks/useIndicesSocket';
import type { IndexQuote } from '@markettrader/shared';

/**
 * Sticky bottom chrome row: a left-scrolling marquee of server-configured
 * symbols + their latest quotes. Hovering pauses the animation; clicking a
 * symbol navigates to `/symbols/:symbol` (outside a game) — phase 3 wires
 * the in-game click into the SelectedSymbolContext.
 */
export function TickerTape() {
  const symbols = useTickerTapeSymbols();
  const quotes = useQuery<IndexQuote[]>({
    queryKey: INDICES_QUERY_KEY,
    enabled: false,
    initialData: [],
  });
  const params = useParams();
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
          return inGame ? (
            <span key={`${it.symbol}-${idx}`}>{content}</span>
          ) : (
            <Link
              key={`${it.symbol}-${idx}`}
              to={`/symbols/${it.symbol}`}
              className="hover:text-accent"
            >
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
