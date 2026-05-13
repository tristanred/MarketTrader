import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  AddWatchlistSymbolRequest,
  CreateWatchlistRequest,
  RenameWatchlistRequest,
  Watchlist,
} from '@markettrader/shared';

export const watchlistKeys = {
  all: ['watchlists'] as const,
};

export function useWatchlists() {
  return useQuery({
    queryKey: watchlistKeys.all,
    queryFn: () => apiFetch<Watchlist[]>('/watchlists'),
  });
}

export function useCreateWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWatchlistRequest) =>
      apiFetch<Watchlist>('/watchlists', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: watchlistKeys.all });
    },
  });
}

export function useRenameWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RenameWatchlistRequest }) =>
      apiFetch<Watchlist>(`/watchlists/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: watchlistKeys.all });
    },
  });
}

export function useDeleteWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/watchlists/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: watchlistKeys.all });
    },
  });
}

export function useAddWatchlistSymbol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AddWatchlistSymbolRequest }) =>
      apiFetch<Watchlist>(`/watchlists/${id}/items`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: watchlistKeys.all });
    },
  });
}

export function useRemoveWatchlistSymbol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, symbol }: { id: string; symbol: string }) =>
      apiFetch<Watchlist>(`/watchlists/${id}/items/${encodeURIComponent(symbol)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: watchlistKeys.all });
    },
  });
}
