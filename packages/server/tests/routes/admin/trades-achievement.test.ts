import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';
import { buildApp } from '../../../src/app.js';
import { createTestDb } from '../../helpers/app.js';
import { MockStockProvider } from '../../helpers/mock-provider.js';

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
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      allowLimitOrders: true,
    },
  });
  return res.json<{ id: string }>();
}

/**
 * Regression tests for the admin force-execute path. Two properties asserted:
 *
 * 1. Emits `trade.executed` on the in-process bus so the achievement engine
 *    treats admin-resolved fills the same as direct trades (first-trade,
 *    ten-buys, etc. must unlock).
 * 2. Broadcasts `trade_executed` over the per-game WebSocket so connected
 *    clients refresh their portfolio/activity panels.
 *
 * Both share one `app`+`adminToken` because the in-memory SQLite is shared
 * within a Vitest worker, so the "first registered user becomes admin" check
 * would only promote one user across two separate describes.
 */
describe('POST /admin/trades/:id/force-execute — bus + WS integration', () => {
  let app: FastifyInstance;
  let port: number;
  let adminToken: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 150 });
    const db = await createTestDb();
    app = await buildApp({
      db,
      provider,
      logger: false,
      disablePoller: true,
      leaderboardThrottleMs: 0,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
    // First-registered globally becomes admin.
    adminToken = (await registerUser(app, `admin-${Math.random().toString(36).slice(2)}`)).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('unlocks first-trade after admin force-executes a working limit order', async () => {
    const game = await createGame(app, adminToken);

    // Place a limit buy at an unreachable price so it rests as 'working'
    // rather than filling immediately. The mock provider's AAPL quote is
    // ~$150; a $1 limit will never fill on its own.
    const placeRes = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/trades`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        limitPrice: 1,
      },
    });
    // 202 = order accepted as resting/working (not filled). The response
    // body shape is `{ orders: [{ id, ... }] }` without an explicit status
    // field — the 202 status code is the contract for "didn't fill yet".
    expect(placeRes.statusCode).toBe(202);
    const placed = placeRes.json<{ orders: Array<{ id: string }> }>();
    const order = placed.orders[0];
    expect(order, JSON.stringify(placed)).toBeTruthy();
    const tradeId = order!.id;

    // Confirm first-trade is NOT yet unlocked before force-execute. This
    // proves the unlock we observe later was caused by the admin action,
    // not by some incidental earlier event.
    const beforeRes = await app.inject({
      method: 'GET',
      url: `/games/${game.id}/achievements`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const before = beforeRes.json<{
      progress: Record<string, Array<{ achievementKey: string; unlockedAt: string | null }>>;
    }>();
    const beforeFirstTrade = Object.values(before.progress)
      .flat()
      .find((p) => p.achievementKey === 'first-trade');
    expect(beforeFirstTrade?.unlockedAt ?? null).toBeNull();

    // Admin force-executes the resting order. The route's Zod schema
    // requires a body object even though the `price` override is optional —
    // pass `{}` to fill at the current quote.
    const forceRes = await app.inject({
      method: 'POST',
      url: `/admin/trades/${tradeId}/force-execute`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    expect(forceRes.statusCode, forceRes.body).toBe(200);

    // The achievement engine runs synchronously on `bus.emit`, so the
    // unlock is observable on the very next REST read.
    const afterRes = await app.inject({
      method: 'GET',
      url: `/games/${game.id}/achievements`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const after = afterRes.json<{
      progress: Record<string, Array<{ achievementKey: string; unlockedAt: string | null }>>;
    }>();
    const afterFirstTrade = Object.values(after.progress)
      .flat()
      .find((p) => p.achievementKey === 'first-trade');
    // Existence check first: a missing entry means the engine never received
    // the `trade.executed` event (the bug this test guards against). The
    // `.unlockedAt` check is what proves it transitioned to unlocked.
    expect(afterFirstTrade, JSON.stringify(after.progress)).toBeDefined();
    expect(afterFirstTrade!.unlockedAt).not.toBeNull();
  });

  it('broadcasts trade_executed to connected game clients on force-execute', async () => {
    const game = await createGame(app, adminToken);

    // Place a resting limit order.
    const placeRes = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/trades`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        limitPrice: 1,
      },
    });
    expect(placeRes.statusCode).toBe(202);
    const { orders } = placeRes.json<{ orders: Array<{ id: string }> }>();
    const tradeId = orders[0]!.id;

    // Connect the admin as a game member; the WS broadcast goes to all
    // sockets in the game (the admin owns the game by virtue of creating it,
    // so registration is automatic — game owners are implicit members).
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/games/${game.id}/live?token=${adminToken}`,
    );
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WS open timeout')), 2000);
      ws.once('open', () => {
        clearTimeout(t);
        resolve();
      });
      ws.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });

    // Register the listener BEFORE the force-execute so we never miss the
    // broadcast (the broadcast happens synchronously inside the HTTP
    // handler, so any setup-then-trigger ordering risks a race).
    const tradeExecutedPromise = new Promise<{
      playerId: string;
      symbol: string;
      direction: string;
      quantity: number;
      price: number;
      executedAt: string;
    }>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for trade_executed')), 3000);
      const handler = (raw: Buffer) => {
        const msg = JSON.parse(raw.toString()) as {
          event: string;
          data: Record<string, unknown>;
        };
        if (msg.event === 'trade_executed') {
          clearTimeout(t);
          ws.off('message', handler);
          resolve(msg.data as never);
        }
      };
      ws.on('message', handler);
    });

    const forceRes = await app.inject({
      method: 'POST',
      url: `/admin/trades/${tradeId}/force-execute`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    expect(forceRes.statusCode, forceRes.body).toBe(200);

    const frame = await tradeExecutedPromise;
    expect(frame).toMatchObject({
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
    });
    // Price comes from the live quote when no override is supplied.
    expect(frame.price).toBeGreaterThan(0);
    expect(typeof frame.executedAt).toBe('string');

    ws.close();
  });
});
