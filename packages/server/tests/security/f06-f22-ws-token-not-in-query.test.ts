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
 * F6 / F22 — the access token must never travel in the upgrade URL, because
 * both the reverse proxy and the process logger record the full request line.
 * It rides in `Sec-WebSocket-Protocol` instead, and the server echoes only the
 * scheme marker back.
 */

async function registerUser(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  return res.json<{ token: string; user: { id: string } }>();
}

async function createGame(app: FastifyInstance, token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'F6 Game',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
    },
  });
  return res.json<{ id: string }>();
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

/** Resolves true when the socket survives `ms` without a close frame. */
function staysOpen(ws: WebSocket, ms = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(true), ms);
    ws.once('close', () => { clearTimeout(t); resolve(false); });
  });
}

describe('WebSocket credentials never travel in the URL (F6, F22)', () => {
  let app: FastifyInstance;
  let port: number;
  let token: string;
  let userId: string;
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
    const registered = await registerUser(app, 'f6-user');
    token = registered.token;
    userId = registered.user.id;
    ({ id: gameId } = await createGame(app, token));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/games/:id/live', () => {
    it('rejects a token supplied in the query string', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live?token=${token}`);
      expect(await waitForClose(ws)).toBe(1008);
    });

    it('accepts a token offered as a subprotocol', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live`, [
        WS_AUTH_SUBPROTOCOL,
        token,
      ]);
      await waitForOpen(ws);
      expect(await staysOpen(ws)).toBe(true);
      ws.close();
      await waitForClose(ws);
    });

    it('echoes the scheme marker back, never the token', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live`, [
        WS_AUTH_SUBPROTOCOL,
        token,
      ]);
      await waitForOpen(ws);
      expect(ws.protocol).toBe(WS_AUTH_SUBPROTOCOL);
      expect(ws.protocol).not.toContain(token);
      ws.close();
      await waitForClose(ws);
    });

    it('closes 1008 when no credential is offered at all', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live`);
      expect(await waitForClose(ws)).toBe(1008);
    });

    it('closes 1008 for a refresh token offered as a subprotocol', async () => {
      const refresh = app.jwt.sign(
        { id: userId, username: 'f6-user', type: 'refresh' },
        { expiresIn: '7d' },
      );
      const ws = new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live`, [
        WS_AUTH_SUBPROTOCOL,
        refresh,
      ]);
      expect(await waitForClose(ws)).toBe(1008);
    });

    it('closes 1008 for a token with no type claim', async () => {
      const untyped = app.jwt.sign({ id: userId, username: 'f6-user' }, { expiresIn: '15m' });
      const ws = new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live`, [
        WS_AUTH_SUBPROTOCOL,
        untyped,
      ]);
      expect(await waitForClose(ws)).toBe(1008);
    });
  });

  describe('/ws/live', () => {
    it('rejects a token supplied in the query string', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live?token=${token}`);
      expect(await waitForClose(ws)).toBe(1008);
    });

    it('accepts a token offered as a subprotocol and echoes only the marker', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live`, [WS_AUTH_SUBPROTOCOL, token]);
      await waitForOpen(ws);
      expect(ws.protocol).toBe(WS_AUTH_SUBPROTOCOL);
      expect(await staysOpen(ws)).toBe(true);
      ws.close();
      await waitForClose(ws);
    });

    it('closes 1008 when no credential is offered at all', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live`);
      expect(await waitForClose(ws)).toBe(1008);
    });
  });
});
