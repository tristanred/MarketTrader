import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
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

export function useStockQuote(symbol: string) {
  return useQuery({
    queryKey: ['stocks', 'quote', symbol],
    queryFn: () => apiFetch<StockQuote>(`/stocks/${symbol}`),
    enabled: !!symbol,
    staleTime: 15_000,
    refetchInterval: 30_000,
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
