import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@/lib/api';
import type {
  BrowsableGame,
  CreateGameRequest,
  Game,
  GameByCodeResponse,
  GameVisibility,
  GameWithLeaderboard,
  JoinGameRequest,
  UpdateGameRequest,
} from '@markettrader/shared';

export const gameKeys = {
  all: ['games'] as const,
  list: () => [...gameKeys.all, 'list'] as const,
  browse: () => [...gameKeys.all, 'browse'] as const,
  detail: (id: string) => [...gameKeys.all, 'detail', id] as const,
  byCode: (code: string) => [...gameKeys.all, 'by-code', code] as const,
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
      void qc.invalidateQueries({ queryKey: gameKeys.browse() });
    },
  });
}

export function useJoinGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ gameId, inviteCode }: { gameId: string; inviteCode?: string }) => {
      const body: JoinGameRequest = inviteCode ? { inviteCode } : {};
      return apiFetch<{ playerId: string; gameId: string; cashBalance: number; joinedAt: string }>(
        `/games/${gameId}/join`,
        { method: 'POST', body },
      );
    },
    onSuccess: (_, { gameId }) => {
      void qc.invalidateQueries({ queryKey: gameKeys.list() });
      void qc.invalidateQueries({ queryKey: gameKeys.detail(gameId) });
      void qc.invalidateQueries({ queryKey: gameKeys.browse() });
    },
    onError: (err) => {
      // A 403 here means visibility flipped to private after the browse list
      // was fetched; refetch so the now-stale row stops offering a dead join.
      if (err instanceof ApiError && err.status === 403) {
        void qc.invalidateQueries({ queryKey: gameKeys.browse() });
      }
    },
  });
}

/** Public games the current user has not joined and can still join. */
export function useBrowsableGames() {
  return useQuery({
    queryKey: gameKeys.browse(),
    queryFn: () => apiFetch<BrowsableGame[]>('/games/browse'),
  });
}

/** Resolves an invite code to a join prompt. */
export function useGameByCode(code: string) {
  return useQuery({
    queryKey: gameKeys.byCode(code),
    queryFn: () => apiFetch<GameByCodeResponse>(`/games/by-code/${code}`),
    enabled: !!code,
    retry: false,
  });
}

/** Creator-only. Flips a game between public and private. */
export function useUpdateGameVisibility(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (visibility: GameVisibility) => {
      const body: UpdateGameRequest = { visibility };
      return apiFetch<Game>(`/games/${gameId}`, { method: 'PATCH', body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gameKeys.detail(gameId) });
      void qc.invalidateQueries({ queryKey: gameKeys.list() });
      void qc.invalidateQueries({ queryKey: gameKeys.browse() });
    },
  });
}

/** Member-only, idempotent. Returns the game's invite code, minting one if absent. */
export function useMintInviteCode(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ inviteCode: string }>(`/games/${gameId}/invite-code`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gameKeys.detail(gameId) });
    },
  });
}
