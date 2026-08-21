import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import {
  placeWorkingOrder,
  cancelWorkingOrder,
  evaluateTriggers,
} from '../../src/services/working-order.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seed(): Promise<{ db: Db; gamePlayerId: string }> {
  const db = await createTestDb();
  const [user] = await db
    .insert(schema.users)
    .values({ username: `f13_${Math.random().toString(36).slice(2, 10)}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('seed user');
  const [game] = await db
    .insert(schema.games)
    .values({
      name: `f13_${Math.random().toString(36).slice(2, 8)}`,
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      status: 'active',
      createdBy: user.id,
      allowBracketOrders: true,
    })
    .returning({ id: schema.games.id });
  if (!game) throw new Error('seed game');
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game.id, userId: user.id, cashBalance: 10000 })
    .returning({ id: schema.gamePlayers.id });
  if (!gp) throw new Error('seed gp');
  return { db, gamePlayerId: gp.id };
}

async function qtyOf(db: Db, gamePlayerId: string, symbol: string): Promise<number> {
  const [h] = await db
    .select({ q: schema.portfolios.quantity })
    .from(schema.portfolios)
    .where(
      and(eq(schema.portfolios.gamePlayerId, gamePlayerId), eq(schema.portfolios.symbol, symbol)),
    );
  return h?.q ?? 0;
}

async function cashOf(db: Db, gamePlayerId: string): Promise<number> {
  const [p] = await db
    .select({ c: schema.gamePlayers.cashBalance })
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.id, gamePlayerId));
  return Number(p?.c ?? 0);
}

describe('cancelling a filled bracket’s children', () => {
  it('does not credit shares the children never reserved', async () => {
    const { db, gamePlayerId } = await seed();
    const orders = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'BRKT',
      direction: 'buy',
      quantity: 10,
      orderType: 'bracket',
      timeInForce: 'day',
      limitPrice: 100,
      takeProfitPrice: 120,
      stopLossPrice: 90,
    });
    const tp = orders.find((o) => o.bracketRole === 'take_profit')!;
    const sl = orders.find((o) => o.bracketRole === 'stop_loss')!;

    const provider = new MockStockProvider();
    provider.setQuote('BRKT', { price: 95 });
    await evaluateTriggers(db, provider);
    expect(await qtyOf(db, gamePlayerId, 'BRKT')).toBe(10);

    const cashAfterEntry = await cashOf(db, gamePlayerId);

    await cancelWorkingOrder(db, gamePlayerId, tp.id);
    await cancelWorkingOrder(db, gamePlayerId, sl.id);

    // Only the entry ever reserved. Cancelling the children must leave the
    // position and the balance exactly as the entry fill left them.
    expect(await qtyOf(db, gamePlayerId, 'BRKT')).toBe(10);
    expect(await cashOf(db, gamePlayerId)).toBe(cashAfterEntry);
  });

  it('does not credit cash to a short bracket’s children', async () => {
    const { db, gamePlayerId } = await seed();
    await db
      .insert(schema.portfolios)
      .values({ gamePlayerId, symbol: 'SHRT', quantity: 10, avgCostBasis: 100 });

    const orders = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'SHRT',
      direction: 'sell',
      quantity: 10,
      orderType: 'bracket',
      timeInForce: 'day',
      limitPrice: 100,
      takeProfitPrice: 80,
      stopLossPrice: 120,
    });
    const tp = orders.find((o) => o.bracketRole === 'take_profit')!;
    const sl = orders.find((o) => o.bracketRole === 'stop_loss')!;

    const provider = new MockStockProvider();
    provider.setQuote('SHRT', { price: 100 });
    await evaluateTriggers(db, provider);

    const cashAfterEntry = await cashOf(db, gamePlayerId);
    const qtyAfterEntry = await qtyOf(db, gamePlayerId, 'SHRT');

    await cancelWorkingOrder(db, gamePlayerId, tp.id);
    await cancelWorkingOrder(db, gamePlayerId, sl.id);

    expect(await cashOf(db, gamePlayerId)).toBe(cashAfterEntry);
    expect(await qtyOf(db, gamePlayerId, 'SHRT')).toBe(qtyAfterEntry);
  });
});
