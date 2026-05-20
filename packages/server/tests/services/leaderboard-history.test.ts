import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import { getLeaderboardHistory, lttb } from '../../src/services/leaderboard-history.js';
import { schema } from '../../src/db/index.js';

let seedCounter = 0;

async function seedGameWithSnapshots(
  db: Awaited<ReturnType<typeof createTestDb>>,
  opts: {
    status?: 'active' | 'ended' | 'pending';
    startDate?: string;
    endDate?: string;
    captures?: Array<{ at: string; values: number[] }>; // values in player order
  } = {},
) {
  const tag = `lh${++seedCounter}`;
  const startDate = opts.startDate ?? '2026-01-01T00:00:00.000Z';
  const endDate = opts.endDate ?? '2027-01-01T00:00:00.000Z';
  const status = opts.status ?? 'active';

  const [creator] = await db
    .insert(schema.users)
    .values({ username: `${tag}_creator`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  const [p1] = await db
    .insert(schema.users)
    .values({ username: `${tag}_p1`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  const [p2] = await db
    .insert(schema.users)
    .values({ username: `${tag}_p2`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!creator || !p1 || !p2) throw new Error('user insert failed');

  const [game] = await db
    .insert(schema.games)
    .values({
      name: tag,
      startDate,
      endDate,
      startingBalance: 10000,
      status,
      createdBy: creator.id,
    })
    .returning({ id: schema.games.id });
  if (!game) throw new Error('game insert failed');

  const [gp1] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game.id, userId: p1.id, cashBalance: 10000 })
    .returning({ id: schema.gamePlayers.id });
  const [gp2] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game.id, userId: p2.id, cashBalance: 10000 })
    .returning({ id: schema.gamePlayers.id });
  if (!gp1 || !gp2) throw new Error('player insert failed');

  if (opts.captures) {
    const rows: typeof schema.portfolioSnapshots.$inferInsert[] = [];
    for (const cap of opts.captures) {
      const [v1, v2] = cap.values;
      if (v1 === undefined || v2 === undefined) continue;
      rows.push({ gameId: game.id, gamePlayerId: gp1.id, capturedAt: cap.at, totalValue: v1, rank: v1 >= v2 ? 1 : 2 });
      rows.push({ gameId: game.id, gamePlayerId: gp2.id, capturedAt: cap.at, totalValue: v2, rank: v2 > v1 ? 1 : 2 });
    }
    if (rows.length > 0) await db.insert(schema.portfolioSnapshots).values(rows);
  }

  return {
    gameId: game.id,
    p1Id: p1.id,
    p2Id: p2.id,
    p1Username: `${tag}_p1`,
    p2Username: `${tag}_p2`,
  };
}

describe('lttb', () => {
  it('returns the input unchanged when target >= length', () => {
    const points = [
      { t: '2026-01-01T00:00:00.000Z', v: 1, r: 1 },
      { t: '2026-01-02T00:00:00.000Z', v: 2, r: 1 },
      { t: '2026-01-03T00:00:00.000Z', v: 3, r: 1 },
    ];
    expect(lttb(points, 10)).toEqual(points);
    expect(lttb(points, 3)).toEqual(points);
  });

  it('always preserves the first and last point', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({
      t: new Date(2026, 0, 1, 0, i).toISOString(),
      v: Math.sin(i / 10) * 100 + 100,
      r: 1,
    }));
    const downsampled = lttb(points, 20);
    expect(downsampled.length).toBe(20);
    expect(downsampled[0]).toEqual(points[0]);
    expect(downsampled[downsampled.length - 1]).toEqual(points[points.length - 1]);
  });

  it('preserves a sharp spike that LTTB should identify as a triangle peak', () => {
    // Flat at 100, single spike to 1000 at index 50, flat thereafter.
    const points = Array.from({ length: 100 }, (_, i) => ({
      t: new Date(2026, 0, 1, 0, i).toISOString(),
      v: i === 50 ? 1000 : 100,
      r: 1,
    }));
    const downsampled = lttb(points, 10);
    // The spike value must survive — that's the whole point of LTTB.
    expect(downsampled.some((p) => p.v === 1000)).toBe(true);
  });
});

