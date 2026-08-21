import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';
import { WS_AUTH_SUBPROTOCOL } from '../../src/ws/subprotocol.js';

/**
 * F21 — inbound client frames were `JSON.parse`d and cast, with no bound on
 * frame size, array length, or string length, and every element was retained
 * in a per-socket Set for the life of the connection.
 */

async function registerUser(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  return res.json<{ token: string }>().token;
}

async function createGame(app: FastifyInstance, token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'F21 Game',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
    },
  });
  return res.json<{ id: string }>().id;
}

function waitForOpen(ws: WebSocket, ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS open timeout')), ms);
    ws.once('open', () => { clearTimeout(t); resolve(); });
    ws.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function waitForClose(ws: WebSocket, ms = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS close timeout')), ms);
    ws.once('close', (code) => { clearTimeout(t); resolve(code); });
    // A maxPayload violation surfaces as an error on the client too; the close
    // frame still follows, so only the timeout is a real failure here.
    ws.once('error', () => undefined);
  });
}

/** Resolves true when the socket survives `ms` without a close frame. */
function staysOpen(ws: WebSocket, ms = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(true), ms);
    ws.once('close', () => { clearTimeout(t); resolve(false); });
  });
}

function symbols(count: number, length = 4): string[] {
  return Array.from({ length: count }, (_, i) => `S${i}`.padEnd(length, 'X').slice(0, length));
}

describe('WebSocket frames are bounded and validated (F21)', () => {
  let app: FastifyInstance;
  let port: number;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const db = await createTestDb();
    app = await buildApp({
      logger: false,
      db,
      provider: new MockStockProvider(),
      marketStatusProvider: new MockMarketStatusProvider(),
      disablePoller: true,
      disableRateLimit: true,
      leaderboardThrottleMs: 0,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
    token = await registerUser(app, 'f21-user');
    gameId = await createGame(app, token);
  });

  afterAll(async () => {
    await app.close();
  });

  function connect(): WebSocket {
    return new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live`, [
      WS_AUTH_SUBPROTOCOL,
      token,
    ]);
  }

  it('drops a frame larger than the configured maxPayload', async () => {
    const ws = connect();
    await waitForOpen(ws);
    // ~1 MiB — far under the old 100 MiB ws default, far over the new cap.
    const huge = JSON.stringify({
      event: 'subscribe',
      data: { symbols: symbols(60_000, 12) },
    });
    expect(huge.length).toBeGreaterThan(16 * 1024);
    ws.send(huge);
    // 1009 = "message too big". The frame never reaches the handler.
    expect(await waitForClose(ws)).toBe(1009);
  });

  it('closes on a subscribe frame carrying more symbols than the cap', async () => {
    const ws = connect();
    await waitForOpen(ws);
    ws.send(JSON.stringify({ event: 'subscribe', data: { symbols: symbols(501) } }));
    expect(await waitForClose(ws)).toBe(1008);
  });

  it('closes on a symbol longer than any real ticker', async () => {
    const ws = connect();
    await waitForOpen(ws);
    ws.send(JSON.stringify({ event: 'subscribe', data: { symbols: ['A'.repeat(13)] } }));
    expect(await waitForClose(ws)).toBe(1008);
  });

  it('closes on a subscribe frame whose symbols are not strings', async () => {
    const ws = connect();
    await waitForOpen(ws);
    ws.send(JSON.stringify({ event: 'subscribe', data: { symbols: [{ nested: 'object' }] } }));
    expect(await waitForClose(ws)).toBe(1008);
  });

  it('closes on an unparseable frame', async () => {
    const ws = connect();
    await waitForOpen(ws);
    ws.send('{not json');
    expect(await waitForClose(ws)).toBe(1008);
  });

  it('closes on an unknown event type', async () => {
    const ws = connect();
    await waitForOpen(ws);
    ws.send(JSON.stringify({ event: 'unsubscribe', data: { symbols: ['AAPL'] } }));
    expect(await waitForClose(ws)).toBe(1008);
  });

  it('accepts a subscribe frame at the cap and keeps serving other clients', async () => {
    const ws = connect();
    await waitForOpen(ws);
    ws.send(JSON.stringify({ event: 'subscribe', data: { symbols: symbols(500) } }));
    expect(await staysOpen(ws)).toBe(true);
    ws.close();
    await waitForClose(ws);

    // The process survived every frame above — a fresh connection still works.
    const fresh = connect();
    await waitForOpen(fresh);
    expect(fresh.readyState).toBe(WebSocket.OPEN);
    fresh.close();
    await waitForClose(fresh);
  });
});
