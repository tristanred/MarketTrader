import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ResolvedLimit } from '../../src/limits/resolver.js';
import { LimitExceededError } from '../../src/limits/errors.js';
import { createTestDb } from '../helpers/app.js';
import { placeWorkingOrder } from '../../src/services/working-order.js';
import { reservePendingTrade } from '../../src/services/pending-trade.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

function limitOf(max: number | null): ResolvedLimit {
  return { key: 'openOrders', max, basis: 'base', privileged: false, probation: false };
}

async function seed(): Promise<{ db: Db; gamePlayerId: string }> {
  const db = await createTestDb();
  const tag = Math.random().toString(36).slice(2, 10);
  const [user] = await db
    .insert(schema.users)
    .values({ username: `oo_${tag}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  const [game] = await db
    .insert(schema.games)
    .values({
      name: `oo_${tag}`,
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 1_000_000,
      status: 'active',
      createdBy: user!.id,
      allowLimitOrders: true,
      allowBracketOrders: true,
    })
    .returning({ id: schema.games.id });
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game!.id, userId: user!.id, cashBalance: 1_000_000 })
    .returning({ id: schema.gamePlayers.id });
  return { db, gamePlayerId: gp!.id };
}

function limitBuy(db: Db, gamePlayerId: string, symbol: string, limit: ResolvedLimit | undefined) {
  return placeWorkingOrder(db, {
    gamePlayerId,
    symbol,
    direction: 'buy',
    quantity: 1,
    orderType: 'limit',
    timeInForce: 'gtc',
    limitPrice: 1,
    ...(limit ? { openOrderLimit: limit } : {}),
  });
}

function pendingBuy(
  db: Db,
  gamePlayerId: string,
  symbol: string,
  limit: ResolvedLimit | undefined,
) {
  return reservePendingTrade(db, {
    gamePlayerId,
    symbol,
    direction: 'buy',
    quantity: 1,
    reservedPrice: 1,
    ...(limit ? { openOrderLimit: limit } : {}),
  });
}

describe('open-order cap', () => {
  it('refuses a working order past the resolved max', async () => {
    const { db, gamePlayerId } = await seed();
    await limitBuy(db, gamePlayerId, 'AAA', limitOf(2));
    await limitBuy(db, gamePlayerId, 'BBB', limitOf(2));
    await expect(limitBuy(db, gamePlayerId, 'CCC', limitOf(2))).rejects.toBeInstanceOf(
      LimitExceededError,
    );
  });

  it('refuses a pending order past the resolved max', async () => {
    const { db, gamePlayerId } = await seed();
    await pendingBuy(db, gamePlayerId, 'AAA', limitOf(2));
    await pendingBuy(db, gamePlayerId, 'BBB', limitOf(2));
    await expect(pendingBuy(db, gamePlayerId, 'CCC', limitOf(2))).rejects.toBeInstanceOf(
      LimitExceededError,
    );
  });

  it('counts working and pending rows together', async () => {
    const { db, gamePlayerId } = await seed();
    await limitBuy(db, gamePlayerId, 'AAA', limitOf(2));
    await pendingBuy(db, gamePlayerId, 'BBB', limitOf(2));
    await expect(pendingBuy(db, gamePlayerId, 'CCC', limitOf(2))).rejects.toBeInstanceOf(
      LimitExceededError,
    );
    await expect(limitBuy(db, gamePlayerId, 'DDD', limitOf(2))).rejects.toBeInstanceOf(
      LimitExceededError,
    );
  });

  it('counts all three rows of a bracket against the cap', async () => {
    const { db, gamePlayerId } = await seed();
    await limitBuy(db, gamePlayerId, 'AAA', limitOf(3));
    await expect(
      placeWorkingOrder(db, {
        gamePlayerId,
        symbol: 'BBB',
        direction: 'buy',
        quantity: 1,
        orderType: 'bracket',
        timeInForce: 'gtc',
        limitPrice: 10,
        takeProfitPrice: 12,
        stopLossPrice: 8,
        openOrderLimit: limitOf(3),
      }),
    ).rejects.toBeInstanceOf(LimitExceededError);
  });

  it('carries the resolved limit on the error', async () => {
    const { db, gamePlayerId } = await seed();
    await pendingBuy(db, gamePlayerId, 'AAA', limitOf(1));
    const err = await pendingBuy(db, gamePlayerId, 'BBB', limitOf(1)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LimitExceededError);
    expect((err as LimitExceededError).resolved).toMatchObject({ key: 'openOrders', max: 1 });
  });

  it('applies no cap when the resolved max is null (admin) or no limit is passed', async () => {
    const { db, gamePlayerId } = await seed();
    for (const symbol of ['AAA', 'BBB', 'CCC'])
      await limitBuy(db, gamePlayerId, symbol, limitOf(null));
    for (const symbol of ['DDD', 'EEE']) await pendingBuy(db, gamePlayerId, symbol, undefined);
    const open = await db
      .select({ id: schema.trades.id })
      .from(schema.trades)
      .where(eq(schema.trades.gamePlayerId, gamePlayerId));
    expect(open).toHaveLength(5);
  });
});
