import type { WebSocket } from 'ws';
import type { LiveWsMessage } from '@markettrader/shared';

interface ClientEntry {
  userId: string;
}

/**
 * Per-app-instance registry of clients connected to the global `/ws/live`
 * socket. Unlike {@link GameClientRegistry}, there's no per-game scope —
 * every connected client receives every broadcast.
 */
export class GlobalClientRegistry {
  private readonly clients = new Map<WebSocket, ClientEntry>();

  get size(): number {
    return this.clients.size;
  }

  add(userId: string, socket: WebSocket): void {
    this.clients.set(socket, { userId });
  }

  remove(socket: WebSocket): void {
    this.clients.delete(socket);
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
