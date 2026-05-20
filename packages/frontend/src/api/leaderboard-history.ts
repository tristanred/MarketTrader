import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  LeaderboardHistoryRange,
  LeaderboardHistoryResponse,
} from '@markettrader/shared';

export const leaderboardHistoryKeys = {
  all: ['leaderboard-history'] as const,
  forGame: (gameId: string, range: LeaderboardHistoryRange, maxPoints: number) =>
    [...leaderboardHistoryKeys.all, gameId, range, maxPoints] as const,
};

/**
 * Fetches `/games/:id/leaderboard/history` and caches per (gameId, range,
 * maxPoints) tuple. The `useGameSocket` hook invalidates the `all` root key
 * on every `leaderboard_update` event, so an executed trade refreshes
 * sparklines without a new WS message type.
 *
 * @param maxPoints  Sparklines call this with ~60; the dedicated page uses
 *                   the server default of 240.
 */
export function useLeaderboardHistory(
  gameId: string,
  range: LeaderboardHistoryRange,
  maxPoints = 240,
) {
  return useQuery({
    queryKey: leaderboardHistoryKeys.forGame(gameId, range, maxPoints),
    queryFn: () =>
      apiFetch<LeaderboardHistoryResponse>(
        `/games/${gameId}/leaderboard/history?range=${range}&maxPoints=${maxPoints}`,
      ),
    enabled: !!gameId,
    // Snapshot cadence is 5 minutes server-side; keep cached data fresh for
    // 30 seconds on the client so rapid panel re-renders don't re-fetch.
    staleTime: 30_000,
  });
}
