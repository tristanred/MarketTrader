import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  AdminForceExecuteTradeRequest,
  AdminEditTradePriceRequest,
  AdminListGameTradesResponse,
  Trade,
} from '@markettrader/shared';
import { adminGameKeys } from './games';

export interface AdminGameTradesQuery {
  status?: 'pending' | 'working' | 'executed' | 'cancelled';
  playerId?: string;
  symbol?: string;
  limit?: number;
  offset?: number;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const adminTradeKeys = {
  all: ['admin', 'trades'] as const,
  gameList: (gameId: string, q: AdminGameTradesQuery) =>
    [...adminTradeKeys.all, 'game', gameId, q] as const,
};

export function useAdminGameTrades(gameId: string, query: AdminGameTradesQuery) {
  return useQuery({
    queryKey: adminTradeKeys.gameList(gameId, query),
    queryFn: () =>
      apiFetch<AdminListGameTradesResponse>(
        `/admin/games/${gameId}/trades${qs({ ...query })}`,
      ),
    enabled: !!gameId,
  });
}

export function useAdminCancelTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tradeId: string) =>
      apiFetch<void>(`/admin/trades/${tradeId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminGameKeys.all });
    },
  });
}

export function useAdminForceExecuteTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tradeId, body }: { tradeId: string; body: AdminForceExecuteTradeRequest }) =>
      apiFetch<Trade>(`/admin/trades/${tradeId}/force-execute`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminGameKeys.all });
    },
  });
}

export function useAdminReverseTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tradeId: string) =>
      apiFetch<void>(`/admin/trades/${tradeId}/reverse`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminGameKeys.all });
    },
  });
}

export function useAdminEditTradePrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tradeId, body }: { tradeId: string; body: AdminEditTradePriceRequest }) =>
      apiFetch<void>(`/admin/trades/${tradeId}/price`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminGameKeys.all });
    },
  });
}