describe('getLeaderboardHistory', () => {
  it('returns one series per roster player, ordered points', async () => {
    const db = await createTestDb();
    const fixture = await seedGameWithSnapshots(db, {
      captures: [
        { at: '2026-01-02T10:00:00.000Z', values: [10000, 9500] },
        { at: '2026-01-02T11:00:00.000Z', values: [10200, 9800] },
        { at: '2026-01-02T12:00:00.000Z', values: [10500, 9700] },
      ],
    });

    const res = await getLeaderboardHistory(db, fixture.gameId, { range: 'all' });
    expect(res.series).toHaveLength(2);

    const p1Series = res.series.find((s) => s.playerId === fixture.p1Id);
    expect(p1Series?.username).toBe(fixture.p1Username);
    expect(p1Series?.points.map((p) => p.v)).toEqual([10000, 10200, 10500]);

    const p2Series = res.series.find((s) => s.playerId === fixture.p2Id);
    expect(p2Series?.points.map((p) => p.v)).toEqual([9500, 9800, 9700]);
  });

  it('returns empty point arrays for players with no snapshots in range', async () => {
    const db = await createTestDb();
    const fixture = await seedGameWithSnapshots(db, {
      captures: [{ at: '2026-01-02T10:00:00.000Z', values: [10000, 9500] }],
    });

    // Drop p2's snapshots so they have no points in range.
    const [p2Gp] = await db
      .select({ id: schema.gamePlayers.id })
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.userId, fixture.p2Id));
    if (!p2Gp) throw new Error('p2 gp lookup failed');
    await db
      .delete(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.gamePlayerId, p2Gp.id));

    const res = await getLeaderboardHistory(db, fixture.gameId, { range: 'all' });
    expect(res.series).toHaveLength(2);
    const p2Series = res.series.find((s) => s.playerId === fixture.p2Id);
    expect(p2Series?.points).toEqual([]);
  });

  it('filters by range (1d window from now)', async () => {
    const db = await createTestDb();
    const now = Date.now();
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const twelveHoursAgo = new Date(now - 12 * 60 * 60 * 1000).toISOString();

    const fixture = await seedGameWithSnapshots(db, {
      startDate: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      captures: [
        { at: twoDaysAgo, values: [10000, 9500] },     // outside 1d window
        { at: twelveHoursAgo, values: [10200, 9800] }, // inside 1d window
      ],
    });

    const res = await getLeaderboardHistory(db, fixture.gameId, { range: '1d' });
    const p1Series = res.series.find((s) => s.playerId === fixture.p1Id);
    expect(p1Series?.points).toHaveLength(1);
    expect(p1Series?.points[0]?.v).toBe(10200);
  });

  it('respects maxPoints by downsampling via LTTB', async () => {
    const db = await createTestDb();
    const captures = Array.from({ length: 100 }, (_, i) => ({
      at: new Date(Date.parse('2026-01-02T00:00:00.000Z') + i * 60000).toISOString(),
      values: [10000 + i, 9500 + i] as number[],
    }));
    const fixture = await seedGameWithSnapshots(db, { captures });

    const res = await getLeaderboardHistory(db, fixture.gameId, { range: 'all', maxPoints: 20 });
    const p1Series = res.series.find((s) => s.playerId === fixture.p1Id);
    expect(p1Series?.points.length).toBeLessThanOrEqual(20);
    // Endpoints survive.
    expect(p1Series?.points[0]?.v).toBe(10000);
    expect(p1Series?.points[p1Series.points.length - 1]?.v).toBe(10099);
  });

  it('uses ranks from the snapshot row, not recomputed', async () => {
    const db = await createTestDb();
    const fixture = await seedGameWithSnapshots(db, {
      captures: [{ at: '2026-01-02T10:00:00.000Z', values: [10000, 9500] }],
    });

    // Forcibly override one snapshot's rank to something nonsensical to
    // prove the endpoint returns the stored value, not a recomputation.
    await db
      .update(schema.portfolioSnapshots)
      .set({ rank: 99 })
      .where(eq(schema.portfolioSnapshots.gameId, fixture.gameId));

    const res = await getLeaderboardHistory(db, fixture.gameId, { range: 'all' });
    for (const s of res.series) {
      expect(s.points[0]?.r).toBe(99);
    }
  });

  it('clamps endedAt to game.endDate for ended games', async () => {
    const db = await createTestDb();
    const fixture = await seedGameWithSnapshots(db, {
      status: 'ended',
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2025-06-01T00:00:00.000Z',
      captures: [{ at: '2025-03-01T10:00:00.000Z', values: [10000, 9500] }],
    });

    const res = await getLeaderboardHistory(db, fixture.gameId, { range: 'all' });
    expect(res.startedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(res.endedAt).toBe('2025-06-01T00:00:00.000Z');
  });
});
