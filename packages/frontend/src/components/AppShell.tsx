import { Outlet, useParams } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader';
import { StatusStrip, TickerTape } from '@/components/shell';
import { useIndicesSocket } from '@/hooks/useIndicesSocket';
import { useGame } from '@/api/games';

/**
 * Three-row layout for every authenticated page: AppHeader on top,
 * StatusStrip below it, the routed page in the middle, and the
 * TickerTape pinned at the viewport bottom. Mounts a single
 * useIndicesSocket subscription that feeds the chrome rows.
 */
export function AppShell() {
  useIndicesSocket();
  const { gameId } = useParams();
  // useGame tolerates undefined via its own `enabled: !!gameId` guard.
  const game = useGame(gameId ?? '');

  // TODO(phase-3): derive dayCurrent/dayTotal from game.startDate/endDate
  // when the arena lands. Phase 2 surfaces 1/1 as a known placeholder.
  const ctx =
    gameId && game.data
      ? { gameId, name: game.data.name, dayCurrent: 1, dayTotal: 1 }
      : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <AppHeader />
      <StatusStrip {...(ctx ? { gameContext: ctx } : {})} />
      <main className="flex-1">
        <Outlet />
      </main>
      <TickerTape />
    </div>
  );
}
