import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { ReconnectController, attachResumeListeners } from '@/lib/reconnect';
import type { IndexQuote, LiveWsMessage } from '@markettrader/shared';
import { TICKER_TAPE_QUERY_KEY } from '@/api/systemSettings';
import { isStaleCredentialClose, wsAuthProtocols } from '@/lib/wsAuth';
import { tryRefresh } from '@/lib/api';

/** Stable React Query key for the live indices cache. */
export const INDICES_QUERY_KEY = ['indices'] as const;

/** Cache key flagging that the provider couldn't fetch index quotes this tick. */
export const INDICES_UNAVAILABLE_QUERY_KEY = ['indices-unavailable'] as const;

/**
 * Subscribes to `/ws/live` for app-wide chrome data (indices + ticker-tape
 * config changes). Writes `IndexQuote[]` into the React Query cache keyed
 * `['indices']` and invalidates the ticker-tape query when its config changes.
 *
 * Mounted once at AppShell level. Reconnects under
 * {@link ReconnectController}'s backoff policy and publishes its health on the
 * `global` channel of {@link useConnectionStore}.
 */
export function useIndicesSocket(): void {
  const token = useAuthStore((s) => s.token);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token) return;
    let socket: WebSocket | null = null;
    let cancelled = false;
    const { setStatus } = useConnectionStore.getState();
    const reconnect = new ReconnectController();

    const connect = () => {
      if (cancelled) return;
      setStatus('global', 'connecting');
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // No credential in the URL: it is offered in the upgrade header instead,
      // because proxy and process logs record the request line verbatim.
      const url = `${proto}//${window.location.host}/api/ws/live`;
      const ws = new WebSocket(url, wsAuthProtocols(token));
      socket = ws;
      let openedAt = 0;

      ws.onopen = () => {
        openedAt = Date.now();
        reconnect.markOpen();
        setStatus('global', 'live');
      };

      ws.onmessage = (e) => {
        let msg: LiveWsMessage;
        try {
          msg = JSON.parse(e.data) as LiveWsMessage;
        } catch {
          return;
        }
        if (msg.event === 'indices') {
          queryClient.setQueryData<IndexQuote[]>(INDICES_QUERY_KEY, msg.data.quotes);
          queryClient.setQueryData<boolean>(
            INDICES_UNAVAILABLE_QUERY_KEY,
            msg.data.unavailable ?? false,
          );
        } else if (msg.event === 'ticker_tape_config_changed') {
          void queryClient.invalidateQueries({ queryKey: TICKER_TAPE_QUERY_KEY });
        }
      };

      // A fault usually fires onerror *and* onclose; funnelling both through
      // close keeps one drop from spending two attempts of the budget.
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      };

      ws.onclose = (evt?: CloseEvent) => {
        if (cancelled) return;
        // See useGameSocket: an established socket closed with 1008 means the
        // access token expired, and only a fresh one gets it back.
        if (isStaleCredentialClose(evt?.code, openedAt)) {
          setStatus('global', 'reconnecting');
          void tryRefresh();
          return;
        }
        setStatus('global', reconnect.scheduleReconnect(connect) === null ? 'offline' : 'reconnecting');
      };
    };

    // Only revives a socket that has spent its attempt budget — a healthy or
    // already-pending one is left alone.
    const resume = () => {
      if (cancelled || !reconnect.exhausted) return;
      reconnect.reset();
      connect();
    };
    const detachResume = attachResumeListeners(resume);
    const unsubscribeRetry = useConnectionStore.subscribe((s, prev) => {
      if (s.retryNonce !== prev.retryNonce) resume();
    });

    connect();

    return () => {
      cancelled = true;
      detachResume();
      unsubscribeRetry();
      reconnect.cancel();
      socket?.close();
      setStatus('global', 'idle');
    };
  }, [token, queryClient]);
}
