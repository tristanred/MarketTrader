import { useParams } from 'react-router-dom';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { AchievementGrid } from '@/components/achievements/AchievementGrid';
import { useAchievements, type GameAchievementsResponse } from '@/api/achievements';
import { useGame } from '@/api/games';
import type { AchievementProgressDTO } from '@markettrader/shared';

/**
 * Game-scoped achievements page at `/games/:gameId/achievements`. Renders
 * only the viewer's own unlocked achievements plus a count of how many
 * remain locked. Peers' achievements never appear here — the only place
 * peer unlocks surface is the Activity panel on the arena page.
 */
export function AchievementsPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const game = useGame(gameId);
  const myGamePlayerId = game.data?.viewerGamePlayerId ?? null;
  const view = useAchievements(gameId);

  const gameData = view.data as GameAchievementsResponse | undefined;
  const allProgress = (gameData?.progress ?? {}) as Record<string, AchievementProgressDTO[]>;
  const totalEnabledCount = gameData?.totalEnabledCount ?? 0;

  const viewerProgress: AchievementProgressDTO[] = myGamePlayerId
    ? allProgress[myGamePlayerId] ?? []
    : [];
  const viewerUnlockedKeys = new Set(
    viewerProgress.filter((p) => p.unlockedAt).map((p) => p.achievementKey),
  );
  // Scope definitions to the viewer's unlocked set — the server payload
  // carries the union across all players (so the arena Activity panel
  // can render peer unlocks), but the viewer's own page must not show
  // peer-only achievements as cards.
  const viewerDefinitions = (gameData?.definitions ?? []).filter((d) =>
    viewerUnlockedKeys.has(d.key),
  );

  const unlockedCount = viewerUnlockedKeys.size;

  return (
    <main className="mx-auto max-w-5xl p-4">
      <Panel>
        <PanelHeader right={<span className="font-mono">{unlockedCount} / {totalEnabledCount} unlocked</span>}>
          Achievements
        </PanelHeader>
        <PanelBody className="flex flex-col gap-4">
          <AchievementGrid
            definitions={viewerDefinitions}
            progress={viewerProgress}
            totalEnabledCount={totalEnabledCount}
          />
        </PanelBody>
      </Panel>
    </main>
  );
}
