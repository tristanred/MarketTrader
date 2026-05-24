import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type {
  AchievementDefinitionDTO,
  AchievementProgressDTO,
} from '@markettrader/shared';

export interface AchievementRosterProps {
  gameId: string;
  myGamePlayerId: string | null;
  definitions: AchievementDefinitionDTO[];
  progressByPlayer: Record<string, AchievementProgressDTO[]>;
  usernames: Record<string, string>;
  className?: string;
}

/**
 * Per-player rollup of unlocked-achievement counts. Renders one row per
 * player (current player pinned first with a YOU chip). Each row is a link
 * to the same page scoped to that player via `?player=<gamePlayerId>`.
 */
export function AchievementRoster({
  gameId,
  myGamePlayerId,
  definitions,
  progressByPlayer,
  usernames,
  className,
}: AchievementRosterProps) {
  const rarityByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of definitions) m.set(d.key, d.rarity);
    return m;
  }, [definitions]);

  const rows = useMemo(() => {
    const out = Object.entries(progressByPlayer).map(([gpid, items]) => {
      const unlockedItems = items.filter((p) => p.unlockedAt);
      const legendaryCount = unlockedItems.filter(
        (p) => rarityByKey.get(p.achievementKey) === 'legendary',
      ).length;
      return {
        gamePlayerId: gpid,
        username: usernames[gpid] ?? gpid.slice(0, 8),
        isMe: gpid === myGamePlayerId,
        unlockedCount: unlockedItems.length,
        legendaryCount,
      };
    });
    out.sort((a, b) => {
      if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
      return b.unlockedCount - a.unlockedCount;
    });
    return out;
  }, [progressByPlayer, rarityByKey, usernames, myGamePlayerId]);

  return (
    <div className={cn('border-t border-hairline pt-3', className)}>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted mb-2">
        Other players
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <Link
            key={r.gamePlayerId}
            to={
              r.isMe
                ? `/games/${gameId}/achievements`
                : `/games/${gameId}/achievements?player=${r.gamePlayerId}`
            }
            className="flex items-center justify-between text-[11px] hover:bg-accent-bg rounded-sm px-1 py-0.5"
          >
            <span className="text-text">
              {r.username}
              {r.isMe && (
                <span className="ml-1.5 font-mono text-[9px] tracking-[0.12em] text-accent">
                  YOU
                </span>
              )}
            </span>
            <span className="font-mono text-[10px] text-muted tabular-nums">
              {r.unlockedCount} unlocked · {r.legendaryCount} leg.
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
