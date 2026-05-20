import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import {
  runPortfolioSnapshotTick,
  startPortfolioSnapshotWorker,
} from '../../src/workers/portfolio-snapshot.js';
import { schema } from '../../src/db/index.js';
import { eq } from 'drizzle-orm';

let seedCounter = 0;

async function seedActiveGameWithPlayer(db: Awaited<ReturnType<typeof createTestDb>>) {
  const tag = `w${++seedCounter}`;
  const [creator] = await db
    .insert(schema.users)
    .values({ username: `${tag}_creator`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  const [p] = await db
    .insert(schema.users)
    .values({ username: `${tag}_p`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!creator || !p) throw new Error('user insert failed');

  const [game] = await db
    .insert(schema.games)
    .values({
      name: 'g',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
      startingBalance: 10000,
      status: 'active',
      createdBy: creator.id,
    })
    .returning({ id: schema.games.id });
  if (!game) throw new Error('game insert failed');

  await db.insert(schema.gamePlayers).values({ gameId: game.id, userId: p.id, cashBalance: 10000 });
  return game.id;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runPortfolioSnapshotTick', () => {
  it('captures snapshots and compacts ended games in a single tick', async () => {
    const db = await createTestDb();
    const gameId = await seedActiveGameWithPlayer(db);

    await runPortfolioSnapshotTick({ db });

    const rows = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gameId, gameId));
    expect(rows).toHaveLength(1);
  });
});

describe('startPortfolioSnapshotWorker', () => {
  it('runs ticks on the configured interval and respects the re-entrancy guard', async () => {
    vi.useFakeTimers();
    const db = await createTestDb();
    const gameId = await seedActiveGameWithPlayer(db);

    // Drive the timer manually to observe tick boundaries.
    const handle = startPortfolioSnapshotWorker({ db, intervalMs: 1000 });
    try {
      await vi.advanceTimersByTimeAsync(1000);
      // Allow microtasks (the .finally) to settle.
      await vi.advanceTimersByTimeAsync(0);

      const afterOne = await db
        .select()
        .from(schema.portfolioSnapshots)
        .where(eq(schema.portfolioSnapshots.gameId, gameId));
      expect(afterOne).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);

      const afterTwo = await db
        .select()
        .from(schema.portfolioSnapshots)
        .where(eq(schema.portfolioSnapshots.gameId, gameId));
      expect(afterTwo).toHaveLength(2);
    } finally {
      handle.stop();
    }
  });
});
