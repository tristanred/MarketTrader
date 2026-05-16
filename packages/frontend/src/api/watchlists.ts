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
    // Write the new list into the cache synchronously so callers that switch
    // selection right after mutateAsync() see it on the next render —
    // otherwise the server refetch can race ahead and snap the selection back.
    onSuccess: (created) => {
      qc.setQueryData<Watchlist[]>(watchlistKeys.all, (prev) =>
        prev ? (prev.some((w) => w.id === created.id) ? prev : [...prev, created]) : [created],
      );
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
