import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { StockQuote, StockSearchResult } from '@markettrader/shared';

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
