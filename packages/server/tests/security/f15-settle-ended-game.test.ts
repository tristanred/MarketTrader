import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { reservePendingTrade, settlePendingTrades } from '../../src/services/pending-trade.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seedPlayer(
  db: Db,
  status: 'active' | 'ended',
): Promise<{ gameId: string; gamePlayerId: string }> {
  const [user] = await db
    .insert(schema.users)
    .values({ username: `f15_${Math.random().toString(36).slice(2, 10)}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('seed user');
  const [game] = await db
    .insert(schema.games)
    .values({
      name: `f15_${Math.random().toString(36).slice(2, 8)}`,
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      status,
      createdBy: user.id,
    })
    .returning({ id: schema.games.id });
  if (!game) throw new Error('seed game');
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game.id, userId: user.id, cashBalance: 10000 })
    .returning({ id: schema.gamePlayers.id });
  if (!gp) throw new Error('seed gp');
  return { gameId: game.id, gamePlayerId: gp.id };
}

describe('settlePendingTrades and game status', () => {
  it('does not settle orders whose game is no longer active', async () => {
    const db = await createTestDb();
    const live = await seedPlayer(db, 'active');
    const closed = await seedPlayer(db, 'active');

    const livePending = await reservePendingTrade(db, {
      gamePlayerId: live.gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      reservedPrice: 100,
    });
    const closedPending = await reservePendingTrade(db, {
      gamePlayerId: closed.gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      reservedPrice: 100,
    });

    // The game ends between placement and the next market open.
    await db
      .update(schema.games)
      .set({ status: 'ended' })
      .where(eq(schema.games.id, closed.gameId));

    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    await settlePendingTrades(db, provider);

    const [liveRow] = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, livePending.id));
    expect(liveRow?.status).toBe('executed');

    const [closedRow] = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, closedPending.id));
    expect(closedRow?.status).toBe('pending');

    const closedHoldings = await db
      .select()
      .from(schema.portfolios)
      .where(eq(schema.portfolios.gamePlayerId, closed.gamePlayerId));
    expect(closedHoldings).toHaveLength(0);
  });
});
