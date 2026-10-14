import { Link } from 'react-router-dom';
import { useDiscover } from '@/api/discover';
import { Panel, PanelBody, PanelHeader } from '@/components/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { teaserItems } from '@/lib/discover';
import { cn, formatPct } from '@/lib/utils';

export interface DiscoverPanelProps {
  gameId: string;
  onSelect: (symbol: string) => void;
  className?: string;
}

/**
 * Arena right-rail teaser for the Discover page: three of today's stocks, each
 * labelled with why it is there, and a link to the full list. Hidden once the
 * game has ended or if the list can't be loaded — it is a pointer, not a
 * surface that needs an error state of its own.
 */
export function DiscoverPanel({ gameId, onSelect, className }: DiscoverPanelProps) {
  const discover = useDiscover(gameId);
  const data = discover.data;
  if (discover.isError || data?.status === 'ended') return null;

  const rows = data?.status === 'ready' ? teaserItems(data.list) : [];

  return (
    <Panel className={className}>
      <PanelHeader right={<SeeAllLink gameId={gameId} />}>Discover</PanelHeader>
      <PanelBody className="px-1.5 py-1">
        {discover.isLoading ? (
          <div className="flex flex-col gap-1.5 px-1 py-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">Today&rsquo;s picks are on the way.</p>
        ) : (
          <ul>
            {rows.map((r) => (
              <li key={r.symbol}>
                <button
                  type="button"
                  onClick={() => onSelect(r.symbol)}
                  className={cn(
                    'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 rounded-chip px-1 py-1 text-left text-xs',
                    'hover:bg-hairline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                  )}
                >
                  <span className="font-mono font-semibold text-accent">{r.symbol}</span>
                  <span className="truncate text-[11px] text-muted">{r.reason}</span>
                  <span
                    className={cn(
                      'font-mono',
                      r.changePct === null || r.changePct === 0
                        ? 'text-muted'
                        : r.changePct > 0
                          ? 'text-gain'
                          : 'text-loss',
                    )}
                  >
                    {r.changePct === null ? '—' : formatPct(r.changePct)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function SeeAllLink({ gameId }: { gameId: string }) {
  return (
    <Link
      to={`/games/${gameId}/discover`}
      className="rounded-chip border border-accent px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-accent hover:bg-accent-bg"
    >
      See all ↗
    </Link>
  );
}
