import { describe, it, expect, beforeEach } from 'vitest';
import { GameClientRegistry } from '../../src/ws/registry.js';
import type { WebSocket } from 'ws';

function makeMockSocket(readyState = 1): WebSocket {
  return { readyState } as unknown as WebSocket;
}

describe('GameClientRegistry', () => {
  let registry: GameClientRegistry;

  beforeEach(() => {
    registry = new GameClientRegistry();
  });

  it('adds and retrieves a client entry for a game', () => {
    const socket = makeMockSocket();
    registry.add('game-1', 'user-1', socket);
    expect(registry.getClients('game-1').size).toBe(1);
  });

  it('stores an empty subscription set per entry', () => {
    const socket = makeMockSocket();
    registry.add('game-1', 'user-1', socket);
    const entry = registry.getEntry('game-1', socket);
    expect(entry).toBeDefined();
    expect(entry!.playerId).toBe('user-1');
    expect(entry!.subscriptions).toBeInstanceOf(Set);
    expect(entry!.subscriptions.size).toBe(0);
  });

  it('removes a client', () => {
    const socket = makeMockSocket();
    registry.add('game-1', 'user-1', socket);
    registry.remove('game-1', socket);
    expect(registry.getClients('game-1').size).toBe(0);
  });

  it('removes the game key when the last client disconnects', () => {
    const socket = makeMockSocket();
    registry.add('game-1', 'user-1', socket);
    registry.remove('game-1', socket);
    expect(registry.getActiveGameIds()).not.toContain('game-1');
  });

  it('returns empty map for unknown game', () => {
    expect(registry.getClients('unknown').size).toBe(0);
  });

  it('broadcasts to all OPEN sockets and skips CLOSED sockets', () => {
    const messages: string[] = [];
    const openSocket = { readyState: 1, send: (m: string) => messages.push(m) } as unknown as WebSocket;
    const closedSocket = { readyState: 3, send: (m: string) => messages.push(m) } as unknown as WebSocket;
    registry.add('game-1', 'user-1', openSocket);
    registry.add('game-1', 'user-2', closedSocket);
    registry.broadcast('game-1', { event: 'leaderboard_update', data: [] });
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0]!)).toMatchObject({ event: 'leaderboard_update' });
  });

  it('broadcastFiltered sends only to clients subscribed to the symbols', () => {
    const messages1: string[] = [];
    const messages2: string[] = [];
    const s1 = { readyState: 1, send: (m: string) => messages1.push(m) } as unknown as WebSocket;
    const s2 = { readyState: 1, send: (m: string) => messages2.push(m) } as unknown as WebSocket;
    registry.add('game-1', 'user-1', s1);
    registry.add('game-1', 'user-2', s2);
    registry.getEntry('game-1', s1)!.subscriptions.add('AAPL');
    // s2 has no subscriptions
    const quotes = [
      { symbol: 'AAPL', price: 100, change: 0, changePercent: 0, fetchedAt: '' },
    ];
    registry.broadcastFiltered('game-1', quotes);
    expect(messages1).toHaveLength(1);
    expect(messages2).toHaveLength(0);
  });

  it('getActiveGameIds returns all gameIds with connected clients', () => {
    registry.add('game-1', 'u1', makeMockSocket());
    registry.add('game-2', 'u2', makeMockSocket());
    expect(registry.getActiveGameIds()).toContain('game-1');
    expect(registry.getActiveGameIds()).toContain('game-2');
    expect(registry.getActiveGameIds()).toHaveLength(2);
  });
});
