import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createTestApp, createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import {
  placeWorkingOrder,
  listWorkingOrders,
  MAX_OPEN_ORDERS_PER_PLAYER,
} from '../../src/services/working-order.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seed(): Promise<{ db: Db; gamePlayerId: string }> {
  const db = await createTestDb();
  const [user] = await db
    .insert(schema.users)
    .values({ username: `f20_${Math.random().toString(36).slice(2, 10)}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('seed user');
  const [game] = await db
    .insert(schema.games)
    .values({
      name: `f20_${Math.random().toString(36).slice(2, 8)}`,
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 1_000_000,
      status: 'active',
      createdBy: user.id,
      allowLimitOrders: true,
    })
    .returning({ id: schema.games.id });
  if (!game) throw new Error('seed game');
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game.id, userId: user.id, cashBalance: 1_000_000 })
    .returning({ id: schema.gamePlayers.id });
  if (!gp) throw new Error('seed gp');
  return { db, gamePlayerId: gp.id };
}

/** Ticker-shaped but 10 chars, so it clears the route's length bound. */
function junkSymbol(i: number): string {
  return `ZQ${String(i).padStart(8, '0')}`;
}

describe('resting orders reject unparseable tickers', () => {
  it('refuses to persist a symbol that is not ticker-shaped', async () => {
    const { db, gamePlayerId } = await seed();
    for (const symbol of ['ZQ X00001', '0QZX', 'zqx', 'ZQX_1', 'ZQX*']) {
      await expect(
        placeWorkingOrder(db, {
          gamePlayerId,
          symbol,
          direction: 'buy',
          quantity: 1,
          orderType: 'limit',
          timeInForce: 'gtc',
          limitPrice: 1,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SYMBOL' });
    }
    const rows = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.gamePlayerId, gamePlayerId));
    expect(rows).toHaveLength(0);
  });

  it('caps the number of resting orders one player can accumulate', async () => {
    const { db, gamePlayerId } = await seed();
    for (let i = 0; i < MAX_OPEN_ORDERS_PER_PLAYER; i++) {
      await placeWorkingOrder(db, {
        gamePlayerId,
        symbol: junkSymbol(i),
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        timeInForce: 'gtc',
        limitPrice: 0.01,
      });
    }
    expect(await listWorkingOrders(db, gamePlayerId)).toHaveLength(MAX_OPEN_ORDERS_PER_PLAYER);

    await expect(
      placeWorkingOrder(db, {
        gamePlayerId,
        symbol: junkSymbol(MAX_OPEN_ORDERS_PER_PLAYER),
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        timeInForce: 'gtc',
        limitPrice: 0.01,
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_OPEN_ORDERS' });

    expect(await listWorkingOrders(db, gamePlayerId)).toHaveLength(MAX_OPEN_ORDERS_PER_PLAYER);
  });
});

describe('POST /games/:id/trades resting-order symbol handling', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;
  let provider: MockStockProvider;

  beforeAll(async () => {
    provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    app = await createTestApp(provider);
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'f20-route', password: 'password123' },
    });
    token = reg.json<{ token: string }>().token;
    const game = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        name: 'F20',
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2099-01-01T00:00:00.000Z',
        startingBalance: 100000,
        allowLimitOrders: true,
        allowGTC: true,
      },
    });
    gameId = game.json<{ id: string }>().id;
  });

  afterAll(async () => app.close());

  it('is rejected rather than stored as a resting order', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        symbol: 'ZQ X00001',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        timeInForce: 'gtc',
        limitPrice: 0.01,
      },
    });
    expect([400, 422]).toContain(res.statusCode);

    const list = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/trades?status=working`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(list.json<unknown[]>()).toHaveLength(0);
  });

  it('rejects a ticker-shaped symbol the provider cannot resolve', async () => {
    // ZQXA satisfies the charset rule, so only a live existence check can
    // catch it — this is precisely the gap the regex cannot close.
    provider.setError('ZQXA', 'SYMBOL_NOT_FOUND');
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        symbol: 'ZQXA',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        timeInForce: 'gtc',
        limitPrice: 0.01,
      },
    });
    expect(res.statusCode).toBe(404);

    const list = await app.inject({
      method: 'GET',
      url: `/games/${gameId}/trades?status=working`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(list.json<Array<{ symbol: string }>>().some((o) => o.symbol === 'ZQXA')).toBe(false);
  });

  it('still accepts an order when the provider is merely unavailable', async () => {
    // A provider outage must not block placement — only an unresolvable
    // ticker does.
    provider.setError('MSFT', 'RATE_LIMITED');
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        symbol: 'MSFT',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        timeInForce: 'gtc',
        limitPrice: 50,
      },
    });
    expect(res.statusCode).toBe(202);
  });
});
