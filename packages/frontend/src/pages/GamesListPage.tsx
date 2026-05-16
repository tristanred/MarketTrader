import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useGames } from '@/api/games';
import { CreateGameDialog } from '@/components/CreateGameDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Panel, PanelBody } from '@/components/panel';
import { cn, formatUSD } from '@/lib/utils';
import type { GameStatus } from '@markettrader/shared';

const statusPill: Record<GameStatus, string> = {
  pending: 'bg-hairline text-muted',
  active: 'bg-accent-bg text-accent',
  ended: 'bg-hairline text-muted',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function GamesListPage() {
  const games = useGames();

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-[-0.025em] text-text-strong">Your games</h1>
          <p className="text-xs text-muted">Tournaments you've joined.</p>
        </div>
        <CreateGameDialog />
      </div>

      {games.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {games.isError && (
        <Panel>
          <PanelBody>
            <p className="text-xs text-loss">Couldn't load games. Try again.</p>
          </PanelBody>
        </Panel>
      )}

      {games.data && games.data.length === 0 && (
        <Panel>
          <PanelBody>
            <p className="py-8 text-center font-mono text-xs text-muted">
              No games yet — create one to get started.
            </p>
          </PanelBody>
        </Panel>
      )}

      {games.data && games.data.length > 0 && (
        <ul className="space-y-2">
          {games.data.map((g) => (
            <li key={g.id}>
              <Link
                to={`/games/${g.id}`}
                className="block rounded-panel border border-hairline-strong bg-panel transition-colors hover:border-muted"
              >
                <div className="grid grid-cols-1 items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_auto_auto_auto_auto]">
                  <div>
                    <div className="text-sm font-semibold text-text-strong">{g.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                      {formatDate(g.startDate)} → {formatDate(g.endDate)}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'rounded-chip px-2 py-0.5 font-mono text-[10px] tracking-[0.14em]',
                      statusPill[g.status],
                    )}
                  >
                    {g.status.toUpperCase()}
                  </span>
                  <StatCell label="Starting" value={formatUSD(g.startingBalance)} />
                  <StatCell label="Start" value={formatDate(g.startDate)} />
                  <StatCell label="End" value={formatDate(g.endDate)} />
                  <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden text-right sm:block">
      <div className="text-[9px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className="font-mono text-xs text-text">{value}</div>
    </div>
  );
}
