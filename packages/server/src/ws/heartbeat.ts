import type { WebSocket } from 'ws';

const OPEN = 1;

export interface WsHeartbeatOptions {
  /** Ping period. Must stay below the shortest idle timeout on the path. */
  intervalMs?: number;
}

export interface WsHeartbeatHandle {
  stop(): void;
}

/**
 * Sends WebSocket ping frames to every open socket `sockets()` yields, and
 * terminates any that failed to answer the previous ping.
 *
 * Two problems this solves. A socket carrying no traffic can be reaped by an
 * intermediary — a reverse proxy's idle timeout, a NAT table entry — and
 * neither end is told, so the server keeps a dead entry and the browser
 * reconnects into a loop. And a peer that vanishes without a close frame
 * (laptop lid, dropped mobile connection) otherwise sits in the registry
 * forever, receiving broadcasts nobody reads.
 *
 * Browsers answer ping frames automatically, so nothing is required of the
 * client.
 */
export function startWsHeartbeat(
  sockets: () => Iterable<WebSocket>,
  options: WsHeartbeatOptions = {},
): WsHeartbeatHandle {
  const intervalMs = options.intervalMs ?? 30_000;
  const tracked = new WeakSet<WebSocket>();
  const alive = new WeakSet<WebSocket>();

  const timer = setInterval(() => {
    for (const socket of sockets()) {
      if (socket.readyState !== OPEN) continue;

      if (!tracked.has(socket)) {
        tracked.add(socket);
        socket.on('pong', () => alive.add(socket));
      } else if (!alive.has(socket)) {
        // Missed the last round trip: the peer is gone even though the
        // underlying socket still looks writable.
        try {
          socket.terminate();
        } catch {
          // already torn down
        }
        continue;
      }

      alive.delete(socket);
      try {
        socket.ping();
      } catch {
        // socket closed between the readyState check and the send
      }
    }
  }, intervalMs);

  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
