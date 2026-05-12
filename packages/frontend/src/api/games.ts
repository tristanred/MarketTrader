import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { CreateGameRequest, Game, GameWithLeaderboard } from '@markettrader/shared';

export const gameKeys = {
  all: ['games'] as const,
  list: () => [...gameKeys.all, 'list'] as const,
  detail: (id: string) => [...gameKeys.all, 'detail', id] as const,
};

export function useGames() {
  return useQuery({
    queryKey: gameKeys.list(),
    queryFn: () => apiFetch<Game[]>('/games'),
  });
}

export function useGame(gameId: string) {
  return useQuery({
    queryKey: gameKeys.detail(gameId),
    queryFn: () => apiFetch<GameWithLeaderboard>(`/games/${gameId}`),
    enabled: !!gameId,
  });
}

export function useCreateGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGameRequest) =>
      apiFetch<Game>('/games', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gameKeys.list() });
    },
  });
}

export function useJoinGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gameId: string) =>
      apiFetch<{ playerId: string; gameId: string; cashBalance: number; joinedAt: string }>(
        `/games/${gameId}/join`,
        { method: 'POST' },
      ),
    onSuccess: (_, gameId) => {
      void qc.invalidateQueries({ queryKey: gameKeys.list() });
      void qc.invalidateQueries({ queryKey: gameKeys.detail(gameId) });
    },
  });
}
