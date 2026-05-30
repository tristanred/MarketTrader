import { useParams } from 'react-router-dom';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { AchievementGrid } from '@/components/achievements/AchievementGrid';
import { useAchievements, type PlayerAchievementsResponse } from '@/api/achievements';
import { useGame } from '@/api/games';
import type { AchievementProgressDTO } from '@markettrader/shared';

/**
 * Game-scoped achievements page at `/games/:gameId/achievements`. Shows the
 * full catalog of enabled achievements — locked and unlocked — with the
 * viewer's own progress. Secret achievements appear only after the viewer
 * unlocks them. Peers' progress never appears here.
 */
export function AchievementsPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const game = useGame(gameId);
  const myGamePlayerId = game.data?.viewerGamePlayerId ?? null;
  const view = useAchievements(gameId, myGamePlayerId ?? undefined);

  const data = view.data as PlayerAchievementsResponse | undefined;
  const definitions = data?.definitions ?? [];
  const totalEnabledCount = data?.totalEnabledCount ?? 0;
  const viewerProgress: AchievementProgressDTO[] = myGamePlayerId
    ? data?.progress[myGamePlayerId] ?? []
    : [];
  const unlockedCount = viewerProgress.filter((p) => p.unlockedAt).length;

  return (
    <main className="mx-auto max-w-5xl p-4">
      <Panel>
        <PanelHeader right={<span className="font-mono">{unlockedCount} / {totalEnabledCount} unlocked</span>}>
          Achievements
        </PanelHeader>
        <PanelBody className="flex flex-col gap-4">
          {!myGamePlayerId ? (
            <p className="py-6 text-center text-sm text-muted">
              {game.isLoading ? 'Loading…' : 'Join this game to track achievements.'}
            </p>
          ) : (
            <AchievementGrid
              definitions={definitions}
              progress={viewerProgress}
              totalEnabledCount={totalEnabledCount}
            />
          )}
        </PanelBody>
      </Panel>
    </main>
  );
}
