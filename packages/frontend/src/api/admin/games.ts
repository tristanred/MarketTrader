import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  AdminListGamesResponse,
  AdminGameSummary,
  AdminUpdateGameRequest,
  AdminTransferGameOwnerRequest,
  AdminSetGameStatusRequest,
  AdminAddPlayerRequest,
  AdminListGamePlayersResponse,
} from '@markettrader/shared';

export const adminGameKeys = {
  all: ['admin', 'games'] as const,
  list: (q: AdminListGamesQuery) => [...adminGameKeys.all, 'list', q] as const,
  detail: (id: string) => [...adminGameKeys.all, 'detail', id] as const,
};

export interface AdminListGamesQuery {
  q?: string;
  status?: 'pending' | 'active' | 'ended';
  ownerId?: string;
  limit?: number;
  offset?: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export function useAdminGames(query: AdminListGamesQuery) {
  return useQuery({
    queryKey: adminGameKeys.list(query),
    queryFn: () => apiFetch<AdminListGamesResponse>(`/admin/games${qs({ ...query })}`),
  });
}

export function useAdminGamePlayers(gameId: string) {
  return useQuery({
    queryKey: [...adminGameKeys.detail(gameId), 'players'] as const,
    queryFn: () => apiFetch<AdminListGamePlayersResponse>(`/admin/games/${gameId}/players`),
    enabled: !!gameId,
  });
}

export function useAdminGame(gameId: string) {
  return useQuery({
    queryKey: adminGameKeys.detail(gameId),
    queryFn: () =>
      apiFetch<AdminGameSummary & { allowShortSelling: boolean; allowLimitOrders: boolean; allowStopOrders: boolean; allowBracketOrders: boolean; allowGTC: boolean }>(
        `/admin/games/${gameId}`,
      ),
    enabled: !!gameId,
  });
}

export function useAdminUpdateGame(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminUpdateGameRequest) =>
      apiFetch<void>(`/admin/games/${gameId}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminGameKeys.all });
    },
  });
}

export function useAdminTransferGameOwner(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminTransferGameOwnerRequest) =>
      apiFetch<void>(`/admin/games/${gameId}/owner`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminGameKeys.all });
    },
  });
}

export function useAdminSetGameStatus(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminSetGameStatusRequest) =>
      apiFetch<void>(`/admin/games/${gameId}/status`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminGameKeys.all });
    },
  });
}

export function useAdminResetGame(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ force }: { force?: boolean } = {}) =>
      apiFetch<void>(
        `/admin/games/${gameId}/reset${force ? '?force=true' : ''}`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminGameKeys.all });
    },
  });
}

export function useAdminDeleteGame(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ force }: { force?: boolean } = {}) =>
      apiFetch<void>(
        `/admin/games/${gameId}${force ? '?force=true' : ''}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminGameKeys.all });
    },
  });
}

export function useAdminAddPlayer(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminAddPlayerRequest) =>
      apiFetch<{ playerId: string }>(`/admin/games/${gameId}/players`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminGameKeys.detail(gameId) });
    },
  });
}

export function useAdminRemovePlayer(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) =>
      apiFetch<void>(`/admin/games/${gameId}/players/${playerId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminGameKeys.detail(gameId) });
    },
  });
}

export function useAdminCancelWorkingOrders(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ cancelled: number }>(
        `/admin/games/${gameId}/cancel-working-orders`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminGameKeys.detail(gameId) });
    },
  });
}
