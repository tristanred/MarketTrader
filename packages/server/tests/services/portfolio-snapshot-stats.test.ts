import { describe, it, expect, beforeAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import { recordSnapshot } from '../../src/services/portfolio-snapshot.js';
import { schema } from '../../src/db/index.js';

describe('recordSnapshot side-effects on game_player_stats', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let gameId: string;
  let gamePlayerIds: string[];

  beforeAll(async () => {
    db = await createTestDb();

    const [creator] = await db
      .insert(schema.users)
      .values({ username: 'snap_stats_creator', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    if (!creator) throw new Error('creator insert failed');

    const [game] = await db
      .insert(schema.games)
      .values({
        name: 'Snap Stats',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
        startingBalance: 10000,
        status: 'active',
        createdBy: creator.id,
      })
      .returning({ id: schema.games.id });
    if (!game) throw new Error('game insert failed');
    gameId = game.id;

    const [p1] = await db
      .insert(schema.users)
      .values({ username: 'snap_stats_p1', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    const [p2] = await db
      .insert(schema.users)
      .values({ username: 'snap_stats_p2', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    if (!p1 || !p2) throw new Error('player insert failed');

    // Distinct cash balances so the leaderboard rank is deterministic.
    const gps = await db
      .insert(schema.gamePlayers)
      .values([
        { gameId, userId: p1.id, cashBalance: 12000 },
        { gameId, userId: p2.id, cashBalance: 8000 },
      ])
      .returning({ id: schema.gamePlayers.id });
    gamePlayerIds = gps.map((g) => g.id);
  });

  it('writes peakPortfolioValue, lastRank, and bestRank for every player', async () => {
    const entries = await recordSnapshot(db, gameId);
    expect(entries).toHaveLength(2);

    const statsRows = await db
      .select()
      .from(schema.gamePlayerStats)
      .where(inArray(schema.gamePlayerStats.gamePlayerId, gamePlayerIds));
    expect(statsRows).toHaveLength(2);

    // Resolve usernames so we can target the row that should be rank 1.
    const playerRows = await db
      .select({ id: schema.gamePlayers.id, username: schema.users.username })
      .from(schema.gamePlayers)
      .innerJoin(schema.users, eq(schema.gamePlayers.userId, schema.users.id))
      .where(inArray(schema.gamePlayers.id, gamePlayerIds));
    const usernameById = new Map(playerRows.map((p) => [p.id, p.username]));

    for (const row of statsRows) {
      const username = usernameById.get(row.gamePlayerId);
      const expectedValue = username === 'snap_stats_p1' ? 12000 : 8000;
      const expectedRank = username === 'snap_stats_p1' ? 1 : 2;

      expect(Number(row.peakPortfolioValue)).toBe(expectedValue);
      expect(Number(row.troughPortfolioValue)).toBe(expectedValue);
      expect(row.lastRank).toBe(expectedRank);
      expect(row.bestRank).toBe(expectedRank);
      expect(row.worstRank).toBe(expectedRank);
      // First snapshot of the player's first UTC day seeds lastDayRank
      // without advancing day counters.
      expect(row.lastDayRank).toBe(expectedRank);
      expect(row.daysAtRankOne).toBe(0);
    }
  });
});
