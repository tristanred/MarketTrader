import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { AchievementGrid } from '@/components/achievements/AchievementGrid';
import { AchievementRoster } from '@/components/achievements/AchievementRoster';
import { useAchievements, type GameAchievementsResponse } from '@/api/achievements';
import { useGame } from '@/api/games';
import type { AchievementProgressDTO } from '@markettrader/shared';

/**
 * Game-scoped achievements page at `/games/:gameId/achievements`. Renders the
 * viewer's progress (or another player's via `?player=…`) and a per-player
 * roster summary linking to each player's drilldown view.
 */
export function AchievementsPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const [params] = useSearchParams();
  const drilldownPlayerId = params.get('player');
  const game = useGame(gameId);
  const myGamePlayerId = game.data?.viewerGamePlayerId ?? null;
  const view = useAchievements(gameId);

  const usernames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of game.data?.leaderboard ?? []) m[e.gamePlayerId] = e.username;
    return m;
  }, [game.data]);

  const gameData = (view.data as GameAchievementsResponse | undefined);
  const definitions = gameData?.definitions ?? [];
  const allProgress = (gameData?.progress ?? {}) as Record<string, AchievementProgressDTO[]>;

  const viewProgress: AchievementProgressDTO[] = drilldownPlayerId
    ? allProgress[drilldownPlayerId] ?? []
    : myGamePlayerId
      ? allProgress[myGamePlayerId] ?? []
      : [];

  const unlockedCount = viewProgress.filter((p) => p.unlockedAt).length;
  const totalCount = definitions.length;

  return (
    <main className="mx-auto max-w-5xl p-4">
      <Panel>
        <PanelHeader right={<span className="font-mono">{unlockedCount} / {totalCount} unlocked</span>}>
          Achievements
          {drilldownPlayerId && (
            <span className="ml-3 normal-case tracking-normal text-text">
              · Viewing {usernames[drilldownPlayerId] ?? 'player'}&apos;s progress ·{' '}
              <Link to={`/games/${gameId}/achievements`} className="text-accent">
                ← back to mine
              </Link>
            </span>
          )}
        </PanelHeader>
        <PanelBody className="flex flex-col gap-4">
          <AchievementGrid definitions={definitions} progress={viewProgress} />
          {!drilldownPlayerId && (
            <AchievementRoster
              gameId={gameId}
              myGamePlayerId={myGamePlayerId}
              definitions={definitions}
              progressByPlayer={allProgress}
              usernames={usernames}
            />
          )}
        </PanelBody>
      </Panel>
    </main>
  );
}
