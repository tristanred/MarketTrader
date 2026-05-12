import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { gameKeys } from '@/api/games';
import type { PlaceTradeRequest, Trade } from '@markettrader/shared';

/** Server response shape for `GET /games/:id/portfolio` — enriched with live prices and P&L. */
export interface EnrichedHolding {
  symbol: string;
  quantity: number;
  avgCostBasis: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

export interface PortfolioResponse {
  cashBalance: number;
  holdings: EnrichedHolding[];
  totalValue: number;
}

export const tradeKeys = {
  portfolio: (gameId: string) => ['portfolio', gameId] as const,
  history: (gameId: string) => ['trades', gameId] as const,
};

export function usePortfolio(gameId: string) {
  return useQuery({
    queryKey: tradeKeys.portfolio(gameId),
    queryFn: () => apiFetch<PortfolioResponse>(`/games/${gameId}/portfolio`),
    enabled: !!gameId,
    refetchInterval: 30_000,
  });
}

export function useTradeHistory(gameId: string) {
  return useQuery({
    queryKey: tradeKeys.history(gameId),
    queryFn: () => apiFetch<Trade[]>(`/games/${gameId}/trades`),
    enabled: !!gameId,
  });
}

export function usePlaceTrade(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PlaceTradeRequest) =>
      apiFetch<{ trade: Trade; cashBalance: number }>(`/games/${gameId}/trades`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tradeKeys.portfolio(gameId) });
      void qc.invalidateQueries({ queryKey: tradeKeys.history(gameId) });
      void qc.invalidateQueries({ queryKey: gameKeys.detail(gameId) });
    },
  });
}
