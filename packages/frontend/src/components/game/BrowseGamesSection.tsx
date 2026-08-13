import { useCallback, useEffect, useRef, useState } from 'react';
import { useBrowsableGames, useJoinGame } from '@/api/games';
import { Panel, PanelBody } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { toastApiError } from '@/lib/toastApiError';
import { cn, formatUSD } from '@/lib/utils';
import type { BrowsableGame, GameStatus } from '@markettrader/shared';

// Joining invalidates the browse query, which would yank the row out from
// under the fill stamp. Hold the list still for this long so the confirmation
// is actually readable, then fall back to server truth.
const FILL_HOLD_MS = 1100;

const statusPill: Record<GameStatus, string> = {
  pending: 'bg-hairline text-muted',
  active: 'bg-accent-bg text-accent',
  ended: 'bg-hairline text-muted',
};

/** Column rhythm shared by the board header and every row below it. */
const BOARD_GRID =
  'grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_5rem_7rem_5.5rem] sm:items-center sm:gap-y-0';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Discovery board rendered below "Your games" — the public games the viewer
 * has not joined, laid out on the same column rhythm so the page reads as one
 * board: positions you hold above, listings you can take below.
 */
export function BrowseGamesSection() {
  const browsable = useBrowsableGames();
  const [filled, setFilled] = useState<ReadonlySet<string>>(() => new Set());
  const [frozen, setFrozen] = useState<BrowsableGame[] | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  const handleFilled = useCallback(
    (gameId: string) => {
      setFrozen((prev) => prev ?? browsable.data ?? null);
      setFilled((prev) => new Set(prev).add(gameId));
      window.clearTimeout(holdTimer.current);
      holdTimer.current = window.setTimeout(() => {
        setFrozen(null);
        setFilled(new Set());
      }, FILL_HOLD_MS);
    },
    [browsable.data],
  );

  const rows = frozen ?? browsable.data ?? [];

  return (
    <section className="space-y-3" data-testid="browse-games">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-[-0.025em] text-text-strong">Open games</h2>
          <p className="text-xs text-muted">Public tournaments anyone can join.</p>
        </div>
        {rows.length > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            {rows.length} listed
          </span>
        )}
      </div>

      {browsable.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {browsable.isError && (
        <Panel>
          <PanelBody className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-xs text-loss">Couldn't load open games.</p>
            <Button size="sm" variant="outline" onClick={() => void browsable.refetch()}>
              Retry
            </Button>
          </PanelBody>
        </Panel>
      )}

      {browsable.isSuccess && rows.length === 0 && (
        <Panel>
          <PanelBody>
            <p className="py-8 text-center font-mono text-xs text-muted">
              No open games right now — create one, or open a friend's invite link.
            </p>
          </PanelBody>
        </Panel>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          {/* Alignment aid only — each row states its own values for screen
              readers. The transparent border matches the 1px each row spends
              on its own border, so the columns land on the same pixels. */}
          <div
            aria-hidden
            className={cn(
              BOARD_GRID,
              'hidden border border-transparent px-4 font-mono text-[9px] uppercase tracking-[0.16em] text-muted sm:grid',
            )}
          >
            <span>Game</span>
            <span>Host</span>
            <span>Status</span>
            <span className="text-right">Players</span>
            <span className="text-right">Start cash</span>
            <span />
          </div>

          <ul className="space-y-2">
            {rows.map((game) => (
              <BrowseRow
                key={game.id}
                game={game}
                filled={filled.has(game.id)}
                onFilled={handleFilled}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function BrowseRow({
  game,
  filled,
  onFilled,
}: {
  game: BrowsableGame;
  filled: boolean;
  onFilled: (gameId: string) => void;
}) {
  const join = useJoinGame();

  async function handleJoin() {
    try {
      await join.mutateAsync(game.id);
      onFilled(game.id);
      toast({ title: `Joined ${game.name}`, variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Could not join game');
    }
  }

  return (
    <li
      className={cn(
        'rounded-panel border bg-panel transition-colors',
        filled ? 'border-accent bg-accent-bg' : 'border-hairline-strong',
      )}
    >
      <div className={cn(BOARD_GRID, 'px-4 py-3')}>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text-strong">{game.name}</div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
            {formatDate(game.startDate)} → {formatDate(game.endDate)}
          </div>
        </div>

        {/* The metadata cells below are the visual board; the sr-only summary
            at the end of the row is what assistive tech reads, so exposing
            both would say everything twice. */}
        <div aria-hidden className="hidden truncate font-mono text-xs text-text sm:block">
          {game.createdByUsername}
        </div>

        <span
          aria-hidden
          className={cn(
            'hidden w-fit rounded-chip px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] sm:inline-block',
            statusPill[game.status],
          )}
        >
          {game.status.toUpperCase()}
        </span>

        <div aria-hidden className="hidden text-right font-mono text-xs text-text sm:block">
          {game.playerCount}
        </div>

        <div aria-hidden className="hidden text-right font-mono text-xs text-text sm:block">
          {formatUSD(game.startingBalance)}
        </div>

        {/* Below sm the columns collapse into one line — the header strip is
            hidden there, so the values have to carry their own units. */}
        <div
          aria-hidden
          className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted sm:hidden"
        >
          <span
            className={cn(
              'rounded-chip px-2 py-0.5 tracking-[0.14em]',
              statusPill[game.status],
            )}
          >
            {game.status.toUpperCase()}
          </span>
          {/* A username is the host's own data — the micro-caps rhythm around
              it does not get to restyle it. */}
          <span className="normal-case">{game.createdByUsername}</span>
          <span>·</span>
          <span>
            {game.playerCount} {game.playerCount === 1 ? 'player' : 'players'}
          </span>
          <span>·</span>
          <span>{formatUSD(game.startingBalance)} start</span>
        </div>

        <div className="sm:justify-self-end">
          {filled ? (
            <span className="animate-stamp inline-flex h-9 items-center font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
              Filled
            </span>
          ) : (
            <Button
              size="sm"
              className="w-full font-mono uppercase tracking-[0.1em] sm:w-auto"
              onClick={handleJoin}
              disabled={join.isPending}
              aria-label={`Join ${game.name}`}
            >
              {join.isPending ? 'Joining…' : 'Join'}
            </Button>
          )}
        </div>
      </div>

      <p className="sr-only">
        Hosted by {game.createdByUsername}. Status {game.status}. {game.playerCount}{' '}
        {game.playerCount === 1 ? 'player' : 'players'}. Starting cash{' '}
        {formatUSD(game.startingBalance)}.
      </p>
    </li>
  );
}
