import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useLiveClock } from '@/hooks/useLiveClock';
import { INDICES_QUERY_KEY } from '@/hooks/useIndicesSocket';
import { AboutGameModal } from './AboutGameModal';
import { useMarketStatus } from '@/api/market-status';
import type { IndexQuote } from '@markettrader/shared';
import { cn } from '@/lib/utils';

export interface StatusStripGameContext {
  gameId: string;
  name: string;
  dayCurrent: number;
  dayTotal: number;
}

export interface StatusStripProps {
  /** When provided, the right cluster shows DAY n/N + name + info button. */
  gameContext?: StatusStripGameContext;
}

/**
 * Second row of global chrome. Left: market-open pulse dot, ticking ET clock,
 * LIVE pill, three major index quotes. Right (only inside a game): the
 * DAY n/N marker and an info button that opens {@link AboutGameModal}.
 */
export function StatusStrip({ gameContext }: StatusStripProps) {
  const clock = useLiveClock();
  const marketStatus = useMarketStatus();
  const indices = useQuery<IndexQuote[]>({
    queryKey: INDICES_QUERY_KEY,
    enabled: false,
    initialData: [],
  });
  const unavailable = useQuery<boolean>({
    queryKey: ['indices-unavailable'],
    enabled: false,
    initialData: false,
  });

  const isOpen = marketStatus.data?.state === 'REGULAR';
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <div className="flex items-center justify-between border-b border-hairline-strong bg-bg/95 px-4 py-1 text-[11px] font-mono text-muted tracking-[0.04em]">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              isOpen
                ? 'bg-accent shadow-[0_0_6px_var(--accent)] animate-pulse-dot'
                : 'bg-muted',
            )}
            aria-hidden
          />
          MARKET {isOpen ? 'OPEN' : 'CLOSED'}
        </span>
        <span>{clock} ET</span>
        <span className="rounded-chip bg-accent-bg px-2 py-0.5 text-[10px] tracking-[0.14em] text-accent">
          LIVE
        </span>
        {unavailable.data ? (
          <span className="text-loss">INDICES UNAVAILABLE</span>
        ) : (
          indices.data?.map((q) => (
            <span key={q.symbol} className="flex items-baseline gap-1">
              <span className="text-text">{q.symbol}</span>
              <span>{formatLast(q.last)}</span>
              <span className={q.changePct >= 0 ? 'text-gain' : 'text-loss'}>
                {formatPct(q.changePct)}
              </span>
            </span>
          ))
        )}
      </div>
      {gameContext ? (
        <div className="flex items-center gap-2">
          <span>
            DAY {gameContext.dayCurrent} / {gameContext.dayTotal} · {gameContext.name}
          </span>
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="text-muted hover:text-text"
            aria-label="Game info"
          >
            <Info className="h-3 w-3" />
          </button>
          <AboutGameModal
            gameId={gameContext.gameId}
            open={aboutOpen}
            onOpenChange={setAboutOpen}
          />
        </div>
      ) : null}
    </div>
  );
}

function formatLast(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}
function formatPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
