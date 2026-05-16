import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import type { IndexQuote, LiveWsMessage } from '@markettrader/shared';
import { TICKER_TAPE_QUERY_KEY } from '@/api/systemSettings';

/** Stable React Query key for the live indices cache. */
export const INDICES_QUERY_KEY = ['indices'] as const;

/**
 * Subscribes to `/ws/live` for app-wide chrome data (indices + ticker-tape
 * config changes). Writes `IndexQuote[]` into the React Query cache keyed
 * `['indices']` and invalidates the ticker-tape query when its config changes.
 *
 * Mounted once at AppShell level. The hook handles reconnection with a
 * fixed 5s backoff on close/error.
 */
export function useIndicesSocket(): void {
  const token = useAuthStore((s) => s.token);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token) return;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/api/ws/live?token=${encodeURIComponent(token)}`;
      socket = new WebSocket(url);
      socket.onmessage = (e) => {
        let msg: LiveWsMessage;
        try {
          msg = JSON.parse(e.data) as LiveWsMessage;
        } catch {
          return;
        }
        if (msg.event === 'indices') {
          queryClient.setQueryData<IndexQuote[]>(INDICES_QUERY_KEY, msg.data.quotes);
        } else if (msg.event === 'ticker_tape_config_changed') {
          void queryClient.invalidateQueries({ queryKey: TICKER_TAPE_QUERY_KEY });
        }
      };
      const reschedule = () => {
        if (stopped) return;
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, 5000);
      };
      socket.onclose = reschedule;
      socket.onerror = reschedule;
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [token, queryClient]);
}
