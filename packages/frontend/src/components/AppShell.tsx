import { Outlet, useParams } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader';
import { StatusStrip, TickerTape } from '@/components/shell';
import { SymbolSearchOverlay } from '@/components/search';
import { AchievementToastHost } from '@/components/achievements/AchievementToastHost';
import { SelectedSymbolProvider } from '@/contexts/SelectedSymbolContext';
import { useIndicesSocket } from '@/hooks/useIndicesSocket';
import { useCommandK } from '@/hooks/useCommandK';
import { useGame } from '@/api/games';
import { getDayCounter } from '@/lib/gameDay';

/**
 * Three-row layout for every authenticated page: AppHeader on top,
 * StatusStrip below it, the routed page in the middle, and the
 * TickerTape pinned at the viewport bottom. Mounts a single
 * useIndicesSocket subscription and the global cmd+k hotkey + overlay.
 */
export function AppShell() {
  useIndicesSocket();
  useCommandK();
  const { gameId } = useParams();
  // useGame tolerates undefined via its own `enabled: !!gameId` guard.
  const game = useGame(gameId ?? '');

  const ctx =
    gameId && game.data
      ? {
          gameId,
          name: game.data.name,
          ...getDayCounter(game.data.startDate, game.data.endDate, new Date()),
        }
      : undefined;

  return (
    // The provider lives at shell level so global chrome (TickerTape,
    // StatusStrip, cmd+k overlay) can write the user's selected symbol
    // into the same context the in-game arena reads. Reset on game
    // change via the keyed remount.
    <SelectedSymbolProvider key={gameId ?? 'no-game'}>
      <div className="flex min-h-screen flex-col bg-bg text-text">
        <AppHeader />
        <StatusStrip {...(ctx ? { gameContext: ctx } : {})} />
        <main className="flex-1">
          <Outlet />
        </main>
        <TickerTape />
        <SymbolSearchOverlay />
        <AchievementToastHost />
      </div>
    </SelectedSymbolProvider>
  );
}
