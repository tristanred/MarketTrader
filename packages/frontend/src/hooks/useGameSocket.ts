import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useLiveStore } from '@/stores/liveStore';
import { tradeKeys } from '@/api/trades';
import { toast } from '@/components/ui/toast';
import type { WsClientEvent, WsServerEvent } from '@markettrader/shared';

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

/** Compute the WebSocket URL for a given game, including the access token query param. */
function buildWsUrl(gameId: string, token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api/games/${gameId}/live?token=${encodeURIComponent(token)}`;
}

/**
 * Opens a per-game WebSocket connection, dispatches inbound events into the
 * live store, sends a `subscribe` message whenever the symbol list changes,
 * and reconnects with exponential backoff. Returns nothing; tear-down happens
 * on unmount.
 */
export function useGameSocket(gameId: string, symbols: string[]): void {
  const token = useAuthStore((s) => s.token);
  const applyPriceUpdate = useLiveStore((s) => s.applyPriceUpdate);
  const applyLeaderboard = useLiveStore((s) => s.applyLeaderboard);
  const applyTradeExecuted = useLiveStore((s) => s.applyTradeExecuted);
  const reset = useLiveStore((s) => s.reset);
  const qc = useQueryClient();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<{ attempt: number; timer: number | null }>({ attempt: 0, timer: null });
  const symbolsRef = useRef<string[]>(symbols);
  symbolsRef.current = symbols;

  useEffect(() => {
    if (!gameId || !token) return;
    let cancelled = false;
    reset();

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(buildWsUrl(gameId, token));
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectRef.current.attempt = 0;
        if (symbolsRef.current.length > 0) {
          const msg: WsClientEvent = {
            event: 'subscribe',
            data: { symbols: symbolsRef.current },
          };
          try {
            ws.send(JSON.stringify(msg));
          } catch {
            // ignore — socket may have just closed
          }
        }
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as WsServerEvent;
          if (parsed.event === 'price_update') applyPriceUpdate(parsed.data);
          else if (parsed.event === 'leaderboard_update') applyLeaderboard(parsed.data);
          else if (parsed.event === 'trade_executed') {
            applyTradeExecuted(parsed.data);
            // A working order may have just flipped to executed — refresh.
            void qc.invalidateQueries({ queryKey: tradeKeys.working(gameId) });
            void qc.invalidateQueries({ queryKey: tradeKeys.pending(gameId) });
          } else if (parsed.event === 'order_placed') {
            void qc.invalidateQueries({ queryKey: tradeKeys.working(gameId) });
          } else if (parsed.event === 'order_cancelled') {
            void qc.invalidateQueries({ queryKey: tradeKeys.working(gameId) });
            void qc.invalidateQueries({ queryKey: tradeKeys.pending(gameId) });
            void qc.invalidateQueries({ queryKey: tradeKeys.portfolio(gameId) });
          } else if (parsed.event === 'order_triggered') {
            void qc.invalidateQueries({ queryKey: tradeKeys.working(gameId) });
            toast({
              title: 'Stop triggered',
              description: `Order ${parsed.data.tradeId.slice(0, 8)} now resting as a limit at ${parsed.data.triggerPrice.toFixed(2)}.`,
              variant: 'success',
            });
          }
        } catch {
          // malformed — drop
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        const attempt = reconnectRef.current.attempt + 1;
        reconnectRef.current.attempt = attempt;
        const delay = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
        reconnectRef.current.timer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectRef.current.timer !== null) {
        window.clearTimeout(reconnectRef.current.timer);
        reconnectRef.current.timer = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, [gameId, token, applyPriceUpdate, applyLeaderboard, applyTradeExecuted, reset, qc]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (symbols.length === 0) return;
    const msg: WsClientEvent = { event: 'subscribe', data: { symbols } };
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore
    }
  }, [symbols]);
}
