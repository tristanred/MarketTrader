import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTestApp, createTestDb } from '../helpers/app.js';
import * as schema from '../../src/db/schema.sqlite.js';

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
      definitions: Array<{ key: string; rarity: string; icon: string }>;
      progress: Record<string, Array<{ achievementKey: string; unlockedAt: string | null }>>;
      totalEnabledCount: number;
    }>();
    // The player view only exposes definitions someone has actually unlocked
    // (locked-and-untouched ones are hidden from the wire), so we assert
    // first-trade is present and that locked definitions are NOT leaked.
    const keys = body.definitions.map((d) => d.key);
    expect(keys).toContain('first-trade');
    expect(keys).not.toContain('ten-buys');
    expect(keys).not.toContain('rock-bottom');
    expect(body.definitions[0]).toMatchObject({
      rarity: expect.stringMatching(/^(common|uncommon|rare|epic|legendary)$/),
      icon: expect.any(String),
    });
    expect(body.totalEnabledCount).toBeGreaterThan(0);
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

async function joinGame(app: FastifyInstance, token: string, gameId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/games/${gameId}/join`,
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json<{ playerId: string }>();
}

describe('POST /games/:id/players/:gamePlayerId/achievements/ack', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    app = await createTestApp();
    db = await createTestDb();
  });
  afterAll(async () => { await app.close(); });

  it('advances last_seen_unlock_at to the provided timestamp', async () => {
    const { token } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const game = await createGame(app, token);
    // Creator is auto-joined; get their gamePlayerId via join response or by joining directly.
    // The game creator is already a player — join returns 409. We create a second user to join.
    const { token: token2 } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const { playerId: gamePlayerId } = await joinGame(app, token2, game.id);

    const ts = '2026-05-23T12:00:00.000Z';
    const res = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/players/${gamePlayerId}/achievements/ack`,
      headers: { Authorization: `Bearer ${token2}` },
      payload: { unlockedAt: ts },
    });
    expect(res.statusCode).toBe(204);

    const [row] = await db
      .select({ lastSeenUnlockAt: schema.gamePlayers.lastSeenUnlockAt })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, gamePlayerId))
      .limit(1);
    expect(row?.lastSeenUnlockAt).toBe(ts);
  });

  it('never regresses last_seen_unlock_at when sent an older timestamp', async () => {
    const { token } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const game = await createGame(app, token);
    const { token: token2 } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const { playerId: gamePlayerId } = await joinGame(app, token2, game.id);

    const newer = '2026-05-23T15:00:00.000Z';
    const older = '2026-05-23T10:00:00.000Z';

    await app.inject({
      method: 'POST',
      url: `/games/${game.id}/players/${gamePlayerId}/achievements/ack`,
      headers: { Authorization: `Bearer ${token2}` },
      payload: { unlockedAt: newer },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/players/${gamePlayerId}/achievements/ack`,
      headers: { Authorization: `Bearer ${token2}` },
      payload: { unlockedAt: older },
    });
    expect(res.statusCode).toBe(204);

    const [row] = await db
      .select({ lastSeenUnlockAt: schema.gamePlayers.lastSeenUnlockAt })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, gamePlayerId))
      .limit(1);
    expect(row?.lastSeenUnlockAt).toBe(newer);
  });

  it('returns 403 when ack-ing another player\'s gamePlayerId', async () => {
    const { token: tokenA } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const game = await createGame(app, tokenA);
    // tokenA is the creator — get their gamePlayerId from the DB via the second user's perspective.
    // Actually, let's have tokenB join the game, then tokenA tries to ack tokenB's player.
    const { token: tokenB } = await registerUser(app, `u-${Math.random().toString(36).slice(2)}`);
    const { playerId: playerBId } = await joinGame(app, tokenB, game.id);

    const res = await app.inject({
      method: 'POST',
      url: `/games/${game.id}/players/${playerBId}/achievements/ack`,
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: { unlockedAt: '2026-05-23T12:00:00.000Z' },
    });
    expect(res.statusCode).toBe(403);
  });
});
