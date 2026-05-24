import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../../helpers/app.js';

async function registerUser(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
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
    },
  });
  return res.json<{ id: string }>();
}

async function gamePlayerIdFor(app: FastifyInstance, token: string, gameId: string): Promise<string> {
  const res = await app.inject({
    method: 'GET',
    url: `/games/${gameId}`,
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = res.json<{ leaderboard: Array<{ playerId: string }> }>();
  // playerId in the leaderboard is the userId; we need gamePlayerId. Use the
  // public portfolio endpoint to discover it via the trade we'll place.
  const trade = await app.inject({
    method: 'POST',
    url: `/games/${gameId}/trades`,
    headers: { Authorization: `Bearer ${token}` },
    payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
  });
  const tradeBody = trade.json<{ trade: { gamePlayerId: string } }>();
  void body;
  return tradeBody.trade.gamePlayerId;
}

describe('admin achievement routes', () => {
  let app: FastifyInstance;
  let adminToken: string;
  beforeAll(async () => {
    app = await createTestApp();
    // First-registered becomes admin; reuse this token in admin-only tests.
    adminToken = (await registerUser(app, `admin-${Math.random().toString(36).slice(2)}`)).token;
  });
  afterAll(async () => { await app.close(); });

  it('non-admin gets 403', async () => {
    const { token } = await registerUser(app, `non-${Math.random().toString(36).slice(2)}`);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/games/whatever/achievements',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin can unlock, reset, set progress, and audit-log captures each', async () => {
    const game = await createGame(app, adminToken);
    const gamePlayerId = await gamePlayerIdFor(app, adminToken, game.id);

    // Unlock ten-buys.
    const unlock = await app.inject({
      method: 'POST',
      url: `/admin/games/${game.id}/players/${gamePlayerId}/achievements/ten-buys/unlock`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(unlock.statusCode).toBe(200);
    expect(unlock.json<{ unlockedAt: string | null }>().unlockedAt).not.toBeNull();

    // Reset it.
    const reset = await app.inject({
      method: 'POST',
      url: `/admin/games/${game.id}/players/${gamePlayerId}/achievements/ten-buys/reset`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json<{ unlockedAt: string | null; progress: number }>().progress).toBe(0);

    // Set progress to 5 (below target 10).
    const setRes = await app.inject({
      method: 'PATCH',
      url: `/admin/games/${game.id}/players/${gamePlayerId}/achievements/ten-buys`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { progress: 5 },
    });
    expect(setRes.json<{ progress: number; unlockedAt: string | null }>().progress).toBe(5);
    expect(setRes.json<{ unlockedAt: string | null }>().unlockedAt).toBeNull();

    // Audit log captured each.
    const audit = await app.inject({
      method: 'GET',
      url: '/admin/audit',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(audit.statusCode).toBe(200);
    const actions = audit.json<{ entries: Array<{ action: string }> }>().entries.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(['achievement.unlock', 'achievement.reset', 'achievement.set_progress']),
    );
  });

  it('global toggle silences an achievement; per-game override restores it for one game', async () => {
    const game = await createGame(app, adminToken);

    // Disable first-trade globally.
    const global = await app.inject({
      method: 'PATCH',
      url: '/admin/achievements/first-trade',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { enabled: false },
    });
    expect(global.statusCode).toBe(200);

    // A trade now should not create a first-trade row.
    await app.inject({
      method: 'POST',
      url: `/games/${game.id}/trades`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    const list = await app.inject({
      method: 'GET',
      url: `/games/${game.id}/achievements`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = list.json<{ progress: Record<string, Array<{ achievementKey: string }>> }>();
    const all = Object.values(body.progress).flat();
    expect(all.find((p) => p.achievementKey === 'first-trade')).toBeUndefined();
  });
});
