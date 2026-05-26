import { useCallback } from 'react';
import { useAchievementToastStore } from '@/stores/achievementToastStore';
import { isAlreadySeen } from '@/lib/achievementSeenMarker';
import type { WsAchievementUnlockedEvent } from '@markettrader/shared';

interface UseAchievementUnlockStreamApi {
  /**
   * Call this with the `data` payload of an incoming achievement_unlocked
   * WS frame. The hook filters peer unlocks and previously-seen unlocks,
   * then enqueues the rest on the toast store.
   */
  handle(unlock: WsAchievementUnlockedEvent['data']): void;
}

/**
 * Bridges the per-game WebSocket to the achievement toast store. Returns a
 * stable `handle` callback that `useGameSocket` calls for each inbound
 * achievement_unlocked frame.
 */
export function useAchievementUnlockStream(
  gameId: string,
  myGamePlayerId: string | null,
): UseAchievementUnlockStreamApi {
  const enqueue = useAchievementToastStore((s) => s.enqueue);

  const handle = useCallback(
    (unlock: WsAchievementUnlockedEvent['data']) => {
      if (!myGamePlayerId) return;
      if (unlock.gamePlayerId !== myGamePlayerId) return;
      if (isAlreadySeen(gameId, myGamePlayerId, unlock.unlockedAt)) return;
      enqueue(unlock);
    },
    [gameId, myGamePlayerId, enqueue],
  );

  return { handle };
}
