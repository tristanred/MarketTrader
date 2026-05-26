import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import * as schema from '../../src/db/schema.sqlite.js';
import type { Db } from '../../src/db/index.js';
import {
  utcDayKey,
  applyTradeStats,
  applyPositionCloseStats,
  applySnapshotStats,
} from '../../src/services/game-player-stats.js';

async function seedGamePlayer(db: Db): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({ username: `u-${Math.random().toString(36).slice(2)}`, passwordHash: 'x' })
    .returning();
  const [game] = await db
    .insert(schema.games)
    .values({
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      createdBy: user!.id,
    })
    .returning();
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game!.id, userId: user!.id, cashBalance: 10000 })
    .returning();
  return gp!.id;
}

describe('utcDayKey', () => {
  it('formats an ISO timestamp as YYYY-MM-DD in UTC', () => {
    expect(utcDayKey('2026-05-25T23:59:00.000Z')).toBe('2026-05-25');
    expect(utcDayKey('2026-05-26T00:00:00.000Z')).toBe('2026-05-26');
  });

  it('uses UTC, not local time', () => {
    expect(utcDayKey('2026-05-25T23:30:00.000Z')).toBe('2026-05-25');
  });
});

describe('applyTradeStats', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let gamePlayerId: string;

  beforeEach(async () => {
    db = await createTestDb();
    gamePlayerId = await seedGamePlayer(db as unknown as Db);
  });

  it('increments totalTrades, buyTrades, totalVolumeTraded on a buy', async () => {
    await applyTradeStats(db as unknown as Db, {
      gamePlayerId,
      direction: 'buy',
      symbol: 'AAPL',
      quantity: 10,
      price: 100,
    });
    const [row] = await db
      .select()
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId));
    expect(row!.totalTrades).toBe(1);
    expect(row!.buyTrades).toBe(1);
    expect(row!.sellTrades).toBe(0);
    expect(Number(row!.totalVolumeTraded)).toBe(1000);
    expect(row!.distinctSymbolsTradedEver).toBe(1);
  });

  it('does not double-count distinctSymbolsTradedEver on a repeat symbol', async () => {
    await applyTradeStats(db as unknown as Db, {
      gamePlayerId,
      direction: 'buy',
      symbol: 'AAPL',
      quantity: 1,
      price: 1,
    });
    // Simulate the caller having inserted the first trade row before the second call.
    await db.insert(schema.trades).values({
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      status: 'executed',
      price: 1,
    });
    await applyTradeStats(db as unknown as Db, {
      gamePlayerId,
      direction: 'buy',
      symbol: 'AAPL',
      quantity: 1,
      price: 1,
    });
    const [row] = await db
      .select()
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId));
    expect(row!.distinctSymbolsTradedEver).toBe(1);
  });
});

describe('applyPositionCloseStats', () => {
  it('records a winning close: increments wins, consecutiveWins, updates bestSinglePnl', async () => {
    const db = await createTestDb();
    const gpId = await seedGamePlayer(db as unknown as Db);
    await applyPositionCloseStats(db as unknown as Db, {
      gamePlayerId: gpId,
      realizedPnl: 50,
      realizedPnlPct: 0.5,
      holdDurationMs: 1000,
    });
    const [row] = await db
      .select()
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, gpId));
    expect(row!.winningClosedPositions).toBe(1);
    expect(row!.losingClosedPositions).toBe(0);
    expect(row!.consecutiveWins).toBe(1);
    expect(Number(row!.realizedPnl)).toBe(50);
    expect(Number(row!.bestSinglePnl)).toBe(50);
    expect(Number(row!.bestSinglePnlPct)).toBe(0.5);
    expect(row!.shortestHoldMs).toBe(1000);
    expect(row!.longestHoldMs).toBe(1000);
  });

  it('records a losing close: resets consecutiveWins, updates worstSinglePnl', async () => {
    const db = await createTestDb();
    const gpId = await seedGamePlayer(db as unknown as Db);
    await applyPositionCloseStats(db as unknown as Db, {
      gamePlayerId: gpId,
      realizedPnl: 10,
      realizedPnlPct: 0.1,
      holdDurationMs: 500,
    });
    await applyPositionCloseStats(db as unknown as Db, {
      gamePlayerId: gpId,
      realizedPnl: -30,
      realizedPnlPct: -0.3,
      holdDurationMs: 2000,
    });
    const [row] = await db
      .select()
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, gpId));
    expect(row!.consecutiveWins).toBe(0);
    expect(row!.losingClosedPositions).toBe(1);
    expect(Number(row!.realizedPnl)).toBe(-20);
    expect(Number(row!.worstSinglePnl)).toBe(-30);
    expect(Number(row!.worstSinglePnlPct)).toBe(-0.3);
    expect(row!.shortestHoldMs).toBe(500);
    expect(row!.longestHoldMs).toBe(2000);
  });
});

