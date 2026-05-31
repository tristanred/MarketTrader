import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { AchievementDefinitionDTO, AchievementProgressDTO } from '@markettrader/shared';

/**
 * Server payload for `GET /games/:gameId/achievements` — the game-wide feed
 * source consumed by the arena Activity panel. `definitions` only includes
 * definitions unlocked by at least one player; `progress` carries the matching
 * unlock rows keyed by gamePlayerId. `totalEnabledCount` is the game's full
 * enabled denominator for the `X / Y unlocked` UI.
 */
export interface GameAchievementsResponse {
  definitions: AchievementDefinitionDTO[];
  /** Keyed by gamePlayerId. Only carries unlock rows for visible definitions. */
  progress: Record<string, AchievementProgressDTO[]>;
  totalEnabledCount: number;
}

/**
 * Server payload for `GET /games/:gameId/players/:gamePlayerId/achievements`.
 * Same shape as {@link GameAchievementsResponse}: `progress` is keyed by the
 * single requested gamePlayerId. For the owner it includes their in-progress
 * (locked) rows; `definitions` includes all enabled non-secret definitions plus
 * any secret ones that player has unlocked.
 */
export interface PlayerAchievementsResponse {
  definitions: AchievementDefinitionDTO[];
  progress: Record<string, AchievementProgressDTO[]>;
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
