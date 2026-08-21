import { describe, it, expect, vi, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import {
  reservePendingTrade,
  cancelPendingTrade,
  PendingTradeNotFoundError,
} from '../../src/services/pending-trade.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seed(): Promise<{ db: Db; gamePlayerId: string }> {
  const db = await createTestDb();
  const [user] = await db
    .insert(schema.users)
    .values({ username: `f14_${Math.random().toString(36).slice(2, 10)}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('seed user');
  const [game] = await db
    .insert(schema.games)
    .values({
      name: `f14_${Math.random().toString(36).slice(2, 8)}`,
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      status: 'active',
      createdBy: user.id,
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

describe('cancelPendingTrade racing another cancel', () => {
  it('refunds a buy reservation exactly once', async () => {
    const { db, gamePlayerId } = await seed();
    const pending = await reservePendingTrade(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      reservedPrice: 100,
    });
    expect(await cashOf(db, gamePlayerId)).toBe(9500);

    commitBeforeNextTransaction(db, async () => {
      await cancelPendingTrade(db, gamePlayerId, pending.id);
    });

    await expect(cancelPendingTrade(db, gamePlayerId, pending.id)).rejects.toBeInstanceOf(
      PendingTradeNotFoundError,
    );

    expect(await cashOf(db, gamePlayerId)).toBe(10000);
    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, pending.id));
    expect(row?.status).toBe('cancelled');
  });

  it('restores a sell reservation exactly once', async () => {
    const { db, gamePlayerId } = await seed();
    await db
      .insert(schema.portfolios)
      .values({ gamePlayerId, symbol: 'MSFT', quantity: 10, avgCostBasis: 50 });

    const pending = await reservePendingTrade(db, {
      gamePlayerId,
      symbol: 'MSFT',
      direction: 'sell',
      quantity: 10,
      reservedPrice: 100,
    });
    expect(await qtyOf(db, gamePlayerId, 'MSFT')).toBe(0);

    commitBeforeNextTransaction(db, async () => {
      await cancelPendingTrade(db, gamePlayerId, pending.id);
    });

    await expect(cancelPendingTrade(db, gamePlayerId, pending.id)).rejects.toBeInstanceOf(
      PendingTradeNotFoundError,
    );

    expect(await qtyOf(db, gamePlayerId, 'MSFT')).toBe(10);
  });
});
