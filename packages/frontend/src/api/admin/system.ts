import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  AdminSetStockPriceRequest,
  AdminStatsResponse,
} from '@markettrader/shared';

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
