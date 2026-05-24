import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';

async function registerUser(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

async function createGame(app: FastifyInstance, token: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      ...overrides,
    },
  });
  return res.json<{ id: string }>();
}

describe('GET /games/:id/achievements', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  it('returns definitions + unlocks first-trade after a trade', async () => {
    const { token } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const game = await createGame(app, token);

    // Execute one trade.
    await app.inject({
      method: 'POST',
      url: `/games/${game.id}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/games/${game.id}/achievements`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      definitions: Array<{ key: string }>;
      progress: Record<string, Array<{ achievementKey: string; unlockedAt: string | null }>>;
    }>();
    expect(body.definitions.map((d) => d.key)).toEqual(
      expect.arrayContaining(['first-trade', 'ten-buys', 'rock-bottom']),
    );
    expect(body.definitions[0]).toMatchObject({
      rarity: expect.stringMatching(/^(common|uncommon|rare|epic|legendary)$/),
      icon: expect.any(String),
    });
    const flat = Object.values(body.progress).flat();
    const firstTrade = flat.find((p) => p.achievementKey === 'first-trade');
    expect(firstTrade?.unlockedAt).not.toBeNull();
  });

  it('respects achievementsEnabled: false at game creation', async () => {
    const { token } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const game = await createGame(app, token, { achievementsEnabled: false });
    await app.inject({
      method: 'POST',
      url: `/games/${game.id}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/games/${game.id}/achievements`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = res.json<{ progress: Record<string, unknown[]> }>();
    expect(Object.values(body.progress).flat()).toHaveLength(0);
  });

  it('returns 404 for non-members', async () => {
    const { token: owner } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const game = await createGame(app, owner);
    const { token: stranger } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const res = await app.inject({
      method: 'GET',
      url: `/games/${game.id}/achievements`,
      headers: { Authorization: `Bearer ${stranger}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
