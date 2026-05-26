import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../../helpers/app.js';

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
 * Regression test for the bug where admin force-execute on a working/pending
 * order did NOT emit `trade.executed` on the in-process bus, so achievements
 * like first-trade never unlocked. The route now plumbs the bus through and
 * emits on the success path; this test asserts the unlock surfaces in the
 * player-facing achievements view after a force-execute.
 */
describe('POST /admin/trades/:id/force-execute — achievement integration', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    // First-registered becomes admin.
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
});
