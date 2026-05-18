import { describe, it, expect, beforeEach } from 'vitest';
import type { WebSocket } from 'ws';
import { GlobalClientRegistry } from '../../src/ws/global-registry.js';

describe('GlobalClientRegistry', () => {
  let registry: GlobalClientRegistry;

  beforeEach(() => {
    registry = new GlobalClientRegistry();
  });

  it('adds and removes clients', () => {
    const s = { readyState: 1, send: () => {} } as unknown as WebSocket;
    registry.add('user-1', s);
    expect(registry.size).toBe(1);
    registry.remove(s);
    expect(registry.size).toBe(0);
  });

  it('broadcasts to every open socket', () => {
    const aSent: string[] = [];
    const bSent: string[] = [];
    const a = { readyState: 1, send: (m: string) => aSent.push(m) } as unknown as WebSocket;
    const b = { readyState: 1, send: (m: string) => bSent.push(m) } as unknown as WebSocket;
    registry.add('u1', a);
    registry.add('u2', b);
    registry.broadcast({ event: 'indices', data: { quotes: [], at: 'now' } });
    expect(aSent).toHaveLength(1);
    expect(bSent).toHaveLength(1);
    expect(JSON.parse(aSent[0]!)).toMatchObject({ event: 'indices' });
  });

  it('skips sockets that are not OPEN', () => {
    const sent: string[] = [];
    const a = { readyState: 2, send: (m: string) => sent.push(m) } as unknown as WebSocket; // CLOSING
    registry.add('u1', a);
    registry.broadcast({ event: 'indices', data: { quotes: [], at: 'now' } });
    expect(sent).toHaveLength(0);
  });
});
