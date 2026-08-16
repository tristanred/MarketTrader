import type { WebSocket } from 'ws';
import type { LiveWsMessage } from '@markettrader/shared';
import { meters } from '../observability/telemetry.js';

/**
 * Per-app-instance registry of clients connected to the global `/ws/live`
 * socket. Unlike {@link GameClientRegistry}, there's no per-game scope —
 * every connected client receives every broadcast.
 */
export class GlobalClientRegistry {
  private readonly clients = new Map<WebSocket, { userId: string }>();

  get size(): number {
    return this.clients.size;
  }

  add(userId: string, socket: WebSocket): void {
    // See the note in registry.ts: only a socket that is actually new moves the
    // gauge, otherwise a reconnect double-counts.
    if (!this.clients.has(socket)) meters.wsClients.add(1, { scope: 'global' });
    this.clients.set(socket, { userId });
  }

  remove(socket: WebSocket): void {
    if (this.clients.delete(socket)) meters.wsClients.add(-1, { scope: 'global' });
  }

  broadcast(message: LiveWsMessage): void {
    const payload = JSON.stringify(message);
    for (const [socket] of this.clients) {
      if (socket.readyState === 1 /* OPEN */) {
        try {
          socket.send(payload);
        } catch {
          // socket closed between check and send — fine
        }
      }
    }
  }
}
