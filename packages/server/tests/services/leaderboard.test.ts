import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import { computeLeaderboard } from '../../src/services/leaderboard.js';
import { schema } from '../../src/db/index.js';

describe('computeLeaderboard', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let gameId: string;
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    db = await createTestDb();

    const [alice] = await db.insert(schema.users).values({ username: 'alice', passwordHash: 'x' }).returning({ id: schema.users.id });
    const [bob] = await db.insert(schema.users).values({ username: 'bob', passwordHash: 'x' }).returning({ id: schema.users.id });
    if (!alice || !bob) throw new Error('Failed to insert test users');

    aliceId = alice.id;
    bobId = bob.id;

    const [game] = await db.insert(schema.games).values({
      name: 'Test',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
      startingBalance: 10000,
      status: 'active',
      createdBy: alice.id,
    }).returning({ id: schema.games.id });
    if (!game) throw new Error('Failed to insert test game');
    gameId = game.id;

    const [aliceGp] = await db.insert(schema.gamePlayers).values({ gameId, userId: alice.id, cashBalance: 10000 }).returning({ id: schema.gamePlayers.id });
    const [bobGp] = await db.insert(schema.gamePlayers).values({ gameId, userId: bob.id, cashBalance: 8000 }).returning({ id: schema.gamePlayers.id });
    if (!aliceGp || !bobGp) throw new Error('Failed to insert test game players');
  });

  it('returns empty array when game has no players', async () => {
    const firstUser = (await db.select({ id: schema.users.id }).from(schema.users).limit(1))[0];
    if (!firstUser) throw new Error('No users found');
    const [emptyGame] = await db.insert(schema.games).values({
      name: 'Empty',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
      startingBalance: 10000,
      status: 'pending',
      createdBy: firstUser.id,
    }).returning({ id: schema.games.id });
    if (!emptyGame) throw new Error('Failed to insert empty game');
    const result = await computeLeaderboard(db, emptyGame.id);
    expect(result).toEqual([]);
  });

  it('returns all players with correct rank order', async () => {
    const result = await computeLeaderboard(db, gameId);
    expect(result).toHaveLength(2);
    expect(result[0]?.rank).toBe(1);
    expect(result[1]?.rank).toBe(2);
    // alice has 10000, bob has 8000
    expect(result[0]?.username).toBe('alice');
    expect(result[0]?.totalValue).toBe(10000);
    expect(result[1]?.username).toBe('bob');
    expect(result[1]?.totalValue).toBe(8000);
  });

  it('includes portfolio value in totalValue using cached price', async () => {
    // Use a separate game and players to avoid shared state with other tests
    const [game3] = await db.insert(schema.games).values({
      name: 'Cache Test',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
      startingBalance: 10000,
      status: 'active',
      createdBy: aliceId,
    }).returning({ id: schema.games.id });
    if (!game3) throw new Error('Failed to insert cache test game');

    const [aliceGp3] = await db.insert(schema.gamePlayers).values({
      gameId: game3.id,
      userId: aliceId,
      cashBalance: 10000,
    }).returning({ id: schema.gamePlayers.id });
    if (!aliceGp3) throw new Error('Failed to insert alice game player');

    await db.insert(schema.stockPriceCache).values({ symbol: 'AAPL', price: 200, change: 0, changePercent: 0 });
    await db.insert(schema.portfolios).values({ gamePlayerId: aliceGp3.id, symbol: 'AAPL', quantity: 5, avgCostBasis: 150 });

    const result = await computeLeaderboard(db, game3.id);
    const alice = result.find(e => e.username === 'alice');
    expect(alice).toBeDefined();
    // 10000 cash + 5 * 200 (cached price) = 11000
    expect(alice!.totalValue).toBe(11000);
  });

  it('falls back to avgCostBasis for portfolio value when no cache entry exists', async () => {
    // Use a separate game and players to avoid shared state with other tests
    const [game4] = await db.insert(schema.games).values({
      name: 'Fallback Test',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
      startingBalance: 10000,
      status: 'active',
      createdBy: bobId,
    }).returning({ id: schema.games.id });
    if (!game4) throw new Error('Failed to insert fallback test game');

    const [bobGp4] = await db.insert(schema.gamePlayers).values({
      gameId: game4.id,
      userId: bobId,
      cashBalance: 8000,
    }).returning({ id: schema.gamePlayers.id });
    if (!bobGp4) throw new Error('Failed to insert bob game player');

    await db.insert(schema.portfolios).values({ gamePlayerId: bobGp4.id, symbol: 'TSLA', quantity: 2, avgCostBasis: 300 });
    // No stockPriceCache entry for TSLA

    const result = await computeLeaderboard(db, game4.id);
    const bob = result.find(e => e.username === 'bob');
    expect(bob).toBeDefined();
    // 8000 cash + 2 * 300 (avgCostBasis fallback) = 8600
    expect(bob!.cashBalance).toBe(8000);
    expect(bob!.totalValue).toBe(8600);
  });
});
