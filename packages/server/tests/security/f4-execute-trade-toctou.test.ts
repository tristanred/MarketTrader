import { describe, it, expect, vi, afterEach } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import { executeTrade } from '../../src/services/trade.js';
import { reservePendingTrade } from '../../src/services/pending-trade.js';
import { TradeError } from '../../src/providers/index.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seed(cash = 10000): Promise<{ db: Db; gamePlayerId: string }> {
  const db = await createTestDb();
  const [user] = await db
    .insert(schema.users)
    .values({ username: `f4_${Math.random().toString(36).slice(2, 10)}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('seed user');
  const [game] = await db
    .insert(schema.games)
    .values({
      name: `f4_${Math.random().toString(36).slice(2, 8)}`,
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: cash,
      status: 'active',
      createdBy: user.id,
    })
    .returning({ id: schema.games.id });
  if (!game) throw new Error('seed game');
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game.id, userId: user.id, cashBalance: cash })
    .returning({ id: schema.gamePlayers.id });
  if (!gp) throw new Error('seed gp');
  return { db, gamePlayerId: gp.id };
}

async function cashOf(db: Db, gamePlayerId: string): Promise<number> {
  const [p] = await db
    .select({ c: schema.gamePlayers.cashBalance })
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.id, gamePlayerId));
  return Number(p?.c ?? 0);
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

/**
 * Lets a competing writer commit in the window between a service's
 * pre-transaction check and its transaction, without relying on two real
 * writers interleaving (libsql serializes those outright).
 */
function commitBeforeNextTransaction(db: Db, hook: () => Promise<void>): void {
  const original = db.transaction.bind(db) as Db['transaction'];
  vi.spyOn(db, 'transaction').mockImplementationOnce((async (
    ...args: Parameters<Db['transaction']>
  ) => {
    await hook();
    return original(...args);
  }) as Db['transaction']);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('executeTrade against a concurrently-changed balance', () => {
  it('cannot spend cash a sibling trade already spent', async () => {
    const { db, gamePlayerId } = await seed();

    commitBeforeNextTransaction(db, async () => {
      // A second order for the same player commits first and takes the cash.
      await db
        .update(schema.gamePlayers)
        .set({ cashBalance: sql`${schema.gamePlayers.cashBalance} - 10000` })
        .where(eq(schema.gamePlayers.id, gamePlayerId));
    });

    await expect(
      executeTrade(db, {
        gamePlayerId,
        symbol: 'AAA',
        direction: 'buy',
        quantity: 100,
        price: 100,
      }),
    ).rejects.toBeInstanceOf(TradeError);

    // The balance must stay where the sibling left it — never restored upward.
    expect(await cashOf(db, gamePlayerId)).toBe(0);
    expect(await qtyOf(db, gamePlayerId, 'AAA')).toBe(0);
  });

  it('cannot sell shares a sibling trade already sold', async () => {
    const { db, gamePlayerId } = await seed();
    await db
      .insert(schema.portfolios)
      .values({ gamePlayerId, symbol: 'MSFT', quantity: 10, avgCostBasis: 50 });

    commitBeforeNextTransaction(db, async () => {
      await db
        .delete(schema.portfolios)
        .where(
          and(
            eq(schema.portfolios.gamePlayerId, gamePlayerId),
            eq(schema.portfolios.symbol, 'MSFT'),
          ),
        );
      await db
        .update(schema.gamePlayers)
        .set({ cashBalance: sql`${schema.gamePlayers.cashBalance} + 1000` })
        .where(eq(schema.gamePlayers.id, gamePlayerId));
    });

    await expect(
      executeTrade(db, {
        gamePlayerId,
        symbol: 'MSFT',
        direction: 'sell',
        quantity: 10,
        price: 100,
      }),
    ).rejects.toBeInstanceOf(TradeError);

    // Exactly one set of proceeds, and no resurrected position.
    expect(await cashOf(db, gamePlayerId)).toBe(11000);
    expect(await qtyOf(db, gamePlayerId, 'MSFT')).toBe(0);
  });

  it('still fills an order that spends the balance exactly', async () => {
    const { db, gamePlayerId } = await seed();
    const result = await executeTrade(db, {
      gamePlayerId,
      symbol: 'AAA',
      direction: 'buy',
      quantity: 100,
      price: 100,
    });
    expect(result.trade.quantity).toBe(100);
    expect(await cashOf(db, gamePlayerId)).toBe(0);
    expect(await qtyOf(db, gamePlayerId, 'AAA')).toBe(100);

    await expect(
      executeTrade(db, { gamePlayerId, symbol: 'BBB', direction: 'buy', quantity: 1, price: 1 }),
    ).rejects.toBeInstanceOf(TradeError);
  });
});

describe('reservePendingTrade against a concurrently-changed balance', () => {
  it('cannot reserve cash a sibling order already reserved', async () => {
    const { db, gamePlayerId } = await seed();

    commitBeforeNextTransaction(db, async () => {
      await db
        .update(schema.gamePlayers)
        .set({ cashBalance: sql`${schema.gamePlayers.cashBalance} - 10000` })
        .where(eq(schema.gamePlayers.id, gamePlayerId));
    });

    await expect(
      reservePendingTrade(db, {
        gamePlayerId,
        symbol: 'AAA',
        direction: 'buy',
        quantity: 100,
        reservedPrice: 100,
      }),
    ).rejects.toBeInstanceOf(TradeError);

    expect(await cashOf(db, gamePlayerId)).toBe(0);
    const rows = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.gamePlayerId, gamePlayerId));
    expect(rows).toHaveLength(0);
  });

  it('cannot reserve shares a sibling order already reserved', async () => {
    const { db, gamePlayerId } = await seed();
    await db
      .insert(schema.portfolios)
      .values({ gamePlayerId, symbol: 'MSFT', quantity: 10, avgCostBasis: 50 });

    commitBeforeNextTransaction(db, async () => {
      await db
        .delete(schema.portfolios)
        .where(
          and(
            eq(schema.portfolios.gamePlayerId, gamePlayerId),
            eq(schema.portfolios.symbol, 'MSFT'),
          ),
        );
    });

    await expect(
      reservePendingTrade(db, {
        gamePlayerId,
        symbol: 'MSFT',
        direction: 'sell',
        quantity: 10,
        reservedPrice: 100,
      }),
    ).rejects.toBeInstanceOf(TradeError);

    expect(await qtyOf(db, gamePlayerId, 'MSFT')).toBe(0);
  });
});
