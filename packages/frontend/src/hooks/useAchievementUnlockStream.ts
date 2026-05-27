import { useCallback } from 'react';
import { useAchievementToastStore } from '@/stores/achievementToastStore';
import { useActivityFeedStore } from '@/stores/activityFeedStore';
import { isAlreadySeen } from '@/lib/achievementSeenMarker';
import type { WsAchievementUnlockedEvent } from '@markettrader/shared';

interface UseAchievementUnlockStreamApi {
  /**
   * Call this with the `data` payload of an incoming achievement_unlocked
   * WS frame. Every unlock (viewer's or peer's) is pushed to the activity
   * feed store; the toast is enqueued only for the viewer's own unlocks.
   */
  handle(unlock: WsAchievementUnlockedEvent['data']): void;
}

/**
 * Bridges the per-game WebSocket to the achievement toast and activity
 * stores. The activity store receives every unlock so peer unlocks can
 * render in the Activity panel; the toast remains viewer-only.
 */
export function useAchievementUnlockStream(
  gameId: string,
  myGamePlayerId: string | null,
): UseAchievementUnlockStreamApi {
  const enqueue = useAchievementToastStore((s) => s.enqueue);

  const handle = useCallback(
    (unlock: WsAchievementUnlockedEvent['data']) => {
      useActivityFeedStore.getState().addUnlock(gameId, {
        gamePlayerId: unlock.gamePlayerId,
        achievementKey: unlock.achievementKey,
        name: unlock.name,
        rarity: unlock.rarity,
        icon: unlock.icon,
        unlockedAt: unlock.unlockedAt,
      });

      if (!myGamePlayerId) return;
      if (unlock.gamePlayerId !== myGamePlayerId) return;
      if (isAlreadySeen(gameId, myGamePlayerId, unlock.unlockedAt)) return;
      enqueue(unlock);
    },
    [gameId, myGamePlayerId, enqueue],
  );

  return { handle };
}
