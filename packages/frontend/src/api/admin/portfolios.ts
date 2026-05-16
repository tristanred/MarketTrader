import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  AdminUpdateCashRequest,
  AdminAdjustHoldingsRequest,
} from '@markettrader/shared';
import type { PortfolioResponse } from '@/api/trades';
import { adminGameKeys } from './games';

export const adminPortfolioKeys = {
  all: ['admin', 'players'] as const,
  portfolio: (playerId: string) =>
    [...adminPortfolioKeys.all, playerId, 'portfolio'] as const,
};

export function useAdminPlayerPortfolio(playerId: string) {
  return useQuery({
    queryKey: adminPortfolioKeys.portfolio(playerId),
    queryFn: () =>
      apiFetch<PortfolioResponse>(`/admin/players/${playerId}/portfolio`),
    enabled: !!playerId,
    refetchInterval: 30_000,
  });
}

function invalidatePortfolio(qc: ReturnType<typeof useQueryClient>, playerId: string) {
  void qc.invalidateQueries({ queryKey: adminGameKeys.all });
  void qc.invalidateQueries({ queryKey: adminPortfolioKeys.portfolio(playerId) });
}

export function useAdminUpdateCash(playerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminUpdateCashRequest) =>
      apiFetch<void>(`/admin/players/${playerId}/cash`, { method: 'PATCH', body }),
    onSuccess: () => invalidatePortfolio(qc, playerId),
  });
}

export function useAdminAdjustHoldings(playerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminAdjustHoldingsRequest) =>
      apiFetch<void>(`/admin/players/${playerId}/holdings`, { method: 'POST', body }),
    onSuccess: () => invalidatePortfolio(qc, playerId),
  });
}

export function useAdminWipeHoldings(playerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ holdingsWiped: number }>(
        `/admin/players/${playerId}/holdings`,
        { method: 'DELETE' },
      ),
    onSuccess: () => invalidatePortfolio(qc, playerId),
  });
}