describe('applySnapshotStats', () => {
  it('updates peak on first snapshot', async () => {
    const db = await createTestDb();
    const gpId = await seedGamePlayer(db as unknown as Db);
    await applySnapshotStats(db as unknown as Db, {
      gamePlayerId: gpId,
      totalValue: 120_000,
      rank: 2,
      totalPlayers: 5,
      capturedAt: '2026-05-25T10:00:00.000Z',
    });
    const [row] = await db
      .select()
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, gpId));
    expect(Number(row!.peakPortfolioValue)).toBe(120_000);
    expect(Number(row!.troughPortfolioValue)).toBe(120_000);
    expect(row!.bestRank).toBe(2);
    expect(row!.worstRank).toBe(2);
    expect(row!.lastRank).toBe(2);
  });

  it('advances day counters only on day rollover', async () => {
    const db = await createTestDb();
    const gpId = await seedGamePlayer(db as unknown as Db);
    await applySnapshotStats(db as unknown as Db, {
      gamePlayerId: gpId,
      totalValue: 100,
      rank: 1,
      totalPlayers: 5,
      capturedAt: '2026-05-25T10:00:00.000Z',
    });
    await applySnapshotStats(db as unknown as Db, {
      gamePlayerId: gpId,
      totalValue: 100,
      rank: 1,
      totalPlayers: 5,
      capturedAt: '2026-05-25T18:00:00.000Z',
    });
    let [row] = await db
      .select()
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, gpId));
    expect(row!.daysAtRankOne).toBe(0);

    await applySnapshotStats(db as unknown as Db, {
      gamePlayerId: gpId,
      totalValue: 100,
      rank: 1,
      totalPlayers: 5,
      capturedAt: '2026-05-26T10:00:00.000Z',
    });
    [row] = await db
      .select()
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, gpId));
    expect(row!.daysAtRankOne).toBe(1);
    expect(row!.consecutiveDaysAtRankOne).toBe(1);
  });

  it('resets consecutive counters when standing breaks', async () => {
    const db = await createTestDb();
    const gpId = await seedGamePlayer(db as unknown as Db);
    await applySnapshotStats(db as unknown as Db, {
      gamePlayerId: gpId,
      totalValue: 100,
      rank: 1,
      totalPlayers: 5,
      capturedAt: '2026-05-25T10:00:00.000Z',
    });
    await applySnapshotStats(db as unknown as Db, {
      gamePlayerId: gpId,
      totalValue: 100,
      rank: 1,
      totalPlayers: 5,
      capturedAt: '2026-05-26T10:00:00.000Z',
    });
    await applySnapshotStats(db as unknown as Db, {
      gamePlayerId: gpId,
      totalValue: 100,
      rank: 3,
      totalPlayers: 5,
      capturedAt: '2026-05-27T10:00:00.000Z',
    });
    await applySnapshotStats(db as unknown as Db, {
      gamePlayerId: gpId,
      totalValue: 100,
      rank: 3,
      totalPlayers: 5,
      capturedAt: '2026-05-28T10:00:00.000Z',
    });
    const [row] = await db
      .select()
      .from(schema.gamePlayerStats)
      .where(eq(schema.gamePlayerStats.gamePlayerId, gpId));
    expect(row!.consecutiveDaysAtRankOne).toBe(0);
    expect(row!.daysAtRankOne).toBe(2);
  });
});
