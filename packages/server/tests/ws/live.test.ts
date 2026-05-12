import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

async function registerUser(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

async function createActiveGame(app: FastifyInstance, token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'WS Test Game',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
    },
  });
  return res.json<{ id: string }>();
}

function connectWs(port: number, gameId: string, token?: string): WebSocket {
  const query = token ? `?token=${token}` : '';
  return new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live${query}`);
}

function waitForOpen(ws: WebSocket, ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS open timeout')), ms);
    ws.once('open', () => { clearTimeout(t); resolve(); });
    ws.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function waitForClose(ws: WebSocket, ms = 2000): Promise<number> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS close timeout')), ms);
    ws.once('close', (code) => { clearTimeout(t); resolve(code); });
  });
}

function waitForMessage(ws: WebSocket, ms = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS message timeout')), ms);
    ws.once('message', (data) => { clearTimeout(t); resolve(JSON.parse(data.toString())); });
  });
}

function waitForEvent(ws: WebSocket, eventName: string, ms = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${eventName}`)), ms);
    const handler = (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as { event: string };
      if (msg.event === eventName) {
        clearTimeout(t);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('GET /games/:id/live (WebSocket)', () => {
  let app: FastifyInstance;
  let port: number;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 150 });
    const db = createTestDb();
    app = await buildApp({ db, provider, logger: false, disablePoller: true, leaderboardThrottleMs: 0 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
    ({ token } = await registerUser(app, 'wsuser1'));
    ({ id: gameId } = await createActiveGame(app, token));
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a valid authenticated member connection', async () => {
    const ws = connectWs(port, gameId, token);
    await waitForOpen(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await waitForClose(ws);
  });

  it('closes with code 1008 when no token is provided', async () => {
    const ws = connectWs(port, gameId);
    const code = await waitForClose(ws);
    expect(code).toBe(1008);
  });

  it('closes with code 1008 when token is invalid', async () => {
    const ws = connectWs(port, gameId, 'not-a-valid-jwt');
    const code = await waitForClose(ws);
    expect(code).toBe(1008);
  });

  it('closes with code 1008 when user is not a member of the game', async () => {
    const { token: otherToken } = await registerUser(app, 'wsuser2');
    const ws = connectWs(port, gameId, otherToken);
    const code = await waitForClose(ws);
    expect(code).toBe(1008);
  });

  it('stays connected after sending a subscribe message', async () => {
    const ws = connectWs(port, gameId, token);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ event: 'subscribe', data: { symbols: ['AAPL'] } }));
    await new Promise((r) => setTimeout(r, 100));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await waitForClose(ws);
  });

  it('receives trade_executed event when a trade is placed in the game', async () => {
    const ws = connectWs(port, gameId, token);
    await waitForOpen(ws);

    const msgPromise = waitForMessage(ws);
    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });

    const msg = await msgPromise;
    expect(msg).toMatchObject({ event: 'trade_executed', data: { symbol: 'AAPL' } });

    ws.close();
    await waitForClose(ws);
  });

  it('receives leaderboard_update event after a trade', async () => {
    const ws = connectWs(port, gameId, token);
    await waitForOpen(ws);

    const lbPromise = waitForEvent(ws, 'leaderboard_update');
    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });

    const lb = (await lbPromise) as { event: string; data: Array<{ rank: number }> };
    expect(lb.data.length).toBeGreaterThan(0);
    expect(lb.data[0]!.rank).toBe(1);

    ws.close();
    await waitForClose(ws);
  });
});
