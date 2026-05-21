import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import { recordSnapshot, recordSnapshotsForActiveGames } from '../../src/services/portfolio-snapshot.js';
import { schema } from '../../src/db/index.js';
import { eq } from 'drizzle-orm';

describe('recordSnapshot', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let gameId: string;

  beforeAll(async () => {
    db = await createTestDb();

    const [creator] = await db
      .insert(schema.users)
      .values({ username: 'creator', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    if (!creator) throw new Error('creator insert failed');

    const [game] = await db
      .insert(schema.games)
      .values({
        name: 'Snapshot Test',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
        startingBalance: 10000,
        status: 'active',
        createdBy: creator.id,
      })
      .returning({ id: schema.games.id });
    if (!game) throw new Error('game insert failed');
    gameId = game.id;

    // Three players with distinct portfolio values so rank ordering is unambiguous.
    const [p1] = await db
      .insert(schema.users)
      .values({ username: 'p1', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    const [p2] = await db
      .insert(schema.users)
      .values({ username: 'p2', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    const [p3] = await db
      .insert(schema.users)
      .values({ username: 'p3', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    if (!p1 || !p2 || !p3) throw new Error('player insert failed');

    await db.insert(schema.gamePlayers).values([
      { gameId, userId: p1.id, cashBalance: 15000 },
      { gameId, userId: p2.id, cashBalance: 10000 },
      { gameId, userId: p3.id, cashBalance: 8000 },
    ]);
  });

  it('writes one snapshot row per player with rank from the leaderboard', async () => {
    const entries = await recordSnapshot(db, gameId);
    expect(entries).toHaveLength(3);

    const rows = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, gameId));

    expect(rows).toHaveLength(3);

    const byUsername = new Map<string, (typeof rows)[number] & { username: string }>();
    for (const r of rows) {
      const [gp] = await db
        .select({ username: schema.users.username })
        .from(schema.gamePlayers)
        .innerJoin(schema.users, eq(schema.gamePlayers.userId, schema.users.id))
        .where(eq(schema.gamePlayers.id, r.gamePlayerId));
      if (!gp) throw new Error('username lookup failed');
      byUsername.set(gp.username, { ...r, username: gp.username });
    }

    expect(byUsername.get('p1')?.rank).toBe(1);
    expect(byUsername.get('p1')?.totalValue).toBe(15000);
    expect(byUsername.get('p2')?.rank).toBe(2);
    expect(byUsername.get('p3')?.rank).toBe(3);
  });

  it('returns empty array and writes nothing for a game with no players', async () => {
    const [creator] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, 'creator'));
    if (!creator) throw new Error('creator lookup failed');

    const [emptyGame] = await db
      .insert(schema.games)
      .values({
        name: 'Empty',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
        startingBalance: 10000,
        status: 'active',
        createdBy: creator.id,
      })
      .returning({ id: schema.games.id });
    if (!emptyGame) throw new Error('empty game insert failed');

    const result = await recordSnapshot(db, emptyGame.id);
    expect(result).toEqual([]);

    const rows = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, emptyGame.id));
    expect(rows).toHaveLength(0);
  });
});

describe('recordSnapshotsForActiveGames', () => {
  it('snapshots only games with status=active', async () => {
    const db = await createTestDb();

    // Unique usernames — createTestDb() shares state across calls in the same file.
    const [creator] = await db
      .insert(schema.users)
      .values({ username: 'rsfag_creator', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    const [p] = await db
      .insert(schema.users)
      .values({ username: 'rsfag_p', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    if (!creator || !p) throw new Error('user insert failed');

    const [activeGame] = await db
      .insert(schema.games)
      .values({
        name: 'Active',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
        startingBalance: 10000,
        status: 'active',
        createdBy: creator.id,
      })
      .returning({ id: schema.games.id });
    const [pendingGame] = await db
      .insert(schema.games)
      .values({
        name: 'Pending',
        startDate: '2030-01-01T00:00:00.000Z',
        endDate: '2031-01-01T00:00:00.000Z',
        startingBalance: 10000,
        status: 'pending',
        createdBy: creator.id,
      })
      .returning({ id: schema.games.id });
    const [endedGame] = await db
      .insert(schema.games)
      .values({
        name: 'Ended',
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2025-06-01T00:00:00.000Z',
        startingBalance: 10000,
        status: 'ended',
        createdBy: creator.id,
      })
      .returning({ id: schema.games.id });
    if (!activeGame || !pendingGame || !endedGame) throw new Error('game insert failed');

    // Add the same player to all three so an empty-game short-circuit can't
    // explain a missing row.
    await db.insert(schema.gamePlayers).values([
      { gameId: activeGame.id, userId: p.id, cashBalance: 10000 },
      { gameId: pendingGame.id, userId: p.id, cashBalance: 10000 },
      { gameId: endedGame.id, userId: p.id, cashBalance: 10000 },
    ]);

    await recordSnapshotsForActiveGames(db);

    // Scope to the three games under test — `createTestDb()` shares state
    // across tests in the same file, so a global count would include rows
    // from sibling tests.
    const fromActive = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, activeGame.id));
    const fromPending = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, pendingGame.id));
    const fromEnded = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, endedGame.id));

    expect(fromActive).toHaveLength(1);
    expect(fromPending).toHaveLength(0);
    expect(fromEnded).toHaveLength(0);
  });
});
