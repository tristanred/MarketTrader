import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, API_BASE, ApiError } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { gameKeys } from '@/api/games';
import type { PendingTrade, PlaceTradeRequest, Trade } from '@markettrader/shared';

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
  /** Cash + held positions + value of any pending-trade reservations. */
  totalValue: number;
  /**
   * Value tied up in pending orders: reservedCash for pending buys, plus
   * (quantity × current price) for pending sells. Already included in `totalValue`.
   */
  reservedValue: number;
}

export const tradeKeys = {
  portfolio: (gameId: string) => ['portfolio', gameId] as const,
  history: (gameId: string) => ['trades', gameId] as const,
  pending: (gameId: string) => ['trades', gameId, 'pending'] as const,
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

/** Successful immediate fill from `POST /games/:id/trades`. */
export interface PlaceTradeExecuted {
  kind: 'executed';
  trade: Trade;
  cashBalance: number;
  /** True when the server filled at a cached price because the live provider was rate-limited. */
  priceWasStale?: boolean;
  /** Age of the cached price in milliseconds. Only present when `priceWasStale` is true. */
  priceAgeMs?: number;
}

/** Queued-pending response from `POST /games/:id/trades` (HTTP 202). */
export interface PlaceTradePending {
  kind: 'pending';
  pending: PendingTrade;
}

export type PlaceTradeResponse = PlaceTradeExecuted | PlaceTradePending;

/**
 * Calls `POST /games/:id/trades` and discriminates the response by status code:
 * 201 → executed, 202 → pending. The hook layer mirrors {@link apiFetch}'s
 * auth/refresh behavior because we need raw status code access here.
 */
async function placeTradeRaw(gameId: string, body: PlaceTradeRequest): Promise<PlaceTradeResponse> {
  const token = useAuthStore.getState().token;
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE}/games/${gameId}/trades`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (res.status === 201) {
    const data = (await res.json()) as Omit<PlaceTradeExecuted, 'kind'>;
    return { kind: 'executed', ...data };
  }
  if (res.status === 202) {
    const data = (await res.json()) as { pending: PendingTrade };
    return { kind: 'pending', pending: data.pending };
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // empty body
  }
  throw new ApiError(res.status, parsed, `${res.status} ${res.statusText}`);
}

export function usePlaceTrade(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PlaceTradeRequest) => placeTradeRaw(gameId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tradeKeys.portfolio(gameId) });
      void qc.invalidateQueries({ queryKey: tradeKeys.history(gameId) });
      void qc.invalidateQueries({ queryKey: tradeKeys.pending(gameId) });
      void qc.invalidateQueries({ queryKey: gameKeys.detail(gameId) });
    },
  });
}

export function usePendingTrades(gameId: string) {
  return useQuery({
    queryKey: tradeKeys.pending(gameId),
    queryFn: () => apiFetch<PendingTrade[]>(`/games/${gameId}/trades/pending`),
    enabled: !!gameId,
    refetchInterval: 30_000,
  });
}

export function useCancelPendingTrade(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pendingId: string) =>
      apiFetch<void>(`/games/${gameId}/trades/pending/${pendingId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tradeKeys.pending(gameId) });
      void qc.invalidateQueries({ queryKey: tradeKeys.portfolio(gameId) });
      void qc.invalidateQueries({ queryKey: gameKeys.detail(gameId) });
    },
  });
}
