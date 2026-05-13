import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import {
  reservePendingTrade,
  cancelPendingTrade,
  settlePendingTrades,
  listPendingTrades,
  PendingTradeNotFoundError,
} from '../../src/services/pending-trade.js';
import { TradeError } from '../../src/providers/index.js';
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

describe('reservePendingTrade — buy', () => {
  it('deducts reservedCash from cashBalance and inserts a pending row', async () => {
    const { db, gamePlayerId } = await seed();
    const pending = await reservePendingTrade(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      reservedPrice: 100,
    });
    expect(pending.reservedCash).toBe(500);
    const [player] = await db
      .select({ cash: schema.gamePlayers.cashBalance })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, gamePlayerId));
    expect(Number(player?.cash)).toBe(9500);
    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, pending.id));
    expect(row?.status).toBe('pending');
    expect(Number(row?.reservedCash)).toBe(500);
    expect(row?.price).toBeNull();
    expect(row?.executedAt).toBeNull();
  });

  it('rejects when cost exceeds cash', async () => {
    const { db, gamePlayerId } = await seed();
    await expect(
      reservePendingTrade(db, {
        gamePlayerId,
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1000,
        reservedPrice: 100,
      }),
    ).rejects.toBeInstanceOf(TradeError);
  });
});

describe('reservePendingTrade — sell', () => {
  it('decrements portfolio quantity and reserves no cash', async () => {
    const { db, gamePlayerId } = await seed();
    await db.insert(schema.portfolios).values({
      gamePlayerId,
      symbol: 'AAPL',
      quantity: 10,
      avgCostBasis: 90,
    });
    const pending = await reservePendingTrade(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 4,
      reservedPrice: 110,
    });
    expect(pending.reservedCash).toBeNull();
    const [holding] = await db
      .select({ qty: schema.portfolios.quantity })
      .from(schema.portfolios)
      .where(eq(schema.portfolios.gamePlayerId, gamePlayerId));
    expect(holding?.qty).toBe(6);
  });

  it('rejects when shares not owned', async () => {
    const { db, gamePlayerId } = await seed();
    await expect(
      reservePendingTrade(db, {
        gamePlayerId,
        symbol: 'AAPL',
        direction: 'sell',
        quantity: 1,
        reservedPrice: 100,
      }),
    ).rejects.toBeInstanceOf(TradeError);
  });
});

describe('cancelPendingTrade', () => {
  it('refunds cash on a buy and marks row cancelled', async () => {
    const { db, gamePlayerId } = await seed();
    const pending = await reservePendingTrade(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      reservedPrice: 100,
    });
    await cancelPendingTrade(db, gamePlayerId, pending.id);
    const [player] = await db
      .select({ cash: schema.gamePlayers.cashBalance })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, gamePlayerId));
    expect(Number(player?.cash)).toBe(10000);
    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, pending.id));
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelledAt).not.toBeNull();
  });

  it('restores share count on a sell cancel', async () => {
    const { db, gamePlayerId } = await seed();
    await db.insert(schema.portfolios).values({
      gamePlayerId,
      symbol: 'AAPL',
      quantity: 10,
      avgCostBasis: 90,
    });
    const pending = await reservePendingTrade(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 4,
      reservedPrice: 110,
    });
    await cancelPendingTrade(db, gamePlayerId, pending.id);
    const [holding] = await db
      .select({ qty: schema.portfolios.quantity })
      .from(schema.portfolios)
      .where(eq(schema.portfolios.gamePlayerId, gamePlayerId));
    expect(holding?.qty).toBe(10);
  });

  it('throws PendingTradeNotFoundError for unknown id', async () => {
    const { db, gamePlayerId } = await seed();
    await expect(
      cancelPendingTrade(db, gamePlayerId, 'nonexistent'),
    ).rejects.toBeInstanceOf(PendingTradeNotFoundError);
  });
});

describe('settlePendingTrades', () => {
  let env: { db: Awaited<ReturnType<typeof seed>>['db']; gamePlayerId: string };
  beforeEach(async () => {
    env = await seed();
  });

  it('fills a pending buy at the fresh quote price and adjusts cash', async () => {
    const { db, gamePlayerId } = env;
    const pending = await reservePendingTrade(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      reservedPrice: 100, // reserved 500
    });
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 90 }); // cheaper at open → refund

    await settlePendingTrades(db, provider);

    const [player] = await db
      .select({ cash: schema.gamePlayers.cashBalance })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, gamePlayerId));
    expect(Number(player?.cash)).toBe(9550); // 9500 reserved + (500-450)
    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, pending.id));
    expect(row?.status).toBe('executed');
    expect(Number(row?.price)).toBe(90);
  });

  it('cancels and refunds when actual cost exceeds reservation + remaining cash', async () => {
    const { db, gamePlayerId } = env;
    // Drain cash so the buy can't be topped up. Place buy first, then null out the rest.
    const pending = await reservePendingTrade(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      reservedPrice: 100, // reserved 500; remaining = 9500
    });
    await db
      .update(schema.gamePlayers)
      .set({ cashBalance: 0 }) // simulate the player spending everything else
      .where(eq(schema.gamePlayers.id, gamePlayerId));

    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 200 }); // 5*200 = 1000 > 0 + 500

    await settlePendingTrades(db, provider);

    const [player] = await db
      .select({ cash: schema.gamePlayers.cashBalance })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, gamePlayerId));
    // Cash was 0 after drain; reservation refunded → 500
    expect(Number(player?.cash)).toBe(500);
    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, pending.id));
    expect(row?.status).toBe('cancelled');
  });

  it('credits cash on a pending sell settle', async () => {
    const { db, gamePlayerId } = env;
    await db.insert(schema.portfolios).values({
      gamePlayerId,
      symbol: 'AAPL',
      quantity: 10,
      avgCostBasis: 90,
    });
    await reservePendingTrade(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 4,
      reservedPrice: 110,
    });
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 120 });

    await settlePendingTrades(db, provider);

    const [player] = await db
      .select({ cash: schema.gamePlayers.cashBalance })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, gamePlayerId));
    expect(Number(player?.cash)).toBe(10000 + 4 * 120);
  });
});

describe('listPendingTrades', () => {
  it('returns pending rows in placedAt order, excluding executed/cancelled', async () => {
    const { db, gamePlayerId } = await seed();
    await reservePendingTrade(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      reservedPrice: 100,
    });
    const list = await listPendingTrades(db, gamePlayerId);
    expect(list).toHaveLength(1);
    expect(list[0]?.symbol).toBe('AAPL');
  });
});
