import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LeaderboardHistoryRange } from '@markettrader/shared';
import { useGame } from '@/api/games';
import { useLeaderboardHistory } from '@/api/leaderboard-history';
import { useAuthStore } from '@/stores/authStore';
import { Panel, PanelHeader } from '@/components/panel';
import { PortfolioRaceChart } from '@/components/leaderboard/PortfolioRaceChart';
import { Podium } from '@/components/leaderboard/Podium';
import { StandingsTable } from '@/components/leaderboard/StandingsTable';
import { analyseHistory } from '@/components/leaderboard/analyse-history';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Dedicated `/games/:gameId/leaderboard` page. Composes the race chart,
 * podium, full standings table, and auto-generated highlights. All data
 * comes from `useGame` + `useLeaderboardHistory` — no new endpoint beyond
 * what Phase 2 added.
 */
export function GameLeaderboardPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const [range, setRange] = useState<LeaderboardHistoryRange>('all');

  const game = useGame(gameId);
  const history = useLeaderboardHistory(gameId, range, 240);

  if (game.isError && game.error instanceof ApiError && game.error.status === 404) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold text-text-strong">Game not found</h1>
        <p className="mt-2 text-sm text-muted">
          You may not be a member of this game, or it may have been deleted.
        </p>
        <Link to="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          ← Back to games
        </Link>
      </main>
    );
  }

  if (game.isLoading || !game.data) {
    return (
      <main className="mx-auto max-w-[1640px] p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-96 w-full" />
      </main>
    );
  }

  const gameData = game.data;
  const entries = gameData.leaderboard ?? [];

  const highlights = history.data ? analyseHistory(history.data) : [];

  return (
    <main className="mx-auto grid w-full max-w-[1640px] grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-3">
        <Crumb gameId={gameId} gameName={gameData.name} />

        <header>
          <h1 className="text-[22px] font-semibold tracking-tight text-text-strong">
            {gameData.name} &mdash; Leaderboard
          </h1>
          <p className="mt-1 text-xs text-muted">
            {entries.length} {entries.length === 1 ? 'player' : 'players'}
            {' · '}starting balance{' '}
            <span className="font-mono">
              ${gameData.startingBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
            {' · '}status{' '}
            <span className="font-mono uppercase">{gameData.status}</span>
          </p>
        </header>

        <Podium entries={entries} startingBalance={gameData.startingBalance} />

        {history.data ? (
          <PortfolioRaceChart
            history={history.data}
            startingBalance={gameData.startingBalance}
            currentUserId={userId}
            range={range}
            onRangeChange={setRange}
          />
        ) : (
          <Skeleton className="h-[440px] w-full" />
        )}

        <StandingsTable
          entries={entries}
          history={history.data ?? { range, startedAt: '', endedAt: '', series: [] }}
          startingBalance={gameData.startingBalance}
          currentUserId={userId}
        />
      </div>

      <aside className="flex flex-col gap-3">
        <YouCard
          entries={entries}
          userId={userId}
          startingBalance={gameData.startingBalance}
        />
        <RaceHighlightsPanel highlights={highlights} />
      </aside>
    </main>
  );
}

function Crumb({ gameId, gameName }: { gameId: string; gameName: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
    >
      <Link to="/" className="hover:text-text">
        Games
      </Link>
      <span className="text-hairline-strong">/</span>
      <Link to={`/games/${gameId}`} className="hover:text-text">
        {gameName}
      </Link>
      <span className="text-hairline-strong">/</span>
      <span className="text-text">Leaderboard</span>
    </nav>
  );
}

function YouCard({
  entries,
  userId,
  startingBalance,
}: {
  entries: Array<{ playerId: string; username: string; rank: number; totalValue: number }>;
  userId: string | null;
  startingBalance: number;
}) {
  const me = userId ? entries.find((e) => e.playerId === userId) ?? null : null;
  if (!me) return null;
  const top = entries[0];
  const above = entries.find((e) => e.rank === me.rank - 1) ?? null;
  const pnl = ((me.totalValue - startingBalance) / startingBalance) * 100;
  const deltaToTop = top ? top.totalValue - me.totalValue : null;
  const deltaToAbove = above ? above.totalValue - me.totalValue : null;

  return (
    <Panel>
      <PanelHeader
        right={
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
            Δ since join
          </span>
        }
      >
        Your row
      </PanelHeader>
      <div className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-3 p-3">
        <div className="font-mono text-[28px] leading-none text-accent">
          #{me.rank}
          <span className="block text-[11px] text-muted">of {entries.length}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Stat label="Value">
            <span className="font-mono text-sm text-text-strong">
              ${me.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
          </Stat>
          <Stat label="P&L">
            <span className={cn('font-mono text-sm', pnl > 0 ? 'text-gain' : pnl < 0 ? 'text-loss' : 'text-muted')}>
              {pnl > 0 ? '+' : pnl < 0 ? '−' : ''}
              {Math.abs(pnl).toFixed(2)}%
            </span>
          </Stat>
          <Stat label="Δ to #1">
            <span className="font-mono text-sm text-loss">
              {deltaToTop != null ? `−$${deltaToTop.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
            </span>
          </Stat>
          <Stat label={above ? `Δ to #${above.rank}` : 'Δ to next'}>
            <span className="font-mono text-sm text-loss">
              {deltaToAbove != null ? `−$${deltaToAbove.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
            </span>
          </Stat>
        </dl>
      </div>
    </Panel>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function RaceHighlightsPanel({
  highlights,
}: {
  highlights: ReturnType<typeof analyseHistory>;
}) {
  return (
    <Panel>
      <PanelHeader>Race highlights</PanelHeader>
      <div className="px-2.5 py-2 text-xs">
        {highlights.length === 0 ? (
          <p className="text-muted">No notable events yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {highlights.map((h, i) => (
              <li key={i} className="flex gap-2 py-1.5">
                <span className="min-w-[44px] font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
                  {h.dayLabel}
                </span>
                <span className="text-text">{h.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
