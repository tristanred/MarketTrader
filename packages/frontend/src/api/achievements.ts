import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { AchievementDefinitionDTO, AchievementProgressDTO } from '@markettrader/shared';

/**
 * Server payload for `GET /games/:gameId/achievements`. `definitions`
 * only includes definitions that at least one player has unlocked
 * (locked metadata is never sent). `totalEnabledCount` is the game's
 * full enabled denominator for the `X / Y unlocked` UI.
 */
export interface GameAchievementsResponse {
  definitions: AchievementDefinitionDTO[];
  /** Keyed by gamePlayerId. Only carries unlock rows for visible definitions. */
  progress: Record<string, AchievementProgressDTO[]>;
  totalEnabledCount: number;
}

/** Server payload for the per-player variant. */
export interface PlayerAchievementsResponse {
  definitions: AchievementDefinitionDTO[];
  progress: AchievementProgressDTO[];
  totalEnabledCount: number;
}

export const achievementKeys = {
  all: ['achievements'] as const,
  game: (gameId: string) => ['achievements', gameId, 'all'] as const,
  player: (gameId: string, gamePlayerId: string) => ['achievements', gameId, gamePlayerId] as const,
};

export function getGameAchievements(gameId: string): Promise<GameAchievementsResponse> {
  return apiFetch<GameAchievementsResponse>(`/games/${gameId}/achievements`);
}

export function getPlayerAchievements(
  gameId: string,
  gamePlayerId: string,
): Promise<PlayerAchievementsResponse> {
  return apiFetch<PlayerAchievementsResponse>(`/games/${gameId}/players/${gamePlayerId}/achievements`);
}

/** Idempotently advances the server-side `last_seen_unlock_at` high-water mark. */
export function ackAchievementUnlock(
  gameId: string,
  gamePlayerId: string,
  unlockedAt: string,
): Promise<void> {
  return apiFetch<void>(`/games/${gameId}/players/${gamePlayerId}/achievements/ack`, {
    method: 'POST',
    body: { unlockedAt },
  });
}

/**
 * Fetches achievement definitions + progress for a game. If `gamePlayerId`
 * is provided, returns the per-player view (smaller payload); otherwise
 * returns progress keyed by every player in the game (used by the roster).
 * Consumers should narrow on the `progress` shape based on whether they
 * passed `gamePlayerId`.
 */
export function useAchievements(
  gameId: string,
  gamePlayerId?: string,
) {
  return useQuery<GameAchievementsResponse | PlayerAchievementsResponse>({
    queryKey: gamePlayerId
      ? achievementKeys.player(gameId, gamePlayerId)
      : achievementKeys.game(gameId),
    queryFn: () =>
      gamePlayerId ? getPlayerAchievements(gameId, gamePlayerId) : getGameAchievements(gameId),
    staleTime: 30_000,
    enabled: Boolean(gameId),
  });
}
