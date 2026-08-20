import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useLiveStore } from '@/stores/liveStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { ReconnectController, attachResumeListeners } from '@/lib/reconnect';
import { tradeKeys } from '@/api/trades';
import { leaderboardHistoryKeys } from '@/api/leaderboard-history';
import { toast } from '@/components/ui/toast';
import { useAchievementUnlockStream } from './useAchievementUnlockStream';
import type { WsClientEvent, WsServerEvent } from '@markettrader/shared';

/** Compute the WebSocket URL for a given game, including the access token query param. */
function buildWsUrl(gameId: string, token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api/games/${gameId}/live?token=${encodeURIComponent(token)}`;
}

/**
 * Opens a per-game WebSocket connection, dispatches inbound events into the
 * live store, sends a `subscribe` message whenever the symbol list changes,
 * and reconnects under {@link ReconnectController}'s backoff policy. Publishes
 * its health on the `game` channel of {@link useConnectionStore}. Returns
 * nothing; tear-down happens on unmount.
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
  const symbolsRef = useRef<string[]>(symbols);
  symbolsRef.current = symbols;
  // Tracks the last sorted-joined symbol set actually sent on this socket.
  // Reset on socket open so the first subscribe after a reconnect always fires.
  const lastSentKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!gameId || !token) return;
    let cancelled = false;
    useLiveStore.getState().reset();
    const { setStatus } = useConnectionStore.getState();
    const reconnect = new ReconnectController();

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
      setStatus('game', 'connecting');
      const ws = new WebSocket(buildWsUrl(gameId, token));
      wsRef.current = ws;

      ws.onopen = () => {
        reconnect.markOpen();
        setStatus('game', 'live');
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
            void qcRef.current.invalidateQueries({ queryKey: ['achievements', gameId] });
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
        setStatus('game', reconnect.scheduleReconnect(connect) === null ? 'offline' : 'reconnecting');
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
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
      lastSentKeyRef.current = null;
      setStatus('game', 'idle');
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
