import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { DiscoverResponse } from '@markettrader/shared';

export const discoverKeys = {
  game: (gameId: string) => ['discover', gameId] as const,
};

export function getDiscover(gameId: string): Promise<DiscoverResponse> {
  return apiFetch<DiscoverResponse>(`/games/${gameId}/discover`);
}

/**
 * The game's Discover list. The server only reads stored rows, so polling is
 * cheap: every minute while the worker is still preparing the list, then every
 * 15 minutes so an open tab picks up the after-close rollover.
 */
export function useDiscover(gameId: string | undefined) {
  return useQuery<DiscoverResponse>({
    queryKey: discoverKeys.game(gameId ?? ''),
    queryFn: () => getDiscover(gameId ?? ''),
    enabled: Boolean(gameId),
    staleTime: 5 * 60_000,
    refetchInterval: (query) => (query.state.data?.status === 'preparing' ? 60_000 : 15 * 60_000),
  });
}
