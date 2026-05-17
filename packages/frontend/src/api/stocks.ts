import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  StockDetails,
  StockHistoryRange,
  StockHistoryResponse,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';

export function useStockSearch(q: string) {
  return useQuery({
    queryKey: ['stocks', 'search', q],
    queryFn: () => apiFetch<StockSearchResult[]>(`/stocks/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 1,
    staleTime: 60_000,
  });
}

/**
 * Fetches a fresh quote for one symbol. Callers can disable the query
 * (e.g. when a live WebSocket tick is already on hand) via `opts.enabled`.
 */
export function useStockQuote(symbol: string, opts: { enabled?: boolean } = {}) {
  const enabled = (opts.enabled ?? true) && !!symbol;
  return useQuery({
    queryKey: ['stocks', 'quote', symbol],
    queryFn: () => apiFetch<StockQuote>(`/stocks/${symbol}`),
    enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useStockDetails(symbol: string) {
  return useQuery({
    queryKey: ['stocks', 'details', symbol],
    queryFn: () => apiFetch<StockDetails>(`/stocks/${encodeURIComponent(symbol)}/details`),
    enabled: !!symbol,
    staleTime: 30_000,
  });
}

export function useStockHistory(symbol: string, range: StockHistoryRange) {
  return useQuery({
    queryKey: ['stocks', 'history', symbol, range],
    queryFn: () =>
      apiFetch<StockHistoryResponse>(
        `/stocks/${encodeURIComponent(symbol)}/history?range=${range}`,
      ),
    enabled: !!symbol,
    staleTime: 60_000,
  });
}
