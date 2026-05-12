import type { WebSocket } from 'ws';
import type { WsServerEvent, StockQuote, WsPriceUpdateEvent } from '@markettrader/shared';

/**
 * Represents a connected player's WebSocket session within a game room.
 * Tracks identity and per-client symbol subscriptions for filtered price updates.
 */
export interface ClientEntry {
  playerId: string;
  /** Ticker symbols this client has subscribed to via a subscribe event. */
  subscriptions: Set<string>;
}

/**
 * Per-app-instance registry of connected WebSocket clients, keyed by gameId.
 * Each entry tracks the user identity and their price-update symbol subscriptions.
 */
export class GameClientRegistry {
  private readonly games = new Map<string, Map<WebSocket, ClientEntry>>();

  add(gameId: string, playerId: string, socket: WebSocket): void {
    if (!this.games.has(gameId)) {
      this.games.set(gameId, new Map());
    }
    this.games.get(gameId)!.set(socket, { playerId, subscriptions: new Set() });
  }

  remove(gameId: string, socket: WebSocket): void {
    const clients = this.games.get(gameId);
    if (!clients) return;
    clients.delete(socket);
    if (clients.size === 0) this.games.delete(gameId);
  }

  getClients(gameId: string): ReadonlyMap<WebSocket, ClientEntry> {
    return this.games.get(gameId) ?? new Map();
  }

  getEntry(gameId: string, socket: WebSocket): ClientEntry | undefined {
    return this.games.get(gameId)?.get(socket);
  }

  getActiveGameIds(): string[] {
    return [...this.games.keys()];
  }

  /** Broadcast a server event to every OPEN socket in a game. */
  broadcast(gameId: string, event: WsServerEvent): void {
    const clients = this.games.get(gameId);
    if (!clients) return;
    const payload = JSON.stringify(event);
    for (const [socket] of clients) {
      if (socket.readyState === 1 /* OPEN */) {
        try { socket.send(payload); } catch { /* socket closed between check and send */ }
      }
    }
  }

  /**
   * Broadcast a price_update event filtered to each client's subscribed symbols.
   * Clients with no subscriptions receive nothing.
   */
  broadcastFiltered(gameId: string, quotes: StockQuote[]): void {
    const clients = this.games.get(gameId);
    if (!clients) return;
    for (const [socket, entry] of clients) {
      if (socket.readyState !== 1 /* OPEN */) continue;
      if (entry.subscriptions.size === 0) continue;
      const relevant = quotes.filter((q) => entry.subscriptions.has(q.symbol));
      if (relevant.length === 0) continue;
      const event: WsPriceUpdateEvent = { event: 'price_update', data: relevant };
      try { socket.send(JSON.stringify(event)); } catch { /* socket closed between check and send */ }
    }
  }
}
