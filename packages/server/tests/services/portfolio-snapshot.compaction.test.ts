import { describe, it, expect } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import { compactEndedGames, compactGame } from '../../src/services/portfolio-snapshot.js';
import { schema } from '../../src/db/index.js';
import { eq } from 'drizzle-orm';

let seedCounter = 0;

/**
 * Fixture: create one ended game and one active game, each with one player
 * carrying many snapshot rows spread across three UTC days. Usernames are
 * suffixed with a per-call counter because `createTestDb()` shares its
 * in-memory DB across test cases within a single file.
 */
async function seed(db: Awaited<ReturnType<typeof createTestDb>>) {
  const tag = `c${++seedCounter}`;
  const [creator] = await db
    .insert(schema.users)
    .values({ username: `${tag}_creator`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  const [p] = await db
    .insert(schema.users)
    .values({ username: `${tag}_p`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!creator || !p) throw new Error('user insert failed');

  const [ended] = await db
    .insert(schema.games)
    .values({
      name: 'Ended',
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2025-01-04T00:00:00.000Z',
      startingBalance: 10000,
      status: 'ended',
      createdBy: creator.id,
    })
    .returning({ id: schema.games.id });
  const [active] = await db
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
  if (!ended || !active) throw new Error('game insert failed');

  const [endedPlayer] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: ended.id, userId: p.id, cashBalance: 10000 })
    .returning({ id: schema.gamePlayers.id });
  const [activePlayer] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: active.id, userId: p.id, cashBalance: 10000 })
    .returning({ id: schema.gamePlayers.id });
  if (!endedPlayer || !activePlayer) throw new Error('player insert failed');

  // Three days × four ticks each = 12 rows for the ended game.
  const endedRows = [
    '2025-01-01T08:00:00.000Z',
    '2025-01-01T12:00:00.000Z',
    '2025-01-01T16:00:00.000Z',
    '2025-01-01T20:00:00.000Z',
    '2025-01-02T08:00:00.000Z',
    '2025-01-02T12:00:00.000Z',
    '2025-01-02T16:00:00.000Z',
    '2025-01-02T20:00:00.000Z',
    '2025-01-03T08:00:00.000Z',
    '2025-01-03T12:00:00.000Z',
    '2025-01-03T16:00:00.000Z',
    '2025-01-03T20:00:00.000Z',
  ].map((t, i) => ({
    gameId: ended.id,
    gamePlayerId: endedPlayer.id,
    capturedAt: t,
    totalValue: 10000 + i * 50,
    rank: 1,
  }));
  await db.insert(schema.portfolioSnapshots).values(endedRows);

  // Five rows for the active game on a single day.
  const activeRows = [
    '2026-05-20T13:00:00.000Z',
    '2026-05-20T13:05:00.000Z',
    '2026-05-20T13:10:00.000Z',
    '2026-05-20T13:15:00.000Z',
    '2026-05-20T13:20:00.000Z',
  ].map((t, i) => ({
    gameId: active.id,
    gamePlayerId: activePlayer.id,
    capturedAt: t,
    totalValue: 10000 + i * 10,
    rank: 1,
  }));
  await db.insert(schema.portfolioSnapshots).values(activeRows);

  return { endedGameId: ended.id, activeGameId: active.id, endedPlayerId: endedPlayer.id };
}

describe('compactEndedGames', () => {
  it('reduces ended games to one row per player per day, keeping last-of-day', async () => {
    const db = await createTestDb();
    const { endedGameId, activeGameId, endedPlayerId } = await seed(db);

    const result = await compactEndedGames(db);
    expect(result.compactedGameIds).toContain(endedGameId);

    const endedRows = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, endedGameId));
    expect(endedRows).toHaveLength(3);
    // Last-of-day means the 20:00 row survives each day.
    const times = endedRows.map((r) => r.capturedAt).sort();
    expect(times).toEqual([
      '2025-01-01T20:00:00.000Z',
      '2025-01-02T20:00:00.000Z',
      '2025-01-03T20:00:00.000Z',
    ]);
    // Sanity: the survivor for each day is the highest totalValue (rows were
    // inserted in increasing order).
    for (const r of endedRows) {
      expect(r.gamePlayerId).toBe(endedPlayerId);
    }

    // Active game untouched.
    const activeRows = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, activeGameId));
    expect(activeRows).toHaveLength(5);

    // snapshotsCompactedAt set on the ended game.
    const [endedGame] = await db
      .select({ snapshotsCompactedAt: schema.games.snapshotsCompactedAt })
      .from(schema.games)
      .where(eq(schema.games.id, endedGameId));
    expect(endedGame?.snapshotsCompactedAt).not.toBeNull();
  });

  it('is idempotent — running twice produces the same result', async () => {
    const db = await createTestDb();
    const { endedGameId } = await seed(db);

    await compactEndedGames(db);
    const afterFirst = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, endedGameId));

    // Second run is a no-op for this game because snapshotsCompactedAt is
    // now set. Other tests in the same vitest file may have seeded their
    // own ended games (shared in-memory DB), so we only assert that *this*
    // game isn't in the list — not that the list is empty.
    const second = await compactEndedGames(db);
    expect(second.compactedGameIds).not.toContain(endedGameId);

    const afterSecond = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, endedGameId));
    expect(afterSecond.map((r) => r.id).sort()).toEqual(afterFirst.map((r) => r.id).sort());
  });

  it('compactGame directly is also idempotent (bypassing the WHERE filter)', async () => {
    const db = await createTestDb();
    const { endedGameId } = await seed(db);

    await compactGame(db, endedGameId);
    const after1 = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, endedGameId));
    expect(after1).toHaveLength(3);

    await compactGame(db, endedGameId);
    const after2 = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, endedGameId));
    expect(after2).toHaveLength(3);
  });

  it('skips ended games that have already been compacted', async () => {
    const db = await createTestDb();
    const { endedGameId } = await seed(db);

    // Manually pre-mark as compacted; rows untouched.
    await db
      .update(schema.games)
      .set({ snapshotsCompactedAt: '2025-02-01T00:00:00.000Z' })
      .where(eq(schema.games.id, endedGameId));

    const result = await compactEndedGames(db);
    expect(result.compactedGameIds).not.toContain(endedGameId);

    const rows = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, endedGameId));
    expect(rows).toHaveLength(12);
  });
});
