import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { TickerTapeSettings } from '@markettrader/shared';

/** Stable query key for the ticker-tape settings cache. */
export const TICKER_TAPE_QUERY_KEY = ['system-settings', 'ticker-tape'] as const;

/**
 * React Query hook around `GET /system-settings/ticker-tape`. Cached
 * indefinitely; live updates come via the `/ws/live` WebSocket
 * (`useIndicesSocket` invalidates this query on config-changed events).
 */
export function useTickerTapeSettings() {
  return useQuery({
    queryKey: TICKER_TAPE_QUERY_KEY,
    queryFn: () => apiFetch<TickerTapeSettings>('/system-settings/ticker-tape'),
    staleTime: Infinity,
  });
}
