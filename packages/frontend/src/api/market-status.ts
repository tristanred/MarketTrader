import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { MarketStatusResult } from '@markettrader/shared';

/**
 * Polls the server's `/market/status` endpoint. The result tells the chart
 * whether to extend the price line with live ticks; staleTime of 30s keeps
 * the chart responsive while the 60s refetch absorbs session boundaries.
 */
export function useMarketStatus() {
  return useQuery({
    queryKey: ['market', 'status'],
    queryFn: () => apiFetch<MarketStatusResult>('/market/status'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
