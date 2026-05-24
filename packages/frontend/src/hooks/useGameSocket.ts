import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useLiveStore } from '@/stores/liveStore';
import { tradeKeys } from '@/api/trades';
import { leaderboardHistoryKeys } from '@/api/leaderboard-history';
import { toast } from '@/components/ui/toast';
import { useAchievementUnlockStream } from './useAchievementUnlockStream';
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
 *
 * @param myGamePlayerId - The viewer's gamePlayerId, used to filter
 *   achievement_unlocked events to only those belonging to the current player.
 *   Pass null when the viewer is not yet a member of the game.
 */
export function useGameSocket(gameId: string, symbols: string[], myGamePlayerId: string | null): void {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  // Stash qc + store setters in refs so the primary effect can depend only on
  // [gameId, token]. The setters happen to be stable today (Zustand v5), but
  // a stable dep list keeps the WS from ever tearing down on incidental
  // provider remounts.
  const qcRef = useRef(qc);
  qcRef.current = qc;

  const { handle: handleAchievementUnlock } = useAchievementUnlockStream(gameId, myGamePlayerId);
  const handleAchievementUnlockRef = useRef(handleAchievementUnlock);
  handleAchievementUnlockRef.current = handleAchievementUnlock;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<{ attempt: number; timer: number | null }>({ attempt: 0, timer: null });
  const symbolsRef = useRef<string[]>(symbols);
  symbolsRef.current = symbols;
  // Tracks the last sorted-joined symbol set actually sent on this socket.
  // Reset on socket open so the first subscribe after a reconnect always fires.
  const lastSentKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!gameId || !token) return;
    let cancelled = false;
    useLiveStore.getState().reset();

    const sendSubscribe = (ws: WebSocket, syms: string[]) => {
      if (syms.length === 0) return;
      const key = [...syms].sort().join(',');
      if (lastSentKeyRef.current === key) return;
      const msg: WsClientEvent = { event: 'subscribe', data: { symbols: syms } };
      try {
        ws.send(JSON.stringify(msg));
        lastSentKeyRef.current = key;
      } catch {
        // socket may have just closed
      }
    };

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(buildWsUrl(gameId, token));
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectRef.current.attempt = 0;
        lastSentKeyRef.current = null;
        sendSubscribe(ws, symbolsRef.current);
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as WsServerEvent;
          const store = useLiveStore.getState();
          if (parsed.event === 'price_update') store.applyPriceUpdate(parsed.data);
          else if (parsed.event === 'leaderboard_update') {
            store.applyLeaderboard(parsed.data);
            // History snapshot was written server-side just before this
            // broadcast — refresh sparklines and the race chart so they
            // pick up the new point on the next render.
            void qcRef.current.invalidateQueries({ queryKey: leaderboardHistoryKeys.all });
          }
          else if (parsed.event === 'trade_executed') {
            store.applyTradeExecuted(parsed.data);
            // A working order may have just flipped to executed — refresh.
            void qcRef.current.invalidateQueries({ queryKey: tradeKeys.working(gameId) });
            void qcRef.current.invalidateQueries({ queryKey: tradeKeys.pending(gameId) });
          } else if (parsed.event === 'order_placed') {
            void qcRef.current.invalidateQueries({ queryKey: tradeKeys.working(gameId) });
          } else if (parsed.event === 'order_cancelled') {
            void qcRef.current.invalidateQueries({ queryKey: tradeKeys.working(gameId) });
            void qcRef.current.invalidateQueries({ queryKey: tradeKeys.pending(gameId) });
            void qcRef.current.invalidateQueries({ queryKey: tradeKeys.portfolio(gameId) });
          } else if (parsed.event === 'order_triggered') {
            void qcRef.current.invalidateQueries({ queryKey: tradeKeys.working(gameId) });
            toast({
              title: 'Stop triggered',
              description: `Order ${parsed.data.tradeId.slice(0, 8)} now resting as a limit at ${parsed.data.triggerPrice.toFixed(2)}.`,
              variant: 'success',
            });
          } else if (parsed.event === 'achievement_unlocked') {
            handleAchievementUnlockRef.current(parsed.data);
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
      lastSentKeyRef.current = null;
    };
  }, [gameId, token]);

  // When the parent's symbol list changes, push a fresh subscribe — but only
  // when the sorted set actually differs from what was last sent.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (symbols.length === 0) return;
    const key = [...symbols].sort().join(',');
    if (lastSentKeyRef.current === key) return;
    const msg: WsClientEvent = { event: 'subscribe', data: { symbols } };
    try {
      ws.send(JSON.stringify(msg));
      lastSentKeyRef.current = key;
    } catch {
      // ignore
    }
  }, [symbols]);
}
