import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { startWsHeartbeat } from '../../src/ws/heartbeat.js';

class FakeSocket extends EventEmitter {
  readyState = 1;
  pings = 0;
  terminated = false;

  ping(): void {
    this.pings += 1;
  }
  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
  }
  /** Simulates the browser's automatic pong reply. */
  replyPong(): void {
    this.emit('pong');
  }
}

function asSockets(...sockets: FakeSocket[]): () => Iterable<WebSocket> {
  return () => sockets as unknown as WebSocket[];
}

describe('startWsHeartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pings every open socket on each tick', () => {
    const a = new FakeSocket();
    const b = new FakeSocket();
    const handle = startWsHeartbeat(asSockets(a, b), { intervalMs: 30_000 });

    vi.advanceTimersByTime(30_000);
    expect(a.pings).toBe(1);
    expect(b.pings).toBe(1);

    a.replyPong();
    b.replyPong();
    vi.advanceTimersByTime(30_000);
    expect(a.pings).toBe(2);
    expect(b.pings).toBe(2);

    handle.stop();
  });

  it('terminates a socket that missed the previous pong', () => {
    const socket = new FakeSocket();
    const handle = startWsHeartbeat(asSockets(socket), { intervalMs: 30_000 });

    vi.advanceTimersByTime(30_000);
    expect(socket.terminated).toBe(false);

    // No pong in between — the peer is gone even though the TCP socket looks fine.
    vi.advanceTimersByTime(30_000);
    expect(socket.terminated).toBe(true);
    expect(socket.pings).toBe(1);

    handle.stop();
  });

  it('keeps a socket alive as long as it answers each ping', () => {
    const socket = new FakeSocket();
    const handle = startWsHeartbeat(asSockets(socket), { intervalMs: 30_000 });

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(30_000);
      socket.replyPong();
    }

    expect(socket.terminated).toBe(false);
    expect(socket.pings).toBe(5);

    handle.stop();
  });

  it('skips sockets that are not open', () => {
    const socket = new FakeSocket();
    socket.readyState = 0;
    const handle = startWsHeartbeat(asSockets(socket), { intervalMs: 30_000 });

    vi.advanceTimersByTime(90_000);
    expect(socket.pings).toBe(0);
    expect(socket.terminated).toBe(false);

    handle.stop();
  });

  it('survives a socket whose ping() throws', () => {
    const bad = new FakeSocket();
    bad.ping = () => {
      throw new Error('socket gone');
    };
    const good = new FakeSocket();
    const handle = startWsHeartbeat(asSockets(bad, good), { intervalMs: 30_000 });

    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow();
    expect(good.pings).toBe(1);

    handle.stop();
  });

  it('stops ticking after stop()', () => {
    const socket = new FakeSocket();
    const handle = startWsHeartbeat(asSockets(socket), { intervalMs: 30_000 });

    vi.advanceTimersByTime(30_000);
    handle.stop();
    vi.advanceTimersByTime(300_000);

    expect(socket.pings).toBe(1);
    expect(socket.terminated).toBe(false);
  });
});
