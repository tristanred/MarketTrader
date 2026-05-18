import { useQuery } from '@tanstack/react-query';
import type { FeaturedGame } from '@markettrader/shared';

export const featuredGamesKeys = {
  all: ['featured-games'] as const,
};

/**
 * Read-only public-tournaments feed used by the unauthenticated auth
 * pages. Uses raw `fetch` so no bearer header is attached — the server
 * route ({@link `GET /public/featured-games`}) is intentionally
 * unauthenticated.
 */
export function useFeaturedGames() {
  return useQuery({
    queryKey: featuredGamesKeys.all,
    queryFn: async (): Promise<FeaturedGame[]> => {
      const res = await fetch('/api/public/featured-games');
      if (!res.ok) {
        throw new Error(`Failed to load featured games (${res.status})`);
      }
      return res.json() as Promise<FeaturedGame[]>;
    },
    staleTime: 30_000,
  });
}
