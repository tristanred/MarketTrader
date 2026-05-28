import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import * as schema from '../../src/db/schema.sqlite.js';
import {
  onPositionOpened,
  onPositionClosed,
  updateMarks,
  getMarks,
  getAllMarks,
} from '../../src/services/position-high-water.js';
import type { Db } from '../../src/db/index.js';

async function seedPlayer(db: Db): Promise<string> {
  const [u] = await db
    .insert(schema.users)
    .values({ username: `u-${Math.random().toString(36).slice(2)}`, passwordHash: 'x' })
    .returning();
  const [g] = await db
    .insert(schema.games)
    .values({
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      createdBy: u!.id,
    })
    .returning();
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: g!.id, userId: u!.id, cashBalance: 10000 })
    .returning();
  return gp!.id;
}

describe('position-high-water', () => {
  let db: Db;
  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Db;
  });

  it('onPositionOpened seeds peak/trough at the current values', async () => {
    const gpid = await seedPlayer(db);
    await onPositionOpened(db, {
      gamePlayerId: gpid,
      symbol: 'AAPL',
      openedAt: '2026-05-27T00:00:00.000Z',
      currentPrice: 100,
      quantity: 5,
      avgCostBasis: 100,
    });
    const marks = await getMarks(db, gpid, 'AAPL');
    expect(marks).toBeDefined();
    expect(marks!.peakValue).toBe(500);
    expect(marks!.peakPnlPct).toBe(0);
    expect(marks!.troughPnlPct).toBe(0);
    expect(marks!.openedAt).toBe('2026-05-27T00:00:00.000Z');
  });

  it('updateMarks raises peak and lowers trough when price moves', async () => {
    const gpid = await seedPlayer(db);
    await onPositionOpened(db, { gamePlayerId: gpid, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 5, avgCostBasis: 100 });

    await updateMarks(db, gpid, [{ symbol: 'AAPL', currentPrice: 120, quantity: 5, avgCostBasis: 100 }]);
    let marks = await getMarks(db, gpid, 'AAPL');
    expect(marks!.peakPnlPct).toBeCloseTo(0.2);
    expect(marks!.troughPnlPct).toBe(0);
    expect(marks!.peakValue).toBe(600);

    await updateMarks(db, gpid, [{ symbol: 'AAPL', currentPrice: 80, quantity: 5, avgCostBasis: 100 }]);
    marks = await getMarks(db, gpid, 'AAPL');
    expect(marks!.peakPnlPct).toBeCloseTo(0.2);
    expect(marks!.troughPnlPct).toBeCloseTo(-0.2);
    expect(marks!.peakValue).toBe(600);
  });

  it('updateMarks skips the write when nothing changes', async () => {
    const gpid = await seedPlayer(db);
    await onPositionOpened(db, { gamePlayerId: gpid, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 5, avgCostBasis: 100 });
    await updateMarks(db, gpid, [{ symbol: 'AAPL', currentPrice: 120, quantity: 5, avgCostBasis: 100 }]);

    const [rawBefore] = await db
      .select({ updatedAt: schema.positionHighWater.updatedAt })
      .from(schema.positionHighWater)
      .where(and(eq(schema.positionHighWater.gamePlayerId, gpid), eq(schema.positionHighWater.symbol, 'AAPL')));

    // Sleep briefly so that a rewrite would necessarily produce a different ISO timestamp.
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Same price as recorded peak → no change to peak/trough/value → row should NOT be rewritten.
    await updateMarks(db, gpid, [{ symbol: 'AAPL', currentPrice: 120, quantity: 5, avgCostBasis: 100 }]);

    const [rawAfter] = await db
      .select({ updatedAt: schema.positionHighWater.updatedAt })
      .from(schema.positionHighWater)
      .where(and(eq(schema.positionHighWater.gamePlayerId, gpid), eq(schema.positionHighWater.symbol, 'AAPL')));

    expect(rawAfter!.updatedAt).toBe(rawBefore!.updatedAt);
  });

  it('onPositionClosed deletes the row', async () => {
    const gpid = await seedPlayer(db);
    await onPositionOpened(db, { gamePlayerId: gpid, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 5, avgCostBasis: 100 });
    await onPositionClosed(db, gpid, 'AAPL');
    expect(await getMarks(db, gpid, 'AAPL')).toBeUndefined();
  });

  it('re-opening a closed position resets openedAt and seeds fresh marks', async () => {
    const gpid = await seedPlayer(db);
    await onPositionOpened(db, { gamePlayerId: gpid, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 5, avgCostBasis: 100 });
    await updateMarks(db, gpid, [{ symbol: 'AAPL', currentPrice: 200, quantity: 5, avgCostBasis: 100 }]);
    await onPositionClosed(db, gpid, 'AAPL');
    await onPositionOpened(db, { gamePlayerId: gpid, symbol: 'AAPL', openedAt: '2026-06-01T00:00:00.000Z', currentPrice: 150, quantity: 2, avgCostBasis: 150 });
    const marks = await getMarks(db, gpid, 'AAPL');
    expect(marks!.openedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(marks!.peakPnlPct).toBe(0);
    expect(marks!.troughPnlPct).toBe(0);
    expect(marks!.peakValue).toBe(300);
  });

  it('getAllMarks returns all symbols for a player', async () => {
    const gpid = await seedPlayer(db);
    await onPositionOpened(db, { gamePlayerId: gpid, symbol: 'AAPL', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 100, quantity: 5, avgCostBasis: 100 });
    await onPositionOpened(db, { gamePlayerId: gpid, symbol: 'GOOG', openedAt: '2026-05-27T00:00:00.000Z', currentPrice: 200, quantity: 2, avgCostBasis: 200 });
    const all = await getAllMarks(db, gpid);
    expect(all).toHaveLength(2);
    const symbols = all.map((r) => r.symbol).sort();
    expect(symbols).toEqual(['AAPL', 'GOOG']);
  });
});
