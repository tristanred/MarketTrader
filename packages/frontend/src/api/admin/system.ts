import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  AdminSetStockPriceRequest,
  AdminStatsResponse,
  AdminUpdateTickerTapeRequest,
  TickerTapeSettings,
} from '@markettrader/shared';
import { TICKER_TAPE_QUERY_KEY } from '@/api/systemSettings';

export const adminSystemKeys = {
  stats: ['admin', 'system', 'stats'] as const,
};

export function useAdminStats() {
  return useQuery({
    queryKey: adminSystemKeys.stats,
    queryFn: () => apiFetch<AdminStatsResponse>('/admin/stats'),
    refetchInterval: 10_000,
  });
}

export function useAdminSetStockPrice() {
  return useMutation({
    mutationFn: ({ symbol, body }: { symbol: string; body: AdminSetStockPriceRequest }) =>
      apiFetch<void>(`/admin/stocks/${symbol}/price`, { method: 'PATCH', body }),
  });
}

export function useAdminFlushPriceCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ entriesRemoved: number }>('/admin/stocks/cache/flush', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminSystemKeys.stats });
    },
  });
}

/**
 * GET the current ticker-tape config. Shares the cache key with the
 * non-admin {@link useTickerTapeSettings}, so writes from this admin
 * hook invalidate the same cache the arena reads from.
 */
export function useAdminTickerTape() {
  return useQuery({
    queryKey: TICKER_TAPE_QUERY_KEY,
    queryFn: () => apiFetch<TickerTapeSettings>('/system-settings/ticker-tape'),
    staleTime: 5_000,
  });
}

/** PUT a new ticker-tape symbol list. Admin-only on the server. */
export function useAdminUpdateTickerTape() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminUpdateTickerTapeRequest) =>
      apiFetch<TickerTapeSettings>('/admin/system-settings/ticker-tape', {
        method: 'PUT',
        body,
      }),
    onSuccess: (next) => {
      qc.setQueryData(TICKER_TAPE_QUERY_KEY, next);
    },
  });
}
