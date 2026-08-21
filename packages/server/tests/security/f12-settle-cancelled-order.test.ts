import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import {
  reservePendingTrade,
  cancelPendingTrade,
  settlePendingTrades,
} from '../../src/services/pending-trade.js';
import { schema } from '../../src/db/index.js';
import type { StockQuote } from '@markettrader/shared';

type Db = Awaited<ReturnType<typeof createTestDb>>;

/**
 * Fires `onFirstQuote` once, while the settlement worker is awaiting its quote —
 * the exact window in which a player's cancel lands.
 */
class RacingProvider extends MockStockProvider {
  private fired = false;

  constructor(private readonly onFirstQuote: () => Promise<void>) {
    super();
  }

  override async getQuote(symbol: string): Promise<StockQuote> {
    if (!this.fired) {
      this.fired = true;
      await this.onFirstQuote();
    }
    return super.getQuote(symbol);
  }
}

async function seed(): Promise<{ db: Db; gamePlayerId: string }> {
  const db = await createTestDb();
  const [user] = await db
    .insert(schema.users)
    .values({ username: `f12_${Math.random().toString(36).slice(2, 10)}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('seed user');
  const [game] = await db
    .insert(schema.games)
    .values({
      name: `f12_${Math.random().toString(36).slice(2, 8)}`,
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

describe('settlePendingTrades racing a cancel', () => {
  it('leaves a cancelled sell cancelled and pays no proceeds', async () => {
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

    const provider = new RacingProvider(async () => {
      await cancelPendingTrade(db, gamePlayerId, pending.id);
    });
    provider.setQuote('MSFT', { price: 100 });

    const outcomes = await settlePendingTrades(db, provider);
    expect(outcomes.filter((o) => o.kind === 'executed')).toHaveLength(0);

    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, pending.id));
    expect(row?.status).toBe('cancelled');
    // The cancel restored the shares; the settle must not also pay proceeds.
    expect(await qtyOf(db, gamePlayerId, 'MSFT')).toBe(10);
    expect(await cashOf(db, gamePlayerId)).toBe(10000);
  });

  it('leaves a cancelled buy cancelled and hands out no shares', async () => {
    const { db, gamePlayerId } = await seed();
    const pending = await reservePendingTrade(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      reservedPrice: 100,
    });
    expect(await cashOf(db, gamePlayerId)).toBe(9500);

    const provider = new RacingProvider(async () => {
      await cancelPendingTrade(db, gamePlayerId, pending.id);
    });
    provider.setQuote('AAPL', { price: 100 });

    const outcomes = await settlePendingTrades(db, provider);
    expect(outcomes.filter((o) => o.kind === 'executed')).toHaveLength(0);

    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, pending.id));
    expect(row?.status).toBe('cancelled');
    expect(await cashOf(db, gamePlayerId)).toBe(10000);
    expect(await qtyOf(db, gamePlayerId, 'AAPL')).toBe(0);
  });
});
