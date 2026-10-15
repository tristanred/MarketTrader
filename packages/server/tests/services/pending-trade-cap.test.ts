import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import { reservePendingTrade } from '../../src/services/pending-trade.js';
import { MAX_OPEN_ORDERS_PER_PLAYER } from '../../src/services/working-order.js';
import { schema } from '../../src/db/index.js';

async function seed() {
  const db = await createTestDb();
  const [user] = await db
    .insert(schema.users)
    .values({ username: `u_${Math.random().toString(36).slice(2, 10)}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('seed user');
  const [game] = await db
    .insert(schema.games)
    .values({
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 1_000_000,
      status: 'active',
      createdBy: user.id,
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

function pendingBuy(gamePlayerId: string) {
  return { gamePlayerId, symbol: 'AAPL', direction: 'buy' as const, quantity: 1, reservedPrice: 1 };
}

describe('reservePendingTrade open-order cap', () => {
  it('refuses a pending order once the player holds the maximum open rows', async () => {
    const { db, gamePlayerId } = await seed();
    for (let i = 0; i < MAX_OPEN_ORDERS_PER_PLAYER; i++) {
      await reservePendingTrade(db, pendingBuy(gamePlayerId));
    }

    await expect(reservePendingTrade(db, pendingBuy(gamePlayerId))).rejects.toMatchObject({
      code: 'TOO_MANY_OPEN_ORDERS',
    });

    const pending = await db
      .select({ id: schema.trades.id })
      .from(schema.trades)
      .where(and(eq(schema.trades.gamePlayerId, gamePlayerId), eq(schema.trades.status, 'pending')));
    expect(pending).toHaveLength(MAX_OPEN_ORDERS_PER_PLAYER);
  });

  it('does not deduct cash for a refused pending buy', async () => {
    const { db, gamePlayerId } = await seed();
    for (let i = 0; i < MAX_OPEN_ORDERS_PER_PLAYER; i++) {
      await reservePendingTrade(db, pendingBuy(gamePlayerId));
    }
    const cashBefore = await cashOf(db, gamePlayerId);
    await expect(reservePendingTrade(db, pendingBuy(gamePlayerId))).rejects.toMatchObject({ code: 'TOO_MANY_OPEN_ORDERS' });
    expect(await cashOf(db, gamePlayerId)).toBe(cashBefore);
  });

  it('counts working rows toward the same cap', async () => {
    const { db, gamePlayerId } = await seed();
    await db.insert(schema.trades).values(
      Array.from({ length: MAX_OPEN_ORDERS_PER_PLAYER }, () => ({
        gamePlayerId,
        symbol: 'MSFT',
        direction: 'buy' as const,
        quantity: 1,
        status: 'working' as const,
        orderType: 'limit' as const,
        limitPrice: 0.01,
      })),
    );
    await expect(reservePendingTrade(db, pendingBuy(gamePlayerId))).rejects.toMatchObject({
      code: 'TOO_MANY_OPEN_ORDERS',
    });
  });
});

async function cashOf(db: Awaited<ReturnType<typeof createTestDb>>, gamePlayerId: string) {
  const [row] = await db
    .select({ cash: schema.gamePlayers.cashBalance })
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.id, gamePlayerId));
  return Number(row?.cash);
}
