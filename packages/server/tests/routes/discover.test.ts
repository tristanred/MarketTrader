import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { DiscoverResponse } from '@markettrader/shared';
import { createTestAppWithDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockProvider } from '../../src/providers/mock.js';
import * as schema from '../../src/db/schema.sqlite.js';
import type { StockProvider } from '../../src/providers/index.js';
import { runDiscoverTick } from '../../src/workers/discover.js';

/** Wraps a provider so every method call is counted. */
function countingProvider(inner: StockProvider): { provider: StockProvider; calls: string[] } {
  const calls: string[] = [];
  const provider = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push(String(prop));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { provider, calls };
}

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
      name: 'discover',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
    },
  });
  return res.json<{ id: string }>().id;
}

describe('GET /games/:id/discover', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof createTestAppWithDb>>['db'];
  let calls: string[];

  beforeAll(async () => {
    const counted = countingProvider(new MockStockProvider());
    calls = counted.calls;
    ({ app, db } = await createTestAppWithDb(counted.provider));
  });
  afterAll(async () => {
    await app.close();
  });

  const get = (gameId: string, token: string) =>
    app.inject({
      method: 'GET',
      url: `/games/${gameId}/discover`,
      headers: { Authorization: `Bearer ${token}` },
    });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/games/whatever/discover' });
    expect(res.statusCode).toBe(401);
  });

  it('404s for non-members and unknown games alike', async () => {
    const owner = await registerUser(app, `disc-owner-${Date.now()}`);
    const stranger = await registerUser(app, `disc-stranger-${Date.now()}`);
    const gameId = await createGame(app, owner);
    expect((await get(gameId, stranger)).statusCode).toBe(404);
    expect((await get('no-such-game', owner)).statusCode).toBe(404);
  });

  it('reports preparing, then the list once the worker has run, without touching the provider', async () => {
    const token = await registerUser(app, `disc-player-${Date.now()}`);
    const gameId = await createGame(app, token);

    calls.length = 0;
    const before = await get(gameId, token);
    expect(before.statusCode).toBe(200);
    expect(before.json<DiscoverResponse>()).toEqual({ status: 'preparing' });

    // After the close on a Tuesday, so the movers are captured too.
    await runDiscoverTick({
      db,
      provider: new MockProvider(),
      now: () => new Date(Date.UTC(2026, 4, 19, 20, 5, 0)),
    });

    calls.length = 0;
    const after = await get(gameId, token);
    expect(after.statusCode).toBe(200);
    const body = after.json<DiscoverResponse>();
    if (body.status !== 'ready') throw new Error(`expected ready, got ${body.status}`);
    expect(body.list.sessionDate).toBe('2026-05-19');
    expect(body.list.sections.map((s) => s.kind)).toEqual([
      'picks',
      'gainers',
      'losers',
      'active',
      'trending',
    ]);
    expect(body.list.sections[0]!.items).toHaveLength(20);
    expect(calls).toEqual([]);
  });

  it('reports ended for a finished game even when a list exists', async () => {
    const token = await registerUser(app, `disc-ended-${Date.now()}`);
    const gameId = await createGame(app, token);
    await runDiscoverTick({ db, provider: new MockProvider() });
    await db.update(schema.games).set({ status: 'ended' }).where(eq(schema.games.id, gameId));

    expect((await get(gameId, token)).json<DiscoverResponse>()).toEqual({ status: 'ended' });
  });
});
