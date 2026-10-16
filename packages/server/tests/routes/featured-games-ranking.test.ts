import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import type { FeaturedGame } from '@markettrader/shared';
import { createTestAppWithDb } from '../helpers/app.js';
import { schema } from '../../src/db/index.js';

const ACTIVE = { startDate: '2026-01-01T00:00:00.000Z', endDate: '2099-01-01T00:00:00.000Z' };

describe('GET /public/featured-games ranking', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof createTestAppWithDb>>['db'];
  let whaleId: string;
  let winnerId: string;
  let soloId: string;

  async function register(username: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, password: 'password123' },
    });
    const body = res.json<{ token: string; user: { id: string } }>();
    return { token: body.token, userId: body.user.id };
  }

  async function createGame(token: string, name: string, startingBalance: number) {
    const res = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name, ...ACTIVE, startingBalance },
    });
    return res.json<{ id: string }>().id;
  }

  async function join(token: string, gameId: string) {
    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  beforeAll(async () => {
    ({ app, db } = await createTestAppWithDb());
    const a = await register('feat-a');
    const b = await register('feat-b');

    // Largest absolute value, but 0% return.
    whaleId = await createGame(a.token, 'Whale Pool', 5_000_000);
    await join(b.token, whaleId);

    // Small balance, but its creator doubled their cash.
    winnerId = await createGame(a.token, 'Winner Pool', 10_000);
    await join(b.token, winnerId);
    await db
      .update(schema.gamePlayers)
      .set({ cashBalance: 20_000 })
      .where(and(eq(schema.gamePlayers.gameId, winnerId), eq(schema.gamePlayers.userId, a.userId)));

    // Only one player: never featured.
    soloId = await createGame(a.token, 'Solo Spam', 9_000_000);
  });
  afterAll(() => app.close());

  it('ranks by % return, not absolute portfolio value', async () => {
    const ids = (await app.inject({ method: 'GET', url: '/public/featured-games' }))
      .json<FeaturedGame[]>()
      .map((g) => g.id);
    expect(ids.indexOf(winnerId)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(whaleId)).toBeGreaterThan(ids.indexOf(winnerId));
  });

  it('excludes games with fewer than two players', async () => {
    const ids = (await app.inject({ method: 'GET', url: '/public/featured-games' }))
      .json<FeaturedGame[]>()
      .map((g) => g.id);
    expect(ids).not.toContain(soloId);
  });
});
